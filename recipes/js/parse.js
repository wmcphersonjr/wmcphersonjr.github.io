/* Recipe parsing + kitchen math. Works in the browser (window.RB) and in Node (module.exports). */
(function (root) {
  'use strict';

  const CATEGORIES = ['Drinks', 'Breakfast', 'Baking and Sweets', 'Mains', 'Sides and Salads', 'Soups', 'Sauces, Spices and Ferments', 'Basics and Technique'];

  // ---------- small helpers ----------
  const slugify = (s) => String(s || 'recipe').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'recipe';

  const SMALL = new Set(['and', 'or', 'of', 'the', 'a', 'an', 'in', 'on', 'with', 'to', 'for']);
  function titleCase(s) {
    return String(s).toLowerCase().split(/(\s+)/).map((w, i) =>
      (i > 0 && SMALL.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join('');
  }

  const stripMd = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/(^|\s)[*_](\S)/g, '$1$2').replace(/(\S)[*_](\s|$)/g, '$1$2').trim();

  function splitSentences(text) {
    const t = String(text || '').trim();
    if (!t) return [];
    // split on ., !, ? followed by space + capital/digit; keep decimals and abbreviations like "approx."
    const parts = t.split(/(?<=[.!?])\s+(?=[A-Z0-9(“"])/);
    return parts.map((p) => p.trim()).filter(Boolean);
  }

  function uniq(arr) { return Array.from(new Set(arr.filter(Boolean))); }

  function normTags(list) {
    return uniq((list || []).map((t) => String(t).toLowerCase().replace(/^#/, '').replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 40));
  }

  function emptyRecipe() {
    return { id: '', title: '', description: '', category: '', tags: [], time: '', yield: '', image: '',
      ingredients: [], steps: [], notes: [], extras: [], sources: [] };
  }

  // ---------- source lines ----------
  function parseSources(line, fallbackLabel) {
    const body = stripMd(line).replace(/^sources?\s*:\s*/i, '');
    const out = [];
    body.split(/\s+[·•|]\s+/).forEach((part) => {
      const m = part.match(/^(.*?)(https?:\/\/\S+)/);
      if (!m) return;
      let label = m[1].replace(/[:\-–\s]+$/, '').trim();
      if (!label) label = fallbackLabel || '';
      out.push({ label, url: m[2].replace(/[).,*]+$/, '') });
    });
    return out;
  }

  // ---------- label classification ----------
  const RX = {
    ingredients: /^(ingredients?|what you(?:'|’)ll need|you(?:'|’)ll need|shopping list)\b/i,
    method: /^(method|instructions?|directions?|steps|preparation|prep and cook|how to make(?: it)?)\b/i,
    notes: /^(notes?|tips?|cook(?:'|’)s notes?|chef(?:'|’)s notes?)$/i,
    yieldLabel: /^(yield|yields|servings|serves|makes)\b/i,
    tags: /^(tags?|keywords)$/i,
    time: /^((prep|cook|cooking|total|active)\s+)?time$|^(total|ready in|takes)$/i,
    category: /^(category|course)$/i,
    forServing: /^(for serving|to serve|garnish(?:es)?|toppings?)$/i,
    extraish: /(note|tip|variation|serving|serve|timeline|finish|key|safety|option|ratio|plating|ahead|storage|store|goal|move|swap|substitut|pair)/i,
    notIngredients: /(note|tip|variation|timeline|safety|option|plating|storage|substitut|pairing|key moves)/i,
  };

  const isBullet = (t) => /^[-*•]\s+/.test(t);
  const isNumbered = (t) => /^(\d+[.)]|step\s+\d+[:.)]?)\s+/i.test(t);
  const bulletText = (t) => t.replace(/^[-*•]\s+/, '').trim();
  const numberedText = (t) => t.replace(/^(\d+[.)]|step\s+\d+[:.)]?)\s+/i, '').trim();
  const looksLikeIngredient = (t) => /^([\d½⅓⅔¼¾⅛]|a |an |pinch|dash|handful|juice|zest|salt|pepper|\w+ to taste)/i.test(t);

  // Normalise messy chat text: markdown headings / "Ingredients:" lines -> **Label** lines
  function normaliseLine(line) {
    let t = line.replace(/\t/g, '  ').trim();
    const h = t.match(/^#{1,6}\s+(.*)$/);
    if (h) return { kind: 'heading', level: t.match(/^#+/)[0].length, text: stripMd(h[1]) };
    return { kind: 'line', text: t };
  }

  /**
   * Parse the body lines of one recipe into structure.
   */
  function parseRecipeLines(title, lines, defaults) {
    const r = Object.assign(emptyRecipe(), defaults || {});
    r.title = stripMd(title).replace(/:$/, '');
    let mode = 'desc';
    let ing = null;   // current ingredient group
    let stp = null;   // current step group
    let extra = null; // current extra section
    let extraFromHeading = false;
    let methodSeen = false;
    const desc = [];

    const nextNonEmpty = (i) => { for (let j = i + 1; j < lines.length; j++) { const t = lines[j].trim(); if (t) return t; } return ''; };
    const newIng = (name, note) => { ing = { name: name || '', note: note || '', items: [] }; r.ingredients.push(ing); mode = 'ing'; return ing; };
    const newSteps = (name) => { stp = { name: name || '', items: [] }; r.steps.push(stp); mode = 'steps'; return stp; };
    const ensureSteps = () => stp || newSteps('');
    const newExtra = (titleText, body, fromHeading) => {
      extra = { title: titleText, body: body ? body + '\n' : '' }; r.extras.push(extra); mode = 'extra'; extraFromHeading = !!fromHeading; return extra;
    };

    function handleLabel(label, rest, i) {
      const L = label.replace(/:$/, '').trim();
      const restClean = rest.replace(/^[:\s]+/, '').trim();
      const paren = /^\(.*\)$/.test(restClean) ? restClean.slice(1, -1) : '';
      extraFromHeading = false;
      if (RX.tags.test(L)) { r.tags = normTags(r.tags.concat(restClean.split(/[,;]|\s#/))); return; }
      if (RX.time.test(L)) {
        const kind = (L.match(/^(prep|cook|cooking|active)/i) || [])[1];
        const val = (kind ? cap(kind.replace(/ing$/i, '')) + ' ' : '') + stripMd(restClean);
        r.time = /^total|^time$|^takes|^ready/i.test(L) ? stripMd(restClean) : (r.time ? r.time + ' · ' + val : val);
        return;
      }
      if (RX.category.test(L)) { r.category = stripMd(restClean); return; }
      if (/^image$/i.test(L)) { r.image = restClean; return; }
      if (/^sources?$/i.test(L)) { r.sources.push(...parseSources(restClean)); return; }
      if (RX.yieldLabel.test(L)) {
        r.yield = /^(yield|yields|servings)$/i.test(L) ? stripMd(restClean) : stripMd((L + ' ' + restClean).trim());
        if (/^\d+$/.test(r.yield)) r.yield = 'Serves ' + r.yield;
        return;
      }
      if (RX.ingredients.test(L)) {
        const sub = L.replace(RX.ingredients, '').replace(/^[\s:—–-]+/, '').replace(/^for\s+/i, '');
        newIng(sub, paren || '');
        if (restClean && !paren) restClean.split(/,\s*/).forEach((x) => ing.items.push(x));
        return;
      }
      if (RX.method.test(L)) {
        methodSeen = true;
        let name = L.replace(RX.method, '').replace(/^[\s:—–-]+/, '').replace(/^for\s+/i, '');
        if (!name && r.steps.some((g) => g.name) && r.ingredients.length > 1) name = r.ingredients[r.ingredients.length - 1].name;
        newSteps(name);
        if (restClean && !paren) splitSentences(restClean).forEach((s) => stp.items.push(s));
        return;
      }
      if (RX.notes.test(L)) {
        mode = 'notes';
        if (restClean) r.notes.push(restClean);
        return;
      }
      if (RX.forServing.test(L) && !methodSeen) {
        newIng(L, '');
        if (restClean) restClean.split(/,\s*/).forEach((x) => ing.items.push(x.charAt(0).toUpperCase() + x.slice(1)));
        return;
      }
      const nxt = nextNonEmpty(i);
      if (!restClean || paren) {
        // a bare sub-heading: decide ingredient group vs step group vs extra
        if (!methodSeen && isBullet(nxt) && !RX.notIngredients.test(L)) { newIng(groupName(L), paren); return; }
        if (!methodSeen && isBullet(nxt) && r.ingredients.length === 0 && !r.steps.length && /^for\b/i.test(L)) { newIng(L.replace(/^for\s+/i, ''), paren); return; }
        if (methodSeen && isNumbered(nxt) && !RX.extraish.test(L)) { newSteps(groupName(L)); return; }
        if (!methodSeen && isNumbered(nxt) && !RX.extraish.test(L)) { methodSeen = true; newSteps(L); return; }
      }
      newExtra(L, paren ? '(' + paren + ')' : restClean, false);
    }

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const n = normaliseLine(raw);
      const t = n.text;
      if (!t || /^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
        if (mode === 'extra' && extra && extra.body && !extra.body.endsWith('\n\n')) extra.body += '\n';
        continue;
      }
      // Source lines (may be *italic*)
      if (/^[*_]*\s*sources?\s*:/i.test(t)) {
        const fb = extraFromHeading && extra ? extra.title : '';
        r.sources.push(...parseSources(t, fb));
        continue;
      }
      if (n.kind === 'heading') {
        const h = n.text;
        if (RX.ingredients.test(h) || RX.method.test(h) || RX.notes.test(h) || RX.yieldLabel.test(h) || RX.tags.test(h) || RX.time.test(h)) {
          const m = h.match(/^(.*?)(?::\s*(.*))?$/);
          handleLabel(m[1], m[2] || '', i);
        } else if (!methodSeen && isBullet(nextNonEmpty(i)) && !RX.extraish.test(h) && r.extras.length === 0) {
          newIng(groupName(h), '');
        } else if (methodSeen && isNumbered(nextNonEmpty(i)) && !RX.extraish.test(h) && r.extras.length === 0) {
          newSteps(groupName(h));
        } else {
          newExtra(h, '', true);
        }
        continue;
      }
      // Inside a ### section keep raw markdown
      if (mode === 'extra' && extraFromHeading) { extra.body += raw.trim() + '\n'; continue; }

      // **Label** rest   |  **Label:** rest
      const b = t.match(/^\*\*([^*]+?)\*\*\s*(.*)$/) || t.match(/^__([^_]+?)__\s*(.*)$/);
      if (b && !isBullet(t)) {
        const label = b[1].trim();
        // A bold sentence that is really a step ("**Serve** taco style...") inside steps
        if (mode === 'steps' && b[2] && !/^:/.test(b[2]) && !/:$/.test(label) && !RX.extraish.test(label) && !RX.notes.test(label)) {
          stp.items.push(t); continue;
        }
        handleLabel(label, b[2] || '', i); continue;
      }
      // Plain "Ingredients:" / "Method" line
      const plain = t.match(/^([A-Za-z][A-Za-z '’]{1,40}?)\s*:\s*(.*)$/);
      if (plain && (RX.ingredients.test(plain[1]) || RX.method.test(plain[1]) || RX.notes.test(plain[1]) || RX.yieldLabel.test(plain[1]) || RX.tags.test(plain[1]) || RX.time.test(plain[1]) || RX.category.test(plain[1]))
        && (plain[2] === '' || !RX.ingredients.test(plain[1]))) {
        handleLabel(plain[1], plain[2], i); continue;
      }
      if (/^(ingredients|method|instructions|directions|steps|notes)$/i.test(t)) { handleLabel(t, '', i); continue; }

      if (isBullet(t)) {
        const item = bulletText(t);
        if (mode === 'ing') ing.items.push(item);
        else if (mode === 'steps') stp.items.push(item);
        else if (mode === 'notes') r.notes.push(item);
        else if (mode === 'extra') extra.body += '- ' + item + '\n';
        else { // desc
          if (!ing) newIng('', '');
          ing.items.push(item);
        }
        continue;
      }
      if (isNumbered(t)) {
        const item = numberedText(t);
        if (mode === 'extra') { extra.body += t + '\n'; continue; }
        if (mode !== 'steps') { methodSeen = true; newSteps(''); }
        stp.items.push(item);
        continue;
      }
      // Paragraph text
      if (mode === 'desc') {
        if (/^[*_].*[*_]$/.test(t) && /last updated/i.test(t)) continue;
        desc.push(t);
      } else if (mode === 'ing') {
        if (looksLikeIngredient(t) && t.length < 90) ing.items.push(t);
        else {
          // instructions attached to a component (e.g. "Combine in a jar…" under Ginger bug)
          newSteps(ing.name);
          splitSentences(t).forEach((s) => stp.items.push(s));
          mode = 'ing-para';
        }
      } else if (mode === 'ing-para') {
        splitSentences(t).forEach((s) => stp.items.push(s));
      } else if (mode === 'steps') {
        splitSentences(t).forEach((s) => stp.items.push(s));
      } else if (mode === 'notes') {
        r.notes.push(t);
      } else if (mode === 'extra') {
        extra.body += t + '\n';
      }
    }
    const chatty = (n) => n.length < 40 && /^(enjoy|bon app|happy (cooking|baking)|let me know|hope you)/i.test(n);
    r.notes = r.notes.filter((n) => !chatty(n));
    r.steps.forEach((g) => { g.items = g.items.filter((n) => !chatty(n)); });
    r.description = stripMd(desc.join(' '));
    r.ingredients = r.ingredients.filter((g) => g.items.length);
    r.steps = r.steps.filter((g) => g.items.length);
    r.extras.forEach((e) => { e.body = e.body.replace(/\n{3,}/g, '\n\n').trim(); });
    r.extras = r.extras.filter((e) => e.body || e.title);
    r.tags = normTags(r.tags);
    return r;
  }

  /**
   * Parse a whole book in the "Waynesdays" markdown format (or any markdown with ## per recipe).
   */
  function parseBook(md) {
    const lines = String(md || '').replace(/\r/g, '').split('\n');
    let bookTitle = '';
    let category = '';
    let current = null;
    let skipping = false;
    const blocks = [];
    for (const line of lines) {
      const h1 = line.match(/^#\s+(.+)$/);
      const h2 = line.match(/^##\s+(.+)$/);
      if (h1) {
        const text = stripMd(h1[1]);
        if (!bookTitle && !blocks.length && text !== text.toUpperCase()) { bookTitle = text; current = null; continue; }
        category = /[a-z]/.test(text) ? text : titleCase(text);
        current = null; skipping = false; continue;
      }
      if (h2) {
        const text = stripMd(h2[1]);
        if (/^(contents|table of contents|index)$/i.test(text)) { skipping = true; current = null; continue; }
        skipping = false;
        current = { title: text, category, lines: [] };
        blocks.push(current);
        continue;
      }
      if (current && !skipping) current.lines.push(line);
    }
    const recipes = blocks.map((b) => parseRecipeLines(b.title, b.lines, { category: b.category }));
    return { title: bookTitle, recipes };
  }

  /**
   * Parse free text pasted from a chat / notes app. Returns an array of recipes.
   */
  function parseText(text) {
    const src = String(text || '').replace(/\r/g, '').replace(/ /g, ' ').trim();
    if (!src) return [];
    // JSON (our export or schema.org)
    if (/^[\[{]/.test(src)) {
      try {
        const data = JSON.parse(src);
        const fromJson = fromAnyJson(data);
        if (fromJson.length) return fromJson;
      } catch (e) { /* not json */ }
    }
    const h2count = (src.match(/^##\s+/gm) || []).length;
    const ingCount = (src.match(/ingredients/gi) || []).length;
    if (h2count > 1 && ingCount > 1) {
      const book = parseBook(src);
      const good = book.recipes.filter((r) => r.ingredients.length || r.steps.length || r.extras.length);
      if (good.length > 1) return good;
    }
    const lines = src.split('\n');
    // find title: prefer the first markdown heading / bold-only line that isn't a section label;
    // otherwise the first short line that isn't chatty preamble ("Sure! Here's…").
    let title = '';
    let start = 0;
    const firstSection = lines.findIndex((l) => { const t = stripMd(l.replace(/^#+\s*/, '')).replace(/:$/, ''); return RX.ingredients.test(t) || RX.method.test(t); });
    const limit = firstSection === -1 ? lines.length : firstSection;
    const isLabel = (c) => RX.ingredients.test(c) || RX.method.test(c) || RX.notes.test(c) || RX.yieldLabel.test(c) || RX.time.test(c.split(':')[0]);
    for (let i = 0; i < limit && !title; i++) {
      const t = lines[i].trim();
      const h = t.match(/^#{1,6}\s+(.*)$/) || t.match(/^\*\*([^*]+)\*\*$/);
      if (h && !isLabel(stripMd(h[1]))) { title = stripMd(h[1]); start = i + 1; }
    }
    for (let i = 0; i < limit && !title; i++) {
      const t = lines[i].trim();
      if (!t || isBullet(t) || isNumbered(t)) continue;
      if (/^(sure|okay|ok|absolutely|of course|great|here(?:'|’)s|here is|certainly)\b/i.test(t) || /[!?]$/.test(t) || t.length > 80 || isLabel(stripMd(t))) continue;
      title = stripMd(t).replace(/[.:]$/, ''); start = i + 1;
    }
    if (!title) title = 'Untitled recipe';
    // skip chatty preambles like "Here's a recipe for..."
    title = title.replace(/^(here(?:'|’)s|here is)\s+(a|an|the|your|my)?\s*(recipe for\s+)?/i, '').replace(/[:!.]$/, '');
    title = title.charAt(0).toUpperCase() + title.slice(1);
    const r = parseRecipeLines(title, lines.slice(start), {});
    return [r];
  }

  // ---------- schema.org / JSON ----------
  function asArray(x) { return x == null ? [] : Array.isArray(x) ? x : [x]; }
  function decodeEntities(s) {
    return String(s || '').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
  }
  const cleanText = (s) => decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

  function isoDuration(d) {
    const m = String(d || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
    if (!m) return cleanText(d);
    const days = +m[1] || 0, h = +m[2] || 0, min = +m[3] || 0;
    const total = days * 1440 + h * 60 + min;
    if (!total) return '';
    const hh = Math.floor(total / 60), mm = total % 60;
    return (hh ? hh + ' hr' + (mm ? ' ' : '') : '') + (mm ? mm + ' min' : '');
  }

  function findRecipeNodes(data, out) {
    out = out || [];
    if (!data || typeof data !== 'object') return out;
    if (Array.isArray(data)) { data.forEach((d) => findRecipeNodes(d, out)); return out; }
    const type = asArray(data['@type']).map(String);
    if (type.some((t) => /(^|\/)Recipe$/i.test(t))) out.push(data);
    if (data['@graph']) findRecipeNodes(data['@graph'], out);
    if (data.mainEntity) findRecipeNodes(data.mainEntity, out);
    if (data.itemListElement) findRecipeNodes(asArray(data.itemListElement).map((x) => x.item || x), out);
    return out;
  }

  function guessCategory(text) {
    const t = String(text || '').toLowerCase();
    if (/(drink|cocktail|beverage|smoothie|tea|coffee|latte|lemonade|punch|spritz|mocktail)/.test(t)) return 'Drinks';
    if (/(breakfast|brunch|pancake|waffle|oatmeal|granola|egg bake|french toast)/.test(t)) return 'Breakfast';
    if (/(dessert|cookie|cake|bak|bread|muffin|pie|brownie|sweet|tart|pastry|scone)/.test(t)) return 'Baking and Sweets';
    if (/(soup|stew|chowder|broth|ramen|pho)/.test(t)) return 'Soups';
    if (/(sauce|dressing|spice|seasoning|marinade|condiment|pickle|ferment|kimchi|salsa|chutney|jam|rub)/.test(t)) return 'Sauces, Spices and Ferments';
    if (/(salad|side|slaw|vegetable|potato)/.test(t)) return 'Sides and Salads';
    return 'Mains';
  }

  function fromSchema(node, pageUrl) {
    const r = emptyRecipe();
    r.title = cleanText(node.name || node.headline || 'Untitled recipe');
    r.description = cleanText(node.description);
    const img = asArray(node.image)[0];
    r.image = typeof img === 'string' ? img : (img && (img.url || img.contentUrl)) || '';
    r.time = isoDuration(node.totalTime) || [isoDuration(node.prepTime), isoDuration(node.cookTime)].filter(Boolean).join(' + ');
    const y = asArray(node.recipeYield).map(cleanText).filter(Boolean);
    r.yield = y.length ? (y.find((v) => /\D/.test(v)) || ('Serves ' + y[0])) : '';
    const kw = typeof node.keywords === 'string' ? node.keywords.split(',') : asArray(node.keywords);
    const cuisine = asArray(node.recipeCuisine).map(cleanText);
    const cats = asArray(node.recipeCategory).map(cleanText);
    r.tags = normTags(cuisine.concat(cats, kw.slice(0, 6)).map((x) => cleanText(x)));
    r.category = guessCategory(cats.join(' ') + ' ' + r.title);
    const items = asArray(node.recipeIngredient || node.ingredients).map(cleanText).filter(Boolean);
    if (items.length) r.ingredients.push({ name: '', note: '', items });
    const walk = (list, groupName) => {
      let g = null;
      asArray(list).forEach((s) => {
        if (typeof s === 'string') {
          if (!g) { g = { name: groupName || '', items: [] }; r.steps.push(g); }
          g.items.push(cleanText(s));
        } else if (s && /HowToSection/i.test(asArray(s['@type']).join())) {
          walk(s.itemListElement, cleanText(s.name));
          g = null;
        } else if (s) {
          if (!g) { g = { name: groupName || '', items: [] }; r.steps.push(g); }
          const txt = cleanText(s.text || s.name || s.description);
          if (txt) g.items.push(txt);
        }
      });
    };
    const ri = node.recipeInstructions;
    if (typeof ri === 'string') {
      const txt = decodeEntities(ri.replace(/<\/(p|li|br)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));
      const parts = txt.split(/\n+/).map((x) => x.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
      r.steps.push({ name: '', items: parts.length > 1 ? parts : splitSentences(txt) });
    } else walk(ri, '');
    r.steps = r.steps.filter((g) => g.items.length);
    if (pageUrl || node.url) r.sources.push({ label: hostLabel(pageUrl || node.url), url: pageUrl || node.url });
    const author = asArray(node.author)[0];
    const authorName = typeof author === 'string' ? author : author && author.name;
    if (authorName) r.notes.push('Recipe by ' + cleanText(authorName) + '.');
    return r;
  }

  function hostLabel(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return 'Web'; } }

  function fromAnyJson(data) {
    if (data && data.recipes && Array.isArray(data.recipes)) return data.recipes.filter((r) => r && r.title);
    if (Array.isArray(data) && data.length && data[0] && data[0].title && data[0].ingredients) return data;
    if (data && data.title && data.ingredients && !data['@type']) return [data];
    return findRecipeNodes(data).map((n) => fromSchema(n));
  }

  /**
   * Extract recipes from a full HTML page (string). Uses DOMParser when available, regex otherwise.
   */
  function parseHtml(html, pageUrl) {
    const src = String(html || '');
    const out = [];
    const re = /<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(src))) {
      const json = tryJson(m[1]);
      if (json) findRecipeNodes(json).forEach((n) => out.push(fromSchema(n, pageUrl)));
    }
    if (out.length) return out;
    // Microdata / plain-text fallback via DOM
    if (typeof DOMParser !== 'undefined') {
      const doc = new DOMParser().parseFromString(src, 'text/html');
      const md = doc.querySelector('[itemtype*="schema.org/Recipe"]');
      if (md) {
        const get = (p) => Array.from(md.querySelectorAll('[itemprop="' + p + '"]')).map((e) => e.getAttribute('content') || e.textContent);
        const node = { '@type': 'Recipe', name: get('name')[0], description: get('description')[0], recipeIngredient: get('recipeIngredient').concat(get('ingredients')),
          recipeInstructions: get('recipeInstructions').map((x) => cleanText(x)), recipeYield: get('recipeYield')[0], totalTime: get('totalTime')[0], image: (md.querySelector('[itemprop="image"]') || {}).src };
        return [fromSchema(node, pageUrl)];
      }
      doc.querySelectorAll('script,style,nav,header,footer,aside,form,noscript,iframe').forEach((e) => e.remove());
      const main = doc.querySelector('article, main, [role=main]') || doc.body;
      if (main) {
        const text = htmlToText(main);
        const parsed = parseText(text);
        const title = cleanText((doc.querySelector('h1') || doc.querySelector('title') || {}).textContent || '');
        if (parsed[0]) {
          if (title) parsed[0].title = title;
          if (pageUrl) parsed[0].sources.push({ label: hostLabel(pageUrl), url: pageUrl });
          if (parsed[0].ingredients.length || parsed[0].steps.length) return parsed;
        }
      }
    }
    return [];
  }

  function htmlToText(el) {
    const lines = [];
    const walk = (node) => {
      node.childNodes.forEach((c) => {
        if (c.nodeType === 3) { const t = c.textContent.replace(/\s+/g, ' '); if (t.trim()) lines.push({ t, inline: true }); return; }
        if (c.nodeType !== 1) return;
        const tag = c.tagName.toLowerCase();
        if (/^h[1-6]$/.test(tag)) { lines.push({ t: '\n## ' + c.textContent.trim() + '\n' }); return; }
        if (tag === 'li') {
          const ol = c.parentElement && c.parentElement.tagName === 'OL';
          lines.push({ t: '\n' + (ol ? '1. ' : '- ') + c.textContent.replace(/\s+/g, ' ').trim() }); return;
        }
        if (/^(p|div|section|br|tr|ul|ol)$/.test(tag)) { lines.push({ t: '\n' }); walk(c); lines.push({ t: '\n' }); return; }
        walk(c);
      });
    };
    walk(el);
    return lines.map((x) => x.t).join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^## /m, '# ').trim();
  }

  function tryJson(s) {
    try { return JSON.parse(s.trim()); } catch (e) {
      try { return JSON.parse(s.trim().replace(/[\u0000-\u001f]+/g, ' ')); } catch (e2) { return null; }
    }
  }

  // ---------- voice dictation -> recipe ----------
  const NUMWORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, sixty: 60, 'a half': '1/2', half: '1/2', 'a quarter': '1/4', quarter: '1/4', 'three quarters': '3/4' };

  function parseSpoken(transcript) {
    let text = ' ' + String(transcript || '').replace(/\s+/g, ' ').trim() + ' ';
    const r = emptyRecipe();
    const markers = [
      ['title', /\b(?:title|recipe name|recipe called|call it|it'?s called)\b[:,]?/gi],
      ['ingredients', /\b(?:ingredients?|you(?:'|’)ll need|you need)\b[:,]?/gi],
      ['steps', /\b(?:steps|method|instructions|directions|how to make it)\b[:,]?/gi],
      ['notes', /\b(?:notes?|tips?)\b[:,]?/gi],
      ['tags', /\b(?:tags?|tagged)\b[:,]?/gi],
      ['yield', /\b(?:serves|servings|makes|yield)\b/gi],
      ['time', /\b(?:takes|total time|cook time|time)\b[:,]?/gi],
      ['category', /\bcategory\b[:,]?/gi],
    ];
    const hits = [];
    markers.forEach(([key, rx]) => { let m; rx.lastIndex = 0; while ((m = rx.exec(text))) hits.push({ key, start: m.index, end: m.index + m[0].length, word: m[0] }); });
    hits.sort((a, b) => a.start - b.start);
    // keep only the first occurrence of each section keyword, except in-section words like "time" inside steps
    const chosen = [];
    const seen = new Set();
    hits.forEach((h) => {
      if (seen.has(h.key)) return;
      const inside = chosen.length ? chosen[chosen.length - 1].key : null;
      if ((h.key === 'time' || h.key === 'yield' || h.key === 'notes' || h.key === 'tags' || h.key === 'category') && (inside === 'steps' || inside === 'ingredients')) {
        // only accept if phrased like a section switch: preceded by "next"/"." or at a pause
        const before = text.slice(Math.max(0, h.start - 12), h.start).toLowerCase();
        if (!/(next|\.|,|and)\s*$/.test(before) && h.key !== 'notes' && h.key !== 'tags') return;
      }
      chosen.push(h); seen.add(h.key);
    });
    const sections = {};
    const pre = text.slice(0, chosen.length ? chosen[0].start : text.length).trim();
    chosen.forEach((h, i) => {
      const end = i + 1 < chosen.length ? chosen[i + 1].start : text.length;
      const body = text.slice(h.end, end).trim().replace(/^[:,.\s]+|[,\s]+$/g, '');
      sections[h.key] = h.key === 'yield' ? (h.word.trim() + ' ' + body) : body;
    });
    r.title = cap((sections.title || (pre.length && pre.length < 90 ? pre : '') || 'Voice recipe').replace(/[.,]$/, ''));
    if (!sections.title && pre.length >= 90) r.description = cap(pre);
    if (sections.yield) r.yield = cap(sections.yield.replace(/[.,]$/, ''));
    if (sections.time) r.time = sections.time.replace(/[.,]$/, '');
    if (sections.category) r.category = titleCase(sections.category.replace(/[.,]$/, ''));
    if (sections.tags) r.tags = normTags(sections.tags.split(/,|\band\b|\bnext\b/));
    if (sections.ingredients) r.ingredients.push({ name: '', note: '', items: splitSpokenIngredients(sections.ingredients) });
    if (sections.steps) r.steps.push({ name: '', items: splitSpokenSteps(sections.steps) });
    if (sections.notes) r.notes = splitSpokenSteps(sections.notes);
    r.category = r.category || guessCategory(r.title + ' ' + r.tags.join(' '));
    return r;
  }

  function groupName(s) { return cap(String(s).replace(/:$/, '').replace(/^for\s+(the\s+)?/i, '')); }
  function cap(s) { s = String(s || '').trim(); return s.charAt(0).toUpperCase() + s.slice(1); }

  function spokenNumbers(s) {
    return s.replace(/\b(a half|a quarter|three quarters|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|sixty|half|quarter)\b(?=\s+(?:and\s+a\s+half\s+)?(?:cups?|tablespoons?|teaspoons?|tbsp|tsp|pounds?|lbs?|ounces?|oz|grams?|kilos?|cloves?|cans?|sticks?|pinch(?:es)?|large|medium|small|whole|inch|eggs?|onions?|limes?|lemons?|of|to)\b)/gi,
      (w) => String(NUMWORDS[w.toLowerCase()]))
      .replace(/(\d+)\s+and\s+a\s+half\b/gi, (_, n) => n + ' 1/2')
      .replace(/\btablespoons?\b/gi, 'tbsp').replace(/\bteaspoons?\b/gi, 'tsp');
  }

  function splitSpokenIngredients(s) {
    s = spokenNumbers(s);
    let parts = s.split(/\s*(?:\bnext(?: ingredient| item)?\b|\bnew line\b|[;\n]|\.\s)\s*/i).map((x) => x.trim()).filter(Boolean);
    // split further when a new quantity starts mid-phrase ("2 cups flour 1 tsp salt")
    const out = [];
    parts.forEach((p) => {
      const pieces = p.split(/,\s*(?=\d)|\s+(?=\d+(?:\/\d+)?\s*(?:cups?|tbsp|tsp|pounds?|lbs?|ounces?|oz|grams?|g|kg|ml|cloves?|cans?|sticks?|large|medium|small|whole|pinch)\b)(?<!\bto\s)(?<!\d\s)(?<!\band\s)/i);
      pieces.forEach((x) => { x = x.replace(/^(and|also|plus)\s+/i, '').replace(/[,.]$/, '').trim(); if (x) out.push(cap(x)); });
    });
    return out;
  }

  function splitSpokenSteps(s) {
    const parts = s.split(/\s*(?:\bnext step\b|\bstep (?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b[:,.]?|\bnext\b|\bnew line\b|\n)\s*/i).map((x) => x.trim()).filter(Boolean);
    const out = [];
    (parts.length > 1 ? parts : splitSentences(s)).forEach((p) => {
      p = p.replace(/^(then|and then|first|after that|finally)[,\s]+/i, '').replace(/[,]$/, '').trim();
      if (p) out.push(cap(/[.!?]$/.test(p) ? p : p + '.'));
    });
    return out;
  }

  // ---------- quantities & scaling ----------
  const UNI = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875, '⅕': 0.2, '⅙': 1 / 6 };
  const NUM = '(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?\\s*[½⅓⅔¼¾⅛⅜⅝⅞]|\\d+(?:\\.\\d+)?|[½⅓⅔¼¾⅛⅜⅝⅞])';
  const QTY_RX = new RegExp('^((?:about|approx\\.?|roughly|juice of|zest of|optional:)\\s+)?(' + NUM + ')(\\s*(?:to|-|–|or)\\s*(' + NUM + '))?', 'i');

  function toNumber(s) {
    s = String(s).trim();
    let m;
    if ((m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + m[2] / m[3];
    if ((m = s.match(/^(\d+)\/(\d+)$/))) return m[1] / m[2];
    if ((m = s.match(/^(\d+(?:\.\d+)?)\s*([½⅓⅔¼¾⅛⅜⅝⅞])$/))) return +m[1] + UNI[m[2]];
    if (UNI[s] != null) return UNI[s];
    return parseFloat(s);
  }

  const FRACS = [[0, ''], [1 / 8, '1/8'], [1 / 6, '1/6'], [1 / 4, '1/4'], [1 / 3, '1/3'], [3 / 8, '3/8'], [1 / 2, '1/2'], [5 / 8, '5/8'], [2 / 3, '2/3'], [3 / 4, '3/4'], [5 / 6, '5/6'], [7 / 8, '7/8'], [1, '']];
  function formatQty(n, style, unit) {
    if (!isFinite(n)) return '';
    const metric = /^(g|kg|ml|l|grams?|kilos?)\b/i.test(unit || '');
    if (metric) {
      if (n >= 100) return String(Math.round(n / 5) * 5);
      if (n >= 10) return String(Math.round(n));
      return String(Math.round(n * 10) / 10);
    }
    if (n >= 20) return String(Math.round(n));
    if (style === 'decimal') return String(Math.round(n * 100) / 100);
    const whole = Math.floor(n);
    const frac = n - whole;
    let best = FRACS[0], diff = 1;
    FRACS.forEach((f) => { const d = Math.abs(frac - f[0]); if (d < diff) { diff = d; best = f; } });
    if (diff > 0.04) return String(Math.round(n * 100) / 100);
    const w = best[0] === 1 ? whole + 1 : whole;
    if (!best[1]) return String(w);
    return w ? w + ' ' + best[1] : best[1];
  }

  function scaleIngredient(text, factor) {
    if (!factor || Math.abs(factor - 1) < 1e-9) return text;
    const m = String(text).match(QTY_RX);
    if (!m) return text;
    const after = text.slice(m[0].length);
    const unit = (after.match(/^\s*([a-zA-Z]+)/) || [])[1] || '';
    const style = /\./.test(m[2]) ? 'decimal' : 'frac';
    const a = formatQty(toNumber(m[2]) * factor, style, unit);
    const b = m[4] ? formatQty(toNumber(m[4]) * factor, style, unit) : null;
    const sep = m[3] ? m[3].replace(m[4], '') : '';
    return (m[1] || '') + a + (b ? sep + b : '') + after;
  }

  // ---------- timers ----------
  const WORDNUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, sixty: 60, ninety: 90 };
  const TIMER_RX = /\b(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|forty-five|sixty|ninety)(?:\s*(?:to|-|–|or)\s*(\d+(?:\.\d+)?))?\s*(?:more\s+)?(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/gi;

  function findTimers(text) {
    const out = [];
    const s = stripMd(text);
    let m;
    TIMER_RX.lastIndex = 0;
    while ((m = TIMER_RX.exec(s))) {
      const n1 = isNaN(+m[1]) ? WORDNUM[m[1].toLowerCase()] : +m[1];
      if (n1 == null) continue;
      const n2 = m[2] ? +m[2] : null;
      const unit = m[3].toLowerCase();
      const mult = /^s/.test(unit) ? 1 : /^m/.test(unit) ? 60 : 3600;
      const secs = Math.round(n1 * mult);
      if (secs < 5 || secs > 72 * 3600) continue;
      if (/^(a|an)$/i.test(m[1]) && /^s/.test(unit)) continue;
      out.push({ text: m[0], index: m.index, seconds: secs, maxSeconds: n2 ? Math.round(n2 * mult) : null });
    }
    return out;
  }

  function fmtDuration(secs) {
    secs = Math.max(0, Math.round(secs));
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    if (h) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return m + ':' + String(s).padStart(2, '0');
  }
  function fmtDurationWords(secs) {
    if (secs < 60) return secs + ' sec';
    const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
    return (h ? h + ' hr' : '') + (h && m ? ' ' : '') + (m ? m + ' min' : '');
  }

  // ---------- ingredient <-> step matching ----------
  const STOP = new Set(('cup cups tbsp tsp tablespoon tablespoons teaspoon teaspoons oz ounce ounces lb lbs pound pounds g kg ml l gram grams inch inches piece pieces ' +
    'large medium small whole fresh freshly dried ground chopped minced sliced diced grated crushed torn cracked peeled unpeeled finely roughly thinly lightly ' +
    'optional about plus more for the and or of to a an in into with taste pinch handful bunch head can cans stick sticks slice slices part parts ' +
    'room temp temperature packed loose loosely extra good quality divided each cut halved quartered trimmed smashed bite sized bite-sized day old day-old ' +
    'boneless skinless bone-in unsalted salted kosher fine coarse flaky light dark hot cold warm filtered boiling half few some juiced zested wedges wedge').split(' '));
  const GENERIC = new Set(['pods', 'pod', 'sauce', 'paste', 'leaves', 'leaf', 'seeds', 'seed', 'juice', 'extract', 'powder', 'flakes', 'berries', 'cloves', 'clove', 'shoots', 'wine', 'stock', 'vinegar', 'thighs', 'thigh']);

  const stem = (w) => {
    w = w.toLowerCase();
    if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (w.length > 4 && /(oes|ches|shes|sses)$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
    return w;
  };

  function ingredientKey(item) {
    let core = stripMd(item).replace(/\([^)]*\)/g, ' ').replace(/^optional:\s*/i, '').split(/,|\bor\b|;/)[0];
    core = core.replace(new RegExp('^' + NUM + '(\\s*(to|-|–)\\s*' + NUM + ')?', 'i'), '').replace(/\d+(\.\d+)?/g, ' ');
    const words = core.toLowerCase().match(/[a-zà-ÿ'-]+/g) || [];
    const sig = words.filter((w) => w.length > 2 && !STOP.has(w)).map(stem);
    if (!sig.length) return null;
    const head = sig[sig.length - 1];
    if (GENERIC.has(head) || GENERIC.has(head + 's')) return sig.length > 1 ? sig[sig.length - 2] : head;
    return head;
  }

  function ingredientsForStep(stepText, ingredientGroups) {
    const words = new Set((stripMd(stepText).toLowerCase().match(/[a-zà-ÿ'-]+/g) || []).map(stem));
    const out = [];
    (ingredientGroups || []).forEach((g, gi) => g.items.forEach((item, ii) => {
      const k = ingredientKey(item);
      if (k && words.has(k)) out.push({ g: gi, i: ii, item });
    }));
    return out;
  }

  // ---------- markdown export ----------
  function toMarkdown(r) {
    const L = [];
    L.push('## ' + r.title, '');
    if (r.description) L.push(r.description, '');
    if (r.tags && r.tags.length) L.push('**Tags:** ' + r.tags.join(', '));
    if (r.time) L.push('**Time:** ' + r.time);
    if ((r.tags && r.tags.length) || r.time) L.push('');
    if (r.yield) L.push(/^(serves|makes)\b/i.test(r.yield) ? '**' + r.yield + '**' : '**Yield:** ' + r.yield, '');
    (r.ingredients || []).forEach((g) => {
      const head = g.name ? g.name : 'Ingredients';
      L.push('**' + head + '**' + (g.note ? ' (' + g.note + ')' : ''));
      g.items.forEach((x) => L.push('- ' + x));
      L.push('');
    });
    (r.steps || []).forEach((g) => {
      L.push('**Method' + (g.name ? ': ' + g.name : '') + '**');
      g.items.forEach((x, i) => L.push((i + 1) + '. ' + x));
      L.push('');
    });
    if (r.notes && r.notes.length) { L.push('**Notes**'); r.notes.forEach((n) => L.push('- ' + n)); L.push(''); }
    (r.extras || []).forEach((e) => { L.push('### ' + e.title, '', e.body, ''); });
    if (r.sources && r.sources.length) {
      L.push('*Source: ' + r.sources.map((s, i) => (i === 0 && !s.label ? '' : (s.label ? s.label + ': ' : '')) + s.url).join(' · ') + '*', '');
    }
    return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  function bookToMarkdown(title, recipes, categories) {
    const byCat = {};
    recipes.forEach((r) => { const c = r.category || 'Uncategorized'; (byCat[c] = byCat[c] || []).push(r); });
    const order = uniq((categories || CATEGORIES).concat(Object.keys(byCat))).filter((c) => byCat[c]);
    const L = ['# ' + (title || 'Recipe Book'), '', '*Exported ' + new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) + '*', '', '## Contents', ''];
    order.forEach((c) => L.push('**' + c + ':** ' + byCat[c].map((r) => r.title).join(' · '), ''));
    L.push('---', '');
    order.forEach((c) => {
      L.push('# ' + c.toUpperCase(), '');
      byCat[c].forEach((r) => { L.push(toMarkdown(r), '---', ''); });
    });
    return L.join('\n');
  }

  const timerRx = () => new RegExp(TIMER_RX.source, 'gi');

  const RB = { CATEGORIES, timerRx, slugify, titleCase, stripMd, splitSentences, normTags, emptyRecipe, parseBook, parseText, parseRecipeLines,
    parseHtml, fromSchema, findRecipeNodes, fromAnyJson, parseSpoken, guessCategory, hostLabel,
    scaleIngredient, toNumber, formatQty, findTimers, fmtDuration, fmtDurationWords, ingredientKey, ingredientsForStep,
    toMarkdown, bookToMarkdown };
  if (typeof module !== 'undefined' && module.exports) module.exports = RB;
  else root.RB = RB;
})(typeof window !== 'undefined' ? window : globalThis);
