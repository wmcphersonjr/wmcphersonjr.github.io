/* Waynesdays Recipe Book — app */
(() => {
  'use strict';
  const RB = window.RB;
  const RK = window.RK;

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
  const K = { book: 'wrb.book.v1', groceries: 'wrb.groceries', settings: 'wrb.settings', timers: 'wrb.timers', ui: 'wrb.ui', draft: 'wrb.draft', scale: 'wrb.scale', tips: 'wrb.tips', pantry: 'wrb.pantry', leftovers: 'wrb.leftovers' };

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
  function download(filename, text, type) { saveFile(new Blob([text], { type: type || 'text/plain' }), filename); }

  // Inside the Claude app, files go out through the downloads capability; on the web, a share sheet or a plain download.
  let downloadsP = null;
  const downloadsCap = () => downloadsP || (downloadsP = (window.claude && typeof window.claude.use === 'function') ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null));
  async function saveFile(blob, filename, opts) {
    opts = opts || {};
    if (opts.share && navigator.canShare && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      const file = new File([blob], filename, { type: blob.type });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: opts.title || filename }); return true; } catch (e) { if (e && e.name === 'AbortError') return false; }
      }
    }
    const dl = await downloadsCap();
    if (dl) {
      try { await dl.save({ filename, data: blob }); return true; } catch (e) {
        if (e && (e.code === 'declined' || e.code === 'rate_limited')) return false;
        if (e && e.code === 'rejected_extension') { toast('That file type can’t be saved here'); return false; }
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    return true;
  }
  const blobToBase64 = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
  async function resizeImage(blob, max, quality) {
    let src;
    try { src = await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) {
      src = await new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = URL.createObjectURL(blob); });
    }
    const w = src.width, h = src.height, k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return new Promise((res) => c.toBlob((b) => res(b || blob), 'image/jpeg', quality || 0.85));
  }

  // ======================================================================
  // Sheet (modal) + in-app confirm. Native confirm() is blocked in embedded viewers.
  // ======================================================================
  const sheet = {
    el: null, onClose: null,
    open(o) {
      this.close(true);
      const root = $('#sheet-root');
      root.innerHTML = `<div class="sheet-backdrop" data-act="sheet-close"></div>
        <div class="sheet ${o.wide ? 'wide' : ''} ${o.cls || ''}" role="dialog" aria-modal="true" aria-label="${esc(o.title)}">
          <div class="sheet-top"><h2>${esc(o.title)}</h2><button class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('i-x')}</button></div>
          <div class="sheet-content">${o.body}</div></div>`;
      root.hidden = false;
      document.body.classList.add('sheet-open');
      requestAnimationFrame(() => root.classList.add('open'));
      this.el = $('.sheet', root); this.onClose = o.onClose || null;
      if (o.onMount) o.onMount(this.el);
      const f = $('[autofocus]', this.el); if (f && !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) setTimeout(() => f.focus(), 60);
      return this.el;
    },
    close(silent) {
      const root = $('#sheet-root');
      if (!root || root.hidden) return;
      root.classList.remove('open'); root.hidden = true; root.innerHTML = '';
      document.body.classList.remove('sheet-open');
      const cb = this.onClose; this.el = null; this.onClose = null;
      if (cb && !silent) cb();
    },
  };
  function ask(msg, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; sheet.close(true); resolve(v); };
      sheet.open({ title: opts.title || 'Are you sure?', cls: 'ask',
        body: `<p class="ask-msg">${esc(msg)}</p><div class="row end"><button class="btn ghost" data-ask="0">${esc(opts.cancel || 'Cancel')}</button><button class="btn ${opts.danger ? 'danger-fill' : 'primary'}" data-ask="1">${esc(opts.ok || 'OK')}</button></div>`,
        onMount: (el) => $$('[data-ask]', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); finish(b.dataset.ask === '1'); })),
        onClose: () => finish(false) });
    });
  }

  // ======================================================================
  // Your photos: kept in IndexedDB on this device (too big for sync)
  // ======================================================================
  const photos = {
    db: null, urls: new Map(),
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res, rej) => {
        let req;
        try { req = indexedDB.open('wrb-photos', 1); } catch (e) { rej(e); return; }
        req.onupgradeneeded = () => req.result.createObjectStore('photos');
        req.onsuccess = () => { this.db = req.result; res(this.db); };
        req.onerror = () => rej(req.error);
      });
    },
    async run(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const tx = db.transaction('photos', mode);
        const req = fn(tx.objectStore('photos'));
        tx.oncomplete = () => res(req && req.result);
        tx.onerror = () => rej(tx.error);
      });
    },
    async put(blob) {
      const id = 'p' + Date.now().toString(36) + uid();
      const [full, thumb] = await Promise.all([resizeImage(blob, 1600, 0.86), resizeImage(blob, 560, 0.8)]);
      await this.run('readwrite', (st) => st.put({ full, thumb, at: nowIso() }, id));
      return id;
    },
    async putRaw(blob) {
      const id = 'a' + Date.now().toString(36) + uid();
      await this.run('readwrite', (st) => st.put({ raw: blob, at: nowIso() }, id));
      return id;
    },
    async blob(id, size) { try { const rec = await this.run('readonly', (st) => st.get(id)); return rec ? rec[size || 'thumb'] : null; } catch (e) { return null; } },
    async url(id, size) {
      const k = id + ':' + (size || 'thumb');
      if (this.urls.has(k)) return this.urls.get(k);
      const b = await this.blob(id, size);
      if (!b) return null;
      const u = URL.createObjectURL(b); this.urls.set(k, u); return u;
    },
    async del(id) {
      ['thumb', 'full'].forEach((sz) => { const u = this.urls.get(id + ':' + sz); if (u) { URL.revokeObjectURL(u); this.urls.delete(id + ':' + sz); } });
      try { await this.run('readwrite', (st) => st.delete(id)); } catch (e) { /* */ }
    },
  };
  /** Fill <img data-photo="id"> tags from IndexedDB after a render. */
  function hydratePhotos(root) {
    $$('img[data-photo]', root || document).forEach(async (img) => {
      const u = await photos.url(img.dataset.photo, img.dataset.size || 'thumb');
      if (u) { img.src = u; const box = img.closest('.card-art, .r-img'); if (box) box.classList.add('has-img'); }
      else if (!img.getAttribute('src')) { const box = img.closest('.card-art'); if (box) box.classList.remove('has-img'); img.remove(); }
    });
  }

  // ======================================================================
  // Store
  // ======================================================================
  const settings = Object.assign({ theme: 'auto', lang: navigator.language || 'en-US', cookSize: 1, speak: false, units: 'original', staples: null, claudeKey: '', gView: 'aisle',
    gh: { token: '', repo: 'wmcphersonjr/wmcphersonjr.github.io', branch: 'master', path: 'recipes/data/recipes.json', auto: true, lastSync: '' } }, LS.get(K.settings, {}));
  settings.gh = Object.assign({ token: '', repo: 'wmcphersonjr/wmcphersonjr.github.io', branch: 'master', path: 'recipes/data/recipes.json', auto: true, lastSync: '' }, settings.gh || {});
  const saveSettings = () => LS.set(K.settings, settings);

  const ui = Object.assign({ q: '', cat: '', tags: [], fav: false, quick: false, story: false, sort: 'book', showTags: false }, LS.get(K.ui, {}));
  ui.q = ''; // don't restore search text
  const saveUi = () => LS.set(K.ui, { cat: ui.cat, tags: ui.tags, fav: ui.fav, quick: ui.quick, story: ui.story, sort: ui.sort, showTags: ui.showTags });

  // Earlier versions of each recipe, kept on this device every time an edit is saved
  const versions = {
    all: LS.get('wrb.versions', {}),
    list(id) { return this.all[id] || []; },
    push(prev) {
      const l = (this.all[prev.id] = this.all[prev.id] || []);
      const snap = JSON.parse(JSON.stringify(prev));
      if (l.length && JSON.stringify(l[l.length - 1].r) === JSON.stringify(snap)) return;
      l.push({ at: prev.updatedAt || nowIso(), r: snap });
      if (l.length > 25) l.splice(0, l.length - 25);
      for (let tries = 0; tries < 5; tries++) {
        try { localStorage.setItem('wrb.versions', JSON.stringify(this.all)); return; } catch (e) {
          const longest = Object.values(this.all).sort((a, b) => b.length - a.length)[0];
          if (!longest || longest.length < 2) return; longest.splice(0, Math.ceil(longest.length / 2));
        }
      }
    },
  };

  const store = {
    book: LS.get(K.book, null), // {title, recipes:[], deleted:{}, meta:{}, seedAt}
    get recipes() { return this.book ? this.book.recipes : []; },
    byId(id) { return this.recipes.find((r) => r.id === id); },
    meta(id) { return Object.assign({ fav: false, cooked: [], notes: '', rating: 0, photos: [], cover: '', updatedAt: '' }, this.book.meta[id] || {}); },
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
      if (i >= 0) { versions.push(this.recipes[i]); this.recipes[i] = r; } else this.recipes.push(r);
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
      const b = this.book;
      return { format: 'waynesdays-recipes', version: 1, title: b.title, updatedAt: b.updatedAt || nowIso(),
        recipes: this.recipes, deleted: b.deleted, meta: b.meta, plan: b.plan, collections: b.collections, collectionsDeleted: b.collectionsDeleted,
        customTips: b.customTips, tipsDeleted: b.tipsDeleted };
    },
    ensure() {
      const b = this.book;
      b.deleted = b.deleted || {}; b.meta = b.meta || {}; b.plan = b.plan || {};
      b.collections = b.collections || []; b.collectionsDeleted = b.collectionsDeleted || {};
      b.customTips = b.customTips || []; b.tipsDeleted = b.tipsDeleted || {};
    },
    // meal plan
    planDay(day) { return (this.book.plan[day] && this.book.plan[day].items) || []; },
    setPlanDay(day, items) { this.book.plan[day] = { items, updatedAt: nowIso() }; this.save(); },
    // collections & custom techniques share the same keep-newest + tombstone rules
    byCollection(id) { return this.book.collections.find((c) => c.id === id); },
    saveCollection(c) { this.putItem(this.book.collections, this.book.collectionsDeleted, c); },
    removeCollection(id) { this.dropItem(this.book.collections, this.book.collectionsDeleted, id); },
    saveTip(t) { this.putItem(this.book.customTips, this.book.tipsDeleted, t); },
    removeTip(id) { this.dropItem(this.book.customTips, this.book.tipsDeleted, id); },
    putItem(list, tombs, item) {
      item.updatedAt = nowIso();
      const i = list.findIndex((x) => x.id === item.id);
      if (i >= 0) list[i] = item; else list.push(item);
      delete tombs[item.id]; this.save();
    },
    dropItem(list, tombs, id) {
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0) list.splice(i, 1);
      tombs[id] = nowIso(); this.save();
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
      Object.entries(remote.plan || {}).forEach(([day, d]) => {
        const ld = this.book.plan[day];
        if (d && (!ld || Date.parse(d.updatedAt || 0) > Date.parse(ld.updatedAt || 0))) { this.book.plan[day] = d; changed++; }
      });
      changed += mergeItems(this.book.collections, this.book.collectionsDeleted, remote.collections, remote.collectionsDeleted);
      changed += mergeItems(this.book.customTips, this.book.tipsDeleted, remote.customTips, remote.tipsDeleted);
      if (changed) { LS.set(K.book, this.book); index.dirty = true; }
      return changed;
    },
  };

  function mergeItems(list, tombs, remoteList, remoteTombs) {
    let changed = 0;
    (remoteList || []).forEach((ri) => {
      if (!ri || !ri.id) return;
      const i = list.findIndex((x) => x.id === ri.id);
      if (i < 0) {
        if (tombs[ri.id] && Date.parse(tombs[ri.id]) >= Date.parse(ri.updatedAt || 0)) return;
        list.push(ri); delete tombs[ri.id]; changed++;
      } else if (Date.parse(ri.updatedAt || 0) > Date.parse(list[i].updatedAt || 0)) { list[i] = ri; changed++; }
    });
    Object.entries(remoteTombs || {}).forEach(([id, ts]) => {
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0 && Date.parse(list[i].updatedAt || 0) <= Date.parse(ts)) { list.splice(i, 1); changed++; }
      if (!tombs[id] || Date.parse(tombs[id]) < Date.parse(ts)) tombs[id] = ts;
    });
    return changed;
  }

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
      store.ensure();
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
      store.book = { title: seed.title || 'Waynesdays Recipe Book', recipes: seed.recipes.map(normalizeRecipe), deleted: seed.deleted || {}, meta: seed.meta || {},
        plan: seed.plan || {}, collections: seed.collections || [], collectionsDeleted: seed.collectionsDeleted || {}, customTips: seed.customTips || [], tipsDeleted: seed.tipsDeleted || {}, seedAt: seed.updatedAt };
    } catch (e) {
      store.book = { title: 'Waynesdays Recipe Book', recipes: [], deleted: {}, meta: {}, seedAt: '' };
    }
    store.ensure();
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
    if (p[0] === 'tips') return { name: 'tips', params: { t: q.get('t'), cat: q.get('cat') } };
    if (p[0] === 'plan') return { name: 'plan', params: { w: q.get('w') } };
    if (p[0] === 'collections') return { name: 'collections', params: {} };
    if (p[0] === 'c' && p[1]) return { name: 'collection', params: { cid: p[1] } };
    if (p[0] === 'pantry') return { name: 'pantry', params: {} };
    if (p[0] === 'cook' && p[1]) return { name: 'cookmulti', params: { ids: p[1].split(',').filter(Boolean) } };
    return { name: 'book', params: {} };
  }
  const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

  let lastRouteKey = '';
  function render() {
    const prev = route;
    route = parseRoute();
    const main = $('#main');
    const key = route.name + ':' + (route.params.id || route.params.mode || '');
    if (route.name !== 'cook' && route.name !== 'cookmulti') cook.close(true);
    sheet.close(true);
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
      case 'tips': viewTips(main); break;
      case 'plan': viewPlan(main); break;
      case 'collections': viewCollections(main); break;
      case 'collection': viewCollection(main, route.params.cid); break;
      case 'pantry': viewPantry(main); break;
      case 'cookmulti': {
        const ids = route.params.ids.filter((id) => store.byId(id));
        if (!ids.length) { go('#/'); return; }
        if (prev.name !== 'cookmulti' || !cook.state) { if (!main.innerHTML) viewBook(main); cook.openMulti(ids, lastHash); }
        break;
      }
      default: viewBook(main);
    }
    if (key !== lastRouteKey && route.name !== 'cook' && route.name !== 'cookmulti') { window.scrollTo(0, route.name === 'book' ? (bookScroll || 0) : 0); }
    lastRouteKey = key;
    if (route.name !== 'cook' && route.name !== 'cookmulti') lastHash = location.hash || '#/';
  }
  let lastHash = '';
  const navFor = (n) => ({ book: 'book', recipe: 'book', cook: 'book', cookmulti: 'plan', edit: 'add', add: 'add', import: 'add', groceries: 'groceries', settings: 'settings', tips: 'tips',
    plan: 'plan', collections: 'collections', collection: 'collections', pantry: 'book' }[n]);
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
          <div class="hero-links">
            ${todayHtml()}
            ${useSoonHtml()}
            <a class="btn small" href="#/pantry">${icon('i-basket')} What can I make?</a>
            <a class="btn small ghost" href="#/plan">${icon('i-calendar')} Plan the week</a>
          </div>
        </div>
        ${collectionsStripHtml()}
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
          <button class="chip ghost ${ui.story ? 'on' : ''}" data-act="toggle-story">${icon('i-quote')} Family stories</button>
          <button class="chip ghost ${ui.showTags || ui.tags.length ? 'on' : ''}" data-act="toggle-tags" aria-expanded="${ui.showTags}"># Tags${ui.tags.length ? ' · ' + ui.tags.length : ''}</button>
          <label class="sort">Sort
            <select id="sort">
              ${[['book', 'Book order'], ['az', 'A–Z'], ['recent', 'Newest'], ['rated', 'Top rated'], ['cooked', 'Most cooked'], ['time', 'Quickest']].map(([v, l]) => `<option value="${v}" ${ui.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
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
      && (!ui.quick || ((parseMinutes(r.time) || 999) <= 30))
      && (!ui.story || hasStory(store.meta(r.id))));
    if (!hasQ) {
      const catIdx = (c) => { const i = CAT_ORDER.indexOf(c); return i < 0 ? 99 : i; };
      const pos = new Map(store.recipes.map((r, i) => [r.id, i]));
      const sorters = {
        book: (a, b) => catIdx(a.r.category) - catIdx(b.r.category) || (a.r.category || '').localeCompare(b.r.category || '') || pos.get(a.r.id) - pos.get(b.r.id),
        az: (a, b) => a.r.title.localeCompare(b.r.title),
        recent: (a, b) => (b.r.createdAt || '').localeCompare(a.r.createdAt || ''),
        cooked: (a, b) => (store.meta(b.r.id).cooked || []).length - (store.meta(a.r.id).cooked || []).length || a.r.title.localeCompare(b.r.title),
        time: (a, b) => (parseMinutes(a.r.time) || 9999) - (parseMinutes(b.r.time) || 9999),
        rated: (a, b) => (store.meta(b.r.id).rating || 0) - (store.meta(a.r.id).rating || 0) || (store.meta(b.r.id).cooked || []).length - (store.meta(a.r.id).cooked || []).length || a.r.title.localeCompare(b.r.title),
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
    const activeFilters = [ui.cat, ui.fav, ui.quick, ui.story].filter(Boolean).length + ui.tags.length;
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
    hydratePhotos(el);
  }

  const starsHtml = (n) => `<span class="stars" aria-label="${n} of 5 stars">${'★'.repeat(n)}<i>${'★'.repeat(5 - n)}</i></span>`;
  function coverImg(r, m, size) {
    if (m.cover) return `<img data-photo="${esc(m.cover)}" data-size="${size || 'thumb'}" alt="" ${r.image ? `src="${esc(r.image)}" referrerpolicy="no-referrer"` : ''}>`;
    if (r.image) return `<img src="${esc(r.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`;
    return '';
  }

  function cardHtml({ r, why }) {
    const m = store.meta(r.id);
    const ck = catKey(r.category);
    const nIng = r.ingredients.reduce((a, g) => a + g.items.length, 0);
    const nSteps = r.steps.reduce((a, g) => a + g.items.length, 0);
    const cooked = (m.cooked || []).length;
    return `<article class="card" style="--cat:var(--c-${ck})">
      <a class="card-link" href="#/r/${encodeURIComponent(r.id)}" aria-label="${esc(r.title)}"></a>
      <div class="card-art ${r.image || m.cover ? 'has-img' : ''}">
        ${coverImg(r, m)}
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
          ${m.rating ? `<span class="rated">${starsHtml(m.rating)}</span>` : ''}
          ${hasStory(m) ? `<span class="heirloom">${icon('i-quote')}Story</span>` : ''}
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

  /** Ingredient line in the chosen unit system (original / US / metric), scaled. */
  const ingText = (it, f) => RK.displayIngredient(it, settings.units, f || 1);
  const stepText = (t) => RK.convertTemps(t, settings.units);
  const unitsSeg = () => `<div class="seg units" role="radiogroup" aria-label="Units">${[['original', 'As written'], ['us', 'US'], ['metric', 'Metric']].map(([v, l]) => `<button role="radio" aria-checked="${settings.units === v}" class="${settings.units === v ? 'on' : ''}" data-act="units" data-u="${v}">${l}</button>`).join('')}</div>`;

  function nutritionHtml(r) {
    const n = RK.nutrition(r);
    if (n.considered < 2 || n.coverage < 0.5 || n.total.kcal < 20) return '';
    const v = (x) => Math.round(x);
    const tot = n.per.protein * 4 + n.per.carbs * 4 + n.per.fat * 9 || 1;
    const bar = (x, k) => `<i style="width:${Math.round((x * k / tot) * 100)}%"></i>`;
    return `<details class="panel nutrition no-print">
      <summary><span class="nut-title">Nutrition <small>estimate</small></span><span class="nut-kcal"><b>${v(n.per.kcal)}</b> kcal / serving</span></summary>
      <div class="nut-bar" aria-hidden="true">${bar(n.per.protein, 4)}${bar(n.per.carbs, 4)}${bar(n.per.fat, 9)}</div>
      <div class="nut-grid"><div><b>${v(n.per.protein)} g</b><span>Protein</span></div><div><b>${v(n.per.carbs)} g</b><span>Carbs</span></div><div><b>${v(n.per.fat)} g</b><span>Fat</span></div><div><b>${v(n.total.kcal)}</b><span>kcal total</span></div></div>
      <p class="muted small">Rough estimate for ${n.servings} serving${n.servings === 1 ? '' : 's'}${r.yield ? '' : ' (assumed)'}, from ${n.counted} of ${n.considered} ingredients using typical values. Garnishes, “to taste” and frying oil aren’t counted.${n.missed.length ? ` Not counted: ${n.missed.slice(0, 5).map((x) => esc(x)).join('; ')}${n.missed.length > 5 ? '…' : ''}.` : ''}</p>
    </details>`;
  }

  function photosHtml(r, m) {
    const list = m.photos || [];
    return `<div class="my-photos">
      ${list.map((id) => `<figure class="${m.cover === id ? 'is-cover' : ''}"><button class="ph" data-act="photo-view" data-pid="${esc(id)}" aria-label="View photo"><img data-photo="${esc(id)}" alt=""></button>
        <figcaption><button class="linkish" data-act="photo-cover" data-pid="${esc(id)}">${m.cover === id ? 'Cover ✓' : 'Make cover'}</button><button class="icon-btn" data-act="photo-del" data-pid="${esc(id)}" aria-label="Delete photo">${icon('i-trash')}</button></figcaption></figure>`).join('')}
      <label class="ph-add">${icon('i-camera')}<span>Add photo</span><input type="file" accept="image/*" multiple data-act="add-photo" data-id="${esc(r.id)}" hidden></label>
    </div>
    ${list.length ? '<p class="muted small">Your photos are stored on this device.</p>' : ''}`;
  }

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
        <header class="r-head ${r.image || m.cover ? 'with-img' : ''}">
          ${r.image || m.cover ? `<div class="r-img">${m.cover ? coverImg(r, m, 'full') : `<img src="${esc(r.image)}" alt="" referrerpolicy="no-referrer" onerror="this.parentNode.remove()">`}</div>` : ''}
          <div class="r-titles">
            <h1>${esc(r.title)}</h1>
            ${r.description ? `<p class="lede">${inlineMd(r.description)}</p>` : ''}
            <dl class="facts">
              ${r.time ? `<div><dt>${icon('i-clock')}Time</dt><dd>${esc(r.time)}</dd></div>` : ''}
              ${r.yield ? `<div><dt>${icon('i-utensils')}Yield</dt><dd>${esc(r.yield)}</dd></div>` : ''}
              ${nSteps ? `<div><dt>${icon('i-list')}Steps</dt><dd>${nSteps}</dd></div>` : ''}
              <div><dt>${icon('i-flame')}Cooked</dt><dd>${cooked.length ? `${cooked.length}× · last ${relDays(cooked[cooked.length - 1])}` : 'Not yet'}</dd></div>
              <div><dt>${icon('i-star')}Your rating</dt><dd class="rate" role="radiogroup" aria-label="Your rating">${[1, 2, 3, 4, 5].map((n) => `<button role="radio" aria-checked="${m.rating === n}" class="${m.rating >= n ? 'on' : ''}" data-act="rate" data-v="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')}</dd></div>
            </dl>
            ${r.tags.length ? `<p class="tags">${r.tags.map((t) => `<a class="tag" href="#/?tag=${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}</p>` : ''}
          </div>
          <div class="r-actions no-print">
            ${nSteps ? `<button class="btn primary big" data-act="cook">${icon('i-play')} Start cooking</button>` : ''}
            <button class="btn ${m.fav ? 'on' : ''}" data-act="fav" data-id="${esc(r.id)}" aria-pressed="${!!m.fav}">${icon('i-heart')} ${m.fav ? 'Favorited' : 'Favorite'}</button>
            <button class="btn" data-act="grocery-add">${icon('i-bag')} ${groceries.has(r.id) ? 'On list ✓' : 'Add to list'}</button>
            <button class="btn" data-act="plan-recipe">${icon('i-calendar')} Plan</button>
            <button class="btn" data-act="ask-claude">${icon('i-sparkle')} Ask Claude</button>
            <button class="btn" data-act="share">${icon('i-share')} Share</button>
            <a class="btn" href="#/edit/${encodeURIComponent(r.id)}">${icon('i-pencil')} Edit</a>
            <details class="menu">
              <summary class="btn icon-only" aria-label="More actions">${icon('i-more')}</summary>
              <div class="menu-pop">
                <button data-act="col-add">${icon('i-grid')} Add to collection…</button>
                <button data-act="cook-with">${icon('i-play')} Cook with another dish…</button>
                <button data-act="versions">${icon('i-history')} Version history${versions.list(r.id).length ? ` <small class="muted">${versions.list(r.id).length}</small>` : ''}</button>
                <button data-act="mark-cooked">${icon('i-flame')} Mark as cooked today</button>
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
              <div class="ing-tools no-print">${unitsSeg()}</div>
              ${f !== 1 ? `<p class="scaled-note">Scaled ${esc(RB.formatQty(f, 'frac'))}× — quantities at the start of each line are adjusted.</p>` : ''}
              ${r.ingredients.map((g, gi) => `
                ${g.name || g.note ? `<h3 class="group">${esc(g.name || '')}${g.note ? ` <small>${esc(g.note)}</small>` : ''}</h3>` : ''}
                <ul class="ing-list">
                  ${g.items.map((it, ii) => `<li><label class="check ${cs.has(gi + ':' + ii) ? 'on' : ''}"><input type="checkbox" data-act="ing-check" data-k="${gi}:${ii}" ${cs.has(gi + ':' + ii) ? 'checked' : ''}><span class="box">${icon('i-check')}</span><span>${qtyHtml(ingText(it, f))}</span></label></li>`).join('')}
                </ul>`).join('')}
              ${cs.size ? `<button class="linkish no-print" data-act="ing-reset">Uncheck all</button>` : ''}
            </div>
            ${nutritionHtml(r)}
          </aside>` : ''}
          <div class="method-col">
            ${lastTimeHtml(r, m)}
            ${r.steps.length ? `<section class="panel">
              <div class="panel-head"><h2>Method</h2>${nSteps ? `<button class="btn small ghost no-print" data-act="cook">${icon('i-play')} Cooking mode</button>` : ''}</div>
              ${r.steps.map((g, gi) => `
                ${g.name ? `<h3 class="group">${esc(g.name)}</h3>` : ''}
                <ol class="steps">
                  ${g.items.map((s, si) => { stepNo++; const k = gi + ':' + si; return `<li class="${ds.has(k) ? 'done' : ''}" data-act="step-done" data-k="${k}"><span class="num">${stepNo}</span><div>${stepHtml(stepText(s), stepLabel(r, s, stepNo))}</div></li>`; }).join('')}
                </ol>`).join('')}
            </section>` : ''}
            ${r.notes.length ? `<section class="panel notes"><h2>Notes</h2><ul>${r.notes.map((n) => `<li>${inlineMd(n)}</li>`).join('')}</ul></section>` : ''}
            ${r.extras.map((e) => `<section class="panel extra"><h2>${esc(e.title)}</h2>${blockMd(e.body)}</section>`).join('')}
            ${chefNotesHtml(r)}
            ${platingHtml(r, m)}
            ${pairingHtml(r)}
            ${storyHtml(r, m)}
            ${practiceLogHtml(r, m)}
            <section class="panel mine no-print">
              <div class="panel-head"><h2>My notes &amp; photos</h2><button class="btn small ghost" data-act="ask-claude">${icon('i-sparkle')} Ask Claude</button></div>
              <textarea id="my-notes" rows="3" placeholder="Tweaks, what worked, what to try next time…">${esc(m.notes || '')}</textarea>
              <div class="row between">
                <span class="muted small" id="notes-status">${m.notes ? 'Saved' : 'Saves automatically'}</span>
                <button class="btn small" data-act="mark-cooked">${icon('i-flame')} I cooked this today</button>
              </div>
              ${photosHtml(r, m)}
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
    hydratePhotos(main);
    hydrateAudio(main);
  }

  // ======================================================================
  // Cooking mode
  // ======================================================================
  const cook = {
    state: null, wake: null, listen: null, multi: null, returnTo: '',
    session(r) {
      const flat = [{ kind: 'prep' }];
      let n = 0;
      r.steps.forEach((g, gi) => g.items.forEach((text, si) => { n++; flat.push({ kind: 'step', text, group: g.name, gi, si, n }); }));
      if (!r.ingredients.length) flat.shift();
      flat.push({ kind: 'done' });
      return { r, flat, i: 0, total: n, sheet: false, practice: null, taste: {} };
    },
    open(id, step) {
      const r = store.byId(id);
      if (!r) return;
      this.multi = null; this.returnTo = '';
      this.state = this.session(r);
      if (step != null && !isNaN(+step)) this.state.i = Math.max(0, Math.min(this.state.flat.length - 1, +step));
      this.start();
    },
    /** Cook several recipes at once. The longest one goes first so it can get going. */
    openMulti(ids, returnTo) {
      const rs = ids.map((id) => store.byId(id)).filter(Boolean)
        .sort((a, b) => (parseMinutes(b.time) || 0) - (parseMinutes(a.time) || 0));
      if (!rs.length) return;
      this.multi = { sessions: rs.map((r) => this.session(r)), k: 0 };
      this.returnTo = returnTo && !/#\/cook\//.test(returnTo) ? returnTo : '#/plan';
      this.state = this.multi.sessions[0];
      this.start();
    },
    switchDish(k) {
      if (!this.multi || !this.multi.sessions[k]) return;
      this.state.sheet = false;
      this.multi.k = k; this.state = this.multi.sessions[k];
      this.render();
      if (settings.speak) this.readCurrent();
    },
    dishLabel(x) {
      const st = x.flat[x.i];
      return st.kind === 'prep' ? 'Not started' : st.kind === 'done' ? 'Done ✓' : `Step ${st.n} of ${x.total}`;
    },
    start() {
      document.body.classList.add('cooking');
      this.render();
      this.requestWake();
      document.addEventListener('keydown', this.onKey);
      document.addEventListener('visibilitychange', this.onVis);
    },
    close(silent) {
      if (!this.state) return;
      const back = this.multi ? (this.returnTo || '#/plan') : '#/r/' + encodeURIComponent(this.state.r.id);
      this.state = null; this.multi = null;
      clearInterval(this.clock); this.clock = null;
      document.body.classList.remove('cooking');
      $('#cook-root').innerHTML = '';
      speech.stop();
      if (this.listen) { this.listen.stop(); this.listen = null; }
      this.releaseWake();
      document.removeEventListener('keydown', this.onKey);
      document.removeEventListener('visibilitychange', this.onVis);
      if (!silent) go(back);
    },
    onKey: (e) => {
      if (!cook.state || e.target.matches('input, textarea, select') || !$('#sheet-root').hidden) return;
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
      if (!this.multi) history.replaceState(null, '', '#/r/' + encodeURIComponent(s.r.id) + '/cook?step=' + s.i);
      if (settings.speak) this.readCurrent();
    },
    goto(i) { this.state.i = i; this.renderStage(0); if (settings.speak) this.readCurrent(); },
    readCurrent() {
      const s = this.state; const st = s.flat[s.i];
      if (st.kind === 'step') speech.say('Step ' + st.n + '. ' + st.text);
      else if (st.kind === 'prep') speech.say((this.multi ? s.r.title + '. ' : '') + 'Gather your ingredients. ' + s.r.ingredients.flatMap((g) => g.items).slice(0, 25).map((x) => ingText(x, getScale(s.r.id))).join('. '));
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
      if (this.asking) return;
      const t = norm(txt);
      const ask = t.match(/^(?:hey |ok |okay )?(?:chef|question)\b[,:]?\s*(.*)$/);
      if (ask) {
        const el = $('.voice-heard'); if (el) { el.textContent = '“' + txt + '”'; el.classList.add('show'); }
        this.openAsk(); if (ask[1]) this.askChef(txt.replace(/^\W*(?:hey |ok |okay )?(?:chef|question)\b[,:]?\s*/i, ''), true); else speech.say('Yes chef? Ask away.');
        return;
      }
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
        const list = st.kind === 'step' ? RB.ingredientsForStep(st.text, this.state.r.ingredients).map((x) => ingText(x.item, getScale(this.state.r.id))) : [];
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
            <div class="cook-title"><b>${esc(r.title)}</b><small class="cook-count"></small><small class="practice-clock" ${s.practice ? '' : 'hidden'}></small></div>
            <div class="cook-tools">
              <button class="icon-btn txt" data-act="cook-size" data-d="-1" aria-label="Smaller text">A−</button>
              <button class="icon-btn txt" data-act="cook-size" data-d="1" aria-label="Bigger text">A+</button>
              ${'speechSynthesis' in window ? `<button class="icon-btn" data-act="cook-speak" aria-label="Read steps aloud" aria-pressed="${!!settings.speak}">${icon('i-volume')}</button>` : ''}
              ${voice.supported ? `<button class="icon-btn" data-act="cook-voice" aria-label="Hands-free voice control" aria-pressed="false">${icon('i-mic')}</button>` : ''}
              <button class="icon-btn ${s.practice ? 'on' : ''}" data-act="cook-practice" aria-pressed="${!!s.practice}" aria-label="Practice run: time every step" title="Practice run: time every step">${icon('i-stopwatch')}</button>
              <button class="icon-btn" data-act="cook-ask" aria-label="Ask the chef" title="Ask the chef">${icon('i-sparkle')}</button>
              ${r.ingredients.length ? `<button class="btn small" data-act="cook-sheet">${icon('i-list')}<span class="hide-sm"> Ingredients</span></button>` : ''}
            </div>
          </header>
          <div class="cook-progress"><i></i></div>
          ${this.multi ? `<nav class="dish-tabs" aria-label="Dishes">${this.multi.sessions.map((x, k) => `<button class="dish-tab ${k === this.multi.k ? 'on' : ''}" data-act="cook-dish" data-k="${k}" style="--cat:var(--c-${catKey(x.r.category)})"><b>${esc(x.r.title.replace(/\s*\(.*\)$/, ''))}</b><small>${esc(this.dishLabel(x))}</small></button>`).join('')}</nav>` : ''}
          <p class="voice-hint" hidden>${icon('i-mic')} Listening — say <b>next</b>, <b>back</b>, <b>repeat</b>, <b>ingredients</b>, <b>start timer</b>, <b>step 3</b>, <b>stop</b>, or <b>“chef, …”</b> to ask a question <span class="voice-heard"></span></p>
          <main class="cook-stage" aria-live="polite"></main>
          <footer class="cook-nav">
            <button class="btn big ghost" data-act="cook-prev">${icon('i-left')} Back</button>
            <div class="dots" aria-hidden="true"></div>
            <button class="btn big primary" data-act="cook-next">Next ${icon('i-right')}</button>
          </footer>
          <div class="cook-ask" hidden>
            <div class="ca-head"><b>${icon('i-sparkle')} Ask the chef</b><button class="icon-btn" data-act="cook-ask-close" aria-label="Close">${icon('i-x')}</button></div>
            <form class="ca-form" data-form="cook-ask"><input placeholder="My sauce broke… can I use thighs?" aria-label="Your question" autocomplete="off">
              ${voice.supported ? `<button type="button" class="icon-btn" data-act="cook-ask-mic" aria-label="Ask out loud">${icon('i-mic')}</button>` : ''}
              <button class="btn small primary" type="submit">Ask</button></form>
            <div class="ca-answer" aria-live="polite"></div>
          </div>
          <aside class="cook-sheet" aria-hidden="true" aria-label="Ingredients">
            <div class="sheet-head"><h2>Ingredients</h2><button class="icon-btn" data-act="cook-sheet" aria-label="Close ingredients">${icon('i-x')}</button></div>
            <div class="sheet-units">${unitsSeg()}</div>
            <div class="sheet-body"></div>
          </aside>
        </div>`;
      this.syncButtons();
      this.renderSheet();
      this.renderStage(0);
      clearInterval(this.clock);
      this.clock = setInterval(() => this.tickPractice(), 1000);
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
        <ul class="ing-list big">${g.items.map((it, ii) => `<li class="${highlight && highlight.has(gi + ':' + ii) ? 'hl' : ''}"><label class="check ${cs.has(gi + ':' + ii) ? 'on' : ''}"><input type="checkbox" data-act="ing-check" data-k="${gi}:${ii}" ${cs.has(gi + ':' + ii) ? 'checked' : ''}><span class="box">${icon('i-check')}</span><span>${qtyHtml(ingText(it, f))}</span></label></li>`).join('')}</ul>`).join('');
    },
    renderSheet() { const b = $('.cook-sheet .sheet-body'); if (b) b.innerHTML = this.ingListHtml(); },
    togglePractice() {
      const s = this.state; if (!s) return;
      if (s.practice && s.practice.start && !s.practice.end) { toast('Practice run stopped'); s.practice = null; }
      else if (s.practice) s.practice = null;
      else {
        s.practice = { start: null, enter: {}, end: null, saved: false };
        if (s.flat[s.i].kind !== 'prep') { s.practice.start = Date.now(); s.practice.enter[s.i] = Date.now(); }
        toast(s.flat[s.i].kind === 'prep' ? 'Practice run: the clock starts on the first step' : 'Practice run started');
      }
      const b = $('[data-act="cook-practice"]'); if (b) { b.classList.toggle('on', !!s.practice); b.setAttribute('aria-pressed', !!s.practice); }
      this.tickPractice();
      if (s.flat[s.i].kind === 'prep') this.renderStage(0);
    },
    tickPractice() {
      const s = this.state; const el = $('.practice-clock'); if (!s || !el) return;
      const p = s.practice;
      el.hidden = !p;
      if (!p) return;
      el.textContent = p.start ? '⏱ ' + RB.fmtDuration(((p.end || Date.now()) - p.start) / 1000) : '⏱ ready';
    },
    practiceSteps(s) {
      const p = s.practice, end = p.end || Date.now();
      const idx = Object.keys(p.enter).map(Number).sort((a, b) => a - b);
      return s.flat.map((x, i) => ({ x, i })).filter((o) => o.x.kind === 'step' && p.enter[o.i] != null).map((o) => {
        const next = idx.find((k) => k > o.i);
        return { n: o.x.n, text: RB.stripMd(o.x.text), secs: Math.round(((next != null ? p.enter[next] : end) - p.enter[o.i]) / 1000) };
      });
    },
    practiceHtml(s) {
      const p = s.practice;
      if (!p || !p.start) return '';
      const total = Math.round(((p.end || Date.now()) - p.start) / 1000);
      const steps = this.practiceSteps(s);
      const runs = store.meta(s.r.id).runs || [];
      const last = runs[runs.length - 1];
      const best = runs.reduce((a, x) => (a == null || x.total < a ? x.total : a), null);
      const planned = RK.parseTime(s.r.time).minutes;
      const delta = (a, b) => { const d = a - b; return `<b class="${d <= 0 ? 'faster' : 'slower'}">${d <= 0 ? '−' : '+'}${RB.fmtDuration(Math.abs(d))}</b>`; };
      const slow = steps.slice().sort((a, b) => b.secs - a.secs).slice(0, 3);
      return `<div class="practice-card">
        <p class="eyebrow">${icon('i-stopwatch')} Practice run</p>
        <p class="pr-total">${RB.fmtDuration(total)}</p>
        <p class="pr-compare">${last ? `${delta(total, last.total)} vs last run` : 'First timed run'}${best != null ? ` · ${delta(total, best)} vs best` : ''}${planned ? ` · recipe says ${planned} min` : ''}</p>
        ${slow.length ? `<div class="pr-slow"><span class="eyebrow">Where the time went</span>${slow.map((x) => `<p><b>${RB.fmtDuration(x.secs)}</b> Step ${x.n}: ${esc(x.text.slice(0, 70))}${x.text.length > 70 ? '…' : ''}</p>`).join('')}</div>` : ''}
        ${p.saved ? `<p class="pill">${icon('i-check')} Run saved to the practice log</p>` : `
        <div class="pr-scores">${[['taste', 'Taste'], ['plating', 'Plating'], ['timing', 'Timing']].map(([k, l]) => `<label><span>${l}</span><input type="range" min="1" max="10" value="7" data-score="${k}" oninput="this.nextElementSibling.textContent=this.value"><output>7</output></label>`).join('')}</div>
        <input class="pr-note" placeholder="What would you change on the next run?">
        <button class="btn primary" data-act="practice-save">Save run</button>`}
      </div>`;
    },
    tasteHtml(s) {
      const t = s.taste || {};
      if (t.saved) return `<div class="taste-card saved"><p class="pill">${icon('i-check')} Taste notes saved. They’ll show at the top of this recipe next time.</p></div>`;
      const row = (k, label, opts) => `<div class="tc-row"><span>${label}</span><div class="seg">${opts.map(([v, l]) => `<button class="${t[k] === v ? 'on' : ''}" data-act="taste-pick" data-k="${k}" data-v="${v}">${l}</button>`).join('')}</div></div>`;
      return `<div class="taste-card">
        <p class="eyebrow">Taste check · 10 seconds</p>
        ${row('salt', 'Salt', [[-1, 'Less'], [0, 'Perfect'], [1, 'More']])}
        ${row('acid', 'Acid', [[-1, 'Less'], [0, 'Perfect'], [1, 'More']])}
        ${row('heat', 'Heat', [[-1, 'Milder'], [0, 'Perfect'], [1, 'Hotter']])}
        ${row('done', 'Cook time', [[-1, 'Shorter'], [0, 'Perfect'], [1, 'Longer']])}
        <input class="tc-note" placeholder="Next time… (e.g. 10 min less, more lime at the end)" value="${esc(t.note || '')}">
        <button class="btn" data-act="taste-save">${icon('i-check')} Save taste notes</button>
      </div>`;
    },
    openAsk() {
      const panel = $('.cook-ask'); if (!panel) return;
      panel.hidden = false;
      if (!/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) setTimeout(() => { const i = $('.ca-form input', panel); if (i) i.focus(); }, 40);
    },
    async askChef(q, spoken) {
      const s = this.state; if (!s || !q.trim()) return;
      const out = $('.ca-answer'); const inp = $('.ca-form input'); if (inp) inp.value = q;
      out.innerHTML = '<p class="muted thinking">Thinking…</p>';
      await ai.init();
      if (!ai.available()) { out.innerHTML = aiSetupHtml(); return; }
      const st = s.flat[s.i];
      const where = st.kind === 'step' ? `Step ${st.n} of ${s.total}: ${RB.stripMd(st.text)}` : st.kind === 'prep' ? 'Gathering ingredients (mise en place)' : 'Finished cooking';
      const prompt = `You are a calm, expert sous-chef standing next to a home cook who is in the middle of cooking. Answer their question in 2 to 4 short sentences that sound natural read aloud: no lists, no markdown, the practical fix first. Use ${settings.units === 'metric' ? 'metric units and °C' : 'the units the recipe uses'}.

RECIPE
${RB.toMarkdown(s.r)}

WHERE THEY ARE
${where}

QUESTION
${q}`;
      this.asking = true;
      try {
        const text = await ai.ask(prompt, { onText: (t) => { out.innerHTML = blockMd(t); } });
        out.innerHTML = blockMd(text);
        if ((spoken || settings.speak) && text) speech.say(text);
      } catch (e) {
        out.innerHTML = e.message === 'NO_KEY' ? aiSetupHtml() : `<p class="error-text">${esc(e.message || 'Something went wrong')}</p>`;
      } finally { setTimeout(() => { this.asking = false; }, 600); }
    },
    renderStage(dir) {
      const s = this.state; const r = s.r; const st = s.flat[s.i];
      if (s.practice) {
        if (st.kind !== 'prep' && s.practice.start == null) s.practice.start = Date.now();
        if (s.practice.start != null && s.practice.enter[s.i] == null) s.practice.enter[s.i] = Date.now();
        if (st.kind === 'done' && !s.practice.end) s.practice.end = Date.now();
      }
      const f = getScale(r.id);
      const stage = $('.cook-stage');
      let html = '';
      if (st.kind === 'prep') {
        const nIng = r.ingredients.reduce((a, g) => a + g.items.length, 0);
        html = `<div class="stage-inner">
          ${this.multi && this.multi.k === 0 && this.multi.sessions.every((x) => x.i === 0) ? `<p class="multi-note">${icon('i-sparkle')}<span>Cooking ${this.multi.sessions.length} dishes. Start with <b>${esc(r.title)}</b>${r.time ? ` (${esc(r.time.replace(/\s*\(.*\)$/, ''))})` : ''} since it takes longest, then switch dishes with the tabs above while things simmer.</span></p>` : ''}
          ${lastTimeHtml(r, store.meta(r.id))}
          ${s.practice ? `<p class="multi-note">${icon('i-stopwatch')}<span><b>Practice run.</b> The clock starts when you tap “Let’s cook”, and every step is timed.</span></p>` : ''}
          <p class="eyebrow">${this.multi ? esc(r.title) + ' · ' : ''}Before you start · mise en place</p>
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
          <p class="stage-text">${stepHtml(stepText(body || st.text), label)}</p>
          ${tms.length ? `<div class="stage-timers">${tms.map((t) => `<button class="btn timer-btn" data-act="timer" data-secs="${t.seconds}" data-label="${esc(label)}">${icon('i-timer')} Start ${esc(RB.fmtDurationWords(t.seconds))} timer${t.maxSeconds ? `<small>up to ${esc(RB.fmtDurationWords(t.maxSeconds))}</small>` : ''}</button>`).join('')}</div>` : ''}
          ${uses.length ? `<div class="uses"><p class="eyebrow">For this step</p><ul>${uses.map((u) => `<li>${qtyHtml(ingText(u.item, f))}</li>`).join('')}</ul></div>` : ''}
          ${next && next.kind === 'step' ? `<p class="up-next"><span>Up next</span> ${esc(RB.stripMd(next.text).slice(0, 110))}${RB.stripMd(next.text).length > 110 ? '…' : ''}</p>` : ''}
        </div>`;
        const ds = doneSet(r.id);
        for (let k = 1; k < s.flat.length; k++) { const x = s.flat[k]; if (x.kind === 'step') { if (k < s.i) ds.add(x.gi + ':' + x.si); } }
      } else {
        const cooked = store.meta(r.id).cooked || [];
        const today = cooked.length && new Date(cooked[cooked.length - 1]).toDateString() === new Date().toDateString();
        const nextDish = this.multi ? this.multi.sessions.findIndex((x, k) => k !== this.multi.k && x.flat[x.i].kind !== 'done') : -1;
        html = `<div class="stage-inner center">
          <p class="done-mark">${icon('i-check')}</p>
          <h2 class="stage-h">That’s it. Enjoy!</h2>
          <p class="muted">${esc(r.title)}</p>
          ${r.notes.length || r.extras.length ? `<div class="done-notes">${r.notes.map((n) => `<p>${inlineMd(n)}</p>`).join('')}${r.extras.map((e) => `<h3>${esc(e.title)}</h3>${blockMd(e.body)}`).join('')}</div>` : ''}
          <div class="row center wrap-row">
            ${nextDish >= 0 ? `<button class="btn primary big" data-act="cook-dish" data-k="${nextDish}">Next dish: ${esc(this.multi.sessions[nextDish].r.title.replace(/\s*\(.*\)$/, ''))} ${icon('i-right')}</button>` : ''}
            ${today ? `<span class="pill">${icon('i-flame')} Logged as cooked today</span>` : `<button class="btn ${nextDish >= 0 ? '' : 'primary'} big" data-act="mark-cooked">${icon('i-flame')} Log that I cooked this</button>`}
            <label class="btn big">${icon('i-camera')} Add a photo<input type="file" accept="image/*" data-act="add-photo" data-id="${esc(r.id)}" hidden></label>
            <button class="btn big ghost" data-act="cook-close">${this.multi ? 'Finish cooking' : 'Back to recipe'}</button>
          </div>
          ${this.practiceHtml(s)}
          ${this.tasteHtml(s)}
        </div>`;
      }
      stage.innerHTML = html;
      stage.classList.remove('in-left', 'in-right');
      void stage.offsetWidth;
      if (dir) stage.classList.add(dir > 0 ? 'in-right' : 'in-left');
      stage.scrollTop = 0;
      this.tickPractice();
      // header + progress
      const stepN = st.kind === 'step' ? st.n : st.kind === 'prep' ? 0 : s.total;
      $('.cook-count').textContent = st.kind === 'prep' ? 'Mise en place' : st.kind === 'done' ? 'Finished' : `Step ${st.n} of ${s.total}`;
      const tab = $('.dish-tab.on small'); if (tab) tab.textContent = this.dishLabel(s);
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
          <label class="add-tile"><span class="add-ic">${icon('i-camera')}</span><b>Snap a photo</b><span>A cookbook page, recipe card or screenshot. Claude reads it for you.</span><input type="file" accept="image/*" multiple data-act="photo-recipe" hidden></label>
          <a class="add-tile" href="#/new" data-act="new-blank"><span class="add-ic">${icon('i-pencil')}</span><b>Type it</b><span>Start with a blank recipe card.</span></a>
          <label class="add-tile"><span class="add-ic">${icon('i-file')}</span><b>Import a file</b><span>Markdown, text, a shared recipe page (.html) or a JSON backup.</span><input type="file" accept=".md,.markdown,.txt,.json,.html,.htm,text/*,application/json" data-act="import-file" hidden></label>
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
            <label class="field"><span>Photo URL</span><input name="image" type="text" inputmode="url" value="${esc(r.image)}" placeholder="https://…/photo.jpg"></label>
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
  const staplesList = () => settings.staples || RK.DEFAULT_STAPLES;
  const groceryMerged = () => RK.mergeGroceries(groceries.list, { system: settings.units === 'metric' ? 'metric' : 'us', staples: staplesList() });
  function viewGroceries(main) {
    const list = groceries.list;
    const left = list.filter((x) => !x.checked).length;
    const view = settings.gView === 'recipe' ? 'recipe' : 'aisle';
    let body = '';
    if (view === 'aisle') {
      const merged = groceryMerged();
      const row = (g) => `<li><label class="check ${g.checked ? 'on' : ''}" title="${esc(g.raws.join('\n'))}"><input type="checkbox" data-act="g-check-many" data-ids="${esc(g.ids.join(','))}" ${g.checked ? 'checked' : ''}><span class="box">${icon('i-check')}</span>
        <span>${g.amount ? `<b class="qty">${esc(g.amount)}</b> ` : ''}${esc(g.display)}${g.approx ? ' <small class="muted">+ more</small>' : ''}${g.sources.length ? `<small class="g-src">${esc(g.sources.join(' · '))}</small>` : ''}</span></label></li>`;
      const byAisle = RK.AISLE_ORDER.map((a) => ({ a, items: merged.filter((g) => !g.staple && g.aisle === a) })).filter((x) => x.items.length);
      const staples = merged.filter((g) => g.staple);
      body = byAisle.map((x) => `<section class="panel g-group aisle"><div class="panel-head"><h2>${esc(RK.AISLE_LABEL[x.a])}</h2><small class="muted">${x.items.filter((g) => !g.checked).length || '✓'}</small></div>
          <ul class="ing-list">${x.items.slice().sort((a, b) => a.checked - b.checked).map(row).join('')}</ul></section>`).join('')
        + (staples.length ? `<details class="panel g-group staples"><summary><h2>Pantry staples</h2><span class="muted small">${staples.length} item${staples.length === 1 ? '' : 's'} you probably have · tap to check</span></summary>
          <ul class="ing-list">${staples.map(row).join('')}</ul></details>` : '');
    } else {
      const groups = [];
      list.forEach((x) => { const k = x.recipeTitle || 'Other items'; let g = groups.find((y) => y.k === k); if (!g) groups.push(g = { k, id: x.recipeId, items: [] }); g.items.push(x); });
      groups.sort((a, b) => (a.k === 'Other items') - (b.k === 'Other items'));
      body = groups.map((g) => `<section class="panel g-group">
          <div class="panel-head"><h2>${g.id && store.byId(g.id) ? `<a href="#/r/${encodeURIComponent(g.id)}">${esc(g.k)}</a>` : esc(g.k)}</h2>
          <button class="linkish" data-act="g-remove-group" data-k="${esc(g.k)}">Remove</button></div>
          <ul class="ing-list">${g.items.slice().sort((a, b) => a.checked - b.checked).map((x) => `<li><label class="check ${x.checked ? 'on' : ''}"><input type="checkbox" data-act="g-check" data-id="${x.id}" ${x.checked ? 'checked' : ''}><span class="box">${icon('i-check')}</span><span>${esc(x.text)}</span></label></li>`).join('')}</ul>
        </section>`).join('');
    }
    const recipesOnList = new Set(list.map((x) => x.recipeId).filter(Boolean)).size;
    main.innerHTML = `
      <section class="wrap narrow groceries">
        <h1>Groceries</h1>
        <p class="sub">${list.length ? `${left} to get${list.length - left ? ` · ${list.length - left} in the cart` : ''}${recipesOnList ? ` · from ${recipesOnList} recipe${recipesOnList === 1 ? '' : 's'}` : ''}` : 'Add a recipe’s ingredients from its page or the meal plan, or add items here.'}</p>
        <form class="add-item" data-form="grocery">
          <div class="with-mic"><input id="g-new" placeholder="Add an item…" enterkeyhint="done" aria-label="Add an item">${voice.supported ? `<button type="button" class="icon-btn mic" data-act="dictate" data-target="g-new" data-mode="text" aria-label="Dictate">${icon('i-mic')}</button>` : ''}</div>
          <button class="btn primary" type="submit">${icon('i-plus')} Add</button>
        </form>
        ${list.length ? `<div class="g-view row between"><div class="seg" role="radiogroup" aria-label="Group by">
            <button role="radio" aria-checked="${view === 'aisle'}" class="${view === 'aisle' ? 'on' : ''}" data-act="g-view" data-v="aisle">By aisle</button>
            <button role="radio" aria-checked="${view === 'recipe'}" class="${view === 'recipe' ? 'on' : ''}" data-act="g-view" data-v="recipe">By recipe</button></div>
          ${view === 'aisle' ? '<span class="muted small">Duplicates combined</span>' : ''}</div>` : ''}
        ${body}
        ${list.length ? `<div class="row wrap-row">
          <button class="btn" data-act="g-share">${icon('i-share')} Share list</button>
          <button class="btn" data-act="g-copy">${icon('i-copy')} Copy</button>
          <button class="btn ghost" data-act="g-clear-checked" ${list.length - left ? '' : 'disabled'}>Clear checked</button>
          <button class="btn ghost danger" data-act="g-clear-all">Clear all</button>
        </div>` : `<div class="empty"><p>${icon('i-bag', 'huge')}</p><div class="row center"><a class="btn" href="#/">Browse recipes</a><a class="btn ghost" href="#/plan">Plan the week</a></div></div>`}
        <details class="panel staples-edit">
          <summary class="linkish">Pantry staples</summary>
          <p class="muted small">Items you always keep at home. They’re tucked into their own section so the list stays short, and “What can I make?” assumes you have them.</p>
          <textarea id="staples" rows="3">${esc(staplesList().join(', '))}</textarea>
          <div class="row end"><button class="btn small ghost" data-act="staples-reset">Reset</button><button class="btn small" data-act="staples-save">Save staples</button></div>
        </details>
      </section>`;
  }
  const groceryText = () => {
    if (settings.gView !== 'recipe') {
      const merged = groceryMerged().filter((g) => !g.checked);
      const main = merged.filter((g) => !g.staple);
      return RK.AISLE_ORDER.map((a) => {
        const items = main.filter((g) => g.aisle === a);
        return items.length ? RK.AISLE_LABEL[a] + '\n' + items.map((g) => '☐ ' + g.label).join('\n') : '';
      }).filter(Boolean).join('\n\n');
    }
    const groups = {};
    groceries.list.filter((x) => !x.checked).forEach((x) => { (groups[x.recipeTitle || 'Other'] = groups[x.recipeTitle || 'Other'] || []).push(x.text); });
    return Object.entries(groups).map(([k, v]) => k + '\n' + v.map((x) => '☐ ' + x).join('\n')).join('\n\n');
  };

  // ======================================================================
  // View: The Chef's Notebook (techniques & cheat codes)
  // ======================================================================
  const TIPS = window.RB_TIPS || { categories: [], tips: [], temps: [], sugar: [], ratios: [], tempsNote: '' };
  /** Built-in techniques plus the ones you've written. */
  const allTips = () => TIPS.tips.concat(store.book.customTips.map((t) => Object.assign({ how: [], useIn: [], match: '', pro: '', why: '', level: 'Foundation' }, t, { custom: true })));
  const tipsUi = { q: '', cat: '', saved: false };
  const savedTips = new Set(LS.get('wrb.tipsSaved', []));
  const saveSavedTips = () => LS.set('wrb.tipsSaved', Array.from(savedTips));
  const tipCat = (id) => TIPS.categories.find((c) => c.id === id) || { id, label: id, blurb: '' };
  const levelRank = (t) => ({ Foundation: 0, Pro: 1, Michelin: 2 }[t.level] || 0);
  const tipRx = {};
  const recipeTextCache = new Map();
  function recipeText(r) {
    const key = r.id + '|' + (r.updatedAt || '');
    if (!recipeTextCache.has(key)) recipeTextCache.set(key, [r.title, r.description].concat(r.ingredients.flatMap((g) => g.items), r.steps.flatMap((g) => g.items), r.notes, r.extras.map((e) => e.body)).join('\n'));
    return recipeTextCache.get(key);
  }
  function tipMatches(t, text) {
    if (!t.match) return 0;
    const key = t.id + '|' + t.match;
    let rx = tipRx[key];
    if (!rx) { try { rx = tipRx[key] = new RegExp(t.match, 'gi'); } catch (e) { return 0; } }
    const m = text.match(rx);
    return m ? m.length : 0;
  }
  function tipsForRecipe(r, n) {
    const text = recipeText(r);
    return allTips().map((t) => { const n = Math.min(tipMatches(t, text), 3); return { t, score: (t.useIn.includes(r.id) ? 10 : 0) + (t.custom && n ? 20 : 0) + n }; })
      .filter((x) => x.score >= (x.t.useIn.includes(r.id) || x.t.custom ? 1 : 2))
      .sort((a, b) => b.score - a.score || levelRank(b.t) - levelRank(a.t))
      .slice(0, n || 3).map((x) => x.t);
  }
  function recipesForTip(t) {
    const ids = t.useIn.filter((id) => store.byId(id));
    if (ids.length < 5 && t.match) {
      store.recipes.map((r) => ({ r, n: tipMatches(t, recipeText(r)) })).filter((x) => x.n > 0 && !ids.includes(x.r.id))
        .sort((a, b) => b.n - a.n).slice(0, 5 - ids.length).forEach((x) => ids.push(x.r.id));
    }
    return ids.map((id) => store.byId(id));
  }
  function chefNotesHtml(r) {
    const list = tipsForRecipe(r, 3);
    if (!list.length) return '';
    return `<section class="panel chef-notes no-print">
      <div class="panel-head"><h2>Chef’s notes</h2><a class="linkish" href="#/tips">All techniques</a></div>
      <ul class="chef-list">${list.map((t) => `<li><a href="#/tips?t=${encodeURIComponent(t.id)}">
        <span class="level level-${t.level.toLowerCase()}">${esc(t.level)}</span>
        <b>${esc(t.title)}</b><span>${esc(t.rule)}</span></a></li>`).join('')}</ul>
    </section>`;
  }
  function tipCardHtml(t, open) {
    const recipes = recipesForTip(t);
    const saved = savedTips.has(t.id);
    return `<details class="tip-card" id="tip-${esc(t.id)}" ${open ? 'open' : ''}>
      <summary>
        <div class="tip-top"><span class="eyebrow">${esc(tipCat(t.cat).label)}</span>${t.custom ? '<span class="level level-yours">Yours</span>' : `<span class="level level-${t.level.toLowerCase()}">${esc(t.level)}</span>`}</div>
        <h3>${esc(t.title)}</h3>
        <p class="tip-rule">${esc(t.rule)}</p>
        <span class="tip-more"><span class="when-closed">How it works</span><span class="when-open">Close</span>${icon('i-right')}</span>
        <button type="button" class="tip-save ${saved ? 'on' : ''}" data-act="tip-save" data-id="${esc(t.id)}" aria-pressed="${saved}" aria-label="${saved ? 'Remove from' : 'Save to'} saved techniques">${icon('i-bookmark')}</button>
      </summary>
      <div class="tip-body">
        <p class="tip-why">${esc(t.why)}</p>
        <ol class="tip-how">${t.how.map((h) => `<li>${esc(h)}</li>`).join('')}</ol>
        ${t.pro ? `<p class="tip-pro"><span class="eyebrow">Chef’s move</span>${esc(t.pro)}</p>` : ''}
        ${recipes.length ? `<div class="tip-uses"><span class="eyebrow">Use it in</span><div>${recipes.map((r) => `<a href="#/r/${encodeURIComponent(r.id)}">${esc(r.title)}</a>`).join('')}</div></div>` : ''}
        ${t.custom ? `<div class="row end"><button class="btn small ghost" data-act="tip-edit" data-id="${esc(t.id)}">${icon('i-pencil')} Edit</button></div>` : ''}
      </div>
    </details>`;
  }
  function filteredTips() {
    const q = norm(tipsUi.q).trim();
    const toks = q ? q.split(/\s+/) : [];
    return allTips().filter((t) => (!tipsUi.cat || (tipsUi.cat === 'mine' ? t.custom : t.cat === tipsUi.cat)) && (!tipsUi.saved || savedTips.has(t.id))
      && toks.every((k) => norm([t.title, t.rule, t.why, t.how.join(' '), t.pro, tipCat(t.cat).label, t.level].join(' ')).includes(k)));
  }
  function renderTipResults(openId) {
    const el = $('#tip-results');
    if (!el) return;
    const list = filteredTips();
    if (!list.length) {
      el.innerHTML = `<div class="empty"><p class="empty-title">${tipsUi.saved && !savedTips.size ? 'No saved techniques yet' : 'Nothing matches that'}</p><p>${tipsUi.saved && !savedTips.size ? 'Tap the bookmark on any technique to keep it here.' : 'Try another word or category.'}</p></div>`;
      return;
    }
    if (!tipsUi.q && !tipsUi.cat && !tipsUi.saved) {
      el.innerHTML = TIPS.categories.map((c) => {
        const items = list.filter((t) => t.cat === c.id);
        if (!items.length) return '';
        return `<section class="tip-section"><div class="tip-section-head"><h2>${esc(c.label)}</h2><p>${esc(c.blurb)}</p></div>
          <div class="tip-grid">${items.map((t) => tipCardHtml(t, t.id === openId)).join('')}</div></section>`;
      }).join('');
    } else {
      el.innerHTML = `<p class="result-count">${list.length} technique${list.length === 1 ? '' : 's'}</p><div class="tip-grid">${list.map((t) => tipCardHtml(t, t.id === openId)).join('')}</div>`;
    }
  }
  function viewTips(main) {
    const p = route.params;
    if (p.t) { tipsUi.q = ''; tipsUi.cat = ''; tipsUi.saved = false; }
    if (p.cat) tipsUi.cat = p.cat;
    const day = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
    const today = TIPS.tips[day % TIPS.tips.length];
    const nLevels = (lv) => TIPS.tips.filter((t) => t.level === lv).length;
    const mine = store.book.customTips.length;
    main.innerHTML = `
      <section class="notebook wrap">
        <header class="nb-hero">
          <p class="eyebrow">The Chef’s Notebook</p>
          <h1>Cheat codes for a Michelin kitchen at home</h1>
          <p class="sub">${TIPS.tips.length} techniques, ratios and plating moves that separate good cooking from unforgettable, each linked to the recipes in your book where it pays off.</p>
          <p class="nb-levels"><span class="level level-foundation">Foundation</span> ${nLevels('Foundation')} everyday habits <span class="level level-pro">Pro</span> ${nLevels('Pro')} real upgrades <span class="level level-michelin">Michelin</span> ${nLevels('Michelin')} fine-dining moves</p>
          <p><button class="btn small" data-act="tip-new">${icon('i-plus')} Add your own technique</button></p>
        </header>
        ${today ? `<article class="spotlight after-dark">
          <div class="spot-copy">
            <p class="eyebrow">Today’s cheat code · ${esc(tipCat(today.cat).label)}</p>
            <h2>${esc(today.title)}</h2>
            <p class="spot-rule">${esc(today.rule)}</p>
            <p class="spot-why">${esc(today.why)}</p>
            <a class="btn" href="#/tips?t=${encodeURIComponent(today.id)}">Learn the technique ${icon('i-right')}</a>
          </div>
          <span class="level level-${today.level.toLowerCase()}">${esc(today.level)}</span>
        </article>` : ''}
        <form class="searchbar" role="search" onsubmit="return false">
          ${icon('i-search', 'lead')}
          <input id="tip-q" type="search" autocomplete="off" placeholder="Search techniques: sear, emulsion, plating…" value="${esc(tipsUi.q)}" aria-label="Search techniques">
        </form>
        <div class="chips tip-chips" role="tablist" aria-label="Technique categories">
          <button class="chip ${!tipsUi.cat && !tipsUi.saved ? 'on' : ''}" data-act="tip-cat" data-cat="">All <small>${TIPS.tips.length + mine}</small></button>
          ${mine ? `<button class="chip ${tipsUi.cat === 'mine' ? 'on' : ''}" data-act="tip-cat" data-cat="mine">Mine <small>${mine}</small></button>` : ''}
          ${TIPS.categories.map((c) => `<button class="chip ${tipsUi.cat === c.id ? 'on' : ''}" data-act="tip-cat" data-cat="${c.id}">${esc(c.label)} <small>${allTips().filter((t) => t.cat === c.id).length}</small></button>`).join('')}
          <button class="chip ${tipsUi.saved ? 'on' : ''}" data-act="tip-saved">${icon('i-bookmark')} Saved <small data-saved-count>${savedTips.size}</small></button>
        </div>
        <div id="tip-results"></div>
        <section class="reference" id="numbers">
          <div class="tip-section-head"><h2>Numbers worth memorizing</h2><p>The ratios and temperatures chefs carry in their heads.</p></div>
          <div class="ref-grid">
            <div class="ref-card ref-wide">
              <h3>Doneness temperatures</h3>
              <div class="table-wrap"><table class="ref-table"><thead><tr><th>What</th><th>Pull at</th><th>After resting</th></tr></thead>
                <tbody>${TIPS.temps.map((x) => `<tr><td>${esc(x.item)}</td><td class="num">${esc(x.pull)}</td><td>${esc(x.final)}</td></tr>`).join('')}</tbody></table></div>
              <p class="ref-note">${esc(TIPS.tempsNote)}</p>
            </div>
            <div class="ref-card">
              <h3>Ratios</h3>
              <dl class="ratio-list">${TIPS.ratios.map((x) => `<div><dt>${esc(x.name)}</dt><dd><b>${esc(x.ratio)}</b><span>${esc(x.note)}</span></dd></div>`).join('')}</dl>
            </div>
            <div class="ref-card">
              <h3>Sugar stages</h3>
              <dl class="ratio-list">${TIPS.sugar.map((x) => `<div><dt>${esc(x.stage)}</dt><dd><b>${esc(x.temp)}</b><span>${esc(x.use)}</span></dd></div>`).join('')}</dl>
            </div>
          </div>
        </section>
      </section>`;
    renderTipResults(p.t);
    const q = $('#tip-q');
    q.addEventListener('input', debounce(() => { tipsUi.q = q.value; renderTipResults(); }, 120));
    if (p.t) setTimeout(() => { const card = document.getElementById('tip-' + p.t); if (card) card.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 60);
  }

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
          <div class="field"><span>Units <small>for ingredients, oven temperatures and the grocery list</small></span>${unitsSeg()}</div>
        </section>

        <section class="panel">
          <h2>${icon('i-sparkle')} Claude</h2>
          <p class="small">Powers <b>Ask Claude</b> on every recipe and <b>Snap a photo</b> in Add a recipe. Inside the Claude app it works with no setup. On your own site, paste an Anthropic API key; it stays on this device and is sent only to Anthropic.</p>
          <form data-form="ai" class="gh-form">
            <label class="field"><span>Anthropic API key</span><input name="key" type="password" autocomplete="off" value="${esc(settings.claudeKey)}" placeholder="sk-ant-…"></label>
            <div class="row between"><span class="muted small" id="ai-status">${ai.sample ? 'Connected through the Claude app' : settings.claudeKey ? 'Key saved on this device' : 'Not connected'}</span><button class="btn" type="submit">Save</button></div>
          </form>
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
            <label class="btn">${icon('i-upload')} Import file<input type="file" accept=".md,.markdown,.txt,.json,.html,.htm,text/*,application/json" data-act="import-file" hidden></label>
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
  // Meal plan
  // ======================================================================
  const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Drinks'];
  const defaultMeal = (r) => { const k = catKey(r.category); return k === 'breakfast' ? 'Breakfast' : k === 'baking' ? 'Dessert' : k === 'drinks' ? 'Drinks' : 'Dinner'; };
  const dayLabel = (key, opts) => { const [y, mo, d] = key.split('-').map(Number); return new Date(y, mo - 1, d).toLocaleDateString(undefined, opts || { weekday: 'long', month: 'short', day: 'numeric' }); };
  function planAdd(day, recipeId, meal) {
    const r = store.byId(recipeId); if (!r) return;
    const items = store.planDay(day).concat({ id: uid(), recipeId, meal: meal || defaultMeal(r) });
    items.sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal));
    store.setPlanDay(day, items);
  }
  function todayHtml() {
    const items = store.planDay(RK.dateKey(new Date())).filter((it) => store.byId(it.recipeId));
    if (!items.length) return '';
    const rs = items.map((it) => store.byId(it.recipeId));
    return `<p class="today-menu">${icon('i-calendar')} <span>On the menu today:</span> ${rs.map((r) => `<a href="#/r/${encodeURIComponent(r.id)}">${esc(r.title)}</a>`).join(', ')}
      ${rs.length > 1 ? `<a class="linkish" href="#/cook/${rs.map((r) => encodeURIComponent(r.id)).join(',')}">Cook together</a>` : ''}</p>`;
  }
  function viewPlan(main) {
    const w = parseInt(route.params.w, 10) || 0;
    const days = RK.weekDays(w);
    const todayKey = RK.dateKey(new Date());
    const keys = days.map(RK.dateKey);
    const count = keys.reduce((a, k) => a + store.planDay(k).filter((it) => store.byId(it.recipeId)).length, 0);
    const title = w === 0 ? 'This week' : w === 1 ? 'Next week' : w === -1 ? 'Last week' : 'Week of ' + days[0].toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
    const range = days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' – ' + days[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const dayHtml = (d) => {
      const key = RK.dateKey(d);
      const items = store.planDay(key).filter((it) => store.byId(it.recipeId));
      const rs = items.map((it) => store.byId(it.recipeId));
      const sides = RK.suggestSides(rs, store.recipes, 2);
      return `<section class="day ${key === todayKey ? 'today' : ''} ${key < todayKey ? 'past' : ''}">
        <header class="day-head"><span class="dow">${esc(d.toLocaleDateString(undefined, { weekday: 'short' }))}</span><b>${d.getDate()}</b>${key === todayKey ? '<span class="today-dot">Today</span>' : ''}</header>
        <ul class="day-items">${items.map((it) => { const r = store.byId(it.recipeId); const m = store.meta(r.id); return `<li class="plan-item" style="--cat:var(--c-${catKey(r.category)})">
          <a href="#/r/${encodeURIComponent(r.id)}"><span class="pi-art">${coverImg(r, m) || icon('c-' + catKey(r.category))}</span><span class="pi-txt"><small>${esc(it.meal)}</small><b>${esc(r.title)}</b></span></a>
          <button class="icon-btn" data-act="plan-remove" data-day="${key}" data-pid="${esc(it.id)}" aria-label="Remove ${esc(r.title)}">${icon('i-x')}</button></li>`; }).join('')}</ul>
        ${sides.length ? `<div class="pairs"><span class="eyebrow">Pairs well</span>${sides.map((x) => `<button class="pair-chip" data-act="plan-add-direct" data-day="${key}" data-rid="${esc(x.id)}">${icon('i-plus')}${esc(x.title)}</button>`).join('')}</div>` : ''}
        <div class="day-foot"><button class="btn small ghost" data-act="plan-pick" data-day="${key}">${icon('i-plus')} Add</button>
          ${rs.some((r) => r.steps.length) ? `<button class="btn small ghost" data-act="plan-schedule" data-day="${key}">${icon('i-clock')} Timing</button>` : ''}
          ${rs.filter((r) => r.steps.length).length > 1 ? `<a class="btn small ghost" href="#/cook/${rs.map((r) => encodeURIComponent(r.id)).join(',')}">${icon('i-play')} Cook together</a>` : rs.length === 1 && rs[0].steps.length ? `<a class="btn small ghost" href="#/r/${encodeURIComponent(rs[0].id)}/cook">${icon('i-play')} Cook</a>` : ''}</div>
      </section>`;
    };
    main.innerHTML = `
      <section class="wrap plan">
        <header class="page-head">
          <div><p class="eyebrow">Meal plan</p><h1>${esc(title)}</h1><p class="sub">${esc(range)} · ${count ? `${count} dish${count === 1 ? '' : 'es'} planned` : 'Nothing planned yet'}</p></div>
          <div class="week-nav">
            <a class="icon-btn" href="#/plan?w=${w - 1}" aria-label="Previous week">${icon('i-left')}</a>
            ${w !== 0 ? '<a class="btn small ghost" href="#/plan">This week</a>' : ''}
            <a class="icon-btn" href="#/plan?w=${w + 1}" aria-label="Next week">${icon('i-right')}</a>
          </div>
        </header>
        <div class="row wrap-row plan-actions">
          <button class="btn primary" data-act="plan-groceries" data-w="${w}" ${count ? '' : 'disabled'}>${icon('i-bag')} Add week to groceries</button>
          <button class="btn ghost" data-act="plan-clear" data-w="${w}" ${count ? '' : 'disabled'}>Clear week</button>
        </div>
        <div class="week">${days.map(dayHtml).join('')}</div>
      </section>`;
    hydratePhotos(main);
  }
  /** Pick a recipe for a given day. */
  function openPlanPicker(day) {
    let meal = 'Dinner';
    const listHtml = (q) => {
      const rs = q.trim() ? search(q).map((x) => x.r) : store.recipes.slice().sort((a, b) => (store.meta(b.id).fav ? 1 : 0) - (store.meta(a.id).fav ? 1 : 0) || a.title.localeCompare(b.title));
      return rs.slice(0, 60).map((r) => `<li><button class="pick-row" data-rid="${esc(r.id)}" style="--cat:var(--c-${catKey(r.category)})">${icon('c-' + catKey(r.category))}<span><b>${esc(r.title)}</b><small>${esc(r.category || '')}${r.time ? ' · ' + esc(r.time.replace(/\s*\(.*\)$/, '')) : ''}</small></span>${store.meta(r.id).fav ? icon('i-heart', 'fav-i') : ''}</button></li>`).join('') || '<li class="muted small">No matches</li>';
    };
    sheet.open({ title: 'Add to ' + dayLabel(day), body: `
      <div class="seg meal-seg" role="radiogroup" aria-label="Meal">${MEALS.map((m) => `<button role="radio" data-meal="${m}" class="${m === meal ? 'on' : ''}" aria-checked="${m === meal}">${m}</button>`).join('')}</div>
      <div class="searchbar small-search">${icon('i-search', 'lead')}<input id="pick-q" type="search" placeholder="Search recipes…" autocomplete="off" autofocus></div>
      <ul class="pick-list">${listHtml('')}</ul>`,
    onMount: (el) => {
      const q = $('#pick-q', el), ul = $('.pick-list', el);
      q.addEventListener('input', debounce(() => { ul.innerHTML = listHtml(q.value); }, 80));
      el.addEventListener('click', (e) => {
        const mb = e.target.closest('[data-meal]');
        if (mb) { meal = mb.dataset.meal; $$('[data-meal]', el).forEach((b) => { b.classList.toggle('on', b === mb); b.setAttribute('aria-checked', b === mb); }); return; }
        const row = e.target.closest('.pick-row');
        if (row) { planAdd(day, row.dataset.rid, meal); sheet.close(true); toast('Added to ' + dayLabel(day, { weekday: 'long' })); if (route.name === 'plan') viewPlan($('#main')); }
      });
    } });
  }
  /** Pick a day for a given recipe (from its page). */
  function openPlanDays(r) {
    let meal = defaultMeal(r);
    const start = new Date();
    const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
    sheet.open({ title: 'Plan ' + r.title, body: `
      <div class="seg meal-seg" role="radiogroup" aria-label="Meal">${MEALS.map((m) => `<button role="radio" data-meal="${m}" class="${m === meal ? 'on' : ''}" aria-checked="${m === meal}">${m}</button>`).join('')}</div>
      <div class="day-pick">${days.map((d, i) => { const key = RK.dateKey(d); const n = store.planDay(key).length; return `<button data-day="${key}"><small>${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : esc(d.toLocaleDateString(undefined, { weekday: 'short' }))}</small><b>${d.getDate()}</b><span>${esc(d.toLocaleDateString(undefined, { month: 'short' }))}${n ? ` · ${n}` : ''}</span></button>`; }).join('')}</div>`,
    onMount: (el) => el.addEventListener('click', (e) => {
      const mb = e.target.closest('[data-meal]');
      if (mb) { meal = mb.dataset.meal; $$('[data-meal]', el).forEach((b) => { b.classList.toggle('on', b === mb); b.setAttribute('aria-checked', b === mb); }); return; }
      const db = e.target.closest('[data-day]');
      if (db) { planAdd(db.dataset.day, r.id, meal); sheet.close(true); toast('Planned for ' + dayLabel(db.dataset.day, { weekday: 'long', month: 'short', day: 'numeric' }), { label: 'View plan', run: () => go('#/plan') }); }
    }) });
  }
  /** Pick other dishes to cook alongside this one. */
  function openCookWith(r) {
    const others = store.recipes.filter((x) => x.id !== r.id && x.steps.length);
    const sides = RK.suggestSides([r], store.recipes, 3).map((x) => x.id);
    others.sort((a, b) => (sides.includes(b.id) ? 1 : 0) - (sides.includes(a.id) ? 1 : 0) || a.title.localeCompare(b.title));
    sheet.open({ title: 'Cook together', body: `<p class="muted small">Pick the dishes to cook alongside <b>${esc(r.title)}</b>. You’ll get one cooking mode with a tab for each dish, and timers labeled by dish.</p>
      <ul class="pick-list checks">${others.map((x) => `<li><label class="check"><input type="checkbox" value="${esc(x.id)}"><span class="box">${icon('i-check')}</span><span><b>${esc(x.title)}</b>${sides.includes(x.id) ? ' <small class="pairs-tag">pairs well</small>' : ''}</span></label></li>`).join('')}</ul>
      <div class="sheet-foot"><button class="btn primary" data-go>${icon('i-play')} Start cooking</button></div>`,
    onMount: (el) => {
      el.addEventListener('change', (e) => { const c = e.target.closest('.check'); if (c) c.classList.toggle('on', e.target.checked); });
      $('[data-go]', el).addEventListener('click', () => {
        const ids = [r.id].concat($$('input:checked', el).map((c) => c.value));
        sheet.close(true); go('#/cook/' + ids.map(encodeURIComponent).join(','));
      });
    } });
  }

  // ======================================================================
  // Collections
  // ======================================================================
  const colRecipes = (c) => c.recipeIds.map((id) => store.byId(id)).filter(Boolean);
  function colTileHtml(c) {
    const rs = colRecipes(c);
    const imgs = rs.filter((r) => r.image).slice(0, 3);
    return `<a class="col-tile" href="#/c/${encodeURIComponent(c.id)}">
      <span class="col-art n${imgs.length}">${imgs.map((r) => `<img src="${esc(r.image)}" alt="" loading="lazy">`).join('') || icon('i-grid')}</span>
      <span class="col-body"><b>${esc(c.name)}</b><small>${rs.length} recipe${rs.length === 1 ? '' : 's'}</small></span></a>`;
  }
  function collectionsStripHtml() {
    const cs = store.book.collections;
    return `<section class="col-strip" aria-label="Collections">
      <div class="strip-head"><h2>Collections</h2><a class="linkish" href="#/collections">All collections</a></div>
      <div class="col-scroll">${cs.map(colTileHtml).join('')}<button class="col-tile new" data-act="col-new"><span class="col-art">${icon('i-plus')}</span><span class="col-body"><b>New collection</b><small>Group recipes for an occasion</small></span></button></div>
    </section>`;
  }
  function viewCollections(main) {
    main.innerHTML = `<section class="wrap collections">
      <header class="page-head"><div><p class="eyebrow">Collections</p><h1>Menus for every occasion</h1><p class="sub">Group recipes for a holiday, a dinner party or practice runs, with a timeline for the day itself.</p></div>
        <button class="btn primary" data-act="col-new">${icon('i-plus')} New collection</button></header>
      <div class="col-grid">${store.book.collections.map(colTileHtml).join('')}</div>
      ${store.book.collections.length ? '' : '<div class="empty"><p class="empty-title">No collections yet</p></div>'}
    </section>`;
  }
  function viewCollection(main, id) {
    const c = store.byCollection(id);
    if (!c) { main.innerHTML = `<section class="wrap narrow empty"><p class="empty-title">Collection not found</p><a class="btn" href="#/collections">All collections</a></section>`; return; }
    const rs = colRecipes(c);
    const cookable = rs.filter((r) => r.steps.length);
    main.innerHTML = `<section class="wrap collection">
      <nav class="crumbs"><a href="#/collections" class="back">${icon('i-back')} Collections</a></nav>
      <header class="page-head">
        <div><p class="eyebrow">Collection · ${rs.length} recipe${rs.length === 1 ? '' : 's'}</p><h1>${esc(c.name)}</h1>${c.description ? `<p class="sub">${inlineMd(c.description)}</p>` : ''}</div>
        <div class="row wrap-row">
          ${cookable.length > 1 ? `<a class="btn primary" href="#/cook/${cookable.slice(0, 6).map((r) => encodeURIComponent(r.id)).join(',')}">${icon('i-play')} Cook together</a>` : ''}
          ${cookable.length ? `<button class="btn" data-act="col-schedule" data-cid="${esc(c.id)}">${icon('i-clock')} Timing</button>` : ''}
          <button class="btn" data-act="col-groceries" data-cid="${esc(c.id)}" ${rs.length ? '' : 'disabled'}>${icon('i-bag')} Add all to groceries</button>
          <button class="btn" data-act="col-edit" data-cid="${esc(c.id)}">${icon('i-pencil')} Edit</button>
        </div>
      </header>
      <div class="col-layout ${c.timeline ? '' : 'no-tl'}">
        <div>${rs.length ? `<div class="grid">${rs.map((r) => cardHtml({ r })).join('')}</div>` : '<div class="empty"><p>No recipes yet. Open any recipe and choose <b>Add to collection</b> from the ⋯ menu.</p></div>'}
          ${menuDrinksHtml(rs)}</div>
        ${c.timeline ? `<aside class="panel timeline"><h2>Game plan</h2>${blockMd(c.timeline)}</aside>` : `<p class="muted small add-tl"><button class="linkish" data-act="col-edit" data-cid="${esc(c.id)}">Add a day-of timeline</button></p>`}
      </div>
    </section>`;
    hydratePhotos(main);
  }
  function menuDrinksHtml(rs) {
    const rows = rs.map((r) => ({ r, p: RK.pairDrink(r, store.recipes) })).filter((x) => x.p);
    if (!rows.length) return '';
    return `<section class="panel menu-drinks"><h2>The menu, with drinks</h2><ul>${rows.map(({ r, p }) => `<li><a href="#/r/${encodeURIComponent(r.id)}">${esc(r.title)}</a>
      <span><b>${esc(p.cocktail)}</b><small>${esc(p.wine)} · zero-proof: ${esc(p.zero)}${p.book.length ? ` · from your book: ${p.book.map((d) => `<a href="#/r/${encodeURIComponent(d.id)}">${esc(d.title)}</a>`).join(', ')}` : ''}</small></span></li>`).join('')}</ul></section>`;
  }
  function openCollectionEditor(c, presetIds) {
    const isNew = !c;
    c = c ? JSON.parse(JSON.stringify(c)) : { id: '', name: '', description: '', recipeIds: presetIds || [], timeline: '' };
    const rs = colRecipes(c);
    sheet.open({ title: isNew ? 'New collection' : 'Edit collection', wide: true, body: `
      <form class="col-form">
        <label class="field"><span>Name</span><input name="name" required value="${esc(c.name)}" placeholder="e.g. Sunday Supper" autofocus></label>
        <label class="field"><span>Description</span><textarea name="description" rows="2" placeholder="What it’s for">${esc(c.description)}</textarea></label>
        <label class="field"><span>Timeline <small>optional · “Day before:” lines start a section, “-” for each task</small></span>
          <textarea name="timeline" rows="7" placeholder="**Day before**&#10;- Make the dough&#10;&#10;**2 hours out**&#10;- Start the braise">${esc(c.timeline)}</textarea></label>
        ${rs.length ? `<div class="field"><span>Recipes <small>untick to remove</small></span><ul class="pick-list checks">${rs.map((r) => `<li><label class="check on"><input type="checkbox" checked value="${esc(r.id)}"><span class="box">${icon('i-check')}</span><span>${esc(r.title)}</span></label></li>`).join('')}</ul></div>` : ''}
        <div class="sheet-foot">${isNew ? '' : '<button type="button" class="btn ghost danger" data-del>Delete</button>'}<span></span><button class="btn primary" type="submit">${icon('i-check')} Save</button></div>
      </form>`,
    onMount: (el) => {
      const form = $('form', el);
      el.addEventListener('change', (e) => { const ch = e.target.closest('.check'); if (ch) ch.classList.toggle('on', e.target.checked); });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const name = String(fd.get('name') || '').trim();
        if (!name) return;
        const keep = new Set($$('.pick-list input:checked', el).map((x) => x.value));
        c.name = name; c.description = String(fd.get('description') || '').trim(); c.timeline = String(fd.get('timeline') || '').trim();
        if (rs.length) c.recipeIds = c.recipeIds.filter((id) => keep.has(id) || !store.byId(id));
        if (isNew) { let base = 'c-' + RB.slugify(name), id = base, n = 2; while (store.byCollection(id)) id = base + '-' + n++; c.id = id; }
        store.saveCollection(c); sheet.close(true);
        toast(isNew ? 'Collection created' : 'Collection saved');
        if (isNew && !presetIds) go('#/c/' + encodeURIComponent(c.id)); else render();
      });
      const del = $('[data-del]', el);
      if (del) del.addEventListener('click', async () => {
        if (!(await ask(`Delete the “${c.name}” collection? The recipes themselves stay in your book.`, { ok: 'Delete', danger: true }))) { openCollectionEditor(store.byCollection(c.id)); return; }
        store.removeCollection(c.id); toast('Collection deleted'); go('#/collections');
      });
    } });
  }
  function openAddToCollection(r) {
    const body = () => `<ul class="pick-list checks">${store.book.collections.map((c) => { const on = c.recipeIds.includes(r.id); return `<li><label class="check ${on ? 'on' : ''}"><input type="checkbox" value="${esc(c.id)}" ${on ? 'checked' : ''}><span class="box">${icon('i-check')}</span><span><b>${esc(c.name)}</b> <small class="muted">${colRecipes(c).length}</small></span></label></li>`; }).join('')}</ul>
      <form class="add-item new-col"><input placeholder="New collection name" aria-label="New collection name"><button class="btn" type="submit">${icon('i-plus')} Create</button></form>`;
    sheet.open({ title: 'Add to collection', body: body(), onMount: (el) => {
      el.addEventListener('change', (e) => {
        const inp = e.target; if (inp.type !== 'checkbox') return;
        const c = JSON.parse(JSON.stringify(store.byCollection(inp.value)));
        c.recipeIds = inp.checked ? c.recipeIds.concat(r.id) : c.recipeIds.filter((id) => id !== r.id);
        store.saveCollection(c); inp.closest('.check').classList.toggle('on', inp.checked);
        toast(inp.checked ? 'Added to ' + c.name : 'Removed from ' + c.name);
      });
      el.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = $('.new-col input', el).value.trim(); if (!name) return;
        let base = 'c-' + RB.slugify(name), id = base, n = 2; while (store.byCollection(id)) id = base + '-' + n++;
        store.saveCollection({ id, name, description: '', recipeIds: [r.id], timeline: '' });
        toast('Added to ' + name); $('.sheet-content', el).innerHTML = body();
      });
    } });
  }

  // ======================================================================
  // What can I make?
  // ======================================================================
  let pantryCommon = null;
  function viewPantry(main) {
    const have = LS.get(K.pantry, []);
    if (!pantryCommon) {
      const freq = new Map();
      store.recipes.forEach((r) => RK.recipeNeeds(r, staplesList()).forEach((raw, name) => { if (name.length < 26) freq.set(name, (freq.get(name) || 0) + 1); }));
      pantryCommon = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).map(([n]) => n);
    }
    const quick = pantryCommon.filter((n) => !have.some((h) => RK.normalizeName(h) === n)).slice(0, 18);
    const results = RK.whatCanIMake(have, store.recipes, staplesList()).slice(0, 30);
    main.innerHTML = `<section class="wrap pantry">
      <header class="page-head"><div><p class="eyebrow">What can I make?</p><h1>Cook from what you have</h1>
        <p class="sub">Add what’s in your fridge and pantry. Recipes are ranked by how little you’d need to buy. Staples like ${esc(staplesList().slice(0, 4).join(', '))} are assumed.</p></div>
        <label class="btn">${icon('i-camera')} Snap your fridge<input type="file" accept="image/*" multiple data-act="pantry-photo" hidden></label></header>
      <p class="status" id="pantry-status" hidden></p>
      <form class="add-item" data-form="pantry">
        <div class="with-mic"><input id="pantry-new" list="pantry-list" placeholder="chicken, rice, limes…" enterkeyhint="done" aria-label="Add an ingredient you have" autocomplete="off">${voice.supported ? `<button type="button" class="icon-btn mic" data-act="dictate" data-target="pantry-new" data-mode="text" aria-label="Dictate">${icon('i-mic')}</button>` : ''}</div>
        <datalist id="pantry-list">${pantryCommon.slice(0, 300).map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <button class="btn primary" type="submit">${icon('i-plus')} Add</button>
      </form>
      ${have.length ? `<div class="have"><span class="eyebrow">You have</span>${have.map((h) => `<button class="tag on" data-act="pantry-rm" data-v="${esc(h)}">${esc(h)} ${icon('i-x')}</button>`).join('')}<button class="linkish" data-act="pantry-clear">Clear</button></div>` : ''}
      <div class="have quick"><span class="eyebrow">Common</span>${quick.map((n) => `<button class="tag" data-act="pantry-add" data-v="${esc(n)}">+ ${esc(n)}</button>`).join('')}</div>
      ${leftoversHtml(have)}
      ${have.length ? '<h2 class="can-head">From what you have</h2>' : ''}
      ${have.length ? (results.length ? `<ol class="can-make">${results.map((x) => {
        const pct = Math.round((x.have.length / x.total) * 100);
        return `<li class="can-row" style="--cat:var(--c-${catKey(x.recipe.category)})">
          <a class="can-main" href="#/r/${encodeURIComponent(x.recipe.id)}"><span class="can-art">${coverImg(x.recipe, store.meta(x.recipe.id)) || icon('c-' + catKey(x.recipe.category))}</span>
            <span class="can-txt"><b>${esc(x.recipe.title)}</b>
            <span class="can-meter"><i style="width:${pct}%"></i></span>
            <small>${x.missing.length ? `Need ${x.missing.length}: ${esc(x.missing.slice(0, 6).join(', '))}${x.missing.length > 6 ? '…' : ''}` : 'You have everything!'}</small></span></a>
          ${x.missing.length ? `<button class="btn small ghost" data-act="pantry-missing" data-id="${esc(x.recipe.id)}">${icon('i-bag')} Add ${x.missing.length} to list</button>` : `<span class="pill">${icon('i-check')} Ready</span>`}
        </li>`; }).join('')}</ol>` : '<div class="empty"><p class="empty-title">No matches yet</p><p>Add a few more ingredients.</p></div>')
      : '<div class="empty"><p>Start by adding a few ingredients, or tap the common ones above.</p></div>'}
    </section>`;
    hydratePhotos(main);
  }
  function leftoversHtml(have) {
    const los = leftovers.list().slice().sort((a, b) => leftovers.daysLeft(a) - leftovers.daysLeft(b));
    const ideas = leftoverIdeas(have);
    return `<section class="leftovers">
      <div class="lo-head"><h2>Leftovers to use up</h2><p class="muted small">Log what’s left and how long it keeps. Recipes that use the most urgent things come first.</p></div>
      <form class="add-item" data-form="leftover"><input id="lo-new" placeholder="2 cups birria broth, half a bunch of cilantro…" aria-label="Leftover" autocomplete="off">
        <select id="lo-days" aria-label="Use within"><option value="0">Use today</option><option value="1">Tomorrow</option><option value="2">2 days</option><option value="3" selected>3 days</option><option value="5">5 days</option><option value="7">A week</option></select>
        <button class="btn" type="submit">${icon('i-plus')} Add</button></form>
      ${los.length ? `<ul class="lo-list">${los.map((x) => { const n = leftovers.daysLeft(x); return `<li class="${n < 0 ? 'past' : n <= 1 ? 'urgent' : ''}"><span>${esc(x.text)}</span><small>${leftovers.label(x)}</small><button class="icon-btn" data-act="lo-rm" data-id="${esc(x.id)}" aria-label="Used it">${icon('i-check')}</button></li>`; }).join('')}</ul>` : ''}
      ${ideas.length ? `<ol class="can-make">${ideas.map((x) => `<li class="can-row" style="--cat:var(--c-${catKey(x.recipe.category)})">
          <a class="can-main" href="#/r/${encodeURIComponent(x.recipe.id)}"><span class="can-art">${coverImg(x.recipe, store.meta(x.recipe.id)) || icon('c-' + catKey(x.recipe.category))}</span>
          <span class="can-txt"><b>${esc(x.recipe.title)}</b><small>Uses ${x.uses.map((u) => `<span class="${leftovers.daysLeft(u) <= 1 ? 'urgent-txt' : ''}">${esc(u.text)}</span>`).join(', ')}${x.missing.length ? ` · need ${x.missing.length} more` : ' · you have the rest'}</small></span></a></li>`).join('')}</ol>` : los.length ? '<p class="muted small">No recipes in your book use these yet.</p>' : ''}
    </section>`;
  }
  async function pantryPhoto(files) {
    const st = $('#pantry-status'); if (!st) return;
    st.hidden = false; st.className = 'status'; st.innerHTML = `${icon('i-sparkle')} Claude is looking at your photo…`;
    await ai.init();
    if (!(await ai.imagesOk())) { st.className = 'status error'; st.innerHTML = 'Reading photos needs Claude. Add an Anthropic API key in <a href="#/settings">Settings</a>, or open the book in the Claude app.'; return; }
    try {
      const imgs = await Promise.all(files.map((f) => resizeImage(f, 1568, 0.85)));
      const text = await ai.ask('List the food ingredients you can clearly identify in this photo of a fridge, pantry or counter. Reply with ONLY a JSON array of short, lowercase, generic ingredient names, like ["eggs","whole milk","scallions","cheddar"]. No brands, no quantities, no non-food items.', { images: imgs });
      const list = parseJsonLoose(text);
      if (!Array.isArray(list) || !list.length) throw new Error('Couldn’t make out any ingredients. Try a brighter, closer photo.');
      const clean = list.map((x) => String(x).toLowerCase().trim()).filter((x) => x && x.length < 40);
      const before = LS.get(K.pantry, []);
      pantrySet(before.concat(clean));
      toast(`Added ${clean.filter((x) => !before.includes(x)).length} ingredients from your photo`);
    } catch (e) { st.className = 'status error'; st.textContent = e.message === 'NO_KEY' ? 'Add an Anthropic API key in Settings to read photos.' : e.message; }
  }
  function pantrySet(list) { LS.set(K.pantry, Array.from(new Set(list.map((x) => x.trim()).filter(Boolean)))); viewPantry($('#main')); }

  // ======================================================================
  // Claude: Ask Claude + photo-to-recipe. Uses the Claude app when available, else your API key.
  // ======================================================================
  const ai = {
    sample: null, ready: null,
    init() {
      if (!this.ready) {
        this.ready = (async () => {
          try { if (window.claude && typeof window.claude.use === 'function') this.sample = await window.claude.use('sample'); } catch (e) { this.sample = null; }
          return this.sample;
        })();
      }
      return this.ready;
    },
    available() { return !!(this.sample || settings.claudeKey); },
    async imagesOk() {
      if (this.sample) { try { const l = await this.sample.limits(); if (l && l.images) return true; } catch (e) { /* */ } }
      return !!settings.claudeKey;
    },
    async ask(prompt, opts) {
      opts = opts || {};
      if (this.sample && (!opts.images || await this.imagesOk())) {
        try {
          const res = await this.sample(prompt, { onText: opts.onText ? ({ text }) => opts.onText(text) : undefined, signal: opts.signal, images: opts.images, cache: false });
          return res.text;
        } catch (e) {
          if (e && e.name === 'AbortError') throw e;
          if (e && e.code === 'not_granted') { this.sample = null; if (!settings.claudeKey) throw new Error('Claude access wasn’t allowed for this page.'); }
          else if (e && e.code === 'rate_limited') throw new Error('Claude is busy. Try again in a minute.');
          else throw new Error((e && e.message) || 'Claude is unavailable right now.');
        }
      }
      if (!settings.claudeKey) throw new Error('NO_KEY');
      return this.api(prompt, opts);
    },
    async api(prompt, opts) {
      const content = [];
      for (const b of opts.images || []) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await blobToBase64(await resizeImage(b, 1568, 0.85)) } });
      content.push({ type: 'text', text: prompt });
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: opts.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': settings.claudeKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: 'claude-opus-5-5', max_tokens: 8000, thinking: { type: 'adaptive' }, stream: true, messages: [{ role: 'user', content }] }),
      });
      if (!res.ok) {
        let msg = 'Claude API error ' + res.status;
        try { const j = await res.json(); msg = (j.error && j.error.message) || msg; } catch (e) { /* */ }
        throw new Error(res.status === 401 ? 'Your API key was rejected. Check it in Settings.' : msg);
      }
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '', text = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          let ev; try { ev = JSON.parse(line.slice(5)); } catch (e) { continue; }
          if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') { text += ev.delta.text; if (opts.onText) opts.onText(text); }
          else if (ev.type === 'error') throw new Error((ev.error && ev.error.message) || 'Claude stopped unexpectedly');
        }
      }
      return text;
    },
  };
  const aiSetupHtml = () => `<div class="ai-setup">${icon('i-sparkle')}<p>To ask Claude from your own site, add an Anthropic API key in <a href="#/settings">Settings</a>. It stays on this device. Inside the Claude app this works with no setup.</p></div>`;
  const ASK_CHIPS = ['What can I substitute if I’m missing something?', 'Scale this for 8 people', 'Make it dairy-free', 'How far ahead can I make it?', 'What should I serve with it?', 'How do I take this to restaurant level?'];
  async function openAsk(r, preset) {
    await ai.init();
    let ctl = null, lastQ = '', lastA = '';
    sheet.open({ title: 'Ask Claude', wide: true, cls: 'ask-claude', body: `
      <p class="muted small">About <b>${esc(r.title)}</b>. Claude sees the full recipe and your notes.</p>
      ${ai.available() ? '' : aiSetupHtml()}
      <div class="ask-chips">${ASK_CHIPS.map((q) => `<button class="tag" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <form class="ask-form"><textarea rows="2" placeholder="Ask anything: swaps, timing, fixing a mistake…" aria-label="Your question" autofocus></textarea><button class="btn primary" type="submit">${icon('i-sparkle')} Ask</button></form>
      <div class="ask-answer" aria-live="polite" hidden></div>
      <div class="row end ask-after" hidden><button class="btn small ghost" data-copy>${icon('i-copy')} Copy</button><button class="btn small" data-save>${icon('i-pencil')} Save to my notes</button></div>`,
    onClose: () => { if (ctl) ctl.abort(); },
    onMount: (el) => {
      const ta = $('textarea', el), out = $('.ask-answer', el), after = $('.ask-after', el), btn = $('.ask-form button', el);
      const run = async (q) => {
        if (!q.trim()) return;
        if (ctl) ctl.abort();
        ctl = new AbortController();
        lastQ = q; lastA = '';
        out.hidden = false; after.hidden = true; out.innerHTML = '<p class="muted thinking">Thinking…</p>'; btn.disabled = true;
        const m = store.meta(r.id);
        const prompt = `You are a warm, precise professional chef helping a home cook with one recipe from their personal recipe book.
Answer the question below about this recipe. Be concise: under about 180 words unless they ask for a full rewritten ingredient list or method. Use short markdown: a sentence or two, then bullet points with **bold** key amounts or times. Use ${settings.units === 'metric' ? 'metric units and °C' : settings.units === 'us' ? 'US units and °F' : 'the same units the recipe uses'}. If the question isn't about cooking, steer back to the recipe.

RECIPE
${RB.toMarkdown(r)}
${m.notes ? '\nTHEIR NOTES\n' + m.notes + '\n' : ''}
QUESTION
${q}`;
        try {
          lastA = await ai.ask(prompt, { signal: ctl.signal, onText: (t) => { out.innerHTML = blockMd(t); } });
          out.innerHTML = blockMd(lastA) || '<p class="muted">No answer came back.</p>';
          after.hidden = !lastA;
        } catch (e) {
          if (e && e.name === 'AbortError') return;
          out.innerHTML = e.message === 'NO_KEY' ? aiSetupHtml() : `<p class="error-text">${esc(e.message || 'Something went wrong')}</p>`;
        } finally { btn.disabled = false; }
      };
      $('.ask-form', el).addEventListener('submit', (e) => { e.preventDefault(); run(ta.value); });
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(ta.value); } });
      $$('[data-q]', el).forEach((b) => b.addEventListener('click', () => { ta.value = b.dataset.q; run(b.dataset.q); }));
      if (preset && ai.available()) { ta.value = preset; run(preset); }
      $('[data-copy]', el).addEventListener('click', () => copyText(lastA, 'Answer copied'));
      $('[data-save]', el).addEventListener('click', () => {
        const m = store.meta(r.id);
        const add = `Asked Claude: ${lastQ}\n${RB.stripMd(lastA).replace(/\n{3,}/g, '\n\n')}`;
        store.setMeta(r.id, { notes: (m.notes ? m.notes.replace(/\s+$/, '') + '\n\n' : '') + add });
        toast('Saved to your notes'); const n = $('#my-notes'); if (n) n.value = store.meta(r.id).notes;
        $('[data-save]', el).disabled = true;
      });
    } });
  }
  async function photoToRecipe(files) {
    const main = $('#main');
    await ai.init();
    const imgs = await Promise.all(files.map((f) => resizeImage(f, 1568, 0.85)));
    const thumbs = imgs.map((b) => URL.createObjectURL(b));
    main.innerHTML = `<section class="wrap narrow photo-import">
      <nav class="crumbs"><a href="#/add" class="back">${icon('i-back')} Add a recipe</a></nav>
      <h1>Reading your photo${files.length > 1 ? 's' : ''}</h1>
      <div class="photo-thumbs">${thumbs.map((u) => `<img src="${u}" alt="">`).join('')}</div>
      <p class="status" id="photo-status">${icon('i-sparkle')} Claude is transcribing the recipe…</p>
      <pre class="photo-stream" id="photo-stream"></pre>
    </section>`;
    const st = $('#photo-status'), stream = $('#photo-stream');
    if (!(await ai.imagesOk())) {
      st.className = 'status error';
      st.innerHTML = ai.sample ? 'Photo reading isn’t available in this view. Open your book on your site with an API key, or paste the recipe text instead.' : 'Photo reading needs Claude. Add an Anthropic API key in <a href="#/settings">Settings</a>, or open the book in the Claude app.';
      return;
    }
    const prompt = `Transcribe the recipe in ${files.length > 1 ? 'these photos (they may be pages of one recipe)' : 'this photo'} for my recipe book. Keep the original quantities, wording and order; fix obvious typos. Leave out sections the photo doesn't have. If it contains several recipes, give each its own "## " section.

${CLAUDE_PROMPT}`;
    try {
      const text = await ai.ask(prompt, { images: imgs, onText: (t) => { stream.textContent = t; stream.scrollTop = stream.scrollHeight; } });
      const list = RB.parseText(text).filter((r) => r.ingredients.length || r.steps.length);
      if (!list.length) throw new Error('Couldn’t find a recipe in that photo. Try a sharper, closer shot.');
      st.innerHTML = `${icon('i-check')} Got it`;
      handleParsed(list);
    } catch (e) {
      st.className = 'status error';
      st.innerHTML = e.message === 'NO_KEY' ? 'Photo reading needs Claude. Add an Anthropic API key in <a href="#/settings">Settings</a>.' : esc(e.message || 'Something went wrong');
    }
  }

  // ======================================================================
  // Share a recipe: card image, clean text or a standalone web page
  // ======================================================================
  function shareText(r) {
    const f = getScale(r.id);
    const lines = [r.title.toUpperCase()];
    if (r.description) lines.push(RB.stripMd(r.description));
    const facts = [r.time, r.yield].filter(Boolean).join(' · ');
    if (facts) lines.push(facts);
    if (r.ingredients.length) {
      lines.push('', 'INGREDIENTS');
      r.ingredients.forEach((g) => { if (g.name) lines.push(g.name + ':'); g.items.forEach((it) => lines.push('• ' + RB.stripMd(ingText(it, f)))); });
    }
    if (r.steps.length) {
      lines.push('', 'METHOD'); let n = 0;
      r.steps.forEach((g) => { if (g.name) lines.push(g.name + ':'); g.items.forEach((s) => lines.push(++n + '. ' + RB.stripMd(stepText(s)))); });
    }
    if (r.notes.length) { lines.push('', 'NOTES'); r.notes.forEach((x) => lines.push('• ' + RB.stripMd(x))); }
    if (r.sources.length) lines.push('', 'Source: ' + r.sources.map((x) => x.url).join(' '));
    lines.push('', '— from Waynesdays Recipe Book');
    return lines.join('\n');
  }
  function recipePage(r) {
    const abs = (u) => { try { return new URL(u, location.href).href; } catch (e) { return u; } };
    const ld = { '@context': 'https://schema.org', '@type': 'Recipe', name: r.title, description: RB.stripMd(r.description || ''), recipeCategory: r.category, keywords: r.tags.join(', '),
      recipeYield: r.yield || undefined, image: r.image && !/^data:/.test(r.image) ? abs(r.image) : undefined,
      recipeIngredient: r.ingredients.flatMap((g) => g.items.map((x) => RB.stripMd(x))),
      recipeInstructions: r.steps.map((g) => (g.name ? { '@type': 'HowToSection', name: g.name, itemListElement: g.items.map((t) => ({ '@type': 'HowToStep', text: RB.stripMd(t) })) } : g.items.map((t) => ({ '@type': 'HowToStep', text: RB.stripMd(t) })))).flat() };
    const md = RB.toMarkdown(r).replace(/<\/script/gi, '<\\/script');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(r.title)}</title>
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<script type="text/markdown" id="wrb-recipe">${md}</script>
<style>
:root{--bg:#f8f7f4;--ink:#15140f;--ink2:#4f4c45;--ink3:#8b877d;--line:#e3e0d8;--accent:#94713f}
@media (prefers-color-scheme:dark){:root{--bg:#0e0d0b;--ink:#f1ede4;--ink2:#bdb7aa;--ink3:#7f796e;--line:#2a2822;--accent:#c9a66b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:300 17px/1.65 'Jost','Avenir Next',system-ui,sans-serif}
article{max-width:760px;margin:0 auto;padding:48px 20px 64px}img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:6px;margin-bottom:28px}
.eyebrow{font:500 .7rem/1.4 system-ui,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:var(--accent)}
h1,h2,h3{font-family:'Bodoni Moda','Didot',Georgia,serif;font-weight:500;line-height:1.1;margin:.2em 0}h1{font-size:clamp(2.2rem,6vw,3.4rem)}
h2{font-style:italic;font-weight:400;font-size:1.7rem;border-bottom:1px solid var(--ink);padding-bottom:10px;margin-top:40px}h3{font-size:1.1rem;margin-top:20px}
.lede{color:var(--ink2);font-size:1.1rem}.facts{color:var(--ink3);font-size:.85rem;letter-spacing:.14em;text-transform:uppercase}
ul,ol{padding-left:1.2em}li{margin:.45em 0}ul li::marker{color:var(--accent)}ol li::marker{font-family:Georgia,serif;color:var(--accent)}
footer{border-top:1px solid var(--line);margin-top:48px;padding-top:16px;color:var(--ink3);font-size:.8rem;letter-spacing:.14em;text-transform:uppercase}
a{color:inherit}
</style></head><body><article>
${r.image && !/^data:/.test(r.image) ? `<img src="${esc(abs(r.image))}" alt="">` : ''}
<p class="eyebrow">${esc(r.category || 'Recipe')}</p>
<h1>${esc(r.title)}</h1>
${r.description ? `<p class="lede">${inlineMd(r.description)}</p>` : ''}
${r.time || r.yield ? `<p class="facts">${[r.time, r.yield].filter(Boolean).map(esc).join(' · ')}</p>` : ''}
${r.ingredients.length ? `<h2>Ingredients</h2>${r.ingredients.map((g) => `${g.name ? `<h3>${esc(g.name)}</h3>` : ''}<ul>${g.items.map((it) => `<li>${inlineMd(it)}</li>`).join('')}</ul>`).join('')}` : ''}
${r.steps.length ? `<h2>Method</h2>${r.steps.map((g) => `${g.name ? `<h3>${esc(g.name)}</h3>` : ''}<ol>${g.items.map((it) => `<li>${inlineMd(it)}</li>`).join('')}</ol>`).join('')}` : ''}
${r.notes.length ? `<h2>Notes</h2><ul>${r.notes.map((n) => `<li>${inlineMd(n)}</li>`).join('')}</ul>` : ''}
${r.extras.map((e) => `<h2>${esc(e.title)}</h2>${blockMd(e.body)}`).join('')}
${r.sources.length ? `<p class="facts">Source: ${r.sources.map((x) => `<a href="${esc(x.url)}">${esc(x.label || RB.hostLabel(x.url))}</a>`).join(' · ')}</p>` : ''}
<footer>Waynesdays Recipe Book · import this file into the app to save it</footer>
</article></body></html>
`;
  }
  async function cardImage(r) {
    const W = 1080, H = 1350, P = 84;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) { /* */ }
    const serif = '"Bodoni Moda", Didot, "Bodoni 72", Georgia, serif', sans = 'Jost, "Avenir Next", system-ui, sans-serif';
    x.fillStyle = '#f8f7f4'; x.fillRect(0, 0, W, H);
    // photo: your cover, else the recipe photo if it's on this site (other sites' images can't be drawn)
    let img = null;
    const m = store.meta(r.id);
    const load = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
    if (m.cover) { const u = await photos.url(m.cover, 'full'); if (u) img = await load(u); }
    if (!img && r.image) { try { if (new URL(r.image, location.href).origin === location.origin) img = await load(r.image); } catch (e) { /* */ } }
    let y;
    if (img) {
      const ih = 600, k = Math.max(W / img.width, ih / img.height), dw = img.width * k, dh = img.height * k;
      x.save(); x.beginPath(); x.rect(0, 0, W, ih); x.clip(); x.drawImage(img, (W - dw) / 2, (ih - dh) / 2, dw, dh); x.restore();
      y = ih + 78;
    } else {
      x.fillStyle = '#15140f'; x.fillRect(0, 0, W, 16); y = 150;
    }
    const wrap = (text, font, maxW, maxLines) => {
      x.font = font; const words = String(text).split(/\s+/); const lines = []; let cur = '';
      words.forEach((w) => { const t = cur ? cur + ' ' + w : w; if (x.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; });
      if (cur) lines.push(cur);
      if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…'; }
      return lines;
    };
    x.fillStyle = '#94713f'; x.font = `500 24px ${sans}`;
    if ('letterSpacing' in x) x.letterSpacing = '6px';
    x.fillText(String(r.category || 'Recipe').toUpperCase(), P, y);
    if ('letterSpacing' in x) x.letterSpacing = '0px';
    y += 26;
    x.fillStyle = '#15140f';
    const tl = wrap(r.title, `500 ${img ? 62 : 82}px ${serif}`, W - P * 2, img ? 2 : 3);
    tl.forEach((ln) => { y += img ? 70 : 92; x.fillText(ln, P, y); });
    const facts = [r.time && r.time.replace(/\s*\(.*\)$/, ''), r.yield, m.rating ? '★'.repeat(m.rating) : ''].filter(Boolean).join('   ·   ');
    if (facts) { y += 52; x.fillStyle = '#4f4c45'; x.font = `400 26px ${sans}`; x.fillText(facts, P, y); }
    y += 40; x.fillStyle = '#15140f'; x.fillRect(P, y, W - P * 2, 2); y += 52;
    // ingredients in two columns
    const items = r.ingredients.flatMap((g) => g.items.map((it) => RB.stripMd(ingText(it, getScale(r.id)))));
    x.font = `400 25px ${sans}`;
    const colW = (W - P * 2 - 48) / 2, lineH = 36, bottom = H - 120;
    const rows = Math.max(1, Math.floor((bottom - y) / lineH));
    let col = 0, row = 0, shown = 0;
    for (const it of items) {
      const lines = wrap(it, `400 25px ${sans}`, colW - 26, 2);
      if (row + lines.length > rows) { if (col === 1) break; col = 1; row = 0; }
      const cx = P + col * (colW + 48);
      x.fillStyle = '#94713f'; x.beginPath(); x.arc(cx + 5, y + row * lineH - 8, 4, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#2b2924'; lines.forEach((ln, k) => x.fillText(ln, cx + 22, y + (row + k) * lineH));
      row += lines.length; shown++;
    }
    if (shown < items.length) { x.fillStyle = '#8b877d'; x.font = `italic 400 24px ${serif}`; x.fillText(`+ ${items.length - shown} more ingredients`, P + (col ? colW + 48 : 0) + 22, Math.min(bottom, y + row * lineH)); }
    x.fillStyle = '#94713f'; x.font = `500 20px ${sans}`;
    if ('letterSpacing' in x) x.letterSpacing = '5px';
    x.fillText('WAYNESDAYS RECIPE BOOK', P, H - 64);
    return new Promise((res) => c.toBlob(res, 'image/png'));
  }
  function openShare(r) {
    const slug = RB.slugify(r.title) || 'recipe';
    const isWeb = /^https?:/.test(location.protocol) && !/localhost|127\.0\.0\.1/.test(location.hostname) && !window.claude;
    sheet.open({ title: 'Share recipe', body: `
      <div class="share-grid">
        <button class="share-opt" data-s="card">${icon('i-image')}<b>Recipe card</b><span>A photo-ready image for messages and stories</span></button>
        <button class="share-opt" data-s="text">${icon('i-chat')}<b>Text</b><span>Clean, formatted text for any app</span></button>
        <button class="share-opt" data-s="html">${icon('i-file')}<b>Web page</b><span>A single .html file anyone can open, and import back into this app</span></button>
        <button class="share-opt" data-s="copy">${icon('i-copy')}<b>Copy</b><span>Copy the text to your clipboard</span></button>
        ${isWeb ? `<button class="share-opt" data-s="link">${icon('i-link')}<b>Link</b><span>A link to this recipe in your book</span></button>` : ''}
      </div>
      <div class="share-preview" hidden></div>`,
    onMount: (el) => el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-s]'); if (!b) return;
      const kind = b.dataset.s;
      if (kind === 'text') {
        const t = shareText(r);
        if (navigator.share) { try { await navigator.share({ title: r.title, text: t }); return; } catch (err) { if (err && err.name === 'AbortError') return; } }
        copyText(t, 'Recipe copied as text');
      } else if (kind === 'copy') copyText(shareText(r), 'Recipe copied');
      else if (kind === 'link') copyText(location.origin + location.pathname + '#/r/' + encodeURIComponent(r.id), 'Link copied');
      else if (kind === 'html') { await saveFile(new Blob([recipePage(r)], { type: 'text/html' }), slug + '.html', { share: true, title: r.title }); }
      else if (kind === 'card') {
        b.disabled = true;
        try {
          const blob = await cardImage(r);
          const pv = $('.share-preview', el);
          pv.hidden = false; pv.innerHTML = `<img src="${URL.createObjectURL(blob)}" alt="Recipe card preview"><button class="btn primary" data-save-card>${icon('i-download')} Save image</button>`;
          $('[data-save-card]', pv).addEventListener('click', () => saveFile(blob, slug + '.png', { share: true, title: r.title }));
        } catch (err) { toast('Couldn’t draw the card'); } finally { b.disabled = false; }
      }
    }) });
  }

  // ======================================================================
  // Your own techniques
  // ======================================================================
  function openTipEditor(t) {
    const isNew = !t;
    t = t ? JSON.parse(JSON.stringify(t)) : { id: '', cat: tipsUi.cat && tipsUi.cat !== 'mine' ? tipsUi.cat : 'workflow', level: 'Foundation', title: '', rule: '', why: '', how: [], pro: '', useIn: [], words: '' };
    sheet.open({ title: isNew ? 'Add your own technique' : 'Edit technique', wide: true, body: `
      <form class="tip-form">
        <label class="field"><span>Title</span><input name="title" required value="${esc(t.title)}" placeholder="e.g. Bloom the curry powder in oil" autofocus></label>
        <div class="field-row two">
          <label class="field"><span>Section</span><select name="cat">${TIPS.categories.map((c) => `<option value="${c.id}" ${t.cat === c.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>
          <label class="field"><span>Level</span><select name="level">${['Foundation', 'Pro', 'Michelin'].map((l) => `<option ${t.level === l ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>The rule <small>one line</small></span><input name="rule" value="${esc(t.rule)}" placeholder="Fry it in hot oil for 30 seconds before adding liquid."></label>
        <label class="field"><span>Why it works</span><textarea name="why" rows="2">${esc(t.why)}</textarea></label>
        <label class="field"><span>How <small>one step per line</small></span><textarea name="how" rows="4">${esc((t.how || []).join('\n'))}</textarea></label>
        <label class="field"><span>Chef’s move <small>optional</small></span><input name="pro" value="${esc(t.pro)}"></label>
        <label class="field"><span>Show on recipes that mention <small>comma-separated words</small></span><input name="words" value="${esc(t.words || '')}" placeholder="curry powder, curry"></label>
        <div class="sheet-foot">${isNew ? '' : '<button type="button" class="btn ghost danger" data-del>Delete</button>'}<span></span><button class="btn primary" type="submit">${icon('i-check')} Save</button></div>
      </form>`,
    onMount: (el) => {
      const form = $('form', el);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const title = String(fd.get('title') || '').trim(); if (!title) return;
        const words = String(fd.get('words') || '').split(',').map((w) => w.trim()).filter(Boolean);
        Object.assign(t, { title, cat: fd.get('cat'), level: fd.get('level'), rule: String(fd.get('rule') || '').trim(), why: String(fd.get('why') || '').trim(),
          how: String(fd.get('how') || '').split('\n').map((x) => x.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean), pro: String(fd.get('pro') || '').trim(),
          words: words.join(', '), match: words.length ? '\\b(' + words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')' : '' });
        if (isNew) { let base = 'my-' + RB.slugify(title), id = base, n = 2; while (allTips().some((x) => x.id === id)) id = base + '-' + n++; t.id = id; }
        delete t.custom;
        store.saveTip(t); sheet.close(true); toast(isNew ? 'Technique added to your notebook' : 'Technique saved');
        tipsUi.q = ''; if (route.name === 'tips') { viewTips($('#main')); setTimeout(() => { const card = document.getElementById('tip-' + t.id); if (card) { card.open = true; card.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }, 60); }
      });
      const del = $('[data-del]', el);
      if (del) del.addEventListener('click', async () => {
        if (!(await ask(`Delete “${t.title}”?`, { ok: 'Delete', danger: true }))) return;
        store.removeTip(t.id); toast('Technique deleted'); if (route.name === 'tips') viewTips($('#main'));
      });
    } });
  }
  function openPhoto(id) {
    sheet.open({ title: 'Photo', wide: true, cls: 'photo-sheet', body: `<img data-photo="${esc(id)}" data-size="full" alt="">`, onMount: (el) => hydratePhotos(el) });
  }
  async function addPhotos(rid, files) {
    const r = store.byId(rid); if (!r || !files.length) return;
    toast('Saving photo…');
    try {
      const ids = [];
      for (const f of files) ids.push(await photos.put(f));
      const m = store.meta(rid);
      const patch = { photos: (m.photos || []).concat(ids) };
      if (!m.cover && !r.image) patch.cover = ids[0];
      store.setMeta(rid, patch);
      toast(ids.length > 1 ? `${ids.length} photos added` : 'Photo added', !patch.cover ? { label: 'Make cover', run: () => { store.setMeta(rid, { cover: ids[0] }); if (route.name === 'recipe') viewRecipe($('#main'), rid); } } : null);
      if (cook.state) cook.renderStage(0); else if (route.name === 'recipe') viewRecipe($('#main'), rid);
    } catch (e) { toast('Couldn’t save that photo on this device'); }
  }

  // ======================================================================
  // Taste notes, practice log, plating, drink pairing, family story
  // ======================================================================
  const hasStory = (m) => !!(m.story && (m.story.text || m.story.audio));
  /** Pull the first JSON object or array out of a model reply. */
  function parseJsonLoose(text) {
    const t = String(text || '').replace(/```(?:json)?/g, '');
    const i = t.search(/[[{]/); if (i < 0) return null;
    const close = t[i] === '[' ? ']' : '}';
    const j = t.lastIndexOf(close); if (j < i) return null;
    try { return JSON.parse(t.slice(i, j + 1)); } catch (e) { return null; }
  }
  function tasteSummary(t) {
    const w = { salt: ['less salt', 'more salt'], acid: ['less acid', 'more acid'], heat: ['milder', 'hotter'], done: ['cook it shorter', 'cook it longer'] };
    const parts = Object.keys(w).filter((k) => t[k] === -1 || t[k] === 1).map((k) => w[k][t[k] === 1 ? 1 : 0]);
    const perfect = Object.keys(w).filter((k) => t[k] === 0).length;
    if (!parts.length && perfect) parts.push('nailed it');
    return parts;
  }
  function lastTimeHtml(r, m) {
    const t = (m.taste || [])[(m.taste || []).length - 1];
    const runs = m.runs || [];
    if (!t && !runs.length) return '';
    const best = runs.reduce((a, x) => (a == null || x.total < a ? x.total : a), null);
    const parts = t ? tasteSummary(t) : [];
    return `<div class="last-time">${icon('i-flame')}<div>
      ${t ? `<p><b>Last time</b> <small>${esc(fmtDate(t.at, { month: 'short', day: 'numeric' }))}</small>${parts.length ? ' · ' + parts.map(esc).join(' · ') : ''}${t.note ? ` — <em>“${esc(t.note)}”</em>` : ''}</p>` : ''}
      ${runs.length ? `<p class="muted small">${runs.length} practice run${runs.length === 1 ? '' : 's'} · best ${RB.fmtDuration(best)} · last ${RB.fmtDuration(runs[runs.length - 1].total)}</p>` : ''}
    </div></div>`;
  }
  function practiceLogHtml(r, m) {
    const runs = m.runs || [];
    if (!runs.length) return '';
    const best = Math.min(...runs.map((x) => x.total));
    const max = Math.max(...runs.map((x) => x.total));
    const avg = (k) => { const v = runs.filter((x) => x.scores && x.scores[k]).map((x) => x.scores[k]); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '–'; };
    // average seconds per step across runs → the steps that eat the clock
    const per = {};
    runs.forEach((x) => (x.steps || []).forEach((st) => { (per[st.n] = per[st.n] || []).push(st.secs); }));
    const flat = r.steps.flatMap((g) => g.items);
    const slow = Object.entries(per).map(([n, v]) => ({ n: +n, secs: v.reduce((a, b) => a + b, 0) / v.length })).sort((a, b) => b.secs - a.secs).slice(0, 3);
    const recent = runs.slice(-10);
    return `<section class="panel practice-log no-print">
      <div class="panel-head"><h2>Practice log</h2><button class="btn small ghost" data-act="cook-practice-start">${icon('i-stopwatch')} New timed run</button></div>
      <div class="pl-stats"><div><b>${RB.fmtDuration(best)}</b><span>Best</span></div><div><b>${RB.fmtDuration(runs[runs.length - 1].total)}</b><span>Last</span></div><div><b>${avg('taste')}</b><span>Taste</span></div><div><b>${avg('plating')}</b><span>Plating</span></div><div><b>${avg('timing')}</b><span>Timing</span></div></div>
      <div class="pl-bars" aria-label="Run times">${recent.map((x) => `<div class="pl-bar ${x.total === best ? 'best' : ''}" title="${esc(fmtDate(x.at))}: ${RB.fmtDuration(x.total)}"><i style="height:${Math.max(8, Math.round((x.total / max) * 100))}%"></i><small>${esc(fmtDate(x.at, { month: 'numeric', day: 'numeric' }))}</small></div>`).join('')}</div>
      ${slow.length ? `<p class="eyebrow">Steps that eat the clock</p><ul class="pl-slow">${slow.map((x) => `<li><b>${RB.fmtDuration(x.secs)}</b> avg · Step ${x.n}: ${esc(RB.stripMd(flat[x.n - 1] || '').slice(0, 80))}</li>`).join('')}</ul>` : ''}
      ${runs.some((x) => x.note) ? `<ul class="pl-notes">${runs.slice().reverse().filter((x) => x.note).slice(0, 4).map((x) => `<li><small>${esc(fmtDate(x.at, { month: 'short', day: 'numeric' }))}</small> ${esc(x.note)}</li>`).join('')}</ul>` : ''}
    </section>`;
  }

  const PLATE_COLORS = ['#94713f', '#6c7f55', '#a3352b', '#e2b45a', '#4f4c45', '#9c6a72', '#5b7c7a'];
  function plateSvg(p) {
    const els = (p.elements || []).slice(0, 8);
    const pos = (e) => {
      const where = String(e.pos || 'center').toLowerCase();
      if (/center|middle/.test(where)) return [150, 150, 0];
      const h = parseInt(where, 10) || 12;
      const a = ((h % 12) / 12) * Math.PI * 2 - Math.PI / 2;
      return [150 + Math.cos(a) * 64, 150 + Math.sin(a) * 64, a];
    };
    const color = (e, i) => (/^#[0-9a-f]{3,8}$/i.test(e.color || '') ? e.color : PLATE_COLORS[i % PLATE_COLORS.length]);
    const shapes = els.map((e, i) => {
      const [x, y, a] = pos(e); const c = color(e, i);
      const r = { s: 14, m: 22, l: 32 }[e.size] || 22;
      const shape = String(e.shape || 'mound').toLowerCase();
      const deg = (a * 180) / Math.PI;
      if (/swoosh|smear|swipe/.test(shape)) {
        const a0 = a - 0.7, a1 = a + 0.7, R = 78;
        return `<path d="M${150 + Math.cos(a0) * R} ${150 + Math.sin(a0) * R} A${R} ${R} 0 0 1 ${150 + Math.cos(a1) * R} ${150 + Math.sin(a1) * R}" stroke="${c}" stroke-width="${r * 0.7}" fill="none" stroke-linecap="round" opacity=".85"/>`;
      }
      if (/dot/.test(shape)) return [-2, -1, 0, 1, 2].map((k) => { const b = a + k * 0.2; return `<circle cx="${150 + Math.cos(b) * 86}" cy="${150 + Math.sin(b) * 86}" r="${4 + (2 - Math.abs(k))}" fill="${c}"/>`; }).join('');
      if (/quenelle|oval|egg/.test(shape)) return `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.55}" fill="${c}" transform="rotate(${deg + 90} ${x} ${y})"/>`;
      if (/scatter|crumb|sprinkle|herb|leaf/.test(shape)) return Array.from({ length: 9 }, (_, k) => { const b = k * 2.4 + i, d = 10 + ((k * 37) % 30); return `<circle cx="${x + Math.cos(b) * d}" cy="${y + Math.sin(b) * d}" r="${2 + (k % 3)}" fill="${c}"/>`; }).join('');
      if (/drizzle|line|sauce/.test(shape)) return `<path d="M${x - 40} ${y + 10} q 13 -22 26 0 t 26 0 t 26 0" stroke="${c}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
      if (/slice|fan|shingle/.test(shape)) return [-1, 0, 1].map((k) => `<rect x="${x - r * 0.35}" y="${y - r}" width="${r * 0.7}" height="${r * 2}" rx="${r * 0.3}" fill="${c}" opacity="${0.75 + k * 0.08}" transform="rotate(${deg + 90 + k * 22} ${x} ${y + r})"/>`).join('');
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/><circle cx="${x - r * 0.3}" cy="${y - r * 0.3}" r="${r * 0.35}" fill="#fff" opacity=".18"/>`;
    }).join('');
    return `<div class="plate-wrap">
      <svg viewBox="0 0 300 300" class="plate-svg" role="img" aria-label="Plating sketch"><circle cx="150" cy="150" r="146" class="plate-rim"/><circle cx="150" cy="150" r="108" class="plate-well"/>${shapes}</svg>
      <div class="plate-notes">
        ${p.plate ? `<p class="eyebrow">${esc(p.plate)}</p>` : ''}
        <ul class="plate-legend">${els.map((e, i) => `<li><i style="background:${color(e, i)}"></i><b>${esc(e.name)}</b> <span>${esc(/center|middle/i.test(e.pos || 'center') ? 'center' : (parseInt(e.pos, 10) || 12) + ' o’clock')}${e.shape ? ' · ' + esc(e.shape) : ''}</span></li>`).join('')}</ul>
        ${(p.steps || []).length ? `<ol>${p.steps.slice(0, 6).map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
        ${p.garnish ? `<p><b>Garnish:</b> ${esc(p.garnish)}</p>` : ''}
        ${p.tip ? `<p class="tip-pro"><span class="eyebrow">Chef’s move</span>${esc(p.tip)}</p>` : ''}
      </div></div>`;
  }
  function platingHtml(r, m) {
    if (catKey(r.category) === 'drinks' || catKey(r.category) === 'sauces') return '';
    const p = m.plating, ref = m.platingRef;
    return `<section class="panel plating no-print">
      <div class="panel-head"><h2>Plating</h2><div class="row"><button class="btn small ghost" data-act="plate-sketch">${icon('i-sparkle')} ${p ? 'New sketch' : 'Sketch with Claude'}</button><button class="btn small ghost" data-act="plate-ref">${icon('i-camera')} ${ref ? 'Change' : 'Reference'} photo</button></div></div>
      ${ref ? `<figure class="plate-ref"><img data-photo="${esc(ref)}" data-size="full" alt="Your best plating"><figcaption>Your best plating, the one to match</figcaption></figure>` : ''}
      ${p ? plateSvg(p) : ''}
      ${!p && !ref ? '<p class="muted small">Get a restaurant-style plating sketch for this dish, or save a photo of your best plate as the reference for next time.</p>' : ''}
    </section>`;
  }
  async function sketchPlating(r, btn) {
    await ai.init();
    if (!ai.available()) { sheet.open({ title: 'Plating with Claude', body: aiSetupHtml() }); return; }
    if (btn) { btn.disabled = true; btn.innerHTML = icon('i-sparkle') + ' Sketching…'; }
    const prompt = `You are a Michelin-trained chef. Design an elegant, achievable plating for this home recipe. Reply with ONLY JSON in this shape:
{"plate":"plate type and color, one short phrase","elements":[{"name":"component","pos":"center or a clock position 1-12","shape":"mound|quenelle|swoosh|dots|scatter|drizzle|slice","size":"s|m|l","color":"#hex close to the food's real color"}],"steps":["3 to 5 short plating steps in order"],"garnish":"one line","tip":"one chef's trick for this dish"}
Use 3 to 6 elements. Keep it true to the dish.

RECIPE
${RB.toMarkdown(r)}`;
    try {
      const text = await ai.ask(prompt, {});
      const p = parseJsonLoose(text);
      if (!p || !Array.isArray(p.elements)) throw new Error('Claude didn’t return a sketch. Try again.');
      store.setMeta(r.id, { plating: p });
      if (route.name === 'recipe') viewRecipe($('#main'), r.id);
      toast('Plating sketch ready');
    } catch (e) {
      toast(e.message === 'NO_KEY' ? 'Add an Anthropic API key in Settings' : e.message || 'Couldn’t sketch a plating');
      if (btn) { btn.disabled = false; btn.innerHTML = icon('i-sparkle') + ' Sketch with Claude'; }
    }
  }
  function openPlatingRef(r) {
    const m = store.meta(r.id);
    sheet.open({ title: 'Reference photo', body: `<p class="muted small">Pick the photo of your best plating. It shows on the recipe and when you finish cooking.</p>
      <div class="my-photos pick">${(m.photos || []).map((id) => `<button class="ph ${m.platingRef === id ? 'on' : ''}" data-ref="${esc(id)}"><img data-photo="${esc(id)}" alt=""></button>`).join('')}
      <label class="ph-add">${icon('i-camera')}<span>New photo</span><input type="file" accept="image/*" data-act="plate-ref-upload" data-id="${esc(r.id)}" hidden></label></div>
      ${m.platingRef ? '<div class="row end"><button class="btn small ghost" data-ref="">Remove reference</button></div>' : ''}`,
    onMount: (el) => {
      hydratePhotos(el);
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-ref]'); if (!b) return;
        store.setMeta(r.id, { platingRef: b.dataset.ref }); sheet.close(true); viewRecipe($('#main'), r.id);
      });
    } });
  }
  function pairingHtml(r) {
    const p = RK.pairDrink(r, store.recipes);
    if (!p) return '';
    return `<section class="panel pairing no-print">
      <div class="panel-head"><h2>Pair it with</h2><button class="btn small ghost" data-act="pair-ask">${icon('i-sparkle')} Ask Claude</button></div>
      <dl class="pair-list"><div><dt>Wine &amp; beer</dt><dd>${esc(p.wine)}</dd></div><div><dt>Cocktail</dt><dd>${esc(p.cocktail)}</dd></div><div><dt>Zero-proof</dt><dd>${esc(p.zero)}</dd></div></dl>
      ${p.book.length ? `<p class="pair-book"><span class="eyebrow">From your book</span>${p.book.map((d) => `<a href="#/r/${encodeURIComponent(d.id)}">${esc(d.title)}</a>`).join(' · ')}</p>` : ''}
    </section>`;
  }
  function storyHtml(r, m) {
    const st = m.story;
    if (!hasStory(m)) {
      return `<section class="panel story empty-story no-print"><div class="story-cta">${icon('i-quote', 'story-ic')}<div><h3>The story behind it</h3><p class="muted small">Who taught you this? Record them telling it in their own words and keep it with the recipe.</p></div>
        <button class="btn small" data-act="story-edit">${icon('i-mic')} Add the story</button></div></section>`;
    }
    return `<section class="panel story">
      <div class="panel-head"><h2>The story</h2><button class="btn small ghost no-print" data-act="story-edit">${icon('i-pencil')} Edit</button></div>
      ${st.by ? `<p class="story-by">As told by <b>${esc(st.by)}</b>${st.at ? ' · ' + esc(fmtDate(st.at, { month: 'long', year: 'numeric' })) : ''}</p>` : ''}
      ${st.audio ? `<audio controls preload="none" data-audio="${esc(st.audio)}"></audio>` : ''}
      ${st.text ? `<blockquote class="story-text">${blockMd(st.text)}</blockquote>` : ''}
    </section>`;
  }
  function hydrateAudio(root) {
    $$('audio[data-audio]', root || document).forEach(async (a) => {
      const u = await photos.url(a.dataset.audio, 'raw');
      if (u) a.src = u; else a.outerHTML = '<p class="muted small">The recording was made on another device.</p>';
    });
  }
  function openStoryEditor(r) {
    const m = store.meta(r.id);
    const st = Object.assign({ by: '', text: '', audio: '' }, m.story || {});
    let rec = null, chunks = [], newBlob = null, removeAudio = false, stream = null, dictation = null;
    const canRecord = !!(navigator.mediaDevices && window.MediaRecorder);
    sheet.open({ title: 'The story', wide: true, body: `
      <form class="story-form">
        <label class="field"><span>As told by</span><input name="by" value="${esc(st.by)}" placeholder="e.g. Grandma Lorna"></label>
        <div class="field"><span>Recording <small>${canRecord ? 'stays on this device' : 'not supported in this browser'}</small></span>
          <div class="rec-row">
            ${canRecord ? `<button type="button" class="btn rec-btn" data-rec>${icon('i-mic')} Record</button>` : ''}
            <span class="rec-time muted small"></span>
            <audio controls class="rec-audio" ${st.audio ? `data-audio="${esc(st.audio)}"` : 'hidden'}></audio>
            ${st.audio ? '<button type="button" class="linkish" data-rm-audio>Remove recording</button>' : ''}
          </div>
          ${voice.supported && canRecord ? '<p class="muted small">While you record, their words are written into the story below so you can tidy them up.</p>' : ''}
        </div>
        <label class="field"><span>The story</span><textarea name="text" rows="8" placeholder="Where it comes from, who made it, the little tricks they swore by…">${esc(st.text)}</textarea></label>
        <div class="sheet-foot"><span></span><button class="btn primary" type="submit">${icon('i-check')} Save story</button></div>
      </form>`,
    onClose: () => { try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) { /* */ } if (stream) stream.getTracks().forEach((t) => t.stop()); if (dictation) voice.stop(); },
    onMount: (el) => {
      hydrateAudio(el);
      const ta = $('textarea', el), btn = $('[data-rec]', el), time = $('.rec-time', el), audio = $('.rec-audio', el);
      let t0 = 0, tick = null;
      const stopAll = () => { if (rec && rec.state !== 'inactive') rec.stop(); if (dictation) { voice.stop(); dictation = null; } clearInterval(tick); };
      if (btn) btn.addEventListener('click', async () => {
        if (rec && rec.state === 'recording') { stopAll(); return; }
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { toast('Microphone access was blocked'); return; }
        chunks = []; rec = new MediaRecorder(stream);
        rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = () => {
          newBlob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          audio.hidden = false; audio.removeAttribute('data-audio'); audio.src = URL.createObjectURL(newBlob);
          btn.innerHTML = icon('i-mic') + ' Record again'; btn.classList.remove('recording');
          stream.getTracks().forEach((t) => t.stop()); stream = null;
        };
        rec.start(); t0 = Date.now();
        btn.innerHTML = icon('i-x') + ' Stop'; btn.classList.add('recording');
        tick = setInterval(() => { time.textContent = '● ' + RB.fmtDuration((Date.now() - t0) / 1000); }, 500);
        if (voice.supported) {
          dictation = voice.start({ keepAlive: true, interim: false, onFinal: (t) => { if (t) { ta.value = ta.value.replace(/\s+$/, '') + (ta.value.trim() ? ' ' : '') + t; } } });
        }
      });
      const rm = $('[data-rm-audio]', el);
      if (rm) rm.addEventListener('click', () => { removeAudio = true; newBlob = null; audio.hidden = true; rm.remove(); });
      $('form', el).addEventListener('submit', async (e) => {
        e.preventDefault(); stopAll();
        await new Promise((res) => setTimeout(res, 250));
        const fd = new FormData(e.target);
        const out = { by: String(fd.get('by') || '').trim(), text: String(fd.get('text') || '').trim(), audio: st.audio, at: st.at || nowIso() };
        try {
          if (newBlob) { if (st.audio) await photos.del(st.audio); out.audio = await photos.putRaw(newBlob); }
          else if (removeAudio && st.audio) { await photos.del(st.audio); out.audio = ''; }
        } catch (err) { toast('Couldn’t save the recording on this device'); }
        store.setMeta(r.id, { story: out }); sheet.close(true); toast('Story saved'); viewRecipe($('#main'), r.id);
      });
    } });
  }

  // ======================================================================
  // Version history
  // ======================================================================
  const recipeLines = (r) => ({ ing: r.ingredients.flatMap((g) => (g.name ? ['— ' + g.name] : []).concat(g.items)), steps: r.steps.flatMap((g) => g.items), notes: r.notes || [] });
  const diffLines = (a, b) => { const A = new Set(a), B = new Set(b); return { removed: a.filter((x) => !B.has(x)), added: b.filter((x) => !A.has(x)) }; };
  function changeSummary(old, cur) {
    const o = recipeLines(old), c = recipeLines(cur);
    const parts = [];
    const n = (d) => Math.max(d.removed.length, d.added.length);
    const ni = n(diffLines(o.ing, c.ing)), ns = n(diffLines(o.steps, c.steps)), nn = n(diffLines(o.notes, c.notes));
    if (old.title !== cur.title) parts.push('title');
    if (ni) parts.push(ni + ' ingredient' + (ni > 1 ? 's' : ''));
    if (ns) parts.push(ns + ' step' + (ns > 1 ? 's' : ''));
    if (nn) parts.push('notes');
    if (old.time !== cur.time || old.yield !== cur.yield) parts.push('time/yield');
    if (old.description !== cur.description) parts.push('description');
    return parts.length ? parts.join(', ') : 'small edits';
  }
  function openVersions(r) {
    const list = versions.list(r.id);
    const diffHtml = (old, cur, label) => {
      const o = recipeLines(old), c = recipeLines(cur);
      const sec = (title, d) => (d.removed.length || d.added.length ? `<h4>${title}</h4><ul class="diff">${d.removed.map((x) => `<li class="rm">${inlineMd(x)}</li>`).join('')}${d.added.map((x) => `<li class="add">${inlineMd(x)}</li>`).join('')}</ul>` : '');
      const meta = [['Title', 'title'], ['Time', 'time'], ['Yield', 'yield']].filter(([, k]) => (old[k] || '') !== (cur[k] || '')).map(([l, k]) => `<li class="rm">${l}: ${esc(old[k] || '—')}</li><li class="add">${l}: ${esc(cur[k] || '—')}</li>`).join('');
      const body = (meta ? `<h4>Details</h4><ul class="diff">${meta}</ul>` : '') + sec('Ingredients', diffLines(o.ing, c.ing)) + sec('Method', diffLines(o.steps, c.steps)) + sec('Notes', diffLines(o.notes, c.notes));
      return `<p class="eyebrow">${esc(label)}</p>${body || '<p class="muted small">No differences in ingredients, method or notes.</p>'}`;
    };
    sheet.open({ title: 'Version history', wide: true, body: list.length ? `
      <p class="muted small">Every time you save an edit, the previous version is kept here on this device (last 25).</p>
      <ul class="versions">
        <li class="current"><b>v${list.length + 1}</b><span>Current · ${esc(fmtDate(r.updatedAt, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }))}</span></li>
        ${list.map((v, i) => ({ v, i })).reverse().map(({ v, i }) => `<li><b>v${i + 1}</b><span>${esc(fmtDate(v.at, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }))} · <small>since then: ${esc(changeSummary(v.r, (list[i + 1] || { r }).r))}</small></span>
          <button class="btn small ghost" data-cmp="${i}">Compare</button><button class="btn small ghost" data-restore="${i}">Restore</button></li>`).join('')}
      </ul>
      <div class="diff-view" hidden></div>` : '<p class="muted">No earlier versions yet. Each time you save an edit, the version before it is kept here so you can compare and roll back.</p>',
    onMount: (el) => el.addEventListener('click', async (e) => {
      const c = e.target.closest('[data-cmp]'), rs = e.target.closest('[data-restore]');
      if (c) {
        const i = +c.dataset.cmp; const dv = $('.diff-view', el);
        dv.hidden = false; dv.innerHTML = diffHtml(list[i].r, r, `v${i + 1} → current`); dv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      if (rs) {
        const i = +rs.dataset.restore;
        if (!(await ask(`Restore v${i + 1}? The current version is kept in the history.`, { ok: 'Restore' }))) { openVersions(store.byId(r.id)); return; }
        const back = normalizeRecipe(JSON.parse(JSON.stringify(list[i].r)));
        back.id = r.id; back.createdAt = r.createdAt;
        store.upsert(back); toast(`Restored v${i + 1}`); viewRecipe($('#main'), r.id);
      }
    }) });
  }

  // ======================================================================
  // Leftovers
  // ======================================================================
  const leftovers = {
    list() { return LS.get(K.leftovers, []); },
    save(l) { LS.set(K.leftovers, l); },
    daysLeft(x) { const d = new Date(x.until); const t = new Date(); t.setHours(0, 0, 0, 0); d.setHours(0, 0, 0, 0); return Math.round((d - t) / 86400000); },
    label(x) { const n = this.daysLeft(x); return n < 0 ? 'past due' : n === 0 ? 'today' : n === 1 ? 'tomorrow' : n + ' days'; },
    name(x) { return RK.parseIngredient(x.text).name || x.text.toLowerCase(); },
  };
  function useSoonHtml() {
    const soon = leftovers.list().filter((x) => leftovers.daysLeft(x) <= 1).sort((a, b) => leftovers.daysLeft(a) - leftovers.daysLeft(b));
    if (!soon.length) return '';
    return `<p class="today-menu use-soon">${icon('i-clock')} <span>Use soon:</span> ${soon.slice(0, 3).map((x) => `${esc(x.text)} <small>(${leftovers.label(x)})</small>`).join(', ')} <a class="linkish" href="#/pantry">Ideas</a></p>`;
  }
  const LO_STOP = new Set('half quarter bunch bunches cup cups tbsp tsp leftover leftovers some piece pieces container bowl bag about little bit of the and with from cooked extra small large'.split(' '));
  const loWords = (x) => RK.normalizeName(x.text.replace(/^[\d\s/½¼¾⅓⅔.]+/, '')).split(/[^a-zñéíóú]+/).filter((w) => w.length > 3 && !LO_STOP.has(w)).map(RK.singular);
  /** Recipes that use up your leftovers, the ones about to turn first. */
  function leftoverIdeas(have) {
    const los = leftovers.list();
    if (!los.length) return [];
    const all = have.concat(los.map((x) => leftovers.name(x)));
    return store.recipes.map((r) => {
      const text = norm(r.title + ' ' + r.ingredients.flatMap((g) => g.items).join(' ')).split(/[^a-zñéíóú]+/).map(RK.singular);
      const set = new Set(text);
      const uses = los.filter((lo) => { const w = loWords(lo); return w.length && w.some((x) => set.has(x)); });
      return { recipe: r, uses };
    }).filter((e) => e.uses.length).map((e) => {
      const fit = RK.whatCanIMake(all, [e.recipe], staplesList())[0] || { missing: [] };
      return Object.assign(e, { urgency: Math.min(...e.uses.map((x) => leftovers.daysLeft(x))), missing: fit.missing });
    }).sort((a, b) => a.urgency - b.urgency || b.uses.length - a.uses.length || a.missing.length - b.missing.length).slice(0, 8);
  }

  // ======================================================================
  // Day-of schedule: work backward from when you want to eat
  // ======================================================================
  const fmtClock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  function openSchedule(rs, opts) {
    opts = opts || {};
    rs = rs.filter((r) => r.steps.length);
    if (!rs.length) { toast('These recipes have no steps to schedule'); return; }
    const base = opts.day ? new Date(opts.day + 'T00:00') : new Date();
    const pad = (n) => String(n).padStart(2, '0');
    let date = base.getFullYear() + '-' + pad(base.getMonth() + 1) + '-' + pad(base.getDate());
    let time = opts.time || '19:00';
    const toMd = (s) => {
      const out = [];
      const ahead = s.warnings.filter((w) => w.kind === 'ahead');
      if (ahead.length) out.push('**Ahead of time**', ...ahead.map((w) => '- ' + w.text), '');
      let last = '';
      s.events.forEach((e) => { const c = fmtClock(e.at); if (c !== last) { out.push((last ? '\n' : '') + '**' + c + '**'); last = c; } out.push(`- ${e.dish.replace(/\s*\(.*\)$/, '')}: ${e.text.split(/(?<=\.)\s/)[0].slice(0, 110)}`); });
      out.push('', '**' + fmtClock(s.serve) + '**', '- Serve');
      return out.join('\n');
    };
    let current = null;
    const draw = (el) => {
      const serveAt = new Date(date + 'T' + time);
      if (isNaN(serveAt)) return;
      const s = current = RK.schedule(rs, serveAt);
      const lead = Math.round((s.serve - s.start) / 60000);
      $('.sched-out', el).innerHTML = `
        <p class="sched-sum">Start at <b>${fmtClock(s.start)}</b> · ${lead >= 60 ? Math.floor(lead / 60) + ' h ' + (lead % 60 ? (lead % 60) + ' min ' : '') : lead + ' min '}before serving${s.start < Date.now() && s.serve > Date.now() ? ' · <span class="error-text">that’s already passed</span>' : ''}</p>
        ${s.warnings.length ? `<ul class="sched-warn">${s.warnings.map((w) => `<li class="${w.kind}">${icon(w.kind === 'oven' ? 'i-flame' : 'i-clock')}<span>${esc(w.text)}</span></li>`).join('')}</ul>` : ''}
        <div class="sched-dishes">${s.dishes.map((d) => `<span style="--cat:var(--c-${catKey((store.byId(d.id) || {}).category)})"><i></i>${esc(d.title.replace(/\s*\(.*\)$/, ''))} <b>${fmtClock(d.start)}</b></span>`).join('')}</div>
        <ol class="sched-list">${s.events.map((e) => `<li class="${e.first ? 'first' : ''}" style="--cat:var(--c-${catKey((store.byId(e.id) || {}).category)})"><time>${fmtClock(e.at)}</time><div><small>${esc(e.dish.replace(/\s*\(.*\)$/, ''))} · step ${e.n} · ${e.minutes} min</small><p>${esc(e.text.length > 150 ? e.text.slice(0, 148) + '…' : e.text)}</p></div></li>`).join('')}
          <li class="serve"><time>${fmtClock(s.serve)}</time><div><p><b>Serve</b></p></div></li></ol>`;
    };
    sheet.open({ title: opts.title ? 'Timing · ' + opts.title : 'Timing', wide: true, body: `
      <div class="sched-form"><label class="field"><span>Serve on</span><input type="date" value="${date}" data-k="date"></label><label class="field"><span>At</span><input type="time" value="${time}" data-k="time" step="300"></label></div>
      <p class="muted small">Times come from each recipe’s timers and stated total time. Real kitchens vary, so give yourself a cushion.</p>
      <div class="sched-out"></div>
      <div class="sheet-foot">
        ${opts.collection ? '<button class="btn ghost" data-save-tl>Save as collection timeline</button>' : ''}<button class="btn ghost" data-copy>${icon('i-copy')} Copy</button><span></span>
        ${rs.length > 1 ? `<a class="btn primary" href="#/cook/${rs.slice(0, 6).map((r) => encodeURIComponent(r.id)).join(',')}">${icon('i-play')} Cook together</a>` : `<a class="btn primary" href="#/r/${encodeURIComponent(rs[0].id)}/cook">${icon('i-play')} Start cooking</a>`}
      </div>`,
    onMount: (el) => {
      draw(el);
      $$('[data-k]', el).forEach((inp) => inp.addEventListener('input', () => { if (inp.dataset.k === 'date') date = inp.value; else time = inp.value; draw(el); }));
      $('[data-copy]', el).addEventListener('click', () => current && copyText(RB.stripMd(toMd(current)).replace(/\n\n+/g, '\n\n'), 'Schedule copied'));
      const sv = $('[data-save-tl]', el);
      if (sv) sv.addEventListener('click', () => {
        const c = JSON.parse(JSON.stringify(store.byCollection(opts.collection)));
        c.timeline = toMd(current); store.saveCollection(c); sheet.close(true); toast('Saved as the collection’s timeline'); render();
      });
    } });
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
          const keyOf = (d) => JSON.stringify([d.recipes, d.deleted, d.meta, d.plan || {}, d.collections || [], d.collectionsDeleted || {}, d.customTips || [], d.tipsDeleted || {}]);
          try { const r = JSON.parse(remoteText || 'null'); same = r && keyOf(r) === keyOf(data); } catch (e) { /* */ }
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
    if (/\.html?$/i.test(file.name) || /^\s*<(!doctype|html)/i.test(text)) {
      const md = (text.match(/<script type="text\/markdown" id="wrb-recipe">([\s\S]*?)<\/script>/) || [])[1];
      const list = md ? RB.parseText(md.replace(/<\\\/script/gi, '</script')) : RB.parseHtml(text, '');
      go('#/add/chat'); setTimeout(() => handleParsed(list), 30); return;
    }
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
      case 'toggle-story': ui.story = !ui.story; saveUi(); el.classList.toggle('on', ui.story); renderResults(); break;
      case 'clear-filters': ui.q = ''; ui.cat = ''; ui.tags = []; ui.fav = false; ui.quick = false; ui.story = false; saveUi(); viewBook($('#main')); break;
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
      case 'share': if (r) openShare(r); break;
      case 'versions': if (r) { el.closest('details').open = false; openVersions(r); } break;
      case 'plate-sketch': if (r) sketchPlating(r, el); break;
      case 'plate-ref': if (r) openPlatingRef(r); break;
      case 'pair-ask': if (r) openAsk(r, 'What should I drink with this? Give one wine or beer, one cocktail and one zero-proof option, and say briefly why each works with this dish.'); break;
      case 'story-edit': if (r) openStoryEditor(r); break;
      case 'col-schedule': { const c = store.byCollection(el.dataset.cid); if (c) openSchedule(colRecipes(c), { title: c.name, collection: c.id }); break; }
      case 'plan-schedule': { const rs = store.planDay(el.dataset.day).map((it) => store.byId(it.recipeId)).filter(Boolean); openSchedule(rs, { title: dayLabel(el.dataset.day, { weekday: 'long' }), day: el.dataset.day }); break; }
      case 'lo-rm': leftovers.save(leftovers.list().filter((x) => x.id !== el.dataset.id)); viewPantry($('#main')); break;
      case 'plan-recipe': if (r) openPlanDays(r); break;
      case 'ask-claude': if (r) openAsk(r); break;
      case 'col-add': if (r) { el.closest('details').open = false; openAddToCollection(r); } break;
      case 'cook-with': if (r) { el.closest('details').open = false; openCookWith(r); } break;
      case 'rate': {
        const v = +el.dataset.v; const cur = store.meta(rid).rating || 0;
        store.setMeta(rid, { rating: cur === v ? 0 : v });
        const nv = store.meta(rid).rating;
        $$('.rate button').forEach((b) => { b.classList.toggle('on', +b.dataset.v <= nv); b.setAttribute('aria-checked', +b.dataset.v === nv); });
        toast(nv ? `Rated ${nv} star${nv > 1 ? 's' : ''}` : 'Rating cleared'); break;
      }
      case 'units': {
        settings.units = el.dataset.u; saveSettings();
        $$('.seg.units button').forEach((b) => { const on = b.dataset.u === settings.units; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
        if (cook.state) { cook.renderSheet(); cook.renderStage(0); } else if (route.name === 'recipe') viewRecipe($('#main'), rid);
        break;
      }
      case 'photo-view': openPhoto(el.dataset.pid); break;
      case 'photo-cover': { const m = store.meta(rid); store.setMeta(rid, { cover: m.cover === el.dataset.pid ? '' : el.dataset.pid }); viewRecipe($('#main'), rid); break; }
      case 'photo-del': {
        if (!(await ask('Delete this photo from this device?', { ok: 'Delete', danger: true }))) break;
        const pid = el.dataset.pid; const m = store.meta(rid);
        store.setMeta(rid, { photos: (m.photos || []).filter((x) => x !== pid), cover: m.cover === pid ? '' : m.cover });
        await photos.del(pid); viewRecipe($('#main'), rid); break;
      }
      case 'copy-md': copyText(RB.toMarkdown(r), 'Recipe copied as text'); el.closest('details').open = false; break;
      case 'duplicate': {
        const copy = JSON.parse(JSON.stringify(r)); copy.title = r.title + ' (copy)'; copy.id = store.uniqueId(copy.title); copy.createdAt = '';
        store.upsert(copy); toast('Duplicated'); go('#/edit/' + encodeURIComponent(copy.id)); break;
      }
      case 'print': el.closest('details').open = false; setTimeout(() => window.print(), 50); break;
      case 'delete': {
        el.closest('details').open = false;
        if (!(await ask(`Delete “${r.title}”? You can undo right after.`, { ok: 'Delete', danger: true }))) break;
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
      case 'cook-dish': cook.switchDish(+el.dataset.k); break;
      case 'cook-practice': cook.togglePractice(); break;
      case 'cook-practice-start': go('#/r/' + encodeURIComponent(rid) + '/cook'); setTimeout(() => { if (cook.state && !cook.state.practice) cook.togglePractice(); }, 120); break;
      case 'practice-save': {
        const s = cook.state; if (!s || !s.practice) break;
        const card = el.closest('.practice-card');
        const scores = {}; $$('[data-score]', card).forEach((i) => { scores[i.dataset.score] = +i.value; });
        const run = { at: nowIso(), total: Math.round(((s.practice.end || Date.now()) - s.practice.start) / 1000), steps: cook.practiceSteps(s).map((x) => ({ n: x.n, secs: x.secs })), scores, note: $('.pr-note', card).value.trim() };
        const m = store.meta(s.r.id); store.setMeta(s.r.id, { runs: (m.runs || []).concat(run).slice(-60) });
        s.practice.saved = true; card.outerHTML = cook.practiceHtml(s); toast('Run saved to the practice log'); break;
      }
      case 'taste-pick': {
        const s = cook.state; if (!s) break;
        const k = el.dataset.k, v = +el.dataset.v;
        s.taste[k] = s.taste[k] === v ? undefined : v;
        $$(`[data-act="taste-pick"][data-k="${k}"]`).forEach((b) => b.classList.toggle('on', s.taste[k] === +b.dataset.v)); break;
      }
      case 'taste-save': {
        const s = cook.state; if (!s) break;
        const card = el.closest('.taste-card');
        const t = { at: nowIso(), note: $('.tc-note', card).value.trim() };
        ['salt', 'acid', 'heat', 'done'].forEach((k) => { if (s.taste[k] != null) t[k] = s.taste[k]; });
        if (Object.keys(t).length <= 2 && !t.note) { toast('Tap at least one, or write a note'); break; }
        const m = store.meta(s.r.id); store.setMeta(s.r.id, { taste: (m.taste || []).concat(t).slice(-40) });
        s.taste = { saved: true }; card.outerHTML = cook.tasteHtml(s); break;
      }
      case 'cook-ask': cook.openAsk(); break;
      case 'cook-ask-close': $('.cook-ask').hidden = true; speech.stop(); break;
      case 'cook-ask-mic': {
        if (cook.listen) { toast('I’m already listening. Say “chef, …” and your question.'); break; }
        const inp = $('.ca-form input');
        voice.start({ continuous: false, onState: (on) => el.classList.toggle('listening', on), onInterim: (t) => { if (t) inp.value = t; }, onFinal: (t) => { if (t) cook.askChef(t, true); } });
        break;
      }
      case 'sheet-close': sheet.close(); break;
      case 'cook-size': settings.cookSize = Math.max(0.8, Math.min(1.8, Math.round((settings.cookSize + (+el.dataset.d) * 0.15) * 100) / 100)); saveSettings(); $('.cook').style.setProperty('--cook-size', settings.cookSize); break;
      // add flows
      case 'new-blank': if (draft) { e.preventDefault(); if (await ask('Start a blank recipe? Your unsaved draft will be discarded.', { ok: 'Start blank' })) { draft = null; LS.del(K.draft); go('#/new'); } } break;
      case 'discard-draft': draft = null; LS.del(K.draft); el.closest('.tip').remove(); break;
      case 'discard-draft-edit': if (await ask('Discard this recipe?', { ok: 'Discard', danger: true })) { draft = null; LS.del(K.draft); go('#/add'); } break;
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
      case 'g-clear-checked': {
        // what you bought goes into the pantry for "What can I make?"
        const bought = groceries.list.filter((x) => x.checked).map((x) => RK.parseIngredient(x.text).name).filter((n) => n && n !== 'water' && !staplesList().includes(n));
        const before = LS.get(K.pantry, []);
        const added = Array.from(new Set(bought)).filter((n) => !before.includes(n));
        if (added.length) LS.set(K.pantry, before.concat(added));
        groceries.list = groceries.list.filter((x) => !x.checked); groceries.save(); viewGroceries($('#main'));
        toast(added.length ? `Cleared · ${added.length} added to your pantry` : 'Cleared', added.length ? { label: 'What can I make?', run: () => go('#/pantry') } : null); break;
      }
      case 'g-clear-all': if (await ask('Clear the whole grocery list?', { ok: 'Clear list', danger: true })) { groceries.list = []; groceries.save(); viewGroceries($('#main')); } break;
      case 'g-check-many': {
        const ids = new Set(el.dataset.ids.split(','));
        groceries.list.forEach((x) => { if (ids.has(x.id)) x.checked = el.checked; });
        groceries.save(); el.closest('.check').classList.toggle('on', el.checked);
        setTimeout(() => { if (route.name === 'groceries') viewGroceries($('#main')); }, 220); break;
      }
      case 'g-view': settings.gView = el.dataset.v; saveSettings(); viewGroceries($('#main')); break;
      case 'staples-save': settings.staples = $('#staples').value.split(/[,\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean); saveSettings(); pantryCommon = null; toast('Pantry staples saved'); viewGroceries($('#main')); break;
      case 'staples-reset': settings.staples = null; saveSettings(); pantryCommon = null; viewGroceries($('#main')); break;
      // meal plan
      case 'plan-pick': openPlanPicker(el.dataset.day); break;
      case 'plan-add-direct': planAdd(el.dataset.day, el.dataset.rid, 'Dinner'); toast('Added ' + (store.byId(el.dataset.rid) || {}).title); viewPlan($('#main')); break;
      case 'plan-remove': {
        const day = el.dataset.day; const before = store.planDay(day);
        store.setPlanDay(day, before.filter((x) => x.id !== el.dataset.pid));
        viewPlan($('#main'));
        toast('Removed from plan', { label: 'Undo', run: () => { store.setPlanDay(day, before); if (route.name === 'plan') viewPlan($('#main')); } }); break;
      }
      case 'plan-groceries': {
        const counts = new Map();
        RK.weekDays(+el.dataset.w || 0).forEach((d) => store.planDay(RK.dateKey(d)).forEach((it) => { if (store.byId(it.recipeId)) counts.set(it.recipeId, (counts.get(it.recipeId) || 0) + 1); }));
        counts.forEach((n, id) => groceries.addRecipe(store.byId(id), n * getScale(id)));
        toast(`Added ingredients for ${counts.size} recipe${counts.size === 1 ? '' : 's'}`, { label: 'View list', run: () => go('#/groceries') }); break;
      }
      case 'plan-clear': {
        if (!(await ask('Clear every meal planned for this week?', { ok: 'Clear week', danger: true }))) break;
        RK.weekDays(+el.dataset.w || 0).forEach((d) => { const k = RK.dateKey(d); if (store.planDay(k).length) store.book.plan[k] = { items: [], updatedAt: nowIso() }; });
        store.save(); viewPlan($('#main')); break;
      }
      // collections
      case 'col-new': openCollectionEditor(null); break;
      case 'col-edit': openCollectionEditor(store.byCollection(el.dataset.cid)); break;
      case 'col-groceries': {
        const c = store.byCollection(el.dataset.cid); if (!c) break;
        const rs = colRecipes(c); rs.forEach((x) => groceries.addRecipe(x, getScale(x.id)));
        toast(`Added ingredients for ${rs.length} recipes`, { label: 'View list', run: () => go('#/groceries') }); break;
      }
      // what can I make
      case 'pantry-add': pantrySet(LS.get(K.pantry, []).concat(el.dataset.v)); break;
      case 'pantry-rm': pantrySet(LS.get(K.pantry, []).filter((x) => x !== el.dataset.v)); break;
      case 'pantry-clear': pantrySet([]); break;
      case 'pantry-missing': {
        const x = RK.whatCanIMake(LS.get(K.pantry, []), [store.byId(el.dataset.id)], staplesList())[0];
        if (!x) break;
        const rec = x.recipe; const needs = RK.recipeNeeds(rec, staplesList());
        x.missing.forEach((name) => groceries.list.push({ id: uid(), text: RB.stripMd(needs.get(name) || name), recipeId: '', recipeTitle: rec.title, checked: false }));
        groceries.save(); toast(`Added ${x.missing.length} item${x.missing.length === 1 ? '' : 's'} for ${rec.title}`, { label: 'View list', run: () => go('#/groceries') }); break;
      }
      case 'g-copy': copyText(groceryText(), 'List copied'); break;
      case 'g-share': { const t = groceryText(); if (navigator.share) { try { await navigator.share({ title: 'Grocery list', text: t }); } catch (err) { /* */ } } else copyText(t, 'List copied'); break; }
      // chef's notebook
      case 'tip-cat': tipsUi.cat = el.dataset.cat; tipsUi.saved = false; $$('.tip-chips .chip').forEach((c) => c.classList.toggle('on', c === el)); renderTipResults(); break;
      case 'tip-saved': tipsUi.saved = !tipsUi.saved; tipsUi.cat = ''; $$('.tip-chips .chip').forEach((c) => c.classList.toggle('on', tipsUi.saved ? c === el : !c.dataset.cat && c.dataset.act === 'tip-cat')); renderTipResults(); break;
      case 'tip-new': openTipEditor(null); break;
      case 'tip-edit': e.preventDefault(); openTipEditor(store.book.customTips.find((x) => x.id === el.dataset.id)); break;
      case 'tip-save': {
        e.preventDefault(); e.stopPropagation();
        const id = el.dataset.id;
        if (savedTips.has(id)) savedTips.delete(id); else savedTips.add(id);
        saveSavedTips();
        const on = savedTips.has(id);
        el.classList.toggle('on', on); el.setAttribute('aria-pressed', on);
        const c = $('[data-saved-count]'); if (c) c.textContent = savedTips.size;
        toast(on ? 'Saved to your techniques' : 'Removed from saved');
        if (tipsUi.saved) renderTipResults();
        break;
      }
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
        if (!(await ask('Erase all recipes, notes, lists and settings on this device? Your GitHub copy, if any, is not touched.', { ok: 'Erase everything', danger: true }))) break;
        Object.values(K).forEach((k) => LS.del(k)); LS.del('wrb.transcript');
        location.hash = '#/'; location.reload(); break;
      }
      default: break;
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('[data-act="import-file"]') && el.files && el.files[0]) { importFile(el.files[0]); el.value = ''; }
    if (el.matches('[data-act="add-photo"]') && el.files && el.files.length) { addPhotos(el.dataset.id || route.params.id, Array.from(el.files)); el.value = ''; }
    if (el.matches('[data-act="photo-recipe"]') && el.files && el.files.length) { photoToRecipe(Array.from(el.files).slice(0, 4)); el.value = ''; }
    if (el.matches('[data-act="pantry-photo"]') && el.files && el.files.length) { pantryPhoto(Array.from(el.files).slice(0, 3)); el.value = ''; }
    if (el.matches('[data-act="plate-ref-upload"]') && el.files && el.files[0]) {
      const rid = el.dataset.id; const f = el.files[0]; el.value = '';
      photos.put(f).then((id) => { const m = store.meta(rid); store.setMeta(rid, { photos: (m.photos || []).concat(id), platingRef: id }); sheet.close(true); toast('Reference photo saved'); viewRecipe($('#main'), rid); }).catch(() => toast('Couldn’t save that photo'));
    }
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
    if (kind === 'cook-ask') { const q = $('input', form).value; cook.askChef(q, false); return; }
    if (kind === 'leftover') {
      const v = $('#lo-new').value.trim(); if (!v) return;
      const days = +$('#lo-days').value; const until = new Date(); until.setDate(until.getDate() + days);
      const l = leftovers.list();
      v.split(/\s*(?:;|\n)\s*/).filter(Boolean).forEach((t) => l.push({ id: uid(), text: t, at: nowIso(), until: until.toISOString() }));
      leftovers.save(l); viewPantry($('#main')); setTimeout(() => $('#lo-new') && $('#lo-new').focus(), 30); return;
    }
    if (kind === 'ai') {
      settings.claudeKey = String(new FormData(form).get('key') || '').trim(); saveSettings();
      const st = $('#ai-status'); if (st) st.textContent = ai.sample ? 'Connected through the Claude app' : settings.claudeKey ? 'Key saved on this device' : 'Not connected';
      toast(settings.claudeKey ? 'API key saved on this device' : 'API key removed');
    }
    if (kind === 'pantry') {
      const inp = $('#pantry-new'); const v = inp.value.trim(); if (!v) return;
      pantrySet(LS.get(K.pantry, []).concat(v.split(/\s*(?:,|\band\b|\bnext\b|\n)\s*/i).map((x) => x.toLowerCase())));
      setTimeout(() => $('#pantry-new') && $('#pantry-new').focus(), 30);
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
    if (e.key === 'Escape' && !$('#sheet-root').hidden) { e.preventDefault(); e.stopImmediatePropagation(); sheet.close(); return; }
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
    ai.init();
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
