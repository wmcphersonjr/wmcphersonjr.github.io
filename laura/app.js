(function () {
  "use strict";

  const app = document.getElementById("app");
  const gate = document.getElementById("gate");
  const lightbox = document.getElementById("lightbox");

  // ---------- storage (per-device conveniences only) ----------
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem("laurita:" + key); return v ? JSON.parse(v) : fallback; }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem("laurita:" + key, JSON.stringify(value)); } catch { /* ignore */ }
    },
    remove(key) {
      try { localStorage.removeItem("laurita:" + key); } catch { /* ignore */ }
    },
  };

  const theme = store.get("theme", null);
  if (theme) document.documentElement.dataset.theme = theme;

  // ---------- decryption (must match tools/lock.mjs) ----------
  const ITERATIONS = 310000;

  async function deriveKey(passcode, salt) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passcode), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  }

  async function decrypt(key, bytes) {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, key, bytes.subarray(12)));
  }

  const fetchBytes = url => fetch(url).then(r => {
    if (!r.ok) throw new Error(url + " " + r.status);
    return r.arrayBuffer();
  }).then(b => new Uint8Array(b));

  // Throws if the passcode is wrong (AES-GCM authentication fails)
  async function unlock(passcode) {
    const [saltText, content] = await Promise.all([fetch("data/salt").then(r => r.text()), fetchBytes("data/content.bin")]);
    const salt = Uint8Array.from(atob(saltText.trim()), c => c.charCodeAt(0));
    const key = await deriveKey(passcode, salt);
    const data = JSON.parse(new TextDecoder().decode(await decrypt(key, content)));
    return { data, key };
  }

  function showGate() {
    gate.hidden = false;
    const form = gate.querySelector("form");
    const input = gate.querySelector("#code");
    const msg = gate.querySelector(".gate-msg");
    input.focus();
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const code = input.value.trim();
      if (!code) return;
      msg.textContent = "Opening…";
      try {
        const opened = await unlock(code);
        store.set("code", code);
        gate.hidden = true;
        start(opened);
      } catch (err) {
        // AES-GCM rejects a wrong key with OperationError; anything else is a loading problem
        if (err && err.name === "OperationError") {
          msg.textContent = "That's not it. Try again.";
          input.value = "";
          form.classList.remove("shake"); void form.offsetWidth; form.classList.add("shake");
        } else {
          msg.textContent = "Couldn't open the book. Check your connection and try again.";
        }
      }
    });
  }

  // Decryption (crypto.subtle) only exists on secure pages, so plain http can never unlock.
  // Move to https when it's available; otherwise say so instead of rejecting the passcode.
  function requireHttps() {
    if (window.isSecureContext && window.crypto && crypto.subtle) return false;
    const secureUrl = location.href.replace(/^http:/, "https:");
    gate.hidden = false;
    gate.querySelector("form").innerHTML = `
      <p class="gate-heart" aria-hidden="true">💛</p>
      <h1>Laurita</h1>
      <p class="lede">Opening the secure version…</p>`;
    fetch(secureUrl.split("#")[0], { mode: "no-cors", cache: "no-store", signal: AbortSignal.timeout(6000) })
      .then(() => location.replace(secureUrl))
      .catch(() => {
        gate.querySelector(".lede").innerHTML =
          `The secure version of this site is still being set up. Try again in a few minutes at <a href="${secureUrl}">${secureUrl.split("#")[0]}</a>.`;
      });
    return true;
  }

  if (!requireHttps()) {
    const remembered = store.get("code", null);
    if (remembered) unlock(remembered).then(start, () => { store.remove("code"); showGate(); });
    else showGate();
  }

  // ---------- the book ----------
  function start({ data, key }) {
    const { BOOK, GROUPS, SECTIONS, TAGS, MOODS, PEOPLE, FACTS } = data;

    const saved = new Set(store.get("saved", []));
    const readSet = new Set(store.get("read", []));
    let showEnglish = store.get("english", false);

    // Letters in table-of-contents order
    const groupIndex = Object.fromEntries(GROUPS.map((g, i) => [g.id, i]));
    const letters = PEOPLE.map((p, i) => ({ p, i }))
      .sort((a, b) => groupIndex[a.p.group] - groupIndex[b.p.group] || a.i - b.i)
      .map(x => x.p);
    const letterById = Object.fromEntries(letters.map(p => [p.id, p]));

    // Moods an entry gets automatically, before any it lists itself
    const KIND_MOODS = { love: ["doubt"], memories: ["reminiscing"], wishes: ["celebrating"] };
    const TAG_MOODS = {
      funny: ["laugh", "happy"], strength: ["strength", "sad"], showingup: ["lonely"], family: ["homesick"], little: ["homesick", "reminiscing"],
      hosting: ["happy"], food: ["happy"], music: ["happy"], us: ["happy"],
      howwemet: ["reminiscing"], depauw: ["reminiscing"], talks: ["lonely"], faith: ["strength", "sad"],
    };

    // Every reason, memory and wish as its own "moment"
    const moments = [];
    for (const p of letters) {
      for (const kind of Object.keys(SECTIONS)) {
        (p[kind] || []).forEach((raw, i) => {
          const e = typeof raw === "string" ? { x: raw } : raw;
          const tags = e.tags || [];
          const moods = new Set([...KIND_MOODS[kind], ...tags.flatMap(t => TAG_MOODS[t] || []), ...(e.moods || [])]);
          if (kind !== "memories" && e.x.length <= 90) moods.add("sleepless");
          moments.push({ id: `${p.id}.${kind}.${i}`, person: p, kind, title: e.t, text: e.x, en: e.en, tags, moods: [...moods] });
        });
      }
    }
    const momentById = Object.fromEntries(moments.map(m => [m.id, m]));
    const momentsOf = (p, kind) => moments.filter(m => m.person === p && m.kind === kind);

    // Every photo, tagged with who sent it
    const photosOf = p => Array.isArray(p.photos) ? p.photos : [];
    const allPhotos = letters.flatMap(p => photosOf(p).map(ph => ({ ...ph, person: p })));

    // ---------- helpers ----------
    const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const initials = name => name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
    const shuffle = arr => arr.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const plural = (n, word, many) => `${n} ${n === 1 ? word : (many || word + "s")}`;
    const dayNumber = () => { const d = new Date(); return d.getFullYear() * 400 + d.getMonth() * 31 + d.getDate(); };
    const firstName = p => p.name.split(" ")[0];

    const saveBtn = id => `<button class="icon-btn save" data-action="save" data-id="${esc(id)}" aria-pressed="${saved.has(id)}" aria-label="Save">${saved.has(id) ? "💛" : "🤍"}</button>`;

    const tagChips = tags => tags.filter(t => TAGS[t])
      .map(t => `<a class="chip" href="#/tag/${t}">${TAGS[t].emoji} ${esc(TAGS[t].label)}</a>`).join("");

    const momentText = m => {
      if (!m.en) return `<p>${esc(m.text)}</p>`;
      return showEnglish
        ? `<p>${esc(m.en)}</p><p class="orig">${esc(m.text)}</p>`
        : `<p>${esc(m.text)}</p><p class="orig">${esc(m.en)}</p>`;
    };

    // A single reason / memory / wish, with who it's from
    const momentCard = (m, opts = {}) => `
      <article class="card moment ${opts.big ? "big" : ""}">
        <div class="moment-top">
          <span class="kind">${SECTIONS[m.kind].emoji} ${esc(SECTIONS[m.kind].one)}</span>
          ${saveBtn(m.id)}
        </div>
        ${m.title ? `<h3>${esc(m.title)}</h3>` : ""}
        <div class="moment-text">${momentText(m)}</div>
        <a class="from" href="#/letter/${m.person.id}">— ${esc(m.person.name)} · ${esc(m.person.relation)}</a>
        ${m.tags.length ? `<div class="chips">${tagChips(m.tags)}</div>` : ""}
      </article>`;

    const momentList = list => list.length
      ? `<div class="list">${list.map(m => momentCard(m)).join("")}</div>`
      : `<p class="empty">Nothing here yet.</p>`;

    const letterRow = p => `
      <a class="toc-row" href="#/letter/${p.id}">
        <span class="avatar">${esc(initials(p.name))}</span>
        <span class="t">${esc(p.name)}${readSet.has(p.id) ? ' <span class="read-dot" title="Read">✓</span>' : ""}</span>
        <span class="n">${esc(p.relation)}</span>
      </a>`;

    // Photo thumbnails are decrypted lazily once they scroll into view (see hydrate)
    const gallery = (list, galleryId) => `
      <div class="gallery">${list.map((ph, i) => `
        <button class="ph" data-gallery="${esc(galleryId)}" data-index="${i}" aria-label="Open photo ${i + 1}">
          <img data-enc="${esc(ph.t)}" alt="">
        </button>`).join("")}
      </div>`;

    const langToggle = () => `<button class="icon-btn" data-action="lang">${showEnglish ? "Ver en español" : "Read in English"}</button>`;

    const counts = p => {
      const parts = [];
      for (const [kind, word, many] of [["love", "reason"], ["memories", "memory", "memories"], ["wishes", "wish", "wishes"]]) {
        const n = (p[kind] || []).length;
        if (n) parts.push(plural(n, word, many));
      }
      if (photosOf(p).length) parts.push(plural(photosOf(p).length, "photo"));
      return parts.join(" · ");
    };

    // ---------- views ----------
    const views = {
      home() {
        const today = moments[dayNumber() % moments.length];
        const photo = allPhotos.length ? allPhotos[dayNumber() % allPhotos.length] : null;
        return `
          <section class="hero">
            <p class="eyebrow">Happy 30th, Laura</p>
            <h1>${esc(BOOK.title)}</h1>
            <p>${esc(BOOK.subtitle)}</p>
            <div class="actions">
              <a class="btn" href="#/contents">Start reading</a>
              <a class="btn ghost" href="#/moods">For when you're…</a>
            </div>
            <div class="stats">
              <div><b>${letters.length}</b><span>people</span></div>
              <div><b>${moments.filter(m => m.kind === "memories").length}</b><span>memories</span></div>
              <div><b>${allPhotos.length}</b><span>photos</span></div>
            </div>
          </section>
          <section class="daily">
            <p class="eyebrow">Today's note for you</p>
            ${momentCard(today)}
          </section>
          ${photo ? `
          <section class="daily">
            <p class="eyebrow">Today's photo</p>
            <button class="card photo-day" data-gallery="all" data-index="${allPhotos.indexOf(photo)}">
              <img data-enc="${esc(photo.f)}" alt="">
              <span class="meta">from ${esc(photo.person.name)}</span>
            </button>
            <p style="text-align:center;margin:12px 0 0"><a class="btn ghost" href="#/photos">See all ${allPhotos.length} photos</a></p>
          </section>` : ""}
          <h2 class="section-title">How are you feeling?</h2>
          <div class="grid">${moodTiles(5)}</div>
          <p style="text-align:center;margin-top:20px">
            <button class="btn ghost" data-action="random">🎲 Surprise me</button>
          </p>
          ${FACTS && FACTS.length ? `
          <h2 class="section-title">By the numbers</h2>
          <div class="facts">${FACTS.map(f => `<a class="card fact" href="${esc(f.link)}"><b>${esc(f.big)}</b><span>${esc(f.text)}</span></a>`).join("")}</div>` : ""}
          <p class="empty" style="padding-bottom:0">${esc(BOOK.dedication)}</p>
          <div class="footer-actions">
            <button class="icon-btn" data-action="theme">🌓 Light / dark</button>
            <button class="icon-btn" data-action="lock">🔒 Lock</button>
          </div>`;
      },

      contents(q) {
        const query = (q || "").trim().toLowerCase();
        let body;
        if (query) {
          const hits = moments.filter(m =>
            [m.title, m.text, m.en, m.person.name, m.person.relation].join(" ").toLowerCase().includes(query));
          body = `<p class="meta">${plural(hits.length, "match", "matches")}</p>${momentList(hits)}`;
        } else {
          body = GROUPS.map(g => {
            const list = letters.filter(p => p.group === g.id);
            return list.length ? `<section class="toc-chapter"><h2>${esc(g.name)}</h2>${list.map(letterRow).join("")}</section>` : "";
          }).join("");
        }
        return `
          <p class="eyebrow">Table of contents</p>
          <h1>Contents</h1>
          <p class="lede">A letter from each person: why they love you, their favorite memories, their hopes for you, and their photos.</p>
          <input class="search" type="search" placeholder="Search every memory: “boat”, “Sueños”, “sushi”…" value="${esc(q || "")}" data-action="search" aria-label="Search">
          <div id="results">${body}</div>`;
      },

      letter(id) {
        const p = letterById[id];
        if (!p) return `<p class="empty">That letter couldn't be found. <a href="#/contents">Back to contents</a></p>`;
        readSet.add(p.id); store.set("read", [...readSet]);
        const i = letters.indexOf(p);
        const prev = letters[i - 1], next = letters[i + 1];
        const photos = photosOf(p);
        const sections = Object.entries(SECTIONS).map(([kind, s]) => {
          const list = momentsOf(p, kind);
          if (!list.length) return "";
          return `
            <section class="letter-section">
              <h2>${s.emoji} ${esc(s.label)}</h2>
              ${list.map(m => `
                <div class="entry">
                  ${m.title ? `<h3>${esc(m.title)}</h3>` : ""}
                  ${momentText(m)}
                  <div class="entry-foot"><div class="chips">${tagChips(m.tags)}</div>${saveBtn(m.id)}</div>
                </div>`).join("")}
            </section>`;
        }).join("");
        return `
          <div class="reader-bar">
            <a class="icon-btn" href="#/contents">← Contents</a>
            ${p.lang === "es" ? langToggle() : ""}
          </div>
          <article class="reader">
            <div class="letter-head">
              <span class="avatar lg">${esc(initials(p.name))}</span>
              <div>
                <p class="eyebrow">${esc(p.relation)}</p>
                <h1>${esc(p.name)}</h1>
                <div class="byline">${esc(counts(p))}</div>
              </div>
            </div>
            ${p.photosOnly ? `<p class="lede">${esc(firstName(p))}'s page is all photos. No words needed.</p>` : sections}
            ${photos.length ? `
              <section class="letter-section">
                <h2>📸 Photos</h2>
                ${gallery(photos, p.id)}
              </section>` : ""}
          </article>
          <nav class="pager">
            <div>${prev ? `<a class="card" href="#/letter/${prev.id}"><span class="meta">← Previous</span><br>${esc(prev.name)}</a>` : ""}</div>
            <div class="next">${next ? `<a class="card" href="#/letter/${next.id}"><span class="meta">Next →</span><br>${esc(next.name)}</a>` : ""}</div>
          </nav>`;
      },

      moment(id) {
        const m = momentById[id];
        if (!m) return views.moods();
        const again = location.hash.includes("?mood=") ? location.hash.split("?mood=")[1] : "";
        return `
          <div class="reader-bar">
            <a class="icon-btn" href="${again ? "#/mood/" + esc(again) : "#/"}">← Back</a>
            <button class="icon-btn" data-action="${again ? "mood-random" : "random"}" data-mood="${esc(again)}">🎲 Another one</button>
          </div>
          ${momentCard(m, { big: true })}
          <p style="text-align:center;margin-top:16px"><a class="btn ghost" href="#/letter/${m.person.id}">Read ${esc(firstName(m.person))}'s whole letter</a></p>`;
      },

      moods() {
        return `
          <p class="eyebrow">A place to go</p>
          <h1>For when you're…</h1>
          <p class="lede">Pick how you're feeling and the book will open to the right words.</p>
          <div class="grid">${moodTiles()}</div>`;
      },

      mood(moodKey) {
        const m = MOODS[moodKey];
        if (!m) return views.moods();
        const list = shuffle(moments.filter(x => x.moods.includes(moodKey)));
        return `
          <a class="icon-btn" href="#/moods">← All feelings</a>
          <section class="mood-head">
            <div class="e">${m.emoji}</div>
            <h1>${esc(m.label)}</h1>
            <p>${esc(m.note)}</p>
          </section>
          ${list.length ? `<div class="mood-actions"><button class="btn" data-action="mood-random" data-mood="${esc(moodKey)}">Open one for me</button></div>` : ""}
          ${momentList(list)}`;
      },

      categories() {
        const tiles = Object.entries(TAGS).map(([k, t]) => {
          const n = moments.filter(m => m.tags.includes(k)).length;
          return n ? `<a class="card mood-tile" href="#/tag/${k}"><span class="e">${t.emoji}</span><b>${esc(t.label)}</b><div class="meta">${n}</div></a>` : "";
        }).join("");
        return `
          <p class="eyebrow">Browse by theme</p>
          <h1>Categories</h1>
          <p class="lede">Every memory, reason and wish is tagged, so you can read all the DePauw stories, all the funny ones, and more.</p>
          <div class="grid">${tiles}</div>`;
      },

      tag(tagKey) {
        const t = TAGS[tagKey];
        if (!t) return views.categories();
        const order = ["memories", "love", "wishes"];
        const list = moments.filter(m => m.tags.includes(tagKey)).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
        return `
          <a class="icon-btn" href="#/categories">← All categories</a>
          <section class="mood-head"><div class="e">${t.emoji}</div><h1>${esc(t.label)}</h1><p>${plural(list.length, "moment")}</p></section>
          ${momentList(list)}`;
      },

      wishes() {
        const list = shuffle(moments.filter(m => m.kind === "wishes"));
        const mexico = moments.filter(m => m.tags.includes("mexico") && m.kind === "wishes");
        return `
          <p class="eyebrow">For your next decade</p>
          <h1>Hopes & Prayers</h1>
          <p class="lede">${plural(list.length, "wish", "wishes")} and prayers for your 30s, from everyone who wrote in.</p>
          ${mexico.length ? `
            <a class="card highlight" href="#/tag/mexico">
              <b>🇲🇽 ${mexico.length} people are rooting for the Mexico City dream</b>
              <span class="meta">${mexico.map(m => esc(firstName(m.person))).join(", ")} (and a few want you as their tour guide)</span>
            </a>` : ""}
          ${momentList(list)}`;
      },

      photos() {
        return `
          <a class="icon-btn" href="#/">← Home</a>
          <section class="mood-head"><div class="e">📸</div><h1>Photos</h1><p>${plural(allPhotos.length, "photo")} from everyone who wrote in</p></section>
          ${letters.filter(p => photosOf(p).length).map(p => `
            <section class="photo-group">
              <h2><a href="#/letter/${p.id}">${esc(p.name)}</a> <span class="meta">${esc(p.relation)}</span></h2>
              ${gallery(photosOf(p), p.id)}
            </section>`).join("")}`;
      },

      saved() {
        const list = moments.filter(m => saved.has(m.id));
        return `
          <p class="eyebrow">Your favorites</p>
          <h1>Saved</h1>
          <p class="lede">Tap 🤍 on anything to keep it here. Saved on this device.</p>
          ${list.length ? momentList(list) : '<p class="empty">Nothing saved yet.</p>'}`;
      },
    };

    function moodTiles(limit) {
      const entries = Object.entries(MOODS).slice(0, limit || undefined);
      return entries.map(([k, m]) =>
        `<a class="card mood-tile" href="#/mood/${k}"><span class="e">${m.emoji}</span><b>${esc(m.label)}</b></a>`).join("")
        + (limit ? `<a class="card mood-tile" href="#/moods"><span class="e">➕</span><b>More feelings</b></a>` : "");
    }

    // ---------- photos ----------
    const thumbCache = new Map();
    const imageUrl = name => fetchBytes(`data/p/${name}.bin`)
      .then(b => decrypt(key, b))
      .then(bytes => URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" })));
    const thumbUrl = name => {
      if (!thumbCache.has(name)) thumbCache.set(name, imageUrl(name));
      return thumbCache.get(name);
    };

    const observer = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        observer.unobserve(e.target);
        thumbUrl(e.target.dataset.enc).then(url => { e.target.src = url; e.target.classList.add("loaded"); }, () => {});
      }
    }, { rootMargin: "400px" });
    const hydrate = () => app.querySelectorAll("img[data-enc]").forEach(img => observer.observe(img));

    let lbList = [], lbIndex = 0, lbUrl = null;
    function showPhoto(i) {
      lbIndex = (i + lbList.length) % lbList.length;
      const ph = lbList[lbIndex];
      const img = lightbox.querySelector("img");
      thumbUrl(ph.t).then(url => { if (lbList[lbIndex] === ph && !img.dataset.full) img.src = url; });
      delete img.dataset.full;
      imageUrl(ph.f).then(url => {
        if (lbList[lbIndex] !== ph) return URL.revokeObjectURL(url);
        if (lbUrl) URL.revokeObjectURL(lbUrl);
        lbUrl = url; img.src = url; img.dataset.full = "1";
      }, () => {});
      lightbox.querySelector(".lb-count").textContent =
        `${ph.person.name} · ${lbIndex + 1} of ${lbList.length}`;
    }
    function openLightbox(galleryId, i) {
      lbList = galleryId === "all" ? allPhotos : photosOf(letterById[galleryId]).map(ph => ({ ...ph, person: letterById[galleryId] }));
      lightbox.hidden = false;
      document.body.classList.add("no-scroll");
      showPhoto(i);
    }
    function closeLightbox() {
      lightbox.hidden = true;
      document.body.classList.remove("no-scroll");
      if (lbUrl) { URL.revokeObjectURL(lbUrl); lbUrl = null; }
      lightbox.querySelector("img").removeAttribute("src");
    }
    lightbox.addEventListener("click", e => {
      const action = e.target.closest("[data-lb]")?.dataset.lb;
      if (action === "prev") showPhoto(lbIndex - 1);
      else if (action === "next") showPhoto(lbIndex + 1);
      else if (action === "close" || e.target === lightbox) closeLightbox();
    });
    document.addEventListener("keydown", e => {
      if (lightbox.hidden) return;
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") showPhoto(lbIndex - 1);
      if (e.key === "ArrowRight") showPhoto(lbIndex + 1);
    });
    let touchX = null;
    lightbox.addEventListener("touchstart", e => { touchX = e.touches[0].clientX; }, { passive: true });
    lightbox.addEventListener("touchend", e => {
      if (touchX === null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 50) showPhoto(lbIndex + (dx < 0 ? 1 : -1));
      touchX = null;
    });

    // ---------- router ----------
    const TAB_FOR = { "": "home", contents: "contents", letter: "contents", moods: "moods", mood: "moods", moment: "moods",
      categories: "categories", tag: "categories", wishes: "wishes", saved: "saved", photos: "home" };

    function render() {
      const path = location.hash.replace(/^#\/?/, "").split("?")[0];
      const [route = "", arg = ""] = path.split("/").map(decodeURIComponent);
      const view = views[route || "home"] || views.home;
      app.innerHTML = view(arg);
      hydrate();
      document.querySelectorAll(".tabs a").forEach(a =>
        a.classList.toggle("active", a.dataset.tab === (TAB_FOR[route] || "home")));
      const p = route === "letter" && letterById[arg];
      document.title = p ? `${p.name} · ${BOOK.title}` : BOOK.title;
      window.scrollTo(0, 0);
    }

    window.addEventListener("hashchange", () => { if (!lightbox.hidden) closeLightbox(); render(); });

    app.addEventListener("click", e => {
      const photo = e.target.closest("[data-gallery]");
      if (photo) return openLightbox(photo.dataset.gallery, Number(photo.dataset.index));
      const el = e.target.closest("[data-action]");
      if (!el) return;
      const action = el.dataset.action;
      if (action === "save") {
        const id = el.dataset.id;
        saved.has(id) ? saved.delete(id) : saved.add(id);
        store.set("saved", [...saved]);
        app.querySelectorAll(`[data-action="save"][data-id="${CSS.escape(id)}"]`).forEach(b => {
          b.setAttribute("aria-pressed", saved.has(id));
          b.textContent = saved.has(id) ? "💛" : "🤍";
        });
      } else if (action === "random") {
        location.hash = "#/moment/" + pick(moments).id;
      } else if (action === "mood-random") {
        const list = moments.filter(m => m.moods.includes(el.dataset.mood));
        if (list.length) location.hash = "#/moment/" + pick(list).id + "?mood=" + el.dataset.mood;
      } else if (action === "lang") {
        showEnglish = !showEnglish;
        store.set("english", showEnglish);
        const y = window.scrollY;
        render();
        window.scrollTo(0, y);
      } else if (action === "theme") {
        const root = document.documentElement;
        const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
        root.dataset.theme = dark ? "light" : "dark";
        store.set("theme", root.dataset.theme);
      } else if (action === "lock") {
        store.remove("code");
        location.reload();
      }
    });

    // Live search: re-render only the results so the input keeps focus
    app.addEventListener("input", e => {
      if (e.target.dataset.action !== "search") return;
      const tmp = document.createElement("div");
      tmp.innerHTML = views.contents(e.target.value);
      app.querySelector("#results").innerHTML = tmp.querySelector("#results").innerHTML;
    });

    document.body.classList.add("unlocked");
    render();
  }
})();
