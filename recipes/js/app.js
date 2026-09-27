/* Waynesdays Recipe Book — app */
(() => {
  'use strict';
  const RB = window.RB;

  // ======================================================================
  // Utilities
  // ======================================================================
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (name, cls) => `<svg class="i ${cls || ''}" aria-hidden="true"><use href="#${name}"/></svg>`;
  const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const nowIso = () => new Date().toISOString();
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const uid = () => Math.random().toString(36).slice(2, 10);

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast('Could not save on this device (storage full or blocked). Export a backup from Settings.'); return false; }
    },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const K = { book: 'wrb.book.v1', groceries: 'wrb.groceries', settings: 'wrb.settings', timers: 'wrb.timers', ui: 'wrb.ui', draft: 'wrb.draft', scale: 'wrb.scale', tips: 'wrb.tips' };

  function inlineMd(s) {
    let h = esc(s);
    h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    h = h.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
    h = h.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    return h;
  }
  function blockMd(s) {
    const lines = String(s || '').split('\n');
    let out = '', list = null;
    const close = () => { if (list) { out += `</${list}>`; list = null; } };
    lines.forEach((ln) => {
      const t = ln.trim();
      if (!t) { close(); return; }
      let m;
      if ((m = t.match(/^[-*•]\s+(.*)/))) { if (list !== 'ul') { close(); out += '<ul>'; list = 'ul'; } out += `<li>${inlineMd(m[1])}</li>`; return; }
      if ((m = t.match(/^\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); out += '<ol>'; list = 'ol'; } out += `<li>${inlineMd(m[1])}</li>`; return; }
      close();
      if ((m = t.match(/^#{1,6}\s+(.*)/))) { out += `<h4>${inlineMd(m[1])}</h4>`; return; }
      if ((m = t.match(/^\*\*([^*]+?):?\*\*$/))) { out += `<h4>${inlineMd(m[1])}</h4>`; return; }
      out += `<p>${inlineMd(t)}</p>`;
    });
    close();
    return out;
  }

  function parseMinutes(time) {
    const t = String(time || '').toLowerCase();
    if (!t) return null;
    if (/\b(day|days|week|weeks|overnight)\b/.test(t)) return 60 * 24;
    let total = 0, found = false, m;
    const rx = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|hr|h|minutes?|mins?|min|m)\b/g;
    // only count the headline (before "plus"/"(")
    const head = t.split(/\(|\bplus\b/)[0];
    while ((m = rx.exec(head))) { found = true; total += /^h/.test(m[2]) ? +m[1] * 60 : +m[1]; }
    return found ? total : null;
  }

  function fmtDate(iso, opts) {
    try { return new Date(iso).toLocaleDateString(undefined, opts || { month: 'short', day: 'numeric', year: 'numeric' }); } catch (e) { return iso; }
  }
  function relDays(iso) {
    const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
    if (d <= 0) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 30) return d + ' days ago';
    return fmtDate(iso);
  }

  const CAT_ORDER = RB.CATEGORIES;
  function catKey(cat) {
    const c = norm(cat);
    if (/drink/.test(c)) return 'drinks';
    if (/breakfast|brunch/.test(c)) return 'breakfast';
    if (/bak|sweet|dessert/.test(c)) return 'baking';
    if (/soup/.test(c)) return 'soups';
    if (/side|salad/.test(c)) return 'sides';
    if (/sauce|spice|ferment|condiment/.test(c)) return 'sauces';
    if (/basic|technique/.test(c)) return 'basics';
    if (/main|dinner|entree/.test(c)) return 'mains';
    return 'other';
  }

  // ======================================================================
  // Toast
  // ======================================================================
  let toastTimer;
  function toast(msg, action) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button type="button" class="toast-act">${esc(action.label)}</button>` : '');
    el.hidden = false;
    el.classList.add('show');
    if (action) $('.toast-act', el).onclick = () => { action.run(); hideToast(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, action ? 7000 : 3200);
  }
  function hideToast() { const el = $('#toast'); el.classList.remove('show'); setTimeout(() => { el.hidden = true; }, 250); }

  async function copyText(text, msg) {
    try { await navigator.clipboard.writeText(text); toast(msg || 'Copied'); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast(msg || 'Copied'); } catch (e2) { toast('Copy failed'); }
      ta.remove();
    }
  }
  function download(filename, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ======================================================================
  // Store
  // ======================================================================
  const settings = Object.assign({ theme: 'auto', lang: navigator.language || 'en-US', cookSize: 1, speak: false,
    gh: { token: '', repo: 'wmcphersonjr/wmcphersonjr.github.io', branch: 'master', path: 'recipes/data/recipes.json', auto: true, lastSync: '' } }, LS.get(K.settings, {}));
  settings.gh = Object.assign({ token: '', repo: 'wmcphersonjr/wmcphersonjr.github.io', branch: 'master', path: 'recipes/data/recipes.json', auto: true, lastSync: '' }, settings.gh || {});
  const saveSettings = () => LS.set(K.settings, settings);

  const ui = Object.assign({ q: '', cat: '', tags: [], fav: false, quick: false, sort: 'book', showTags: false }, LS.get(K.ui, {}));
  ui.q = ''; // don't restore search text
  const saveUi = () => LS.set(K.ui, { cat: ui.cat, tags: ui.tags, fav: ui.fav, quick: ui.quick, sort: ui.sort, showTags: ui.showTags });

  const store = {
    book: LS.get(K.book, null), // {title, recipes:[], deleted:{}, meta:{}, seedAt}
    get recipes() { return this.book ? this.book.recipes : []; },
    byId(id) { return this.recipes.find((r) => r.id === id); },
    meta(id) { return this.book.meta[id] || { fav: false, cooked: [], notes: '', updatedAt: '' }; },
    setMeta(id, patch) { this.book.meta[id] = Object.assign({}, this.meta(id), patch, { updatedAt: nowIso() }); this.save(); },
    save() { this.book.updatedAt = nowIso(); LS.set(K.book, this.book); index.dirty = true; sync.schedule(); },
    uniqueId(title, except) {
      const base = RB.slugify(String(title).replace(/\(.*?\)/g, ''));
      let id = base, n = 2;
      while (this.recipes.some((r) => r.id === id && r.id !== except)) id = base + '-' + n++;
      return id;
    },
    upsert(r) {
      r.updatedAt = nowIso();
      if (!r.createdAt) r.createdAt = r.updatedAt;
      const i = this.recipes.findIndex((x) => x.id === r.id);
      if (i >= 0) this.recipes[i] = r; else this.recipes.push(r);
      delete this.book.deleted[r.id];
      this.save();
      return r;
    },
    remove(id) {
      const i = this.recipes.findIndex((x) => x.id === id);
      if (i < 0) return null;
      const [r] = this.recipes.splice(i, 1);
      this.book.deleted[id] = nowIso();
      this.save();
      return r;
    },
    exportData() {
      return { format: 'waynesdays-recipes', version: 1, title: this.book.title, updatedAt: this.book.updatedAt || nowIso(),
        recipes: this.recipes, deleted: this.book.deleted, meta: this.book.meta };
    },
    /** Merge another copy of the book (seed file, backup or GitHub). Newest edit wins per recipe. */
    merge(remote, opts) {
      opts = opts || {};
      let changed = 0;
      const del = this.book.deleted;
      (remote.recipes || []).forEach((rr) => {
        if (!rr || !rr.id || !rr.title) return;
        const local = this.byId(rr.id);
        const tomb = del[rr.id];
        if (!local && tomb && !opts.restore && Date.parse(tomb) >= Date.parse(rr.updatedAt || 0)) return;
        if (!local) { this.recipes.push(normalizeRecipe(rr)); delete del[rr.id]; changed++; return; }
        if (Date.parse(rr.updatedAt || 0) > Date.parse(local.updatedAt || 0)) {
          Object.assign(local, normalizeRecipe(rr)); changed++;
        }
      });
      Object.entries(remote.deleted || {}).forEach(([id, ts]) => {
        const local = this.byId(id);
        if (local && Date.parse(local.updatedAt || 0) <= Date.parse(ts)) { this.recipes.splice(this.recipes.indexOf(local), 1); changed++; }
        if (!del[id] || Date.parse(del[id]) < Date.parse(ts)) del[id] = ts;
      });
      Object.entries(remote.meta || {}).forEach(([id, m]) => {
        const lm = this.book.meta[id];
        if (!lm || Date.parse(m.updatedAt || 0) > Date.parse(lm.updatedAt || 0)) { this.book.meta[id] = m; changed++; }
      });
      if (changed) { LS.set(K.book, this.book); index.dirty = true; }
      return changed;
    },
  };

  function normalizeRecipe(r) {
    const base = RB.emptyRecipe();
    const out = Object.assign(base, r);
    out.tags = RB.normTags(out.tags || []);
    out.ingredients = (out.ingredients || []).map((g) => ({ name: g.name || '', note: g.note || '', items: (g.items || []).filter(Boolean) })).filter((g) => g.items.length);
    out.steps = (out.steps || []).map((g) => ({ name: g.name || '', items: (g.items || []).filter(Boolean) })).filter((g) => g.items.length);
    out.notes = (out.notes || []).filter(Boolean);
    out.extras = (out.extras || []).filter((e) => e && (e.title || e.body));
    out.sources = (out.sources || []).filter((s) => s && s.url);
    return out;
  }

  async function loadSeed() {
    const res = await fetch('data/recipes.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('seed ' + res.status);
    return res.json();
  }

  async function initStore() {
    if (store.book && Array.isArray(store.book.recipes)) {
      store.book.deleted = store.book.deleted || {};
      store.book.meta = store.book.meta || {};
      // pick up new recipes added to book.md / data file since last visit (in background)
      loadSeed().then((seed) => {
        if (seed.updatedAt !== store.book.seedAt) {
          const n = store.merge(seed);
          store.book.seedAt = seed.updatedAt; LS.set(K.book, store.book);
          if (n) { toast('Recipe book updated'); render(); }
        }
      }).catch(() => {});
      return;
    }
    try {
      const seed = await loadSeed();
      store.book = { title: seed.title || 'Waynesdays Recipe Book', recipes: seed.recipes.map(normalizeRecipe), deleted: seed.deleted || {}, meta: seed.meta || {}, seedAt: seed.updatedAt };
    } catch (e) {
      store.book = { title: 'Waynesdays Recipe Book', recipes: [], deleted: {}, meta: {}, seedAt: '' };
    }
    LS.set(K.book, store.book);
  }

  // ======================================================================
  // Search index
  // ======================================================================
  const index = {
    dirty: true, docs: [], vocab: [],
    build() {
      const vocab = new Set();
      this.docs = store.recipes.map((r) => {
        const ing = r.ingredients.flatMap((g) => g.items.concat(g.name));
        const d = {
          r,
          title: norm(r.title), tags: r.tags.map(norm), cat: norm(r.category),
          ing: norm(ing.join(' \n ')), ingList: ing,
          rest: norm([r.description, r.time, r.yield].concat(r.steps.flatMap((g) => g.items), r.notes, r.extras.map((e) => e.title + ' ' + e.body), (store.meta(r.id).notes || '')).join(' ')),
        };
        (d.title + ' ' + d.tags.join(' ') + ' ' + d.ing).split(/[^a-z0-9]+/).forEach((w) => { if (w.length > 3) vocab.add(w); });
        return d;
      });
      this.vocab = Array.from(vocab);
      this.dirty = false;
    },
  };
  const QSTOP = new Set(['recipe', 'recipes', 'show', 'me', 'find', 'a', 'an', 'the', 'for', 'some', 'my', 'i', 'want', 'make', 'to', 'how', 'with', 'and', 'of', 'something', 'dish', 'dishes', 'please']);

  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = dp[0]; dp[0] = i; let rowMin = dp[0];
      for (let j = 1; j <= b.length; j++) {
        const tmp = dp[j];
        dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp; rowMin = Math.min(rowMin, dp[j]);
      }
      if (rowMin > max) return max + 1;
    }
    return dp[b.length];
  }

  function search(q) {
    if (index.dirty) index.build();
    const raw = norm(q).replace(/["“”]/g, ' ').split(/\s+/).filter(Boolean);
    const excl = raw.filter((t) => t.startsWith('-') && t.length > 1).map((t) => t.slice(1));
    const toks = raw.filter((t) => !t.startsWith('-') && !QSTOP.has(t));
    const results = [];
    index.docs.forEach((d) => {
      if (excl.some((t) => d.title.includes(t) || d.ing.includes(t) || d.tags.some((x) => x.includes(t)))) return;
      let score = 0; const why = [];
      for (const t of toks) {
        let s = 0;
        const wordStart = new RegExp('(^|[^a-z0-9])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        if (d.title.includes(t)) s += wordStart.test(d.title) ? 14 : 8;
        if (d.tags.some((x) => x.startsWith(t) || x === t)) s += 9;
        else if (d.tags.some((x) => x.includes(t))) s += 4;
        if (d.cat.includes(t)) s += 5;
        if (d.ing.includes(t)) {
          s += wordStart.test(d.ing) ? 5 : 2;
          if (!d.title.includes(t)) { const hit = d.ingList.find((x) => norm(x).includes(t)); if (hit && why.length < 2) why.push(hit); }
        }
        if (d.rest.includes(t)) s += 1;
        if (!s && t.length >= 4) {
          const max = t.length >= 7 ? 2 : 1;
          const close = index.vocab.filter((w) => lev(t, w, max) <= max);
          if (close.some((w) => d.title.includes(w) || d.tags.some((x) => x.includes(w)) || d.ing.includes(w))) s += 2;
        }
        if (!s) { score = -1; break; }
        score += s;
      }
      if (score >= 0) results.push({ r: d.r, score, why });
    });
    return results.sort((a, b) => b.score - a.score);
  }

  // ======================================================================
  // Voice (speech recognition + synthesis)
  // ======================================================================
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const voice = {
    supported: !!SR,
    active: null,
    /** start({continuous, interim, onFinal, onInterim, onState, keepAlive}) -> controller */
    start(opts) {
      if (!SR) { toast('Voice input isn’t supported in this browser. Try Chrome, Edge or Safari, or use your keyboard’s mic.'); return null; }
      this.stop();
      const rec = new SR();
      rec.lang = settings.lang || 'en-US';
      rec.continuous = opts.continuous !== false;
      rec.interimResults = opts.interim !== false;
      rec.maxAlternatives = 1;
      const ctl = { rec, opts, on: true, stop: () => { ctl.on = false; try { rec.stop(); } catch (e) { /* */ } opts.onState && opts.onState(false); } };
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) opts.onFinal && opts.onFinal(res[0].transcript.trim());
          else interim += res[0].transcript;
        }
        opts.onInterim && opts.onInterim(interim);
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { toast('Microphone permission is blocked for this site.'); ctl.on = false; }
        else if (e.error === 'network') { toast('Voice recognition needs a network connection.'); ctl.on = false; }
      };
      rec.onend = () => {
        if (ctl.on && opts.keepAlive) { setTimeout(() => { if (ctl.on) try { rec.start(); } catch (e) { /* */ } }, 200); return; }
        ctl.on = false; if (this.active === ctl) this.active = null;
        opts.onState && opts.onState(false);
      };
      try { rec.start(); } catch (e) { toast('Could not start the microphone.'); return null; }
      opts.onState && opts.onState(true);
      this.active = ctl;
      return ctl;
    },
    stop() { if (this.active) { this.active.stop(); this.active = null; } },
  };

  const speech = {
    speaking: false,
    say(text) {
      if (!('speechSynthesis' in window)) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(RB.stripMd(text).replace(/°F/g, ' degrees').replace(/°C/g, ' degrees Celsius').replace(/\btbsp\b/gi, 'tablespoons').replace(/\btsp\b/gi, 'teaspoons').replace(/\boz\b/g, 'ounces').replace(/\blb\b/g, 'pounds'));
      u.lang = settings.lang || 'en-US';
      u.rate = 1;
      u.onstart = () => { this.speaking = true; };
      u.onend = u.onerror = () => { setTimeout(() => { this.speaking = false; }, 400); };
      speechSynthesis.speak(u);
    },
    stop() { if ('speechSynthesis' in window) speechSynthesis.cancel(); this.speaking = false; },
  };

  /** Dictate into an input/textarea. mode 'lines' puts each phrase (or "next") on its own line. */
  function toggleDictation(btn, field, mode) {
    if (btn.classList.contains('listening')) { voice.stop(); return; }
    $$('.listening').forEach((b) => b.classList.remove('listening'));
    voice.start({
      keepAlive: true,
      onState: (on) => btn.classList.toggle('listening', on),
      onInterim: (t) => { field.dataset.interim = t; field.placeholder = t || field.dataset.ph || ''; },
      onFinal: (t) => {
        if (!t) return;
        if (/^(stop listening|stop dictation)$/i.test(t)) { voice.stop(); return; }
        let add = t;
        if (mode === 'lines') {
          add = t.split(/\s*\b(?:next(?: step| ingredient| item)?|new line)\b\s*/i).map((x) => x.trim()).filter(Boolean)
            .map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join('\n');
          if (!add) return;
          field.value = field.value.replace(/\s+$/, '') + (field.value.trim() ? '\n' : '') + add;
        } else {
          field.value = field.value.replace(/\s+$/, '') + (field.value.trim() ? ' ' : '') + add;
        }
        field.dispatchEvent(new Event('input', { bubbles: true }));
      },
    });
  }

  // ======================================================================
  // Timers
  // ======================================================================
  const timers = {
    list: LS.get(K.timers, []).filter((t) => t.endAt || t.pausedLeft != null),
    ctx: null, ringTimer: null,
    save() { LS.set(K.timers, this.list); },
    add(seconds, label, recipeId) {
      this.unlockAudio();
      const t = { id: uid(), label, recipeId, total: seconds, endAt: Date.now() + seconds * 1000, pausedLeft: null, done: false };
      this.list.push(t); this.save(); this.renderTray(); this.loop();
      toast('Timer started: ' + RB.fmtDurationWords(seconds));
      if ('Notification' in window && Notification.permission === 'default') { try { Notification.requestPermission(); } catch (e) { /* */ } }
      return t;
    },
    left(t) { return t.pausedLeft != null ? t.pausedLeft : Math.max(0, (t.endAt - Date.now()) / 1000); },
    toggle(id) {
      const t = this.list.find((x) => x.id === id); if (!t) return;
      if (t.pausedLeft != null) { t.endAt = Date.now() + t.pausedLeft * 1000; t.pausedLeft = null; } else { t.pausedLeft = this.left(t); }
      this.save(); this.renderTray();
    },
    plus(id, s) {
      const t = this.list.find((x) => x.id === id); if (!t) return;
      if (t.done) { t.done = false; t.endAt = Date.now() + s * 1000; }
      else if (t.pausedLeft != null) t.pausedLeft += s; else t.endAt += s * 1000;
      t.total += s; this.save(); this.renderTray(); this.checkRing(); this.loop();
    },
    remove(id) { this.list = this.list.filter((x) => x.id !== id); this.save(); this.renderTray(); this.checkRing(); },
    dismissDone() { const had = this.list.some((t) => t.done); this.list = this.list.filter((t) => !t.done); this.save(); this.renderTray(); this.checkRing(); return had; },
    loopId: null,
    loop() {
      if (this.loopId) return;
      const tick = () => {
        let changed = false;
        this.list.forEach((t) => {
          if (!t.done && t.pausedLeft == null && Date.now() >= t.endAt) { t.done = true; changed = true; this.fire(t); }
        });
        if (changed) { this.save(); this.checkRing(); }
        this.updateTray();
        if (this.list.length) this.loopId = setTimeout(tick, 250); else this.loopId = null;
      };
      tick();
    },
    fire(t) {
      if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        try { new Notification('Timer done', { body: t.label, icon: 'icon-192.png', tag: t.id }); } catch (e) { /* */ }
      }
      if (cook.state && settings.speak) speech.say('Timer done. ' + t.label);
    },
    unlockAudio() {
      try { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); if (this.ctx.state === 'suspended') this.ctx.resume(); } catch (e) { /* */ }
    },
    beep() {
      if (!this.ctx) return;
      const c = this.ctx, t0 = c.currentTime;
      [0, 0.22, 0.44].forEach((d, i) => {
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'sine'; o.frequency.value = i === 2 ? 1175 : 880;
        g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.18);
        o.connect(g).connect(c.destination); o.start(t0 + d); o.stop(t0 + d + 0.2);
      });
    },
    checkRing() {
      const ringing = this.list.some((t) => t.done);
      if (ringing && !this.ringTimer) { this.beep(); this.ringTimer = setInterval(() => this.beep(), 1600); }
      if (!ringing && this.ringTimer) { clearInterval(this.ringTimer); this.ringTimer = null; }
      document.body.classList.toggle('ringing', ringing);
    },
    renderTray() {
      const el = $('#timers');
      el.innerHTML = this.list.map((t) => `
        <div class="timer ${t.done ? 'done' : ''} ${t.pausedLeft != null ? 'paused' : ''}" data-tid="${t.id}">
          <div class="timer-ring" style="--p:0">${icon('i-timer')}</div>
          <div class="timer-main"><b class="timer-left">${RB.fmtDuration(this.left(t))}</b><span>${esc(t.label)}</span></div>
          <div class="timer-btns">
            ${t.done ? `<button class="btn small primary" data-act="timer-dismiss" data-tid="${t.id}">Done</button><button class="icon-btn" data-act="timer-plus" data-tid="${t.id}" aria-label="Add one minute">+1m</button>`
            : `<button class="icon-btn" data-act="timer-toggle" data-tid="${t.id}" aria-label="${t.pausedLeft != null ? 'Resume' : 'Pause'}">${t.pausedLeft != null ? '▶' : '❚❚'}</button>
               <button class="icon-btn" data-act="timer-plus" data-tid="${t.id}" aria-label="Add one minute">+1m</button>
               <button class="icon-btn" data-act="timer-remove" data-tid="${t.id}" aria-label="Cancel timer">${icon('i-x')}</button>`}
          </div>
        </div>`).join('');
      this.updateTray();
    },
    updateTray() {
      this.list.forEach((t) => {
        const el = document.querySelector(`.timer[data-tid="${t.id}"]`);
        if (!el) return;
        const left = this.left(t);
        $('.timer-left', el).textContent = t.done ? 'Done!' : RB.fmtDuration(left);
        $('.timer-ring', el).style.setProperty('--p', t.total ? (1 - left / t.total).toFixed(3) : 1);
      });
      const title = this.list.filter((t) => !t.done && t.pausedLeft == null).sort((a, b) => a.endAt - b.endAt)[0];
      document.title = this.list.some((t) => t.done) ? '⏰ Timer done!' : title ? '⏱ ' + RB.fmtDuration(this.left(title)) + ' · Recipes' : baseTitle;
    },
  };
  const baseTitle = document.title;

  // ======================================================================
  // Groceries
  // ======================================================================
  const groceries = {
    list: LS.get(K.groceries, []),
    save() { LS.set(K.groceries, this.list); updateBadges(); },
    addRecipe(r, factor) {
      this.list = this.list.filter((x) => x.recipeId !== r.id);
      r.ingredients.forEach((g) => g.items.forEach((it) => {
        this.list.push({ id: uid(), text: RB.stripMd(RB.scaleIngredient(it, factor)), recipeId: r.id, recipeTitle: r.title, checked: false });
      }));
      this.save();
    },
    has(id) { return this.list.some((x) => x.recipeId === id); },
  };
  function updateBadges() {
    const n = groceries.list.filter((x) => !x.checked).length;
    $$('[data-grocery-count]').forEach((b) => { b.textContent = n; b.hidden = !n; });
  }

  // ======================================================================
  // Router
  // ======================================================================
  let route = { name: 'book', params: {} };
  function parseRoute() {
    const h = decodeURI(location.hash.replace(/^#/, '')) || '/';
    const [path, query] = h.split('?');
    const q = new URLSearchParams(query || '');
    const p = path.split('/').filter(Boolean);
    if (!p.length) return { name: 'book', params: { tag: q.get('tag'), cat: q.get('cat'), q: q.get('q') } };
    if (p[0] === 'r' && p[1]) return { name: p[2] === 'cook' ? 'cook' : 'recipe', params: { id: p[1], step: q.get('step') } };
    if (p[0] === 'edit' && p[1]) return { name: 'edit', params: { id: p[1] } };
    if (p[0] === 'new') return { name: 'edit', params: { id: null } };
    if (p[0] === 'add') return { name: 'add', params: { mode: p[1] || '' } };
    if (p[0] === 'import') return { name: 'import', params: { d: q.get('d') } };
    if (p[0] === 'groceries') return { name: 'groceries', params: {} };
    if (p[0] === 'settings') return { name: 'settings', params: {} };
    return { name: 'book', params: {} };
  }
  const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

  let lastRouteKey = '';
  function render() {
    const prev = route;
    route = parseRoute();
    const main = $('#main');
    const key = route.name + ':' + (route.params.id || route.params.mode || '');
    if (route.name !== 'cook') cook.close(true);
    voice.stop();
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === navFor(route.name)));
    document.body.dataset.view = route.name;
    switch (route.name) {
      case 'book': viewBook(main); break;
      case 'recipe': viewRecipe(main, route.params.id); break;
      case 'cook': if (!store.byId(route.params.id)) { go('#/'); return; } if (prev.name !== 'cook' || !cook.state) { if (!main.innerHTML || prev.name !== 'recipe') viewRecipe(main, route.params.id); cook.open(route.params.id, route.params.step); } break;
      case 'edit': viewEdit(main, route.params.id); break;
      case 'add': viewAdd(main, route.params.mode); break;
      case 'import': viewImportPayload(main, route.params.d); break;
      case 'groceries': viewGroceries(main); break;
      case 'settings': viewSettings(main); break;
      default: viewBook(main);
    }
    if (key !== lastRouteKey && route.name !== 'cook') { window.scrollTo(0, route.name === 'book' ? (bookScroll || 0) : 0); }
    lastRouteKey = key;
  }
  const navFor = (n) => ({ book: 'book', recipe: 'book', cook: 'book', edit: 'add', add: 'add', import: 'add', groceries: 'groceries', settings: 'settings' }[n]);
  let bookScroll = 0;
  window.addEventListener('scroll', () => { if (route.name === 'book') bookScroll = window.scrollY; }, { passive: true });

  // ======================================================================
  // View: Library
  // ======================================================================
  function categoriesInUse() {
    const counts = {};
    store.recipes.forEach((r) => { const c = r.category || 'Uncategorized'; counts[c] = (counts[c] || 0) + 1; });
    const order = CAT_ORDER.filter((c) => counts[c]).concat(Object.keys(counts).filter((c) => !CAT_ORDER.includes(c)).sort());
    return order.map((c) => ({ name: c, count: counts[c] }));
  }
  function tagsInUse() {
    const counts = {};
    store.recipes.forEach((r) => r.tags.forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
    return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  function viewBook(main) {
    const p = route.params;
    if (p.tag) { ui.tags = [p.tag]; ui.cat = ''; saveUi(); history.replaceState(null, '', '#/'); }
    if (p.cat) { ui.cat = p.cat; saveUi(); history.replaceState(null, '', '#/'); }
    if (p.q) { ui.q = p.q; history.replaceState(null, '', '#/'); }
    const cats = categoriesInUse();
    const total = store.recipes.length;
    const showTip = !LS.get(K.tips, false);
    main.innerHTML = `
      <section class="lib wrap">
        <div class="lib-hero">
          <div>
            <p class="eyebrow">${esc(store.book.title || 'Recipe Book')}</p>
            <h1>What are we cooking${new Date().getHours() < 11 ? ' this morning' : new Date().getHours() < 16 ? ' today' : ' tonight'}?</h1>
            <p class="sub">${total} recipe${total === 1 ? '' : 's'} · ${cats.length} categor${cats.length === 1 ? 'y' : 'ies'}</p>
          </div>
        </div>
        <form class="searchbar" role="search" onsubmit="return false">
          ${icon('i-search', 'lead')}
          <input id="q" type="search" autocomplete="off" enterkeyhint="search" placeholder="Search recipes, ingredients, tags…" value="${esc(ui.q)}" aria-label="Search recipes">
          <button type="button" class="icon-btn mic" data-act="voice-search" aria-label="Search by voice" ${voice.supported ? '' : 'hidden'}>${icon('i-mic')}</button>
        </form>
        <div class="chips cats" role="tablist" aria-label="Categories">
          <button class="chip ${!ui.cat ? 'on' : ''}" data-act="cat" data-cat="">All <small>${total}</small></button>
          ${cats.map((c) => `<button class="chip cat-chip ${ui.cat === c.name ? 'on' : ''}" data-act="cat" data-cat="${esc(c.name)}" style="--cat:var(--c-${catKey(c.name)})">${icon('c-' + catKey(c.name))}${esc(c.name)} <small>${c.count}</small></button>`).join('')}
        </div>
        <div class="filterbar">
          <button class="chip ghost ${ui.fav ? 'on' : ''}" data-act="toggle-fav-filter">${icon('i-heart')} Favorites</button>
          <button class="chip ghost ${ui.quick ? 'on' : ''}" data-act="toggle-quick">${icon('i-clock')} 30 min or less</button>
          <button class="chip ghost ${ui.showTags || ui.tags.length ? 'on' : ''}" data-act="toggle-tags" aria-expanded="${ui.showTags}"># Tags${ui.tags.length ? ' · ' + ui.tags.length : ''}</button>
          <label class="sort">Sort
            <select id="sort">
              ${[['book', 'Book order'], ['az', 'A–Z'], ['recent', 'Newest'], ['cooked', 'Most cooked'], ['time', 'Quickest']].map(([v, l]) => `<option value="${v}" ${ui.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="tagcloud" id="tagcloud" ${ui.showTags ? '' : 'hidden'}>
          ${tagsInUse().map(([t, n]) => `<button class="tag ${ui.tags.includes(t) ? 'on' : ''}" data-act="tag-filter" data-tag="${esc(t)}">#${esc(t)} <small>${n}</small></button>`).join('')}
        </div>
        ${showTip && total ? `<div class="tip">
          ${icon('i-sparkle')}
          <p><b>Tips:</b> open any recipe and hit <b>Start cooking</b> for a hands-free, step-by-step mode with timers. Add recipes by <a href="#/add/voice">voice</a>, <a href="#/add/web">link</a> or <a href="#/add/chat">chat paste</a>.<span class="kbd-hint"> Press <kbd>/</kbd> to search.</span></p>
          <button class="icon-btn" data-act="hide-tip" aria-label="Dismiss tip">${icon('i-x')}</button>
        </div>` : ''}
        <div id="results" aria-live="polite"></div>
      </section>`;
    renderResults();
    const q = $('#q');
    q.addEventListener('input', debounce(() => { ui.q = q.value; renderResults(); }, 90));
    $('#sort').addEventListener('change', (e) => { ui.sort = e.target.value; saveUi(); renderResults(); });
  }

  function filteredRecipes() {
    let list;
    const hasQ = ui.q.trim().length > 0;
    if (hasQ) list = search(ui.q);
    else list = store.recipes.map((r) => ({ r, score: 0, why: [] }));
    list = list.filter(({ r }) => (!ui.cat || (r.category || 'Uncategorized') === ui.cat)
      && ui.tags.every((t) => r.tags.includes(t))
      && (!ui.fav || store.meta(r.id).fav)
      && (!ui.quick || ((parseMinutes(r.time) || 999) <= 30)));
    if (!hasQ) {
      const catIdx = (c) => { const i = CAT_ORDER.indexOf(c); return i < 0 ? 99 : i; };
      const pos = new Map(store.recipes.map((r, i) => [r.id, i]));
      const sorters = {
        book: (a, b) => catIdx(a.r.category) - catIdx(b.r.category) || (a.r.category || '').localeCompare(b.r.category || '') || pos.get(a.r.id) - pos.get(b.r.id),
        az: (a, b) => a.r.title.localeCompare(b.r.title),
        recent: (a, b) => (b.r.createdAt || '').localeCompare(a.r.createdAt || ''),
        cooked: (a, b) => (store.meta(b.r.id).cooked || []).length - (store.meta(a.r.id).cooked || []).length || a.r.title.localeCompare(b.r.title),
        time: (a, b) => (parseMinutes(a.r.time) || 9999) - (parseMinutes(b.r.time) || 9999),
      };
      list.sort(sorters[ui.sort] || sorters.book);
    }
    return list;
  }

  function renderResults() {
    const el = $('#results');
    if (!el) return;
    const list = filteredRecipes();
    const hasQ = ui.q.trim().length > 0;
    const activeFilters = [ui.cat, ui.fav, ui.quick].filter(Boolean).length + ui.tags.length;
    let html = '';
    if (ui.tags.length) {
      html += `<div class="active-tags">${ui.tags.map((t) => `<button class="tag on" data-act="tag-filter" data-tag="${esc(t)}">#${esc(t)} ${icon('i-x')}</button>`).join('')}</div>`;
    }
    if (!list.length) {
      html += `<div class="empty">
        <p class="empty-title">${store.recipes.length ? 'No recipes match that.' : 'Your recipe book is empty.'}</p>
        <p>${hasQ ? `Nothing for “${esc(ui.q)}”${activeFilters ? ' with the current filters' : ''}.` : ''}</p>
        <div class="row center">
          ${activeFilters || hasQ ? '<button class="btn" data-act="clear-filters">Clear search &amp; filters</button>' : ''}
          <a class="btn primary" href="#/add">${icon('i-plus')} Add a recipe</a>
        </div></div>`;
      el.innerHTML = html; return;
    }
    if (hasQ) {
      html += `<p class="result-count">${list.length} result${list.length === 1 ? '' : 's'} for “${esc(ui.q)}”</p><div class="grid">${list.map(cardHtml).join('')}</div>`;
    } else if (ui.sort === 'book' && !ui.cat) {
      const groups = [];
      list.forEach((x) => { const c = x.r.category || 'Uncategorized'; let g = groups.find((y) => y.c === c); if (!g) groups.push(g = { c, items: [] }); g.items.push(x); });
      html += groups.map((g) => `<section class="cat-section" style="--cat:var(--c-${catKey(g.c)})">
        <h2 class="cat-title">${icon('c-' + catKey(g.c))}<span>${esc(g.c)}</span><small>${g.items.length}</small></h2>
        <div class="grid">${g.items.map(cardHtml).join('')}</div></section>`).join('');
    } else {
      html += `<div class="grid">${list.map(cardHtml).join('')}</div>`;
    }
    el.innerHTML = html;
  }

  function cardHtml({ r, why }) {
    const m = store.meta(r.id);
    const ck = catKey(r.category);
    const nIng = r.ingredients.reduce((a, g) => a + g.items.length, 0);
    const nSteps = r.steps.reduce((a, g) => a + g.items.length, 0);
    const cooked = (m.cooked || []).length;
    return `<article class="card" style="--cat:var(--c-${ck})">
      <a class="card-link" href="#/r/${encodeURIComponent(r.id)}" aria-label="${esc(r.title)}"></a>
      <div class="card-art ${r.image ? 'has-img' : ''}">
        ${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
        <span class="card-glyph">${icon('c-' + ck)}</span>
      </div>
      <div class="card-body">
        <p class="eyebrow">${esc(r.category || 'Uncategorized')}</p>
        <h3>${esc(r.title)}</h3>
        ${why && why.length ? `<p class="why">${icon('i-search')} ${esc(RB.stripMd(why[0]))}</p>` : r.description ? `<p class="desc">${esc(r.description)}</p>` : ''}
        <p class="meta">
          ${r.time ? `<span>${icon('i-clock')}${esc(r.time.replace(/\s*\(.*\)$/, ''))}</span>` : ''}
          ${nIng ? `<span>${nIng} ingredients</span>` : ''}
          ${!nIng && nSteps ? `<span>${nSteps} steps</span>` : ''}
          ${cooked ? `<span class="cooked">${icon('i-flame')}${cooked}×</span>` : ''}
        </p>
        ${r.tags.length ? `<p class="card-tags">${r.tags.slice(0, 4).map((t) => `<span>#${esc(t)}</span>`).join('')}</p>` : ''}
      </div>
      <button class="fav ${m.fav ? 'on' : ''}" data-act="fav" data-id="${esc(r.id)}" aria-pressed="${!!m.fav}" aria-label="${m.fav ? 'Remove from' : 'Add to'} favorites">${icon('i-heart')}</button>
    </article>`;
  }

  // ======================================================================
  // View: Recipe
  // ======================================================================
  const scales = LS.get(K.scale, {});
  const checks = {}; // recipeId -> Set of "g:i"
  const doneSteps = {}; // recipeId -> Set of "g:i"
  const getScale = (id) => scales[id] || 1;
  const setScale = (id, f) => { f = Math.max(0.25, Math.min(20, Math.round(f * 100) / 100)); if (f === 1) delete scales[id]; else scales[id] = f; LS.set(K.scale, scales); };
  const checkSet = (id) => checks[id] || (checks[id] = new Set());
  const doneSet = (id) => doneSteps[id] || (doneSteps[id] = new Set());

  function qtyHtml(text) {
    const h = inlineMd(text);
    return h.replace(/^((?:about |juice of |zest of )?[\d½⅓⅔¼¾⅛⅜⅝⅞][\d\s./½⅓⅔¼¾⅛⅜⅝⅞]*(?:\s*(?:to|-|–)\s*[\d./½⅓⅔¼¾⅛⅜⅝⅞]+)?\s*(?:\(\d+[^)]*\)\s*)?(?:cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|g|kg|ml|l|inch(?:es)?|cans?|cloves?|sticks?|pieces?|heads?|bunch|slices?)?\b)/i, '<b class="qty">$1</b>');
  }

  function stepHtml(text, label) {
    let h = inlineMd(text);
    h = h.replace(RB.timerRx(), (m) => {
      const t = RB.findTimers(m)[0];
      if (!t) return m;
      return `<button type="button" class="tchip" data-act="timer" data-secs="${t.seconds}" data-label="${esc(label)}" title="Start a ${esc(RB.fmtDurationWords(t.seconds))} timer">${icon('i-timer')}${m}</button>`;
    });
    return h;
  }
  const stepLabel = (r, text, n) => {
    const b = String(text).match(/^\*\*([^*]+?):?\*\*/);
    return (b ? b[1] : 'Step ' + n) + ' · ' + r.title.replace(/\s*\(.*\)$/, '');
  };

  function viewRecipe(main, id) {
    const r = store.byId(id);
    if (!r) {
      main.innerHTML = `<section class="wrap narrow empty"><p class="empty-title">Recipe not found</p><p>It may have been deleted or renamed.</p><a class="btn primary" href="#/">Back to recipes</a></section>`;
      return;
    }
    const m = store.meta(r.id);
    const f = getScale(r.id);
    const ck = catKey(r.category);
    const cs = checkSet(r.id);
    const ds = doneSet(r.id);
    const nSteps = r.steps.reduce((a, g) => a + g.items.length, 0);
    let stepNo = 0;
    const cooked = m.cooked || [];
    main.innerHTML = `
      <article class="recipe wrap" style="--cat:var(--c-${ck})">
        <nav class="crumbs no-print"><a href="#/" class="back">${icon('i-back')} All recipes</a>
          <a href="#/?cat=${encodeURIComponent(r.category || '')}" class="crumb-cat">${icon('c-' + ck)}${esc(r.category || 'Uncategorized')}</a></nav>
        <header class="r-head ${r.image ? 'with-img' : ''}">
          ${r.image ? `<div class="r-img"><img src="${esc(r.image)}" alt="" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></div>` : ''}
          <div class="r-titles">
            <h1>${esc(r.title)}</h1>
            ${r.description ? `<p class="lede">${inlineMd(r.description)}</p>` : ''}
            <dl class="facts">
              ${r.time ? `<div><dt>${icon('i-clock')}Time</dt><dd>${esc(r.time)}</dd></div>` : ''}
              ${r.yield ? `<div><dt>${icon('i-utensils')}Yield</dt><dd>${esc(r.yield)}</dd></div>` : ''}
              ${nSteps ? `<div><dt>${icon('i-list')}Steps</dt><dd>${nSteps}</dd></div>` : ''}
              <div><dt>${icon('i-flame')}Cooked</dt><dd>${cooked.length ? `${cooked.length}× · last ${relDays(cooked[cooked.length - 1])}` : 'Not yet'}</dd></div>
            </dl>
            ${r.tags.length ? `<p class="tags">${r.tags.map((t) => `<a class="tag" href="#/?tag=${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}</p>` : ''}
          </div>
          <div class="r-actions no-print">
            ${nSteps ? `<button class="btn primary big" data-act="cook">${icon('i-play')} Start cooking</button>` : ''}
            <button class="btn ${m.fav ? 'on' : ''}" data-act="fav" data-id="${esc(r.id)}" aria-pressed="${!!m.fav}">${icon('i-heart')} ${m.fav ? 'Favorited' : 'Favorite'}</button>
            <button class="btn" data-act="grocery-add">${icon('i-bag')} ${groceries.has(r.id) ? 'On list ✓' : 'Add to list'}</button>
            <a class="btn" href="#/edit/${encodeURIComponent(r.id)}">${icon('i-pencil')} Edit</a>
            <details class="menu">
              <summary class="btn icon-only" aria-label="More actions">${icon('i-more')}</summary>
              <div class="menu-pop">
                <button data-act="mark-cooked">${icon('i-flame')} Mark as cooked today</button>
                <button data-act="share">${icon('i-share')} Share…</button>
                <button data-act="copy-md">${icon('i-copy')} Copy as text</button>
                <button data-act="duplicate">${icon('i-copyadd')} Duplicate</button>
                <button data-act="print">${icon('i-print')} Print</button>
                <button data-act="delete" class="danger">${icon('i-trash')} Delete</button>
              </div>
            </details>
          </div>
        </header>

        <div class="r-body ${r.ingredients.length ? '' : 'no-ing'}">
          ${r.ingredients.length ? `<aside class="ing-col">
            <div class="panel">
              <div class="panel-head">
                <h2>Ingredients</h2>
                <div class="scaler no-print" role="group" aria-label="Scale recipe">
                  <button class="icon-btn" data-act="scale" data-d="-" aria-label="Smaller batch">${icon('i-minus')}</button>
                  <button class="scale-val" data-act="scale-reset" title="Reset to 1×">${esc(RB.formatQty(f, 'frac'))}×</button>
                  <button class="icon-btn" data-act="scale" data-d="+" aria-label="Bigger batch">${icon('i-plus')}</button>
                </div>
              </div>
              ${f !== 1 ? `<p class="scaled-note">Scaled ${esc(RB.formatQty(f, 'frac'))}× — quantities at the start of each line are adjusted.</p>` : ''}
              ${r.ingredients.map((g, gi) => `
                ${g.name || g.note ? `<h3 class="group">${esc(g.name || '')}${g.note ? ` <small>${esc(g.note)}</small>` : ''}</h3>` : ''}
                <ul class="ing-list">
                  ${g.items.map((it, ii) => `<li><label class="check ${cs.has(gi + ':' + ii) ? 'on' : ''}"><input type="checkbox" data-act="ing-check" data-k="${gi}:${ii}" ${cs.has(gi + ':' + ii) ? 'checked' : ''}><span class="box">${icon('i-check')}</span><span>${qtyHtml(RB.scaleIngredient(it, f))}</span></label></li>`).join('')}
                </ul>`).join('')}
              ${cs.size ? `<button class="linkish no-print" data-act="ing-reset">Uncheck all</button>` : ''}
            </div>
          </aside>` : ''}
          <div class="method-col">
            ${r.steps.length ? `<section class="panel">
              <div class="panel-head"><h2>Method</h2>${nSteps ? `<button class="btn small ghost no-print" data-act="cook">${icon('i-play')} Cooking mode</button>` : ''}</div>
              ${r.steps.map((g, gi) => `
                ${g.name ? `<h3 class="group">${esc(g.name)}</h3>` : ''}
                <ol class="steps">
                  ${g.items.map((s, si) => { stepNo++; const k = gi + ':' + si; return `<li class="${ds.has(k) ? 'done' : ''}" data-act="step-done" data-k="${k}"><span class="num">${stepNo}</span><div>${stepHtml(s, stepLabel(r, s, stepNo))}</div></li>`; }).join('')}
                </ol>`).join('')}
            </section>` : ''}
            ${r.notes.length ? `<section class="panel notes"><h2>Notes</h2><ul>${r.notes.map((n) => `<li>${inlineMd(n)}</li>`).join('')}</ul></section>` : ''}
            ${r.extras.map((e) => `<section class="panel extra"><h2>${esc(e.title)}</h2>${blockMd(e.body)}</section>`).join('')}
            <section class="panel mine no-print">
              <h2>My notes</h2>
              <textarea id="my-notes" rows="3" placeholder="Tweaks, what worked, what to try next time…">${esc(m.notes || '')}</textarea>
              <div class="row between">
                <span class="muted small" id="notes-status">${m.notes ? 'Saved' : 'Saves automatically'}</span>
                <button class="btn small" data-act="mark-cooked">${icon('i-flame')} I cooked this today</button>
              </div>
              ${cooked.length ? `<p class="cook-log">${icon('i-flame')} Cooked ${cooked.length}×: ${cooked.slice(-6).reverse().map((d) => esc(fmtDate(d))).join(' · ')}${cooked.length > 6 ? ' …' : ''} <button class="linkish" data-act="unmark-cooked">undo last</button></p>` : ''}
            </section>
            ${r.sources.length ? `<section class="sources"><h2>Sources</h2><ul>${r.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${icon('i-link')}${esc(s.label || (/claude\.ai\/chat/.test(s.url) ? 'Original chat' : RB.hostLabel(s.url)))}</a></li>`).join('')}</ul></section>` : ''}
            <p class="muted small stamp">Added ${esc(fmtDate(r.createdAt))}${r.updatedAt && fmtDate(r.updatedAt) !== fmtDate(r.createdAt) ? ' · edited ' + esc(fmtDate(r.updatedAt)) : ''}</p>
          </div>
        </div>
      </article>`;
    const notes = $('#my-notes');
    const saveNotes = debounce(() => { store.setMeta(r.id, { notes: notes.value }); $('#notes-status').textContent = 'Saved'; }, 500);
    notes.addEventListener('input', () => { $('#notes-status').textContent = 'Saving…'; saveNotes(); });
  }

  // ======================================================================
  // Cooking mode
  // ======================================================================
  const cook = {
    state: null, wake: null, listen: null,
    open(id, step) {
      const r = store.byId(id);
      if (!r) return;
      const flat = [{ kind: 'prep' }];
      let n = 0;
      r.steps.forEach((g, gi) => g.items.forEach((text, si) => { n++; flat.push({ kind: 'step', text, group: g.name, gi, si, n }); }));
      if (!r.ingredients.length) flat.shift();
      flat.push({ kind: 'done' });
      this.state = { r, flat, i: 0, total: n, sheet: false };
      if (step != null && !isNaN(+step)) this.state.i = Math.max(0, Math.min(flat.length - 1, +step));
      document.body.classList.add('cooking');
      this.render();
      this.requestWake();
      document.addEventListener('keydown', this.onKey);
      document.addEventListener('visibilitychange', this.onVis);
    },
    close(silent) {
      if (!this.state) return;
      this.state = null;
      document.body.classList.remove('cooking');
      $('#cook-root').innerHTML = '';
      speech.stop();
      if (this.listen) { this.listen.stop(); this.listen = null; }
      this.releaseWake();
      document.removeEventListener('keydown', this.onKey);
      document.removeEventListener('visibilitychange', this.onVis);
      if (!silent) { const id = route.params.id; go('#/r/' + encodeURIComponent(id)); }
    },
    onKey: (e) => {
      if (!cook.state || e.target.matches('input, textarea, select')) return;
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); cook.move(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); cook.move(-1); }
      else if (e.key === 'Escape') { if (cook.state.sheet) cook.toggleSheet(false); else cook.close(); }
      else if (e.key === 'i') cook.toggleSheet();
    },
    onVis: () => { if (document.visibilityState === 'visible' && cook.state) cook.requestWake(); },
    async requestWake() {
      try { if ('wakeLock' in navigator) { this.wake = await navigator.wakeLock.request('screen'); const b = $('.wake-note'); if (b) b.hidden = false; } } catch (e) { /* not allowed */ }
    },
    releaseWake() { try { if (this.wake) this.wake.release(); } catch (e) { /* */ } this.wake = null; },
    move(d) {
      const s = this.state; if (!s) return;
      const ni = Math.max(0, Math.min(s.flat.length - 1, s.i + d));
      if (ni === s.i) return;
      s.i = ni; this.renderStage(d);
      history.replaceState(null, '', '#/r/' + encodeURIComponent(s.r.id) + '/cook?step=' + s.i);
      if (settings.speak) this.readCurrent();
    },
    goto(i) { this.state.i = i; this.renderStage(0); if (settings.speak) this.readCurrent(); },
    readCurrent() {
      const s = this.state; const st = s.flat[s.i];
      if (st.kind === 'step') speech.say('Step ' + st.n + '. ' + st.text);
      else if (st.kind === 'prep') speech.say('Gather your ingredients. ' + s.r.ingredients.flatMap((g) => g.items).slice(0, 25).map((x) => RB.scaleIngredient(x, getScale(s.r.id))).join('. '));
      else speech.say('All done. Enjoy!');
    },
    toggleSheet(force) {
      const s = this.state; if (!s) return;
      s.sheet = force != null ? force : !s.sheet;
      const sh = $('.cook-sheet'); if (sh) { sh.classList.toggle('open', s.sheet); sh.setAttribute('aria-hidden', !s.sheet); }
    },
    toggleVoice() {
      if (this.listen) { this.listen.stop(); this.listen = null; this.syncButtons(); return; }
      this.listen = voice.start({
        keepAlive: true, interim: false,
        onState: (on) => { if (!on && this.listen && !this.listen.on) this.listen = null; this.syncButtons(); },
        onFinal: (txt) => this.command(txt),
      });
      if (this.listen) toast('Listening. Say “next”, “back”, “repeat”, “ingredients”, “start timer”…');
      this.syncButtons();
    },
    command(txt) {
      if (speech.speaking) return;
      const t = norm(txt);
      const flash = (w) => { const el = $('.voice-heard'); if (el) { el.textContent = '“' + txt + '”'; el.classList.add('show'); clearTimeout(this._h); this._h = setTimeout(() => el.classList.remove('show'), 1800); } return w; };
      let m;
      if ((m = t.match(/\b(?:go to |jump to )?step (\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen)\b/))) {
        const w = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15 };
        const n = isNaN(+m[1]) ? w[m[1]] : +m[1];
        const idx = this.state.flat.findIndex((x) => x.n === n);
        if (idx >= 0) { flash(); this.goto(idx); }
        return;
      }
      if (/\b(stop|silence|quiet|dismiss|shut up|okay|ok)\b/.test(t) && timers.list.some((x) => x.done)) { flash(); timers.dismissDone(); return; }
      if (/\b(next|forward|continue|done|go on|skip)\b/.test(t)) { flash(); this.move(1); return; }
      if (/\b(back|previous|go back|last step)\b/.test(t)) { flash(); this.move(-1); return; }
      if (/\b(repeat|read|again|say that|what)\b/.test(t)) { flash(); this.readCurrent(); return; }
      if (/\b(ingredient|ingredients|what do i need)\b/.test(t)) {
        flash(); const st = this.state.flat[this.state.i];
        const list = st.kind === 'step' ? RB.ingredientsForStep(st.text, this.state.r.ingredients).map((x) => RB.scaleIngredient(x.item, getScale(this.state.r.id))) : [];
        if (list.length) speech.say('For this step: ' + list.join('. ')); else this.toggleSheet(true);
        return;
      }
      if (/\b(timer|time it|start)\b/.test(t)) { flash(); const b = $('.cook-stage [data-act="timer"]'); if (b) b.click(); else speech.say('No timer in this step.'); return; }
      if (/\b(exit|close|finish cooking|stop cooking)\b/.test(t)) { flash(); this.close(); }
    },
    syncButtons() {
      const v = $('[data-act="cook-voice"]'); if (v) { v.classList.toggle('on', !!this.listen); v.setAttribute('aria-pressed', !!this.listen); }
      const s = $('[data-act="cook-speak"]'); if (s) { s.classList.toggle('on', !!settings.speak); s.setAttribute('aria-pressed', !!settings.speak); }
      const hint = $('.voice-hint'); if (hint) hint.hidden = !this.listen;
    },
    render() {
      const s = this.state; const r = s.r;
      $('#cook-root').innerHTML = `
        <div class="cook" role="dialog" aria-modal="true" aria-label="Cooking mode: ${esc(r.title)}" style="--cat:var(--c-${catKey(r.category)}); --cook-size:${settings.cookSize}">
          <header class="cook-top">
            <button class="icon-btn" data-act="cook-close" aria-label="Exit cooking mode">${icon('i-x')}</button>
            <div class="cook-title"><b>${esc(r.title)}</b><small class="cook-count"></small></div>
            <div class="cook-tools">
              <button class="icon-btn txt" data-act="cook-size" data-d="-1" aria-label="Smaller text">A−</button>
              <button class="icon-btn txt" data-act="cook-size" data-d="1" aria-label="Bigger text">A+</button>
              ${'speechSynthesis' in window ? `<button class="icon-btn" data-act="cook-speak" aria-label="Read steps aloud" aria-pressed="${!!settings.speak}">${icon('i-volume')}</button>` : ''}
              ${voice.supported ? `<button class="icon-btn" data-act="cook-voice" aria-label="Hands-free voice control" aria-pressed="false">${icon('i-mic')}</button>` : ''}
              ${r.ingredients.length ? `<button class="btn small" data-act="cook-sheet">${icon('i-list')}<span class="hide-sm"> Ingredients</span></button>` : ''}
            </div>
          </header>
          <div class="cook-progress"><i></i></div>
          <p class="voice-hint" hidden>${icon('i-mic')} Listening — say <b>next</b>, <b>back</b>, <b>repeat</b>, <b>ingredients</b>, <b>start timer</b>, <b>step 3</b>, <b>stop</b> <span class="voice-heard"></span></p>
          <main class="cook-stage" aria-live="polite"></main>
          <footer class="cook-nav">
            <button class="btn big ghost" data-act="cook-prev">${icon('i-left')} Back</button>
            <div class="dots" aria-hidden="true"></div>
            <button class="btn big primary" data-act="cook-next">Next ${icon('i-right')}</button>
          </footer>
          <aside class="cook-sheet" aria-hidden="true" aria-label="Ingredients">
            <div class="sheet-head"><h2>Ingredients</h2><button class="icon-btn" data-act="cook-sheet" aria-label="Close ingredients">${icon('i-x')}</button></div>
            <div class="sheet-body"></div>
          </aside>
        </div>`;
      this.syncButtons();
      this.renderSheet();
      this.renderStage(0);
      // swipe
      const stage = $('.cook-stage');
      let x0 = null, y0 = null;
      stage.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
      stage.addEventListener('touchend', (e) => {
        if (x0 == null) return;
        const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) this.move(dx < 0 ? 1 : -1);
        x0 = null;
      }, { passive: true });
    },
    ingListHtml(highlight) {
      const r = this.state.r, f = getScale(r.id), cs = checkSet(r.id);
      return r.ingredients.map((g, gi) => `
        ${g.name ? `<h3 class="group">${esc(g.name)}</h3>` : ''}
        <ul class="ing-list big">${g.items.map((it, ii) => `<li class="${highlight && highlight.has(gi + ':' + ii) ? 'hl' : ''}"><label class="check ${cs.has(gi + ':' + ii) ? 'on' : ''}"><input type="checkbox" data-act="ing-check" data-k="${gi}:${ii}" ${cs.has(gi + ':' + ii) ? 'checked' : ''}><span class="box">${icon('i-check')}</span><span>${qtyHtml(RB.scaleIngredient(it, f))}</span></label></li>`).join('')}</ul>`).join('');
    },
    renderSheet() { const b = $('.cook-sheet .sheet-body'); if (b) b.innerHTML = this.ingListHtml(); },
    renderStage(dir) {
      const s = this.state; const r = s.r; const st = s.flat[s.i];
      const f = getScale(r.id);
      const stage = $('.cook-stage');
      let html = '';
      if (st.kind === 'prep') {
        const nIng = r.ingredients.reduce((a, g) => a + g.items.length, 0);
        html = `<div class="stage-inner">
          <p class="eyebrow">Before you start · mise en place</p>
          <h2 class="stage-h">Gather ${nIng} ingredients</h2>
          ${f !== 1 ? `<p class="muted">Scaled ${esc(RB.formatQty(f, 'frac'))}×</p>` : ''}
          <div class="prep-list">${this.ingListHtml()}</div>
          ${r.yield || r.time ? `<p class="muted">${[r.yield, r.time].filter(Boolean).map(esc).join(' · ')}</p>` : ''}
          <p class="wake-note muted small" ${this.wake ? '' : 'hidden'}>${icon('i-sparkle')} Your screen will stay on while cooking.</p>
        </div>`;
      } else if (st.kind === 'step') {
        const b = st.text.match(/^\*\*([^*]+?):?\*\*:?\s*(.*)$/);
        const head = b ? b[1] : '';
        const body = b ? b[2] : st.text;
        const uses = RB.ingredientsForStep(st.text, r.ingredients);
        const tms = RB.findTimers(st.text);
        const next = s.flat[s.i + 1];
        const label = stepLabel(r, st.text, st.n);
        html = `<div class="stage-inner">
          <p class="eyebrow">Step ${st.n} of ${s.total}${st.group ? ' · ' + esc(st.group) : ''}</p>
          ${head ? `<h2 class="stage-h">${esc(head)}</h2>` : ''}
          <p class="stage-text">${stepHtml(body || st.text, label)}</p>
          ${tms.length ? `<div class="stage-timers">${tms.map((t) => `<button class="btn timer-btn" data-act="timer" data-secs="${t.seconds}" data-label="${esc(label)}">${icon('i-timer')} Start ${esc(RB.fmtDurationWords(t.seconds))} timer${t.maxSeconds ? `<small>up to ${esc(RB.fmtDurationWords(t.maxSeconds))}</small>` : ''}</button>`).join('')}</div>` : ''}
          ${uses.length ? `<div class="uses"><p class="eyebrow">For this step</p><ul>${uses.map((u) => `<li>${qtyHtml(RB.scaleIngredient(u.item, f))}</li>`).join('')}</ul></div>` : ''}
          ${next && next.kind === 'step' ? `<p class="up-next"><span>Up next</span> ${esc(RB.stripMd(next.text).slice(0, 110))}${RB.stripMd(next.text).length > 110 ? '…' : ''}</p>` : ''}
        </div>`;
        const ds = doneSet(r.id);
        for (let k = 1; k < s.flat.length; k++) { const x = s.flat[k]; if (x.kind === 'step') { if (k < s.i) ds.add(x.gi + ':' + x.si); } }
      } else {
        const cooked = store.meta(r.id).cooked || [];
        const today = cooked.length && new Date(cooked[cooked.length - 1]).toDateString() === new Date().toDateString();
        html = `<div class="stage-inner center">
          <p class="done-mark">${icon('i-check')}</p>
          <h2 class="stage-h">That’s it. Enjoy!</h2>
          <p class="muted">${esc(r.title)}</p>
          ${r.notes.length || r.extras.length ? `<div class="done-notes">${r.notes.map((n) => `<p>${inlineMd(n)}</p>`).join('')}${r.extras.map((e) => `<h3>${esc(e.title)}</h3>${blockMd(e.body)}`).join('')}</div>` : ''}
          <div class="row center wrap-row">
            ${today ? `<span class="pill">${icon('i-flame')} Logged as cooked today</span>` : `<button class="btn primary big" data-act="mark-cooked">${icon('i-flame')} Log that I cooked this</button>`}
            <button class="btn big" data-act="cook-close">Back to recipe</button>
          </div>
          <label class="done-notes-field">Anything to remember next time?
            <textarea id="cook-notes" rows="3" placeholder="e.g. needed 5 more minutes, less salt…">${esc(store.meta(r.id).notes || '')}</textarea></label>
        </div>`;
      }
      stage.innerHTML = html;
      stage.classList.remove('in-left', 'in-right');
      void stage.offsetWidth;
      if (dir) stage.classList.add(dir > 0 ? 'in-right' : 'in-left');
      stage.scrollTop = 0;
      const cn = $('#cook-notes');
      if (cn) cn.addEventListener('input', debounce(() => store.setMeta(r.id, { notes: cn.value }), 500));
      // header + progress
      const stepN = st.kind === 'step' ? st.n : st.kind === 'prep' ? 0 : s.total;
      $('.cook-count').textContent = st.kind === 'prep' ? 'Mise en place' : st.kind === 'done' ? 'Finished' : `Step ${st.n} of ${s.total}`;
      $('.cook-progress i').style.width = (s.total ? (stepN / s.total) * 100 : 100) + '%';
      $('[data-act="cook-prev"]').disabled = s.i === 0;
      const nextBtn = $('[data-act="cook-next"]');
      nextBtn.hidden = st.kind === 'done';
      nextBtn.innerHTML = (st.kind === 'prep' ? 'Let’s cook' : s.flat[s.i + 1] && s.flat[s.i + 1].kind === 'done' ? 'Finish' : 'Next') + ' ' + icon('i-right');
      $('.dots').innerHTML = s.flat.length <= 24 ? s.flat.map((x, i) => `<i class="${i === s.i ? 'on' : i < s.i ? 'past' : ''}"></i>`).join('') : `<span>${s.i + 1}/${s.flat.length}</span>`;
      // highlight in sheet
      if (st.kind === 'step') {
        const hl = new Set(RB.ingredientsForStep(st.text, r.ingredients).map((u) => u.g + ':' + u.i));
        const b = $('.cook-sheet .sheet-body'); if (b) b.innerHTML = this.ingListHtml(hl);
      }
    },
  };

  // ======================================================================
  // View: Add hub + import flows
  // ======================================================================
  let draft = LS.get(K.draft, null);
  function setDraft(r) { draft = r; LS.set(K.draft, r); }
  function openDraft(r) { setDraft(normalizeRecipe(r)); go('#/new'); }

  const CLAUDE_PROMPT = `Format this recipe for my recipe book. Reply with ONLY the recipe in this exact markdown format:

## Recipe Title

One or two sentences about the dish.

**Tags:** cuisine, main ingredient, occasion
**Time:** 45 min

**Serves 4**

**Ingredients**
- 1 cup example ingredient
- 2 tbsp another ingredient

(Use a bold sub-heading like **Sauce** above a list for each component if there are several.)

**Method**
1. **Short label:** First step, with times like 5 minutes.
2. Next step.

**Notes**
- Tips, swaps, storage.`;

  function viewAdd(main, mode) {
    if (mode === 'voice') return viewAddVoice(main);
    if (mode === 'web') return viewAddWeb(main);
    if (mode === 'chat') return viewAddChat(main);
    main.innerHTML = `
      <section class="wrap narrow add-hub">
        <h1>Add a recipe</h1>
        <p class="sub">Pick whatever’s easiest. Every option ends in a quick review screen so you can fix anything before saving.</p>
        <div class="add-grid">
          <a class="add-tile" href="#/add/voice"><span class="add-ic">${icon('i-mic')}</span><b>Say it</b><span>Dictate the recipe out loud. Great with messy hands.</span></a>
          <a class="add-tile" href="#/add/web"><span class="add-ic">${icon('i-link')}</span><b>From a website</b><span>Paste a link. We pull the ingredients and steps.</span></a>
          <a class="add-tile" href="#/add/chat"><span class="add-ic">${icon('i-chat')}</span><b>From a chat</b><span>Paste a recipe from Claude, a text, notes or an email.</span></a>
          <a class="add-tile" href="#/new" data-act="new-blank"><span class="add-ic">${icon('i-pencil')}</span><b>Type it</b><span>Start with a blank recipe card.</span></a>
          <label class="add-tile"><span class="add-ic">${icon('i-file')}</span><b>Import a file</b><span>Markdown (.md), text or a JSON backup.</span><input type="file" accept=".md,.markdown,.txt,.json,text/*,application/json" data-act="import-file" hidden></label>
        </div>
        ${draft ? `<div class="tip">${icon('i-pencil')}<p>You have an unsaved draft: <b>${esc(draft.title || 'Untitled')}</b></p><a class="btn small" href="#/new">Resume</a><button class="icon-btn" data-act="discard-draft" aria-label="Discard draft">${icon('i-x')}</button></div>` : ''}
      </section>`;
  }

  function viewAddVoice(main) {
    main.innerHTML = `
      <section class="wrap narrow">
        <nav class="crumbs"><a href="#/add" class="back">${icon('i-back')} Add a recipe</a></nav>
        <h1>Say it</h1>
        <p class="sub">Tap the mic and talk naturally. Use the words in bold to jump between sections, and say <b>“next”</b> between items.</p>
        <div class="voice-box">
          <button class="mic-big" data-act="voice-dictate" aria-label="Start dictation" ${voice.supported ? '' : 'disabled'}>${icon('i-mic')}</button>
          <p class="mic-status" id="mic-status">${voice.supported ? 'Tap to start' : 'Voice input isn’t supported in this browser. Tap the box below and use your keyboard’s microphone instead, following the same pattern.'}</p>
          <p class="interim" id="interim"></p>
        </div>
        <div class="example">
          <p class="eyebrow">Example</p>
          <p>“<b>Title</b> garlic butter rice. <b>Serves</b> 4. <b>Ingredients</b> 2 cups jasmine rice <b>next</b> 4 cloves garlic <b>next</b> 3 tablespoons butter. <b>Steps</b> rinse the rice <b>next</b> fry the garlic in butter for 2 minutes <b>next</b> add rice and water and simmer 18 minutes. <b>Notes</b> day-old rice works too. <b>Tags</b> rice, side.”</p>
        </div>
        <label class="field"><span>Transcript <small>(edit freely)</small></span>
          <textarea id="transcript" rows="8" placeholder="Your words appear here…">${esc(LS.get('wrb.transcript', ''))}</textarea></label>
        <div class="row between">
          <button class="btn ghost" data-act="clear-transcript">Clear</button>
          <button class="btn primary big" data-act="build-voice">${icon('i-sparkle')} Build recipe</button>
        </div>
      </section>`;
    const ta = $('#transcript');
    ta.addEventListener('input', debounce(() => LS.set('wrb.transcript', ta.value), 300));
  }

  function viewAddWeb(main, prefill) {
    const bm = bookmarklet();
    main.innerHTML = `
      <section class="wrap narrow">
        <nav class="crumbs"><a href="#/add" class="back">${icon('i-back')} Add a recipe</a></nav>
        <h1>From a website</h1>
        <p class="sub">Most recipe sites publish structured recipe data. Paste the link and we’ll grab the ingredients, steps, times and photo.</p>
        <form class="url-form" data-form="web">
          <input id="url" type="url" inputmode="url" required placeholder="https://www.example.com/best-pancakes" value="${esc(prefill || '')}" aria-label="Recipe link">
          <button class="btn primary" type="submit">${icon('i-download')} Import</button>
        </form>
        <p class="status" id="web-status" hidden></p>
        <details class="panel fallback" id="web-fallback">
          <summary><b>Site won’t import?</b> Paste the page instead</summary>
          <p class="muted small">Some sites block apps from reading them. Open the recipe, select all (or just the recipe part), copy, and paste here.</p>
          <textarea id="web-text" rows="7" placeholder="Paste page text or HTML…"></textarea>
          <button class="btn" data-act="parse-web-text">${icon('i-sparkle')} Read recipe</button>
        </details>
        <section class="panel">
          <h2>One-tap import button</h2>
          <p>Drag this button to your browser’s bookmarks bar. On any recipe page, tap it to send the recipe straight here — works even on sites that block the link importer.</p>
          <p class="center"><a class="btn bookmarklet" href="${esc(bm)}" onclick="event.preventDefault(); alert('Drag this button to your bookmarks bar, then click it on any recipe page.')">${icon('i-book')} Save to Recipe Book</a></p>
          <details><summary class="small">On iPhone / iPad or Android</summary>
            <p class="small">Bookmark any page, then edit the bookmark and replace its address with the code below. Or just use your phone’s <b>Share</b> button: on Android, once this app is installed it appears in the share menu; on iPhone, share → Copy, then paste the link above.</p>
            <button class="btn small" data-act="copy-bookmarklet">${icon('i-copy')} Copy bookmarklet code</button>
          </details>
        </section>
      </section>`;
    if (prefill) setTimeout(() => $('.url-form').requestSubmit(), 50);
  }

  function bookmarklet() {
    const app = location.origin + location.pathname;
    const code = `(function(){var j=[].slice.call(document.querySelectorAll('script[type="application/ld+json"]')).map(function(s){return s.textContent}).filter(function(t){return /Recipe/.test(t)}).join('\\n<<<RB>>>\\n');var p={u:location.href,t:document.title,j:j.slice(0,120000)};if(!j){var s=String(getSelection());p.x=(s||document.body.innerText).slice(0,30000)}window.open('${app}#/import?d='+encodeURIComponent(JSON.stringify(p)),'_blank')})()`;
    return 'javascript:' + code;
  }

  const PROXIES = [
    (u) => u,
    (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
    (u) => 'https://r.jina.ai/' + u,
  ];
  async function fetchWithTimeout(url, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try { return await fetch(url, { signal: ctl.signal, credentials: 'omit' }); } finally { clearTimeout(t); }
  }
  async function importFromUrl(url, status) {
    let lastErr = null;
    for (let i = 0; i < PROXIES.length; i++) {
      status(i === 0 ? 'Fetching the page…' : i === PROXIES.length - 1 ? 'Trying a reader service…' : 'Site is guarded, trying another route…');
      try {
        const res = await fetchWithTimeout(PROXIES[i](url), 15000);
        if (!res.ok) { lastErr = new Error('HTTP ' + res.status); continue; }
        const text = await res.text();
        let found = [];
        if (i === PROXIES.length - 1) {
          // reader returns markdown: "Title: …\nURL Source: …\nMarkdown Content:\n…"
          const title = (text.match(/^Title:\s*(.+)$/m) || [])[1];
          const body = text.split(/Markdown Content:\s*/)[1] || text;
          const embedded = RB.parseHtml(body, url);
          found = embedded.length ? embedded : RB.parseText(body);
          if (found[0]) { if (title && found[0].title === 'Untitled recipe') found[0].title = title.trim(); if (!found[0].sources.length) found[0].sources.push({ label: RB.hostLabel(url), url }); }
        } else {
          found = RB.parseHtml(text, url);
        }
        found = found.filter((r) => r.ingredients.length || r.steps.length);
        if (found.length) return found;
        lastErr = new Error('No recipe found on the page');
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Could not import');
  }

  function viewAddChat(main, prefill) {
    main.innerHTML = `
      <section class="wrap narrow">
        <nav class="crumbs"><a href="#/add" class="back">${icon('i-back')} Add a recipe</a></nav>
        <h1>From a chat</h1>
        <p class="sub">Paste a recipe from a Claude chat, a text message, notes app or email. Markdown, bullet lists and numbered steps are all understood. Paste a whole recipe book and we’ll split it into separate recipes.</p>
        <div class="row">
          <button class="btn" data-act="paste-clipboard">${icon('i-copy')} Paste from clipboard</button>
          <button class="btn ghost" data-act="copy-prompt" title="Copy a prompt that asks Claude to format a recipe perfectly for this book">${icon('i-sparkle')} Copy prompt for Claude</button>
        </div>
        <label class="field"><span>Recipe text</span>
          <textarea id="chat-text" rows="14" placeholder="## Grandma’s Chili&#10;&#10;**Ingredients**&#10;- 2 lb ground beef&#10;- …&#10;&#10;**Method**&#10;1. Brown the beef…">${esc(prefill || '')}</textarea></label>
        <div class="row between">
          <span class="muted small">Tip: ask Claude “format this for my recipe book” using the prompt button for perfect results.</span>
          <button class="btn primary big" data-act="parse-chat">${icon('i-sparkle')} Read recipe</button>
        </div>
        <div id="multi"></div>
      </section>`;
  }

  function showMulti(recipes) {
    const el = $('#multi') || $('#main');
    el.innerHTML = `<section class="panel multi">
      <h2>Found ${recipes.length} recipes</h2>
      <p class="muted small">Recipes with the same title as one you already have will be updated.</p>
      <ul class="multi-list">${recipes.map((r, i) => `<li><label class="check on"><input type="checkbox" checked data-i="${i}"><span class="box">${icon('i-check')}</span>
        <span><b>${esc(r.title)}</b> <small class="muted">${esc(r.category || RB.guessCategory(r.title))} · ${r.ingredients.reduce((a, g) => a + g.items.length, 0)} ingredients · ${r.steps.reduce((a, g) => a + g.items.length, 0)} steps${store.recipes.some((x) => norm(x.title) === norm(r.title)) ? ' · <em>update</em>' : ''}</small></span></label></li>`).join('')}</ul>
      <div class="row end"><button class="btn primary" data-act="import-multi">Import selected</button></div></section>`;
    el._recipes = recipes;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function importMany(recipes) {
    let added = 0, updated = 0;
    recipes.forEach((r0) => {
      const r = normalizeRecipe(r0);
      if (!r.category) r.category = RB.guessCategory(r.title + ' ' + r.tags.join(' '));
      const existing = store.recipes.find((x) => x.id === r.id) || store.recipes.find((x) => norm(x.title) === norm(r.title));
      if (existing) { r.id = existing.id; r.createdAt = existing.createdAt; updated++; } else { r.id = store.uniqueId(r.title); r.createdAt = ''; added++; }
      r.updatedAt = nowIso(); if (!r.createdAt) r.createdAt = r.updatedAt;
      const i = store.recipes.findIndex((x) => x.id === r.id);
      if (i >= 0) store.recipes[i] = r; else store.recipes.push(r);
      delete store.book.deleted[r.id];
    });
    store.save();
    toast(`Imported ${added} new${updated ? `, updated ${updated}` : ''}`);
  }

  function handleParsed(recipes, sourceNote) {
    const good = recipes.filter((r) => r && (r.ingredients.length || r.steps.length || r.extras.length));
    if (!good.length) { toast('Couldn’t find a recipe in that. Check it has ingredients or steps.'); return; }
    if (good.length === 1) {
      const r = good[0];
      if (!r.category) r.category = RB.guessCategory(r.title + ' ' + r.tags.join(' '));
      if (sourceNote && !r.sources.length) r.sources.push(sourceNote);
      openDraft(r);
    } else showMulti(good);
  }

  function viewImportPayload(main, d) {
    main.innerHTML = `<section class="wrap narrow"><p class="sub">Reading recipe…</p></section>`;
    let p = null;
    try { p = JSON.parse(d || ''); } catch (e) { /* */ }
    if (!p) { main.innerHTML = `<section class="wrap narrow empty"><p class="empty-title">Nothing to import</p><a class="btn" href="#/add">Add a recipe</a></section>`; return; }
    let recipes = [];
    if (p.j) p.j.split('\n<<<RB>>>\n').forEach((block) => { try { RB.findRecipeNodes(JSON.parse(block)).forEach((n) => recipes.push(RB.fromSchema(n, p.u))); } catch (e) { /* */ } });
    if (!recipes.length && p.x) { recipes = RB.parseText(p.x); if (recipes[0]) { if (p.t && /untitled/i.test(recipes[0].title)) recipes[0].title = p.t; recipes[0].sources.push({ label: RB.hostLabel(p.u), url: p.u }); } }
    history.replaceState(null, '', '#/add');
    if (!recipes.length) { viewAddWeb(main); toast('No recipe found on that page. Try pasting the text.'); return; }
    viewAddChat(main);
    handleParsed(recipes);
  }

  // ======================================================================
  // View: Editor
  // ======================================================================
  const groupsToText = (groups) => groups.map((g) => (g.name || g.note ? (g.name || 'Ingredients') + (g.note ? ' (' + g.note + ')' : '') + ':\n' : '') + g.items.join('\n')).join('\n\n');
  const stepsToText = (groups) => groups.map((g) => (g.name ? g.name + ':\n' : '') + g.items.join('\n')).join('\n\n');
  function textToGroups(text, numbered) {
    const groups = [];
    let cur = null;
    String(text || '').split('\n').forEach((ln) => {
      let t = ln.trim();
      if (!t) return;
      const header = t.match(/^#+\s*(.+)$/) || t.match(/^\*\*(.+?)\*\*:?$/) || (!/^[-*•\d]/.test(t) && t.length < 50 && /:$/.test(t) ? [t, t.slice(0, -1)] : null);
      if (header) {
        const h = header[1].replace(/:$/, '').trim();
        const note = (h.match(/\(([^)]*)\)\s*$/) || [])[1] || '';
        let name = note ? h.replace(/\s*\([^)]*\)\s*$/, '') : h;
        if (/^(ingredients|method|steps|instructions|directions)$/i.test(name)) name = '';
        cur = { name, note, items: [] }; groups.push(cur); return;
      }
      t = t.replace(/^[-*•]\s+/, '');
      if (numbered) t = t.replace(/^(\d+[.)]|step\s+\d+[:.)]?)\s+/i, '');
      if (!cur) { cur = { name: '', note: '', items: [] }; groups.push(cur); }
      cur.items.push(t);
    });
    return groups.filter((g) => g.items.length);
  }
  const extrasToText = (extras) => extras.map((e) => '### ' + e.title + '\n' + e.body).join('\n\n');
  function textToExtras(text) {
    const out = []; let cur = null;
    String(text || '').split('\n').forEach((ln) => {
      const h = ln.match(/^#{1,6}\s+(.+)$/);
      if (h) { cur = { title: h[1].trim(), body: '' }; out.push(cur); return; }
      if (!cur) { if (!ln.trim()) return; cur = { title: 'More', body: '' }; out.push(cur); }
      cur.body += ln + '\n';
    });
    out.forEach((e) => { e.body = e.body.trim(); });
    return out.filter((e) => e.body || e.title !== 'More');
  }
  const sourcesToText = (s) => s.map((x) => (x.label ? x.label + ': ' : '') + x.url).join('\n');
  const textToSources = (t) => String(t || '').split('\n').map((l) => { const m = l.match(/^(.*?)(https?:\/\/\S+)/); return m ? { label: m[1].replace(/[:\s–-]+$/, '').trim(), url: m[2] } : null; }).filter(Boolean);

  function viewEdit(main, id) {
    const existing = id ? store.byId(id) : null;
    if (id && !existing) { go('#/'); return; }
    const r = existing ? JSON.parse(JSON.stringify(existing)) : (draft ? normalizeRecipe(draft) : Object.assign(RB.emptyRecipe(), { category: '' }));
    const isNew = !existing;
    const cats = RB.CATEGORIES.concat(categoriesInUse().map((c) => c.name)).filter((c, i, a) => a.indexOf(c) === i);
    const allTags = tagsInUse().map(([t]) => t);
    const mic = (target, mode) => voice.supported ? `<button type="button" class="icon-btn mic" data-act="dictate" data-target="${target}" data-mode="${mode}" aria-label="Dictate">${icon('i-mic')}</button>` : '';
    main.innerHTML = `
      <section class="wrap narrow editor">
        <nav class="crumbs"><a href="${isNew ? '#/add' : '#/r/' + encodeURIComponent(r.id)}" class="back">${icon('i-back')} ${isNew ? 'Add a recipe' : 'Back to recipe'}</a></nav>
        <h1>${isNew ? (draft ? 'Review & save' : 'New recipe') : 'Edit recipe'}</h1>
        ${isNew && draft ? `<p class="sub">Check everything looks right, then save. ${draft.sources && draft.sources[0] ? `Imported from ${esc(draft.sources[0].label || RB.hostLabel(draft.sources[0].url))}.` : ''}</p>` : ''}
        <form id="edit-form" autocomplete="off">
          <label class="field"><span>Title</span><div class="with-mic"><input name="title" required value="${esc(r.title)}" placeholder="e.g. Sunday Sugo">${mic('title', 'text')}</div></label>
          <div class="field-row">
            <label class="field"><span>Category</span>
              <input name="category" list="cat-list" value="${esc(r.category)}" placeholder="Mains">
              <datalist id="cat-list">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
            <label class="field"><span>Time</span><input name="time" value="${esc(r.time)}" placeholder="45 min"></label>
            <label class="field"><span>Yield</span><input name="yield" value="${esc(r.yield)}" placeholder="Serves 4"></label>
          </div>
          <div class="field"><span>Tags</span>
            <div class="tag-input" id="tag-input">
              ${r.tags.map((t) => `<span class="tag on" data-tag="${esc(t)}">#${esc(t)}<button type="button" data-act="rm-tag" aria-label="Remove ${esc(t)}">${icon('i-x')}</button></span>`).join('')}
              <input id="tag-new" list="tag-list" placeholder="${r.tags.length ? 'Add tag' : 'thai, weeknight, make-ahead…'}" enterkeyhint="done">
              <datalist id="tag-list">${allTags.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
            </div>
          </div>
          <label class="field"><span>Short description</span><div class="with-mic"><textarea name="description" rows="2" placeholder="What makes it good?">${esc(r.description)}</textarea>${mic('description', 'text')}</div></label>
          <label class="field"><span>Ingredients <small>one per line · a line ending in “:” starts a group (e.g. “Sauce:”)</small></span>
            <div class="with-mic"><textarea name="ingredients" rows="10" placeholder="2 cups flour&#10;1 tsp salt&#10;&#10;Sauce:&#10;2 tbsp soy sauce">${esc(groupsToText(r.ingredients))}</textarea>${mic('ingredients', 'lines')}</div></label>
          <label class="field"><span>Method <small>one step per line · start with “**Label:**” for a bold lead-in</small></span>
            <div class="with-mic"><textarea name="steps" rows="10" placeholder="Whisk the dry ingredients.&#10;Cook 5 minutes until golden.">${esc(stepsToText(r.steps))}</textarea>${mic('steps', 'lines')}</div></label>
          <label class="field"><span>Notes <small>one per line</small></span>
            <div class="with-mic"><textarea name="notes" rows="4">${esc(r.notes.join('\n'))}</textarea>${mic('notes', 'lines')}</div></label>
          <details class="more-fields" ${r.extras.length || r.sources.length || r.image ? 'open' : ''}>
            <summary>More: extra sections, sources, photo</summary>
            <label class="field"><span>Extra sections <small>“### Title” then text · e.g. Serving, Variations, Timeline</small></span>
              <textarea name="extras" rows="6" placeholder="### Serving&#10;Over rice with lime wedges.">${esc(extrasToText(r.extras))}</textarea></label>
            <label class="field"><span>Sources <small>one per line · “Label: https://…”</small></span>
              <textarea name="sources" rows="2" placeholder="https://claude.ai/chat/…">${esc(sourcesToText(r.sources))}</textarea></label>
            <label class="field"><span>Photo URL</span><input name="image" type="url" value="${esc(r.image)}" placeholder="https://…/photo.jpg"></label>
          </details>
          <div class="save-bar">
            ${isNew ? `<button type="button" class="btn ghost" data-act="discard-draft-edit">Discard</button>` : `<a class="btn ghost" href="#/r/${encodeURIComponent(r.id)}">Cancel</a>`}
            <button class="btn primary big" type="submit">${icon('i-check')} Save recipe</button>
          </div>
        </form>
      </section>`;

    const form = $('#edit-form');
    const tagInput = $('#tag-new');
    const addTag = (v) => {
      RB.normTags(String(v).split(',')).forEach((t) => {
        if ($$('#tag-input .tag').some((x) => x.dataset.tag === t)) return;
        const span = document.createElement('span');
        span.className = 'tag on'; span.dataset.tag = t;
        span.innerHTML = `#${esc(t)}<button type="button" data-act="rm-tag" aria-label="Remove ${esc(t)}">${icon('i-x')}</button>`;
        $('#tag-input').insertBefore(span, tagInput);
      });
      tagInput.value = '';
    };
    tagInput.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ',') && tagInput.value.trim()) { e.preventDefault(); addTag(tagInput.value); }
      else if (e.key === 'Backspace' && !tagInput.value) { const last = $$('#tag-input .tag').pop(); if (last) last.remove(); }
    });
    tagInput.addEventListener('change', () => { if (tagInput.value.trim()) addTag(tagInput.value); });
    const collect = () => {
      const fd = new FormData(form);
      if (tagInput.value.trim()) addTag(tagInput.value);
      return normalizeRecipe(Object.assign({}, r, {
        title: String(fd.get('title') || '').trim(),
        category: String(fd.get('category') || '').trim(),
        time: String(fd.get('time') || '').trim(),
        yield: String(fd.get('yield') || '').trim(),
        description: String(fd.get('description') || '').trim(),
        tags: $$('#tag-input .tag').map((x) => x.dataset.tag),
        ingredients: textToGroups(fd.get('ingredients'), false),
        steps: textToGroups(fd.get('steps'), true).map((g) => ({ name: g.name, items: g.items })),
        notes: String(fd.get('notes') || '').split('\n').map((x) => x.replace(/^[-*•]\s+/, '').trim()).filter(Boolean),
        extras: textToExtras(fd.get('extras')),
        sources: textToSources(fd.get('sources')),
        image: String(fd.get('image') || '').trim(),
      }));
    };
    if (isNew) form.addEventListener('input', debounce(() => setDraft(collect()), 400));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const nr = collect();
      if (!nr.title) { toast('Give it a title first'); form.elements.title.focus(); return; }
      if (!nr.category) nr.category = RB.guessCategory(nr.title + ' ' + nr.tags.join(' '));
      if (isNew) { nr.id = store.uniqueId(nr.title); nr.createdAt = ''; }
      store.upsert(nr);
      if (isNew) { draft = null; LS.del(K.draft); LS.del('wrb.transcript'); }
      toast(isNew ? 'Recipe saved' : 'Changes saved');
      go('#/r/' + encodeURIComponent(nr.id));
    });
  }

  // ======================================================================
  // View: Groceries
  // ======================================================================
  function viewGroceries(main) {
    const list = groceries.list;
    const groups = [];
    list.forEach((x) => { const k = x.recipeTitle || 'Other items'; let g = groups.find((y) => y.k === k); if (!g) groups.push(g = { k, id: x.recipeId, items: [] }); g.items.push(x); });
    groups.sort((a, b) => (a.k === 'Other items') - (b.k === 'Other items'));
    const left = list.filter((x) => !x.checked).length;
    main.innerHTML = `
      <section class="wrap narrow groceries">
        <h1>Groceries</h1>
        <p class="sub">${list.length ? `${left} to get${list.length - left ? ` · ${list.length - left} in the cart` : ''}` : 'Add a recipe’s ingredients from its page, or add items here.'}</p>
        <form class="add-item" data-form="grocery">
          <div class="with-mic"><input id="g-new" placeholder="Add an item…" enterkeyhint="done" aria-label="Add an item">${voice.supported ? `<button type="button" class="icon-btn mic" data-act="dictate" data-target="g-new" data-mode="text" aria-label="Dictate">${icon('i-mic')}</button>` : ''}</div>
          <button class="btn primary" type="submit">${icon('i-plus')} Add</button>
        </form>
        ${groups.map((g) => `<section class="panel g-group">
          <div class="panel-head"><h2>${g.id && store.byId(g.id) ? `<a href="#/r/${encodeURIComponent(g.id)}">${esc(g.k)}</a>` : esc(g.k)}</h2>
          <button class="linkish" data-act="g-remove-group" data-k="${esc(g.k)}">Remove</button></div>
          <ul class="ing-list">${g.items.slice().sort((a, b) => a.checked - b.checked).map((x) => `<li><label class="check ${x.checked ? 'on' : ''}"><input type="checkbox" data-act="g-check" data-id="${x.id}" ${x.checked ? 'checked' : ''}><span class="box">${icon('i-check')}</span><span>${esc(x.text)}</span></label></li>`).join('')}</ul>
        </section>`).join('')}
        ${list.length ? `<div class="row wrap-row">
          <button class="btn" data-act="g-share">${icon('i-share')} Share list</button>
          <button class="btn" data-act="g-copy">${icon('i-copy')} Copy</button>
          <button class="btn ghost" data-act="g-clear-checked" ${list.length - left ? '' : 'disabled'}>Clear checked</button>
          <button class="btn ghost danger" data-act="g-clear-all">Clear all</button>
        </div>` : `<div class="empty"><p>${icon('i-bag', 'huge')}</p><a class="btn" href="#/">Browse recipes</a></div>`}
      </section>`;
  }
  const groceryText = () => {
    const groups = {};
    groceries.list.filter((x) => !x.checked).forEach((x) => { (groups[x.recipeTitle || 'Other'] = groups[x.recipeTitle || 'Other'] || []).push(x.text); });
    return Object.entries(groups).map(([k, v]) => k + '\n' + v.map((x) => '☐ ' + x).join('\n')).join('\n\n');
  };

  // ======================================================================
  // View: Settings
  // ======================================================================
  function viewSettings(main) {
    const gh = settings.gh;
    const total = store.recipes.length;
    const cooked = Object.values(store.book.meta).reduce((a, m) => a + (m.cooked || []).length, 0);
    const favs = Object.values(store.book.meta).filter((m) => m.fav).length;
    const langs = [['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['es-ES', 'Español'], ['es-MX', 'Español (MX)'], ['fr-FR', 'Français'], ['it-IT', 'Italiano'], ['pt-BR', 'Português (BR)'], ['de-DE', 'Deutsch'], ['ja-JP', '日本語'], ['ko-KR', '한국어'], ['th-TH', 'ไทย']];
    main.innerHTML = `
      <section class="wrap narrow settings">
        <h1>Settings</h1>
        <div class="stats">
          <div><b>${total}</b><span>recipes</span></div>
          <div><b>${tagsInUse().length}</b><span>tags</span></div>
          <div><b>${favs}</b><span>favorites</span></div>
          <div><b>${cooked}</b><span>times cooked</span></div>
        </div>

        <section class="panel">
          <h2>Appearance &amp; voice</h2>
          <div class="field"><span>Theme</span>
            <div class="seg" role="radiogroup">${['auto', 'light', 'dark'].map((t) => `<button role="radio" aria-checked="${settings.theme === t}" class="${settings.theme === t ? 'on' : ''}" data-act="theme" data-theme="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
          <label class="field"><span>Voice language <small>for dictation, voice search and read-aloud</small></span>
            <select id="lang">${langs.map(([v, l]) => `<option value="${v}" ${settings.lang === v ? 'selected' : ''}>${l}</option>`).join('')}${langs.some(([v]) => v === settings.lang) ? '' : `<option selected value="${esc(settings.lang)}">${esc(settings.lang)}</option>`}</select></label>
          ${voice.supported ? '' : '<p class="muted small">Voice input isn’t available in this browser. Chrome, Edge and Safari support it.</p>'}
        </section>

        <section class="panel">
          <h2>${icon('i-cloud')} Sync across devices</h2>
          <p class="small">Recipes are saved on this device automatically. To keep your phone, tablet and computer in sync, connect GitHub: the app saves the book to <code>${esc(gh.path)}</code> in your site’s repo, and every device pulls from it. The same file is the book everyone sees on your site.</p>
          <form data-form="gh" class="gh-form">
            <label class="field"><span>GitHub token <small>fine-grained, “Contents: read &amp; write” on this repo only · stays on this device</small></span>
              <input name="token" type="password" autocomplete="off" value="${esc(gh.token)}" placeholder="github_pat_…"></label>
            <div class="field-row">
              <label class="field"><span>Repository</span><input name="repo" value="${esc(gh.repo)}"></label>
              <label class="field"><span>Branch</span><input name="branch" value="${esc(gh.branch)}"></label>
            </div>
            <label class="field"><span>File path</span><input name="path" value="${esc(gh.path)}"></label>
            <label class="check-line"><input type="checkbox" name="auto" ${gh.auto ? 'checked' : ''}> Sync automatically after changes</label>
            <div class="row between">
              <span class="muted small" id="sync-status">${gh.lastSync ? 'Last synced ' + esc(new Date(gh.lastSync).toLocaleString()) : gh.token ? 'Not synced yet' : 'Not connected'}</span>
              <div class="row"><button class="btn" type="submit">Save</button><button class="btn primary" type="button" data-act="sync-now" ${gh.token ? '' : 'disabled'}>${icon('i-refresh')} Sync now</button></div>
            </div>
            <details class="small"><summary>How to make a token</summary>
              <ol><li>GitHub → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate.</li>
              <li>Repository access: <b>Only select repositories</b> → <code>${esc(gh.repo)}</code>.</li>
              <li>Permissions → Repository → <b>Contents: Read and write</b>. Generate, copy, paste above.</li>
              <li>Do the same paste on each device (the token is never uploaded anywhere else).</li></ol>
            </details>
          </form>
        </section>

        <section class="panel">
          <h2>Backup &amp; export</h2>
          <div class="row wrap-row">
            <button class="btn" data-act="export-json">${icon('i-download')} Backup (.json)</button>
            <button class="btn" data-act="export-md">${icon('i-download')} Recipe book (.md)</button>
            <label class="btn">${icon('i-upload')} Import file<input type="file" accept=".md,.markdown,.txt,.json,text/*,application/json" data-act="import-file" hidden></label>
          </div>
          <p class="muted small">The Markdown export uses the same format as your original recipe book, so it can be pasted back into a chat or imported here.</p>
        </section>

        <section class="panel">
          <h2>Install on your phone</h2>
          <p class="small"><b>iPhone:</b> open in Safari → Share → <b>Add to Home Screen</b>. <b>Android:</b> Chrome menu → <b>Install app</b>. It opens full-screen, works offline, and (on Android) shows up in the Share menu so you can send recipe links straight to it.</p>
        </section>

        <section class="panel danger-zone">
          <h2>Reset</h2>
          <div class="row wrap-row">
            <button class="btn" data-act="restore-seed">${icon('i-refresh')} Restore original recipes</button>
            <button class="btn danger" data-act="erase-all">${icon('i-trash')} Erase everything on this device</button>
          </div>
          <p class="muted small">Restore brings back any of the original book’s recipes you deleted, without touching your own.</p>
        </section>
      </section>`;
    $('#lang').addEventListener('change', (e) => { settings.lang = e.target.value; saveSettings(); toast('Voice language saved'); });
  }

  // ======================================================================
  // GitHub sync
  // ======================================================================
  const b64encode = (str) => { const bytes = new TextEncoder().encode(str); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); };
  const b64decode = (b64) => { const bin = atob(String(b64).replace(/\s/g, '')); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); };
  const sync = {
    busy: false, timer: null,
    enabled() { return !!(settings.gh.token && settings.gh.repo && settings.gh.path); },
    schedule() { if (!this.enabled() || !settings.gh.auto) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.run(true), 4000); },
    status(msg) { const el = $('#sync-status'); if (el) el.textContent = msg; },
    async run(quiet) {
      if (!this.enabled() || this.busy) return;
      this.busy = true; this.status('Syncing…');
      const { token, repo, branch, path } = settings.gh;
      const url = `https://api.github.com/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
      const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const res = await fetch(url + '?ref=' + encodeURIComponent(branch) + '&t=' + Date.now(), { headers, cache: 'no-store' });
          let sha = null, changed = 0, remoteText = '';
          if (res.status === 200) {
            const j = await res.json();
            sha = j.sha;
            remoteText = j.content ? b64decode(j.content) : '';
            if (!remoteText && j.download_url) remoteText = await (await fetch(j.download_url, { cache: 'no-store' })).text();
            if (remoteText) changed = store.merge(JSON.parse(remoteText));
          } else if (res.status !== 404) {
            throw new Error(res.status === 401 ? 'Token rejected (401). Check it hasn’t expired.' : res.status === 403 ? 'Token lacks permission (403). It needs Contents: read & write.' : 'GitHub error ' + res.status);
          }
          const data = store.exportData();
          const body = JSON.stringify(data, null, 1) + '\n';
          // Only write when our copy differs from what's there
          let same = false;
          try { const r = JSON.parse(remoteText || 'null'); same = r && JSON.stringify({ a: r.recipes, b: r.deleted, c: r.meta }) === JSON.stringify({ a: data.recipes, b: data.deleted, c: data.meta }); } catch (e) { /* */ }
          if (!same) {
            const put = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ message: 'Update recipe book (' + data.recipes.length + ' recipes)', content: b64encode(body), branch, sha: sha || undefined }) });
            if (put.status === 409 || put.status === 422) { if (attempt === 0) continue; }
            if (!put.ok) throw new Error('Could not save to GitHub (' + put.status + ')');
          }
          settings.gh.lastSync = nowIso(); saveSettings();
          store.book.seedAt = ''; LS.set(K.book, store.book);
          this.status('Last synced ' + new Date().toLocaleString());
          if (changed) { index.dirty = true; if (!cook.state && !['edit'].includes(route.name)) render(); }
          if (!quiet) toast(changed ? `Synced · ${changed} update${changed === 1 ? '' : 's'} pulled in` : 'Synced');
          break;
        }
      } catch (e) {
        this.status('Sync failed: ' + e.message);
        if (!quiet) toast('Sync failed: ' + e.message);
      } finally { this.busy = false; }
    },
  };

  // ======================================================================
  // File import
  // ======================================================================
  async function importFile(file) {
    const text = await file.text();
    if (/\.json$/i.test(file.name) || /^\s*[{[]/.test(text)) {
      try {
        const data = JSON.parse(text);
        if (data && data.format === 'waynesdays-recipes') {
          const n = store.merge(data, { restore: true });
          LS.set(K.book, store.book); index.dirty = true;
          toast(`Backup merged · ${n} change${n === 1 ? '' : 's'}`); sync.schedule(); render(); return;
        }
        const list = RB.fromAnyJson(data);
        if (list.length) { go('#/add/chat'); setTimeout(() => handleParsed(list), 30); return; }
      } catch (e) { /* fall through to text */ }
    }
    const book = RB.parseBook(text);
    const good = book.recipes.filter((r) => r.ingredients.length || r.steps.length || r.extras.length);
    const list = good.length > 1 ? good : RB.parseText(text);
    go('#/add/chat');
    setTimeout(() => handleParsed(list), 30);
  }

  // ======================================================================
  // Global event delegation
  // ======================================================================
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) {
      // close open menus when clicking elsewhere
      $$('details.menu[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; });
      return;
    }
    const act = el.dataset.act;
    const rid = route.params.id;
    const r = rid ? store.byId(rid) : null;
    switch (act) {
      // library
      case 'cat': ui.cat = el.dataset.cat; saveUi(); $$('.cats .chip').forEach((c) => c.classList.toggle('on', c === el)); renderResults(); break;
      case 'toggle-fav-filter': ui.fav = !ui.fav; saveUi(); el.classList.toggle('on', ui.fav); renderResults(); break;
      case 'toggle-quick': ui.quick = !ui.quick; saveUi(); el.classList.toggle('on', ui.quick); renderResults(); break;
      case 'toggle-tags': ui.showTags = !ui.showTags; saveUi(); $('#tagcloud').hidden = !ui.showTags; el.setAttribute('aria-expanded', ui.showTags); el.classList.toggle('on', ui.showTags || ui.tags.length > 0); break;
      case 'tag-filter': {
        const t = el.dataset.tag;
        ui.tags = ui.tags.includes(t) ? ui.tags.filter((x) => x !== t) : ui.tags.concat(t); saveUi();
        $$('#tagcloud .tag').forEach((b) => b.classList.toggle('on', ui.tags.includes(b.dataset.tag)));
        const tb = $('[data-act="toggle-tags"]'); if (tb) tb.innerHTML = '# Tags' + (ui.tags.length ? ' · ' + ui.tags.length : '');
        renderResults(); break;
      }
      case 'clear-filters': ui.q = ''; ui.cat = ''; ui.tags = []; ui.fav = false; ui.quick = false; saveUi(); viewBook($('#main')); break;
      case 'hide-tip': LS.set(K.tips, true); el.closest('.tip').remove(); break;
      case 'voice-search': {
        const q = $('#q');
        if (el.classList.contains('listening')) { voice.stop(); break; }
        voice.start({ continuous: false, onState: (on) => el.classList.toggle('listening', on),
          onInterim: (t) => { if (t) q.value = t; },
          onFinal: (t) => { q.value = t.replace(/[.?!]$/, ''); ui.q = q.value; renderResults(); } });
        break;
      }
      case 'fav': {
        e.preventDefault();
        const id = el.dataset.id;
        store.setMeta(id, { fav: !store.meta(id).fav });
        const on = store.meta(id).fav;
        el.classList.toggle('on', on); el.setAttribute('aria-pressed', on);
        if (el.classList.contains('btn')) el.innerHTML = icon('i-heart') + (on ? ' Favorited' : ' Favorite');
        toast(on ? 'Added to favorites' : 'Removed from favorites');
        if (route.name === 'book' && ui.fav) renderResults();
        break;
      }
      // recipe
      case 'cook': go('#/r/' + encodeURIComponent(rid) + '/cook'); break;
      case 'scale': {
        const f = getScale(rid);
        const steps = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 8, 10];
        let nf;
        if (el.dataset.d === '+') nf = steps.find((s) => s > f + 1e-9) || f + 1;
        else nf = steps.slice().reverse().find((s) => s < f - 1e-9) || 0.25;
        setScale(rid, nf); viewRecipe($('#main'), rid); break;
      }
      case 'scale-reset': setScale(rid, 1); viewRecipe($('#main'), rid); break;
      case 'ing-check': {
        const id = cook.state ? cook.state.r.id : rid;
        const set = checkSet(id); const k = el.dataset.k;
        if (el.checked) set.add(k); else set.delete(k);
        $$(`input[data-act="ing-check"][data-k="${k}"]`).forEach((c) => { c.checked = el.checked; c.closest('.check').classList.toggle('on', el.checked); });
        break;
      }
      case 'ing-reset': checkSet(rid).clear(); viewRecipe($('#main'), rid); break;
      case 'step-done': {
        if (e.target.closest('a, button')) break;
        const set = doneSet(rid); const k = el.dataset.k;
        if (set.has(k)) set.delete(k); else set.add(k);
        el.classList.toggle('done', set.has(k)); break;
      }
      case 'timer': e.stopPropagation(); timers.add(+el.dataset.secs, el.dataset.label || 'Timer', rid); break;
      case 'timer-toggle': timers.toggle(el.dataset.tid); break;
      case 'timer-plus': timers.plus(el.dataset.tid, 60); break;
      case 'timer-remove': timers.remove(el.dataset.tid); break;
      case 'timer-dismiss': timers.remove(el.dataset.tid); break;
      case 'grocery-add': if (r) { groceries.addRecipe(r, getScale(r.id)); toast(`Added ${r.ingredients.reduce((a, g) => a + g.items.length, 0)} items to groceries`, { label: 'View list', run: () => go('#/groceries') }); el.innerHTML = icon('i-bag') + ' On list ✓'; } break;
      case 'mark-cooked': {
        const id = cook.state ? cook.state.r.id : rid;
        const m = store.meta(id);
        store.setMeta(id, { cooked: (m.cooked || []).concat(nowIso()) });
        toast('Nice! Logged as cooked today', { label: 'Undo', run: () => { const mm = store.meta(id); store.setMeta(id, { cooked: mm.cooked.slice(0, -1) }); if (!cook.state) viewRecipe($('#main'), id); else cook.renderStage(0); } });
        $$('details.menu[open]').forEach((d) => { d.open = false; });
        if (cook.state) cook.renderStage(0); else viewRecipe($('#main'), id);
        break;
      }
      case 'unmark-cooked': { const m = store.meta(rid); store.setMeta(rid, { cooked: (m.cooked || []).slice(0, -1) }); viewRecipe($('#main'), rid); break; }
      case 'share': {
        const text = RB.toMarkdown(r);
        if (navigator.share) { try { await navigator.share({ title: r.title, text }); } catch (err) { /* cancelled */ } }
        else copyText(text, 'Recipe copied — paste it anywhere');
        el.closest('details').open = false; break;
      }
      case 'copy-md': copyText(RB.toMarkdown(r), 'Recipe copied as text'); el.closest('details').open = false; break;
      case 'duplicate': {
        const copy = JSON.parse(JSON.stringify(r)); copy.title = r.title + ' (copy)'; copy.id = store.uniqueId(copy.title); copy.createdAt = '';
        store.upsert(copy); toast('Duplicated'); go('#/edit/' + encodeURIComponent(copy.id)); break;
      }
      case 'print': el.closest('details').open = false; setTimeout(() => window.print(), 50); break;
      case 'delete': {
        if (!confirm(`Delete “${r.title}”? This can be undone right after.`)) break;
        const removed = store.remove(r.id);
        go('#/');
        toast('Recipe deleted', { label: 'Undo', run: () => { store.upsert(removed); render(); } });
        break;
      }
      // cook mode
      case 'cook-close': cook.close(); break;
      case 'cook-next': cook.move(1); break;
      case 'cook-prev': cook.move(-1); break;
      case 'cook-sheet': cook.toggleSheet(); break;
      case 'cook-voice': cook.toggleVoice(); break;
      case 'cook-speak': settings.speak = !settings.speak; saveSettings(); cook.syncButtons(); if (settings.speak) cook.readCurrent(); else speech.stop(); break;
      case 'cook-size': settings.cookSize = Math.max(0.8, Math.min(1.8, Math.round((settings.cookSize + (+el.dataset.d) * 0.15) * 100) / 100)); saveSettings(); $('.cook').style.setProperty('--cook-size', settings.cookSize); break;
      // add flows
      case 'new-blank': if (draft) { e.preventDefault(); if (confirm('Start a blank recipe? Your unsaved draft will be discarded.')) { draft = null; LS.del(K.draft); go('#/new'); } } break;
      case 'discard-draft': draft = null; LS.del(K.draft); el.closest('.tip').remove(); break;
      case 'discard-draft-edit': if (confirm('Discard this recipe?')) { draft = null; LS.del(K.draft); go('#/add'); } break;
      case 'voice-dictate': {
        const ta = $('#transcript'), st = $('#mic-status'), interim = $('#interim');
        if (el.classList.contains('listening')) { voice.stop(); break; }
        voice.start({ keepAlive: true,
          onState: (on) => { el.classList.toggle('listening', on); st.textContent = on ? 'Listening… tap to stop' : 'Tap to continue'; if (!on) interim.textContent = ''; },
          onInterim: (t) => { interim.textContent = t; },
          onFinal: (t) => { ta.value = ta.value.replace(/\s+$/, '') + (ta.value.trim() ? ' ' : '') + t; interim.textContent = ''; LS.set('wrb.transcript', ta.value); ta.scrollTop = ta.scrollHeight; } });
        break;
      }
      case 'clear-transcript': $('#transcript').value = ''; LS.del('wrb.transcript'); break;
      case 'build-voice': {
        const txt = $('#transcript').value.trim();
        if (!txt) { toast('Say or type something first'); break; }
        voice.stop();
        openDraft(RB.parseSpoken(txt)); break;
      }
      case 'dictate': { const f = document.getElementById(el.dataset.target) || $(`[name="${el.dataset.target}"]`); if (f) toggleDictation(el, f, el.dataset.mode); break; }
      case 'paste-clipboard': {
        try { const t = await navigator.clipboard.readText(); $('#chat-text').value = t; if (t.trim()) handleParsed(RB.parseText(t)); }
        catch (err) { toast('Clipboard blocked. Long-press the box and choose Paste.'); $('#chat-text').focus(); }
        break;
      }
      case 'copy-prompt': copyText(CLAUDE_PROMPT, 'Prompt copied. Paste it into Claude along with the recipe.'); break;
      case 'parse-chat': { const t = $('#chat-text').value; if (!t.trim()) { toast('Paste a recipe first'); break; } handleParsed(RB.parseText(t)); break; }
      case 'parse-web-text': {
        const t = $('#web-text').value; if (!t.trim()) break;
        const url = $('#url').value.trim();
        let list = /<\w+[^>]*>/.test(t) ? RB.parseHtml(t, url) : [];
        if (!list.length) list = RB.parseText(t.replace(/<[^>]+>/g, '\n'));
        handleParsed(list, url ? { label: RB.hostLabel(url), url } : null); break;
      }
      case 'import-multi': {
        const box = el.closest('#multi') || $('#main');
        const all = box._recipes || [];
        const picked = $$('.multi-list input', box).filter((c) => c.checked).map((c) => all[+c.dataset.i]);
        if (!picked.length) { toast('Nothing selected'); break; }
        importMany(picked); go('#/'); break;
      }
      case 'copy-bookmarklet': copyText(bookmarklet(), 'Bookmarklet code copied'); break;
      // groceries
      case 'g-check': { const it = groceries.list.find((x) => x.id === el.dataset.id); if (it) { it.checked = el.checked; groceries.save(); setTimeout(() => viewGroceries($('#main')), 180); } break; }
      case 'g-remove-group': groceries.list = groceries.list.filter((x) => (x.recipeTitle || 'Other items') !== el.dataset.k); groceries.save(); viewGroceries($('#main')); break;
      case 'g-clear-checked': groceries.list = groceries.list.filter((x) => !x.checked); groceries.save(); viewGroceries($('#main')); break;
      case 'g-clear-all': if (confirm('Clear the whole grocery list?')) { groceries.list = []; groceries.save(); viewGroceries($('#main')); } break;
      case 'g-copy': copyText(groceryText(), 'List copied'); break;
      case 'g-share': { const t = groceryText(); if (navigator.share) { try { await navigator.share({ title: 'Grocery list', text: t }); } catch (err) { /* */ } } else copyText(t, 'List copied'); break; }
      // settings
      case 'theme': settings.theme = el.dataset.theme; saveSettings(); applyTheme(); $$('.seg button').forEach((b) => { const on = b.dataset.theme === settings.theme; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }); break;
      case 'sync-now': sync.run(false); break;
      case 'export-json': download('recipe-book-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(store.exportData(), null, 1), 'application/json'); break;
      case 'export-md': download('recipe-book-' + new Date().toISOString().slice(0, 10) + '.md', RB.bookToMarkdown(store.book.title, store.recipes), 'text/markdown'); break;
      case 'restore-seed': {
        try { const seed = await loadSeed(); const n = store.merge(seed, { restore: true }); store.save(); toast(n ? `Restored ${n} recipe${n === 1 ? '' : 's'}` : 'All original recipes are already here'); }
        catch (err) { toast('Couldn’t load the original book (offline?)'); }
        break;
      }
      case 'erase-all': {
        if (!confirm('Erase all recipes, notes, lists and settings on this device? (Your GitHub copy, if any, is not touched.)')) break;
        Object.values(K).forEach((k) => LS.del(k)); LS.del('wrb.transcript');
        location.hash = '#/'; location.reload(); break;
      }
      default: break;
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('[data-act="import-file"]') && el.files && el.files[0]) { importFile(el.files[0]); el.value = ''; }
  });

  document.addEventListener('submit', async (e) => {
    const form = e.target;
    const kind = form.dataset.form;
    if (!kind) return;
    e.preventDefault();
    if (kind === 'web') {
      const url = $('#url').value.trim();
      const st = $('#web-status');
      const btn = $('button[type="submit"]', form);
      st.hidden = false; st.className = 'status'; btn.disabled = true;
      try {
        const list = await importFromUrl(url, (m) => { st.textContent = m; });
        st.textContent = 'Found it!';
        if (list.length === 1) openDraft(list[0]); else { viewAddChat($('#main')); showMulti(list); }
      } catch (err) {
        st.className = 'status error';
        st.textContent = 'Couldn’t read a recipe from that page (' + (err.message || 'blocked') + '). Use the paste box below, or the one-tap import button.';
        $('#web-fallback').open = true;
      } finally { btn.disabled = false; }
    }
    if (kind === 'grocery') {
      const inp = $('#g-new'); const v = inp.value.trim(); if (!v) return;
      v.split(/\s*(?:,|\bnext\b|\n)\s*/i).filter(Boolean).forEach((t) => groceries.list.push({ id: uid(), text: t.charAt(0).toUpperCase() + t.slice(1), recipeId: '', recipeTitle: '', checked: false }));
      groceries.save(); viewGroceries($('#main')); setTimeout(() => $('#g-new') && $('#g-new').focus(), 30);
    }
    if (kind === 'gh') {
      const fd = new FormData(form);
      Object.assign(settings.gh, { token: String(fd.get('token') || '').trim(), repo: String(fd.get('repo') || '').trim(), branch: String(fd.get('branch') || '').trim() || 'master', path: String(fd.get('path') || '').trim(), auto: !!fd.get('auto') });
      saveSettings(); toast('Sync settings saved');
      $('[data-act="sync-now"]').disabled = !settings.gh.token;
      if (settings.gh.token) sync.run(false);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (cook.state) return;
    if (e.target.matches('input, textarea, select, [contenteditable]')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); if (route.name !== 'book') { go('#/'); setTimeout(() => $('#q') && $('#q').focus(), 50); } else $('#q').focus(); }
    else if (e.key === 'n') go('#/add');
    else if (e.key === 'c' && route.name === 'recipe') go('#/r/' + encodeURIComponent(route.params.id) + '/cook');
  });

  function applyTheme() {
    if (settings.theme === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = settings.theme;
  }

  // ======================================================================
  // Boot
  // ======================================================================
  async function boot() {
    applyTheme();
    await initStore();
    // Share target / deep links: ?url=…&text=…&title=…
    const sp = new URLSearchParams(location.search);
    const sharedUrl = sp.get('url') || ((sp.get('text') || '').match(/https?:\/\/\S+/) || [])[0];
    const sharedText = sp.get('text');
    if (sharedUrl || sharedText) {
      history.replaceState(null, '', location.pathname + '#/add');
      route = parseRoute();
      if (sharedUrl && (!sharedText || sharedText.trim().length < 300)) { viewAddWeb($('#main'), sharedUrl); }
      else { viewAddChat($('#main'), sharedText); handleParsed(RB.parseText(sharedText)); }
    } else render();
    window.addEventListener('hashchange', render);
    updateBadges();
    timers.renderTray(); if (timers.list.length) { timers.loop(); timers.checkRing(); }
    if (sync.enabled()) sync.run(true);
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  boot();
})();
