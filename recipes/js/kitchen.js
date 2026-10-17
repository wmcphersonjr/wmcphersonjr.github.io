/* Kitchen logic: ingredient parsing, unit math, grocery merging & aisles, pairings.
   Works in the browser (window.RK) and in Node (module.exports). Depends on RB (parse.js). */
(function (root) {
  'use strict';
  const RB = root.RB || (typeof require !== 'undefined' ? require('./parse.js') : null);

  // ---------- units ----------
  const UNITS = {
    tsp: { fam: 'vol', ml: 4.929, re: 'teaspoons?|tsps?\\.?|tsp\\.?' },
    tbsp: { fam: 'vol', ml: 14.787, re: 'tablespoons?|tbsps?\\.?|tbsp\\.?|tbs\\.?' },
    cup: { fam: 'vol', ml: 236.6, re: 'cups?' },
    floz: { fam: 'vol', ml: 29.57, re: 'fl\\.? ?oz\\.?|fluid ounces?' },
    pint: { fam: 'vol', ml: 473.2, re: 'pints?|pt\\.?' },
    quart: { fam: 'vol', ml: 946.4, re: 'quarts?|qts?\\.?' },
    gallon: { fam: 'vol', ml: 3785, re: 'gallons?|gal\\.?' },
    ml: { fam: 'vol', ml: 1, re: 'milliliters?|millilitres?|ml' },
    l: { fam: 'vol', ml: 1000, re: 'liters?|litres?|l' },
    oz: { fam: 'wt', g: 28.35, re: 'ounces?|oz\\.?' },
    lb: { fam: 'wt', g: 453.6, re: 'pounds?|lbs?\\.?' },
    g: { fam: 'wt', g: 1, re: 'grams?|gr\\.?|g' },
    kg: { fam: 'wt', g: 1000, re: 'kilograms?|kilos?|kg' },
  };
  const COUNT_UNITS = {
    can: 'cans?|tins?', jar: 'jars?', package: 'packages?|packets?|pkgs?\\.?|bags?|boxes?', bunch: 'bunch(?:es)?',
    head: 'heads?', clove: 'cloves?', sprig: 'sprigs?', stalk: 'stalks?|ribs?', slice: 'slices?', stick: 'sticks?',
    piece: 'pieces?', fillet: 'fillets?', ear: 'ears?', pinch: 'pinch(?:es)?', dash: 'dash(?:es)?', handful: 'handfuls?', bottle: 'bottles?', loaf: 'loa(?:f|ves)',
  };
  const unitAlternation = Object.entries(UNITS).map(([k, u]) => `(?<${k}>${u.re})`)
    .concat(Object.entries(COUNT_UNITS).map(([k, re]) => `(?<c_${k}>${re})`)).join('|');
  const UNIT_RX = new RegExp('^(?:' + unitAlternation + ')(?![a-z])\\.?\\s*', 'i');
  const NUM = '(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?\\s*[½⅓⅔¼¾⅛⅜⅝⅞]|\\d+(?:\\.\\d+)?|[½⅓⅔¼¾⅛⅜⅝⅞])';
  const QTY_RX = new RegExp('^(' + NUM + ')(?:\\s*(?:to|-|–|or)\\s*(' + NUM + '))?\\s*');
  const num = (s) => RB.toNumber(String(s).replace(/\s+/g, ' ').trim());

  // ---------- name normalization ----------
  const DESCRIPTORS = new Set(('fresh freshly large medium small extra-large jumbo whole chopped minced diced sliced thinly finely roughly coarsely grated ' +
    'crushed peeled seeded stemmed trimmed halved quartered softened melted cold warm room-temperature packed loosely lightly divided unsalted ' +
    'extra-virgin virgin pure plain good-quality ripe firm boneless skinless day-old leftover store-bought homemade organic well-rinsed rinsed ' +
    'drained about approximately juiced zested shredded cubed scrubbed smashed bashed uncooked raw tightly heaping scant level sifted jarred filtered mild').split(' '));
  const SYNONYMS = [
    [/^(cloves? )?garlic( cloves?)?$|^garlic clove$/, 'garlic'],
    [/^(green|spring) onions?$|^scallion( (whites|greens))?$/, 'scallion'],
    [/^cilantro( leaves| and tender stems)?$/, 'cilantro'],
    [/^(kosher|sea|fine sea|fine|table|coarse kosher|coarse sea) salt$|^salt$/, 'salt'],
    [/^(ground )?(black )?pepper(corns)?$|^black pepper$/, 'black pepper'],
    [/^(neutral|vegetable|canola|grapeseed|peanut) oil$|^neutral-tasting oil$/, 'neutral oil'],
    [/^olive oil$/, 'olive oil'],
    [/^(all-purpose|ap|plain) flour$|^flour$/, 'all-purpose flour'],
    [/^(granulated|white|caster) sugar$|^sugar$/, 'sugar'],
    [/^(confectioners'?|powdered|icing) sugar$/, 'powdered sugar'],
    [/^(egg|eggs|egg yolks?|egg whites?)$/, 'egg'],
    [/^(lemon wedges?|lemon juice|lemons?)$/, 'lemon'],
    [/^(lime wedges?|lime juice|limes?)$/, 'lime'],
    [/^(fresh )?basil( leaves)?$|^thai basil$/, 'basil'],
    [/^(flat-leaf |italian )?parsley( leaves)?$/, 'parsley'],
    [/^(fresh )?thyme( sprigs| leaves)?$/, 'thyme'],
    [/^(fresh )?rosemary( sprigs)?$/, 'rosemary'],
    [/^(fresh )?sage( leaves)?$/, 'sage'],
    [/^vanilla$|^(pure )?vanilla extract$/, 'vanilla extract'],
    [/^(chicken|vegetable|beef|pork) (stock|broth)$/, null], // keep as-is
    [/^parmesan( cheese)?$|^parmigiano(-| )reggiano$/, 'parmesan'],
    [/^((ice|boiling|hot|warm|cold|tap|lukewarm|filtered) )?water$|^ice( cubes?)?$/, 'water'],
  ];
  function singular(w) {
    if (/(ss|us|is)$/.test(w) || w.length < 4) return w;
    if (/^chil+ies$/.test(w)) return w.slice(0, -2);
    if (/(cookie|brownie|calorie|smoothie|veggie|pie)s$/.test(w)) return w.slice(0, -1);
    if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (/(tomato|potato)es$/.test(w)) return w.slice(0, -2);
    if (/(lea|hal|loa)ves$/.test(w)) return w.slice(0, -3) + 'f';
    if (/(ch|sh|x)es$/.test(w)) return w.slice(0, -2);
    if (/s$/.test(w)) return w.slice(0, -1);
    return w;
  }
  function plural(name, n) {
    if (!(n > 1)) return name;
    const parts = name.split(' ');
    let w = parts.pop();
    if (/(sh|ch|x|ss)$/.test(w)) w += 'es';
    else if (/[^aeiou]y$/.test(w)) w = w.slice(0, -1) + 'ies';
    else if (/(tomato|potato)$/.test(w)) w += 'es';
    else if (/(lea|hal|loa)f$/.test(w)) w = w.slice(0, -1) + 'ves';
    else if (!/s$/.test(w)) w += 's';
    return parts.concat(w).join(' ');
  }
  function normalizeName(rest) { return normalizeNameEx(rest).name; }
  function normalizeNameEx(rest) {
    let s = String(rest || '').toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\s+(for|to) (serving|frying|greasing|garnish|dusting|rolling|the pan|the ramekins|taste|finish)\b.*$/, '')
      .replace(/\s+(mixed|dissolved|whisked|stirred) (with|in)\b.*$/, '')
      .replace(/^plus\s+/, '');
    const clean = (seg) => seg.replace(/^of\s+/, '').replace(/[*_]/g, '')
      .replace(/\b\d+(\.\d+)?(-inch)?\b/g, ' ').replace(/\s+/g, ' ').trim()
      .split(' ').filter((w) => w && !DESCRIPTORS.has(w) && !/-$/.test(w)).join(' ');
    // first segment that still names something ("fresh or dried bay leaves", "ripe, well-rinsed strawberries")
    const segs = s.split(/,|;|\s+or\s+|\s+plus\s+/);
    // "pork or beef stock" → "pork stock"
    const alt = s.split(/,|;/)[0].trim().match(/^(.+?) or (?:\S+ )+?(stock|broth|oil|squash|meat|flour|chiles?|peppers?|vinegar|sugar|beans?|cheese|juice)$/);
    if (alt && /^\S+$/.test(clean(alt[1]))) segs[0] = clean(alt[1]) + ' ' + alt[2];
    s = '';
    for (const seg of segs) { const c = clean(seg); if (c) { s = c; break; } }
    s = s.replace(/\b(room temperature|at room temperature|cut into.*|in wedges|in .* pieces)$/, '').trim();
    const words = s.split(' ');
    if (words.length) words[words.length - 1] = singular(words[words.length - 1]);
    s = words.join(' ');
    let suffix = null;
    if (!/\bbay leaf$/.test(s)) s = s.replace(/ (sprig|leaf|pod|stem|stalk|rib|wedge|floret)$/, (m, w) => { suffix = w; return ''; });
    if (/^([\w-]+ )*salt and ([\w-]+ )*pepper$/.test(s)) s = 'salt';
    for (const [rx, to] of SYNONYMS) { if (rx.test(s)) { if (to) s = to; break; } }
    return { name: s, suffix };
  }

  // ---------- parsing ----------
  /** Parse one ingredient line into a structured amount. */
  function parseIngredient(text) {
    const raw = RB.stripMd(String(text || '')).replace(/ /g, ' ').trim();
    let t = raw.replace(/^(optional:\s*|about\s+|approx\.?\s+|roughly\s+)/i, '');
    const out = { raw, qty: null, qtyMin: null, unit: null, fam: null, size: null, hintG: null, name: '', note: '', optional: /optional/i.test(raw), forServing: /\b(for|to) (serving|garnish|frying|greasing|dusting|the pan|the ramekins)\b|to taste/i.test(raw) };
    // "Juice of 2 limes", "Zest of 1 lemon"
    let m = t.match(new RegExp('^(?:juice|zest|zest and juice) of (' + NUM + ')(?:\\s*(?:to|-)\\s*(' + NUM + '))?\\s+(.*)$', 'i'));
    if (m) {
      out.qty = num(m[2] || m[1]); out.qtyMin = num(m[1]);
      out.name = normalizeName(m[3]); out.fam = 'each';
      return out;
    }
    t = t.replace(/^(?:a\s+)?(?:small|large|big|generous|good)\s+(?=(?:handful|pinch|dash|splash)\b)/i, '');
    m = t.match(/^(\d+(?:\.\d+)?)[- ]inch(?:es)?\s+(?:piece|knob|chunk)s?\s+(?:of\s+)?/i);
    if (m) { out.qty = out.qtyMin = 1; out.unit = 'piece'; out.fam = 'count'; out.name = normalizeName(t.slice(m[0].length)); return out; }
    m = t.match(QTY_RX);
    if (m) {
      out.qtyMin = num(m[1]); out.qty = m[2] ? num(m[2]) : out.qtyMin;
      t = t.slice(m[0].length);
    }
    // package size: "(28-ounce)", "(13- to 14-ounce)", "(1.75-ounce)"
    m = t.match(/^\(([^)]*?)(\d+(?:\.\d+)?)[- ]?(ounce|oz|pound|lb|gram|g)s?\)\s*/i);
    if (m) {
      const u = /^(pound|lb)/i.test(m[3]) ? 453.6 : /^g/i.test(m[3]) ? 1 : 28.35;
      out.size = { g: +m[2] * u, label: m[2] + (u === 1 ? ' g' : u > 100 ? ' lb' : ' oz') };
      t = t.slice(m[0].length);
    }
    t = t.replace(/^\([^)]*\)\s*/, '').replace(/^(?:(?:tightly|loosely|lightly|firmly|well)\s+)?(?:packed|heaping|heaped|scant|level|generous|rounded)\s+/i, '');
    m = t.match(UNIT_RX);
    if (!m && out.qty != null) {
      const d = t.match(/^(fresh|large|medium|small|whole|big|heaping|good)\s+/i);
      const m2 = d && t.slice(d[0].length).match(UNIT_RX);
      if (m2) { t = t.slice(d[0].length); m = m2; }
    }
    if (m && out.qty == null && m.groups.c_pinch || m && out.qty == null && m.groups.c_dash || m && out.qty == null && m.groups.c_handful) {
      out.qty = out.qtyMin = 1;
    }
    if (m && out.qty != null) {
      const k = Object.keys(m.groups).find((g) => m.groups[g]);
      if (k.startsWith('c_')) { out.unit = k.slice(2); out.fam = 'count'; } else { out.unit = k; out.fam = UNITS[k].fam; }
      t = t.slice(m[0].length);
    }
    // "1 cup/240 grams whole milk"
    m = t.match(/^\/\s*(\d+(?:\.\d+)?)\s*(grams?|g|milliliters?|ml)\b\s*/i);
    if (m) { if (/^g/i.test(m[2])) out.hintG = +m[1]; t = t.slice(m[0].length); }
    out.rest = t;
    const hint = t.match(/\((?:about\s+)?(\d+(?:\.\d+)?)\s*(grams?|g)\b[^)]*\)/i);
    if (hint && out.hintG == null) out.hintG = +hint[1];
    t = t.replace(/^of\s+/i, '');
    const nx = normalizeNameEx(t);
    out.name = nx.name;
    if (nx.suffix && out.qty != null && !out.fam && /^(sprig|stalk|rib|pod)$/.test(nx.suffix)) { out.unit = nx.suffix === 'rib' ? 'stalk' : nx.suffix; out.fam = 'count'; }
    if (!out.name && out.unit && out.fam === 'count') { out.name = singular(out.unit === 'clove' ? 'cloves' : out.unit); if (out.name === 'clove') out.name = 'whole cloves'; out.unit = null; out.fam = 'each'; }
    if (out.name === 'garlic' && out.fam == null && out.qty != null && /clove/i.test(t)) { out.unit = 'clove'; out.fam = 'count'; }
    if (out.qty != null && !out.fam) out.fam = 'each';
    const comma = raw.indexOf(',');
    out.note = comma > 0 ? raw.slice(comma + 1).trim() : '';
    return out;
  }

  // ---------- amounts ----------
  function toBase(p) {
    if (p.qty == null) return null;
    if (p.fam === 'vol') return { fam: 'vol', v: p.qty * UNITS[p.unit].ml };
    if (p.fam === 'wt') return { fam: 'wt', v: p.qty * UNITS[p.unit].g };
    if (p.fam === 'count') return { fam: 'count:' + p.unit + (p.size ? ':' + p.size.label : ''), v: p.qty, unit: p.unit, size: p.size };
    return { fam: 'each' + (p.size ? ':' + p.size.label : ''), v: p.qty, size: p.size };
  }
  const roundTo = (n, step) => Math.round(n / step) * step;
  function fmt(n) { return RB.formatQty(n, 'frac'); }
  function formatVolume(ml, system) {
    if (system === 'metric') return ml >= 1000 ? (Math.round(ml / 100) / 10) + ' L' : Math.round(ml >= 100 ? roundTo(ml, 5) : ml) + ' ml';
    const cups = ml / UNITS.cup.ml;
    if (cups >= 0.25) return fmt(roundTo(cups, cups >= 4 ? 0.5 : 0.25)) + (cups > 1.01 ? ' cups' : ' cup');
    const tbsp = ml / UNITS.tbsp.ml;
    if (tbsp >= 1) return fmt(roundTo(tbsp, 0.5)) + ' tbsp';
    return fmt(Math.max(0.25, roundTo(ml / UNITS.tsp.ml, 0.25))) + ' tsp';
  }
  function formatWeight(g, system) {
    if (system === 'metric') return g >= 1000 ? (Math.round(g / 10) / 100) + ' kg' : Math.round(g >= 100 ? roundTo(g, 5) : g) + ' g';
    const oz = g / UNITS.oz.g;
    if (oz < 16) return fmt(Math.max(0.5, roundTo(oz, 0.5))) + ' oz';
    return fmt(roundTo(oz / 16, 0.25)) + ' lb';
  }

  // ---------- grocery aisles ----------
  const AISLES = [
    ['frozen', 'Frozen', /\b(ice cream|frozen|sorbet)\b/],
    ['canned', 'Canned & jarred', /\b(canned|crushed tomato|whole peeled tomato|plum tomato|diced tomato|tomato paste|tomato sauce|coconut (milk|cream)|evaporated|condensed|broth|stock|bouillon|pumpkin pur|roasted red pepper|sun-dried|in adobo|olive(?! oil)|caper|preserve|jam|apple butter|butter bean|black bean|white bean|cannellini|chickpea|kidney bean|pinto)\b/],
    ['grains', 'Pasta, rice & grains', /\b(pasta|rigatoni|spaghetti|fusilli|penne|orecchiette|gemelli|noodle|vermicelli|rice|oat|lentil|split pea|red pea|quinoa|couscous|cornmeal|polenta|panko|breadcrumb|bread crumb)\b/],
    ['spices', 'Spices & seasonings', /\b(salt|black pepper|white pepper|peppercorn|red-pepper flake|pepper flake|cayenne|cumin|coriander|paprika|cinnamon|nutmeg|cloves?$|whole clove|ground clove|allspice|pimento|cardamom|turmeric|curry powder|chili powder|chile powder|gochugaru|dried oregano|oregano|bay lea\w*|star anise|anise seed|sesame seed|spice|seasoning|garam masala|mexican oregano|dried thyme|dried rosemary|stock cube|soup mix)\b/],
    ['baking', 'Baking', /\b(flour|sugar|baking soda|baking powder|yeast|cornstarch|cocoa|chocolate|vanilla|extract|molasses|corn syrup|shortening|cream of tartar|sprinkle|espresso powder)\b/],
    ['condiments', 'Oils, vinegars & condiments', /\b(oil|vinegar|soy sauce|fish sauce|worcestershire|hoisin|ketchup|mustard|mayo|hot sauce|sriracha|sambal|chile crisp|chili crisp|curry paste|miso|tahini|aji|browning|pickapeppa|honey|maple syrup|mirin|sofrito|epis|shrimp paste|salsa)\b/],
    ['meat', 'Meat & seafood', /\b(chicken|beef|steak|short rib|chuck|oxtail|pork|bacon|ham|prosciutto|sausage|kielbasa|chorizo|turkey|duck|lamb|goat|shrimp|fish|salmon|mackerel|pig|tuna|cod|snapper)\b/],
    ['dairy', 'Dairy & eggs', /\b(milk|butter|cream|half-and-half|yogurt|cheese|parmesan|pecorino|mozzarella|cheddar|feta|ricotta|mascarpone|crème fraîche|creme fraiche|sour cream|crema|buttermilk|egg|ghee|monterey jack)\b/],
    ['bakery', 'Bakery & bread', /\b(bread|tortilla|roti|bun|pita|baguette|brioche|challah)\b/],
    ['produce', 'Produce', /\b(onion|shallot|garlic|ginger|scallion|leek|carrot|celery|bell pepper|jalapeño|jalapeno|poblano|scotch bonnet|habanero|serrano|fresno|chile|chili|tomato|potato|yam|squash|pumpkin|calabaza|kabocha|eggplant|cabbage|kale|chard|collard|green|spinach|lettuce|cilantro|parsley|basil|mint|dill|thyme|rosemary|sage|chive|tarragon|herb|lemon|lime|orange|apple|banana|plantain|peach|berr\w*|avocado|cucumber|corn|yuca|cassava|yautia|taro|daikon|mushroom|radish|pear|grape|guajillo|ancho|kombu|lemongrass|kaffir|bamboo)\b/],
    ['snacks', 'Snacks, nuts & dried fruit', /\b(walnut|pecan|almond|pepita|peanut|cashew|pine nut|pistachio|raisin|cranberr\w*|cookie|cracker|cornflake|cereal|speculoos)\b/],
    ['drinks', 'Drinks & alcohol', /\b(wine|vodka|rum|whisk(?:e)?y|bourbon|rye|scotch|cognac|brandy|amaro|sherry|beer|prosecco|liqueur|aperol|campari|tea|coffee|espresso|cider|juice|soda|seltzer)\b/],
  ];
  const AISLE_ORDER = ['produce', 'meat', 'dairy', 'bakery', 'canned', 'grains', 'baking', 'spices', 'condiments', 'snacks', 'frozen', 'drinks', 'other'];
  const AISLE_LABEL = Object.fromEntries(AISLES.map(([k, l]) => [k, l]).concat([['other', 'Other']]));
  function aisleFor(name) {
    const n = String(name || '').toLowerCase();
    if (/\bpeanut butter\b/.test(n)) return 'condiments';
    if (/\b(butter bean|apple butter)\b/.test(n)) return 'canned';
    if (/\b(sweet potato)\b/.test(n)) return 'produce';
    if (/\bcoconut oil\b/.test(n)) return 'condiments';
    if (/\b(eggplant|butternut|pigeon pea|green bean|snap pea|sugar snap|cherry tomato)/.test(n)) return 'produce';
    if (/\b(cooked|steamed) rice\b/.test(n)) return 'grains';
    for (const [k, , rx] of AISLES) if (rx.test(n)) return k;
    return 'other';
  }

  const DEFAULT_STAPLES = ['salt', 'black pepper', 'neutral oil', 'olive oil', 'sugar', 'all-purpose flour', 'baking soda', 'baking powder', 'vanilla extract'];

  /**
   * Merge grocery items into one line per ingredient.
   * items: [{id, text, recipeTitle, checked}] → [{key, name, aisle, amount, label, ids, sources, checked, staple}]
   */
  function mergeGroceries(items, opts) {
    opts = opts || {};
    const system = opts.system || 'us';
    const staples = new Set((opts.staples || DEFAULT_STAPLES).map((s) => normalizeName(s)));
    const groups = new Map();
    (items || []).forEach((it) => {
      const p = parseIngredient(it.text);
      let name = p.name || RB.stripMd(it.text).toLowerCase();
      if (name === 'water') return; // never shop for water
      // juice measured by volume → buy whole fruit (lemon ≈ 3 tbsp, lime ≈ 2 tbsp, orange ≈ 1/3 cup)
      let base = toBase(p);
      const fruitMl = { lemon: 45, lime: 30, orange: 80 }[name];
      if (fruitMl && base && base.fam === 'wt' && p.unit === 'oz') base = { fam: 'vol', v: p.qty * UNITS.floz.ml };
      if (fruitMl && base && base.fam === 'vol') base = { fam: 'each', v: Math.max(1, Math.ceil(base.v / fruitMl - 0.15)) };
      if (name === 'egg' && base && base.fam !== 'each' && base.fam !== 'count:egg') base = null;
      if (!groups.has(name)) groups.set(name, { key: name, name, buckets: new Map(), some: false, ids: [], sources: new Set(), checkedAll: true, raws: [] });
      const g = groups.get(name);
      g.ids.push(it.id); g.raws.push(it.text);
      if (it.recipeTitle) g.sources.add(it.recipeTitle);
      if (!it.checked) g.checkedAll = false;
      if (!base) { g.some = true; return; }
      const b = g.buckets.get(base.fam) || { fam: base.fam, v: 0, unit: base.unit, size: base.size };
      b.v += base.v; g.buckets.set(base.fam, b);
    });
    return Array.from(groups.values()).map((g) => {
      const parts = [];
      let countForName = 0;
      g.buckets.forEach((b) => {
        if (b.fam === 'vol') parts.push(formatVolume(b.v, system));
        else if (b.fam === 'wt') parts.push(formatWeight(b.v, system));
        else if (b.fam.startsWith('count:')) {
          const n = Math.ceil(b.v * 4 - 0.01) / 4;
          const unitWord = b.unit === 'pinch' ? 'pinch' : b.unit;
          parts.push(fmt(n) + ' ' + plural(unitWord, n) + (b.size ? ' (' + b.size.label + ')' : ''));
        } else {
          const n = Math.ceil(b.v * 4 - 0.01) / 4;
          countForName = Math.max(countForName, n);
          parts.push(fmt(n) + (b.size ? ' (' + b.size.label + ')' : ''));
        }
      });
      const onlyEach = parts.length === 1 && Array.from(g.buckets.keys())[0].startsWith('each');
      const display = onlyEach ? plural(g.name, countForName) : g.name;
      const amount = parts.join(' + ');
      return {
        key: g.key, name: g.name, aisle: aisleFor(g.name), amount, label: (amount ? amount + ' ' : '') + display,
        display, ids: g.ids, sources: Array.from(g.sources), checked: g.checkedAll, staple: staples.has(g.key), raws: g.raws,
        approx: g.some && parts.length > 0,
      };
    }).sort((a, b) => AISLE_ORDER.indexOf(a.aisle) - AISLE_ORDER.indexOf(b.aisle) || a.name.localeCompare(b.name));
  }

  // ---------- pairings ----------
  /** Suggest side recipes for a set of planned recipes. */
  function suggestSides(planned, allRecipes, limit) {
    const sides = allRecipes.filter((r) => r.category === 'Sides and Salads');
    if (!sides.length) return [];
    const plannedIds = new Set(planned.map((r) => r.id));
    if (planned.some((r) => r.category === 'Sides and Salads')) return [];
    const mains = planned.filter((r) => r.category === 'Mains' || r.category === 'Soups');
    if (!mains.length) return [];
    const text = mains.map((r) => (r.title + ' ' + r.tags.join(' ')).toLowerCase()).join(' ');
    const score = (s) => {
      const t = (s.title + ' ' + s.tags.join(' ')).toLowerCase();
      let n = 0;
      // Trini curries want roti; Jamaican stews and oxtail want rice
      if (/curry|chana|trinidad|doubles/.test(text)) { if (/roti|buss up/.test(t)) n += 4; else if (/rice/.test(t)) n += 2; }
      if (/oxtail|stew|jamaican|braise|birria|red peas|rundown|brown stew/.test(text)) { if (/rice/.test(t)) n += 4; else if (/roti|buss up/.test(t)) n += 2; }
      if (/chicken|roast|pork|steak|duck/.test(text) && /squash|rice/.test(t)) n += 2;
      if (/soup/.test(text) && /roti|bread|rice/.test(t)) n += 1;
      return n;
    };
    return sides.filter((s) => !plannedIds.has(s.id)).map((s) => ({ s, n: score(s) }))
      .sort((a, b) => b.n - a.n).filter((x, i) => x.n > 0 || i < 1).slice(0, limit || 2).map((x) => x.s);
  }

  // ---------- dates ----------
  const pad = (n) => String(n).padStart(2, '0');
  const dateKey = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  function weekStart(d, offsetWeeks) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dow = (x.getDay() + 6) % 7; // Monday = 0
    x.setDate(x.getDate() - dow + (offsetWeeks || 0) * 7);
    return x;
  }
  function weekDays(offsetWeeks, now) {
    const s = weekStart(now || new Date(), offsetWeeks);
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(s); d.setDate(s.getDate() + i); return d; });
  }


  // ---------- unit conversion for display ----------
  const fmtDec = (n) => (n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10));
  /**
   * Render an ingredient line in a unit system: 'original' | 'us' | 'metric', scaled by factor.
   * Falls back to RB.scaleIngredient when the amount can't be converted.
   */
  function displayIngredient(text, system, factor) {
    factor = factor || 1;
    const scaled = RB.scaleIngredient(text, factor);
    if (!system || system === 'original') return scaled;
    const p = parseIngredient(text);
    if (p.qty == null || (p.fam !== 'vol' && p.fam !== 'wt')) return scaled;
    const rest = String(p.rest || '').replace(/\s*\((?:about\s+)?\d+(?:\.\d+)?\s*(?:grams?|g|ml|milliliters?)\)/i, '').trim();
    const q = p.qty * factor, qMin = (p.qtyMin != null ? p.qtyMin : p.qty) * factor;
    let amt;
    if (system === 'metric') {
      if (p.hintG != null) amt = formatWeight(p.hintG * factor, 'metric');
      else if (p.fam === 'wt') amt = formatWeight(q * UNITS[p.unit].g, 'metric');
      else if (p.unit === 'tsp' || p.unit === 'tbsp') return scaled; // spoons are universal
      else {
        const e = nutrEntry(p.name);
        const liquid = /milk|water|stock|broth|oil|juice|cream|wine|vinegar|syrup|honey|molasses|sauce|rum|vodka|whisk|tea|coffee|liqueur|buttermilk|half-and-half|yogurt/.test(p.name);
        if (e && e.gc && !liquid && e.gc !== 236) { amt = formatWeight((q * UNITS[p.unit].ml / UNITS.cup.ml) * e.gc, 'metric'); qMin === q || (amt = '~' + amt); }
        else amt = formatVolume(q * UNITS[p.unit].ml, 'metric');
      }
      if (qMin !== q && p.hintG == null && !/^~/.test(amt) && amt.indexOf('–') < 0 && !(p.fam === 'vol' && /g$/.test(amt))) {
        const lo = p.fam === 'wt' ? formatWeight(qMin * UNITS[p.unit].g, 'metric') : formatVolume(qMin * UNITS[p.unit].ml, 'metric');
        amt = lo.replace(/\s*[a-zA-Z]+$/, '') + '–' + amt;
      }
    } else {
      if (p.fam === 'wt' && (p.unit === 'g' || p.unit === 'kg')) amt = formatWeight(q * UNITS[p.unit].g, 'us');
      else if (p.fam === 'vol' && (p.unit === 'ml' || p.unit === 'l')) amt = formatVolume(q * UNITS[p.unit].ml, 'us');
      else return scaled;
    }
    return amt + ' ' + rest;
  }
  /** Convert oven/liquid temperatures inside a step. Only touches explicit °F/°C or 3-digit degrees. */
  function convertTemps(text, system) {
    if (!system || system === 'original') return text;
    return String(text).replace(/(\d{2,3})(?:\s*(?:°|º|degrees?)\s*(F|C|Fahrenheit|Celsius)?\b|\s*(F|C)\b(?![a-z]))/g, (m, n, u1, u2) => {
      const u = (u1 || u2 || '').charAt(0).toUpperCase();
      const v = +n;
      const isF = u === 'F' || (!u && v >= 200);
      const isC = u === 'C';
      if (!isF && !isC) return m;
      if (system === 'metric' && isF) return Math.round(((v - 32) * 5) / 9 / 5) * 5 + '°C';
      if (system === 'us' && isC) return Math.round(((v * 9) / 5 + 32) / 5) * 5 + '°F';
      return m;
    });
  }
  function parseServings(y) {
    const t = String(y || '').toLowerCase();
    let m;
    if ((m = t.match(/(\d+)(?:\s*(?:to|-|–)\s*\d+)?\s*servings/))) return +m[1];
    if ((m = t.match(/serves\s+(?:at least\s+|about\s+)?(\d+)/))) return +m[1];
    if ((m = t.match(/(\d+)\s*(?:\w+\s+)?(loa(?:f|ves)|cakes?|pies?|tarts?)\b/))) return +m[1] <= 2 ? +m[1] * (/cake/.test(t) ? 10 : 8) : +m[1];
    if ((m = t.match(/(\d+(?:\.\d+)?)\s*(?:lb|pounds?) (?:of )?pasta/))) return Math.round(+m[1] * 4);
    if ((m = t.match(/(\d+(?:\/\d+)?(?:\.\d+)?)\s*cups?/)) && !/makes\s+(?:about\s+)?\d+\s+(?!cups?)/.test(t)) return Math.max(1, Math.round(RB.toNumber(m[1]) * 4));
    if ((m = t.match(/makes\s+(?:about\s+)?(\d+)/))) return +m[1];
    return 0;
  }

  // ---------- nutrition ----------
  // [pattern, kcal, protein, fat, carbs (per 100 g), grams per cup, grams each]
  const NUTR = [
    ['water|ice', 0, 0, 0, 0, 236, 0],
    ['black pepper|white pepper|peppercorn|pepper flake|red-pepper flake|garlic powder|onion powder|baking powder|curry powder|chili powder|chile powder', 0, 0, 0, 0, 120, 1],
    ['(orange|pineapple|apple|cranberry|grapefruit) juice', 46, 0.6, 0.1, 11, 248, 0],
    ['peanut butter', 588, 25, 50, 20, 258, 0],
    ['coconut milk', 197, 2, 21, 3, 226, 0], ['coconut cream|cream of coconut', 330, 3.6, 35, 7, 240, 0], ['coconut', 660, 7, 65, 24, 93, 0],
    ['evaporated milk', 134, 6.8, 7.6, 10, 252, 0], ['condensed milk', 321, 7.9, 8.7, 54, 306, 0],
    ['buttermilk', 40, 3.3, 0.9, 4.8, 245, 0], ['half-and-half', 131, 3, 11.5, 4.3, 242, 0],
    ['cream cheese', 342, 6, 34, 4, 232, 0], ['sour cream|crema|cr[eè]me fra[iî]che', 198, 2.4, 19, 4.6, 230, 0],
    ['heavy cream|whipping cream|double cream|cream', 340, 2.8, 36, 2.7, 238, 0],
    ['greek yogurt', 97, 9, 5, 4, 245, 0], ['yogurt', 61, 3.5, 3.3, 4.7, 245, 0], ['milk', 61, 3.2, 3.3, 4.8, 244, 0],
    ['parmesan|pecorino|grana', 431, 38, 29, 4, 100, 0], ['ricotta', 174, 11, 13, 3, 246, 0], ['mascarpone', 429, 4.6, 44, 4, 240, 0],
    ['feta|cotija|queso fresco', 264, 14, 21, 4, 150, 0], ['cheese|cheddar|mozzarella|monterey|gruy[eè]re|fontina', 400, 25, 33, 1.3, 113, 0],
    ['butter|ghee', 717, 0.9, 81, 0.1, 227, 0],
    ['egg yolk', 322, 16, 27, 3.6, 243, 17], ['egg white', 52, 11, 0.2, 0.7, 243, 33], ['egg', 143, 12.6, 9.5, 0.7, 243, 50],
    ['shortening|lard', 900, 0, 100, 0, 205, 0], ['oil', 884, 0, 100, 0, 216, 0],
    ['mayo', 680, 1, 75, 0.6, 220, 0],
    ['brown sugar|demerara|turbinado|muscovado|piloncillo', 380, 0, 0, 98, 220, 0], ['powdered sugar|confectioners', 389, 0, 0, 100, 120, 0],
    ['sugar', 387, 0, 0, 100, 200, 0], ['honey', 304, 0.3, 0, 82, 340, 0], ['maple syrup|agave|simple syrup|syrup', 260, 0, 0, 67, 320, 0],
    ['molasses', 290, 0, 0, 75, 330, 0], ['jam|preserve|marmalade|apple butter', 250, 0.4, 0.1, 65, 320, 0],
    ['cornstarch|corn starch|tapioca', 381, 0.3, 0, 91, 128, 0], ['cornmeal|polenta|masa', 370, 8, 4, 77, 157, 0],
    ['whole wheat flour|rye flour', 340, 13, 2.5, 72, 120, 0], ['almond flour', 571, 21, 50, 21, 96, 0], ['flour', 364, 10, 1, 76, 125, 0],
    ['cocoa', 228, 20, 14, 58, 86, 0], ['chocolate', 546, 5, 31, 61, 170, 0],
    ['oat', 389, 17, 7, 66, 80, 0], ['panko|breadcrumb|bread crumb', 395, 13, 5, 72, 108, 0],
    ['(cooked|steamed) rice', 130, 2.7, 0.3, 28, 158, 0], ['rice', 360, 7, 0.6, 79, 185, 0],
    ['pasta|spaghetti|rigatoni|penne|fusilli|orecchiette|gemelli|linguine|noodle|vermicelli', 371, 13, 1.5, 75, 100, 0],
    ['lentil|split (?:green |yellow )?pea|red pea|dried bean', 352, 25, 1, 63, 192, 0],
    ['chickpea|black bean|kidney bean|cannellini|white bean|pinto|butter bean|pigeon pea|bean', 130, 8, 0.5, 22, 172, 0],
    ['bread|brioche|challah|baguette|bun|roll', 265, 9, 3.2, 49, 45, 30], ['tortilla|roti', 300, 8, 7, 50, 0, 45],
    ['cookie|cracker|speculoos|cornflake|cereal', 480, 6, 20, 70, 100, 15],
    ['walnut|pecan|almond|cashew|peanut|pistachio|hazelnut|pine nut|macadamia', 620, 18, 58, 14, 120, 0],
    ['pepita|pumpkin seed|sunflower seed|sesame seed|chia|flax', 560, 25, 49, 18, 140, 0],
    ['raisin|cranberr|date|prune|dried fruit|apricot', 300, 3, 0.5, 79, 145, 8],
    ['bacon', 541, 37, 42, 1.4, 0, 12], ['sausage|chorizo|kielbasa|salami|pepperoni', 300, 15, 26, 2, 0, 75], ['ham|prosciutto', 145, 21, 6, 1.5, 0, 0],
    ['chicken breast', 120, 22, 2.6, 0, 0, 225], ['chicken|turkey|duck', 170, 20, 9, 0, 0, 0],
    ['oxtail', 131, 15, 7, 0, 0, 0], ['ground beef', 254, 17, 20, 0, 0, 0], ['beef|steak|short rib|chuck|brisket|veal', 250, 26, 17, 0, 0, 0],
    ['pork', 242, 27, 14, 0, 0, 0], ['lamb|goat|mutton', 260, 25, 18, 0, 0, 0],
    ['shrimp|prawn|scallop|crab|lobster|clam|mussel', 99, 24, 0.3, 0.2, 0, 15], ['salmon|mackerel|sardine', 208, 20, 13, 0, 0, 0],
    ['fish|cod|snapper|tilapia|halibut|tuna|saltfish', 100, 20, 1.5, 0, 0, 0], ['tofu', 76, 8, 4.8, 1.9, 252, 0],
    ['tomato paste', 82, 4.3, 0.5, 19, 262, 0], ['tomato', 18, 0.9, 0.2, 3.9, 180, 120],
    ['sweet potato|yam|boniato', 86, 1.6, 0.1, 20, 133, 150], ['potato', 77, 2, 0.1, 17, 150, 210],
    ['yuca|cassava|taro|yautia|malanga|dasheen', 160, 1.4, 0.3, 38, 206, 400],
    ['plantain', 122, 1.3, 0.4, 32, 150, 180], ['banana', 89, 1.1, 0.3, 23, 150, 118], ['avocado', 160, 2, 15, 9, 150, 150],
    ['squash|pumpkin|calabaza|kabocha|zucchini', 40, 1, 0.1, 10, 140, 900],
    ['shallot', 72, 2.5, 0.1, 17, 160, 40], ['onion|leek', 40, 1.1, 0.1, 9.3, 160, 150], ['scallion|chive', 32, 1.8, 0.2, 7, 100, 15],
    ['garlic', 149, 6.4, 0.5, 33, 136, 5], ['ginger|turmeric root|galangal', 80, 1.8, 0.8, 18, 96, 30],
    ['carrot', 41, 0.9, 0.2, 10, 128, 60], ['celery', 16, 0.7, 0.2, 3, 101, 40], ['bell pepper', 26, 1, 0.3, 6, 150, 150],
    ['jalape|scotch bonnet|habanero|serrano|chile|chili|chilli|pepper', 40, 2, 0.4, 9, 150, 15],
    ['mushroom', 22, 3, 0.3, 3, 70, 15], ['corn', 86, 3.3, 1.4, 19, 154, 100], ['cucumber', 15, 0.7, 0.1, 3.6, 120, 300], ['pea', 81, 5, 0.4, 14, 145, 0],
    ['cabbage|kale|spinach|green|chard|collard|lettuce|arugula|watercress|bok choy|broccoli|cauliflower|eggplant|okra', 28, 2, 0.4, 5, 70, 600],
    ['cilantro|parsley|basil|mint|dill|thyme|rosemary|sage|tarragon|oregano leaves|culantro|herb|curry lea|bay lea', 30, 2.5, 0.6, 5, 20, 1],
    ['lemon|lime', 29, 1.1, 0.3, 9, 240, 58], ['orange|tangerine|clementine|grapefruit', 47, 0.9, 0.1, 12, 180, 130],
    ['apple|pear', 52, 0.3, 0.2, 14, 125, 180], ['strawberr|blueberr|raspberr|blackberr|cranberr|berr|cherr|grape|peach|mango|pineapple|fruit', 50, 0.8, 0.3, 12, 150, 100],
    ['rum|vodka|whisk|bourbon|rye|gin|tequila|mezcal|brandy|cognac|scotch', 231, 0, 0, 0, 222, 0],
    ['wine|sherry|vermouth|prosecco|champagne', 83, 0.1, 0, 2.6, 236, 0], ['beer|stout|cider', 43, 0.5, 0, 3.6, 240, 0],
    ['liqueur|aperol|campari|amaro|triple sec|cointreau|kahl', 250, 0, 0, 30, 240, 0],
    ['stock|broth|bouillon', 5, 0.6, 0.2, 0.4, 240, 0], ['soy sauce|tamari', 53, 8, 0.6, 5, 255, 0], ['fish sauce', 35, 5, 0, 4, 288, 0],
    ['miso', 199, 12, 6, 26, 275, 0], ['tahini', 595, 17, 54, 21, 240, 0], ['ketchup', 101, 1, 0.1, 27, 240, 0], ['mustard', 66, 4, 3, 6, 250, 0],
    ['hot sauce|sriracha|sambal|vinegar|worcestershire|browning|bitters|tea|coffee|espresso|seltzer|soda water|club soda', 15, 0.5, 0, 3, 240, 0],
    ['salt|pepper|cumin|coriander|paprika|cinnamon|nutmeg|clove|allspice|cardamom|anise|curry powder|garam|oregano|seasoning|spice|chili powder|cayenne|flake|baking soda|baking powder|yeast|extract|vanilla|cream of tartar|saffron|achiote|annatto|gochugaru|five-spice|za.atar|sumac', 0, 0, 0, 0, 120, 1],
  ].map(([rx, k, p, f, c, gc, ge]) => ({ rx: new RegExp('\\b(?:' + rx + ')', 'i'), k, p, f, c, gc, ge }));
  const COUNT_G = { clove: 5, sprig: 1, pinch: 0.3, dash: 0.6, handful: 30, slice: 30, stalk: 40, bunch: 60, head: 0, stick: 113, can: 400, jar: 340, package: 300, piece: 50, fillet: 170, ear: 100, bottle: 750, loaf: 450 };
  // The head noun sits at the end ("butter bean", "chicken stock"), so the match that ends latest wins.
  function nutrEntry(name) {
    let best = null, bestEnd = -1;
    for (const e of NUTR) {
      const rx = new RegExp(e.rx.source, 'gi'); let m, end = -1;
      while ((m = rx.exec(name))) { end = m.index + m[0].length; if (!m[0]) rx.lastIndex++; }
      if (end > bestEnd) { best = e; bestEnd = end; }
    }
    return best;
  }
  function gramsFor(p, e) {
    if (p.hintG != null) return p.hintG;
    if (p.qty == null) return null;
    if (p.fam === 'wt') return p.qty * UNITS[p.unit].g;
    if (p.fam === 'vol') return (p.qty * UNITS[p.unit].ml / UNITS.cup.ml) * (e.gc || 236);
    if (p.fam === 'count') {
      if (p.size) return p.qty * p.size.g;
      if (p.unit === 'stick' && !/butter/.test(p.name)) return p.qty * 10;
      if (p.unit === 'head') return p.qty * (/garlic/.test(p.name) ? 50 : e.ge || 500);
      if (p.unit === 'piece') return p.qty * (e.ge || 50);
      return p.qty * (COUNT_G[p.unit] || e.ge || 50);
    }
    if (p.size) return p.qty * p.size.g;
    return p.qty * (e.ge || 0) || null;
  }
  /** Estimate nutrition for a recipe. Returns totals, per-serving values, and coverage. */
  function nutrition(recipe, servingsOverride) {
    const tot = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
    const missed = []; let counted = 0, considered = 0;
    (recipe.ingredients || []).forEach((g) => g.items.forEach((text) => {
      const p = parseIngredient(text);
      if (!p.name || p.name === 'water' || /to taste|for serving|for garnish|for frying|for greasing|for dusting|as needed/i.test(p.raw)) return;
      considered++;
      let e = nutrEntry(p.name);
      if (!e) { missed.push(p.raw); return; }
      if (e.k === 0) { counted++; return; }
      if (p.name.endsWith('rice') && /day-old|leftover|cooked/i.test(p.raw)) e = nutrEntry('cooked rice');
      let g = gramsFor(p, e);
      if (g == null || !isFinite(g)) { missed.push(p.raw); return; }
      if (/bone-in|ham hock|whole chicken/i.test(p.raw)) g *= 0.7;
      if (/juice of|^juice/i.test(p.raw) && /lemon|lime|orange/.test(p.name)) g = g * 0.5;
      counted++;
      tot.kcal += (g * e.k) / 100; tot.protein += (g * e.p) / 100; tot.fat += (g * e.f) / 100; tot.carbs += (g * e.c) / 100;
    }));
    const servings = servingsOverride || parseServings(recipe.yield) || 4;
    const per = {}; Object.keys(tot).forEach((k) => (per[k] = tot[k] / servings));
    return { total: tot, per, servings, coverage: considered ? counted / considered : 0, missed, counted, considered };
  }

  // ---------- what can I make ----------
  function recipeNeeds(recipe, staples) {
    const st = new Set((staples || DEFAULT_STAPLES).map((s) => normalizeName(s)));
    const names = new Map();
    (recipe.ingredients || []).forEach((g) => g.items.forEach((text) => {
      const p = parseIngredient(text);
      if (!p.name || p.name === 'water' || p.optional || p.forServing || st.has(p.name)) return;
      if (p.name.split(/ and /).every((x) => st.has(normalizeName(x)))) return;
      if (!names.has(p.name)) names.set(p.name, p.raw);
    }));
    return names;
  }
  const words = (s) => String(s).toLowerCase().split(/[^a-z0-9ñéíóú]+/).filter((w) => w.length > 2).map(singular);
  function haveMatch(need, have) {
    const nw = words(need);
    return have.some((h) => {
      const hw = words(h);
      if (!hw.length) return false;
      if (need === h) return true;
      return hw.every((w) => nw.includes(w)); // "chicken" covers "chicken thigh"; "garlic" covers "garlic"
    });
  }
  /** Rank recipes by how few ingredients are missing from what's on hand. */
  function whatCanIMake(have, recipes, staples) {
    const H = (have || []).map((h) => normalizeName(h) || String(h).toLowerCase()).filter(Boolean);
    if (!H.length) return [];
    return recipes.map((r) => {
      const needs = recipeNeeds(r, staples);
      const missing = [], got = [];
      needs.forEach((raw, name) => (haveMatch(name, H) ? got : missing).push(name));
      return { recipe: r, total: needs.size, have: got, missing };
    }).filter((x) => x.total && x.have.length)
      .sort((a, b) => a.missing.length - b.missing.length || b.have.length - a.have.length);
  }


  // ---------- timing: work backward from the serving time ----------
  /** "2 1/2 hr (plus chilling)" → { minutes: 150, ahead: 'plus chilling' } */
  function parseTime(time) {
    const t = String(time || '').toLowerCase();
    if (!t) return { minutes: null, ahead: '' };
    const parts = t.split(/\(|\bplus\b/);
    let head = parts[0];
    if (/\bto\b/.test(head) && /\d/.test(head.split(/\bto\b/).pop())) head = head.split(/\bto\b/).pop();
    const ahead = /\(|\bplus\b/.test(t) ? t.slice(head.length).replace(/[()]/g, '').trim() : '';
    if (/\b(week|weeks|days?)\b/.test(head)) return { minutes: null, ahead: head.trim() };
    let total = 0, found = false, m;
    const rx = new RegExp('(' + NUM + ')\\s*(hours?|hrs?|hr|h|minutes?|mins?|min|m)\\b', 'g');
    while ((m = rx.exec(head))) { found = true; const n = num(m[1]); total += /^h/.test(m[2]) ? n * 60 : n; }
    return { minutes: found ? Math.round(total) : null, ahead };
  }
  const ovenTemp = (text) => {
    const t = RB.stripMd(text);
    const m = t.match(/(?:oven|bake|roast|broil)[^.]*?(\d{3})\s*(?:°|degrees)?\s*F?\b/i) || t.match(/(\d{3})\s*(?:°|degrees)\s*F?\b[^.]*?(?:oven|bake|roast)/i);
    return m && +m[1] >= 200 && +m[1] <= 550 ? +m[1] : null;
  };
  const usesOven = (text) => /\b(oven|bake|baking|roast|broil)\b/i.test(RB.stripMd(text)) && !/\b(out of the oven|remove from the oven|turn off)\b/i.test(text);
  /**
   * Build a day-of schedule. recipes: [{id,title,time,steps}], serveAt: Date.
   * Each step gets its timer length (or a few active minutes); slack from the recipe's stated time goes to untimed steps.
   */
  function schedule(recipes, serveAt) {
    const serve = serveAt.getTime();
    const dishes = [], events = [], warnings = [];
    recipes.forEach((r) => {
      const steps = [];
      (r.steps || []).forEach((g) => g.items.forEach((text) => steps.push(text)));
      if (!steps.length) return;
      const pt = parseTime(r.time);
      const durs = steps.map((text) => {
        const tm = RB.findTimers(text);
        const secs = tm.reduce((a, x) => Math.max(a, x.maxSeconds || x.seconds), 0);
        return { timed: secs > 0, min: secs ? Math.max(1, secs / 60) : 5 };
      });
      let sum = durs.reduce((a, d) => a + d.min, 0);
      const untimed = durs.filter((d) => !d.timed);
      if (pt.minutes && pt.minutes > sum && untimed.length) {
        const extra = (pt.minutes - sum) / untimed.length;
        untimed.forEach((d) => { d.min += extra; });
        sum = pt.minutes;
      }
      // long single timers (marinate overnight, rise 12 hours) become "ahead" tasks instead of stretching the day
      let end = serve;
      const rows = [];
      for (let k = steps.length - 1; k >= 0; k--) {
        const start = end - durs[k].min * 60000;
        rows.unshift({ k, start, end, text: steps[k] });
        end = start;
      }
      // oven windows: from the first oven step to the last one, at the first temperature named
      let oven = null;
      rows.forEach((row) => {
        if (!usesOven(row.text)) return;
        const temp = ovenTemp(row.text);
        if (!oven) oven = { from: row.start, to: row.end, temp };
        else { oven.to = row.end; if (!oven.temp && temp) oven.temp = temp; }
      });
      const d = { id: r.id, title: r.title, start: rows[0].start, minutes: Math.round(sum), ahead: pt.ahead, oven };
      dishes.push(d);
      rows.forEach((row) => events.push({ at: row.start, dish: r.title, id: r.id, n: row.k + 1, text: RB.stripMd(row.text), minutes: Math.round((row.end - row.start) / 60000), first: row.k === 0 }));
    });
    // two dishes needing the oven at different temperatures at the same time
    const pairs = [];
    for (let i = 0; i < dishes.length; i++) for (let j = i + 1; j < dishes.length; j++) {
      const a = dishes[i].oven, b = dishes[j].oven;
      if (a && b && a.temp && b.temp && a.from < b.to && b.from < a.to && Math.abs(a.temp - b.temp) > 25) pairs.push([i, j]);
    }
    // one warning per odd-one-out dish
    while (pairs.length) {
      const count = {}; pairs.forEach(([i, j]) => { count[i] = (count[i] || 0) + 1; count[j] = (count[j] || 0) + 1; });
      const k = +Object.keys(count).sort((x, y) => count[y] - count[x])[0];
      const others = pairs.filter((p) => p.includes(k)).map((p) => (p[0] === k ? p[1] : p[0]));
      warnings.push({ kind: 'oven', a: dishes[k].id, text: `Oven clash: ${dishes[k].title} wants ${dishes[k].oven.temp}°F while ${others.map((o) => `${dishes[o].title} (${dishes[o].oven.temp}°F)`).join(', ')} ${others.length > 1 ? 'are' : 'is'} baking. Cook it first and hold it warm, or use a second oven or toaster oven.` });
      for (let n = pairs.length - 1; n >= 0; n--) if (pairs[n].includes(k)) pairs.splice(n, 1);
    }
    dishes.filter((d) => d.ahead && /overnight|day|marinat|chill|soak|rise|proof|ferment|steep|rest/.test(d.ahead))
      .forEach((d) => warnings.push({ kind: 'ahead', text: `${d.title}: start ahead (${d.ahead}).`, a: d.id }));
    events.sort((x, y) => x.at - y.at || x.n - y.n);
    return { serve, start: events.length ? events[0].at : serve, dishes: dishes.sort((x, y) => x.start - y.start), events, warnings };
  }

  // ---------- drink pairing ----------
  const PAIRINGS = [
    [/pancake|waffle|french toast|oatmeal|dutch baby|shakshuka|breakfast/, { wine: 'Brut sparkling wine or a mimosa', cocktail: 'Mimosa or a Bellini', zero: 'Fresh orange juice, coffee or chai', book: /chai|thai milk tea/ }],
    [/souffl|chocolate|cookie|cake|cobbler|shortcake|pone|concha|cinnamon roll|pan de muerto|loaf|baking|sweet/, { wine: 'Tawny port or a late-harvest dessert wine', cocktail: 'Espresso martini', zero: 'Café de olla or masala chai', book: /chai|hot chocolate|thai milk tea/ }],
    [/curry|thai|coconut|khao|laksa|chile oil|gochugaru|kimchi|jerk/, { wine: 'Off-dry Riesling or Gewürztraminer', cocktail: 'Dark ’n’ Stormy (dark rum + ginger beer + lime)', zero: 'Spicy ginger beer over ice with lime', book: /ginger beer/ }],
    [/oxtail|brown stew|jamaican|stew peas|rundown|red peas|soup joumou|sancocho/, { wine: 'Grenache, Zinfandel or a chilled Beaujolais', cocktail: 'Rum punch or a rum old fashioned', zero: 'Sorrel or homemade ginger beer', book: /ginger beer/ }],
    [/birria|taco|mexican|peruvian|aji|carnitas|pozole/, { wine: 'Tempranillo or a Mexican lager with lime', cocktail: 'Margarita or Paloma', zero: 'Agua fresca or tamarind soda', book: null }],
    [/bulgogi|short rib|korean/, { wine: 'Off-dry Riesling or juicy Zinfandel', cocktail: 'Soju highball with yuzu', zero: 'Iced barley tea', book: null }],
    [/vodka|sugo|norma|tomato|meatball|red pesto/, { wine: 'Chianti or another Sangiovese', cocktail: 'Negroni, or a Spritz before dinner', zero: 'Sparkling water with lemon and bitters', book: /spritz/ }],
    [/pesto|lemon|ricotta|risotto|white bean/, { wine: 'Vermentino or Sauvignon Blanc', cocktail: 'Classic Spritz', zero: 'Elderflower tonic', book: /spritz/ }],
    [/steak|beef|flank/, { wine: 'Malbec or Cabernet Sauvignon', cocktail: 'Manhattan', zero: 'Black cherry and rosemary soda', book: null }],
    [/chicken|turkey|duck|thanksgiving/, { wine: 'Pinot Noir or a lightly oaked Chardonnay', cocktail: 'Apple-cider bourbon sour', zero: 'Sparkling apple cider', book: /toddy/ }],
    [/pork/, { wine: 'Riesling or Gamay', cocktail: 'Hot toddy or a rye old fashioned', zero: 'Ginger-apple spritz', book: /toddy|ginger beer/ }],
    [/mackerel|fish|shrimp|salmon|seafood|saltfish/, { wine: 'Albariño or Sancerre', cocktail: 'Ti’ punch or a gin and tonic', zero: 'Lime and cucumber soda', book: null }],
    [/squash|pumpkin|sweet potato|lentil|split pea|congee|black bean|soup/, { wine: 'Viognier or a rich Chardonnay', cocktail: 'Hot toddy', zero: 'Hot spiced cider or chai', book: /toddy|chai/ }],
  ];
  /** Suggest a wine, a cocktail and a zero-proof drink, plus matching drinks from the book. */
  function pairDrink(r, allRecipes) {
    if (!r || r.category === 'Drinks') return null;
    const text = (r.title + ' ' + (r.tags || []).join(' ') + ' ' + (r.category || '')).toLowerCase();
    const hit = PAIRINGS.find(([rx]) => rx.test(text));
    const p = hit ? hit[1] : { wine: 'Dry sparkling wine; it goes with almost anything', cocktail: 'French 75', zero: 'Sparkling water with citrus', book: null };
    const book = p.book ? (allRecipes || []).filter((x) => x.category === 'Drinks' && p.book.test(x.title.toLowerCase())).slice(0, 2) : [];
    return { wine: p.wine, cocktail: p.cocktail, zero: p.zero, book };
  }

  const RK = { UNITS, parseIngredient, normalizeName, plural, singular, formatVolume, formatWeight, aisleFor, AISLE_ORDER, AISLE_LABEL,
    DEFAULT_STAPLES, mergeGroceries, suggestSides, dateKey, weekStart, weekDays,
    displayIngredient, convertTemps, parseServings, nutrition, nutrEntry, recipeNeeds, whatCanIMake, parseTime, schedule, pairDrink };
  if (typeof module !== 'undefined' && module.exports) module.exports = RK;
  else root.RK = RK;
})(typeof window !== 'undefined' ? window : globalThis);
