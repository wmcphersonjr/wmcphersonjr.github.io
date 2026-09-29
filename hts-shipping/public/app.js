'use strict';

// ---------- constants ----------

const STORAGE_KEY = 'hts-shipping:v1';

// Merchandise Processing Fee / Harbor Maintenance Fee defaults (FY2026).
// These are adjusted each October — editable under "Fee settings".
const DEFAULT_SETTINGS = {
  mpfRate: 0.3464,
  mpfMin: 33.58,
  mpfMax: 651.5,
  informalLimit: 2500,
  mpfInformal: 2.69,
  hmfRate: 0.125,
};

// Countries whose goods take the HTS "Column 2" (Other) rate.
const COLUMN2_COUNTRIES = new Set(['CU', 'KP', 'RU', 'BY']);

// Origin country -> Special Program Indicator codes that may appear in the
// "Special" column. Claiming one requires meeting that program's rules of origin.
const SPI_BY_COUNTRY = {
  CA: ['S', 'S+', 'CA'], MX: ['S', 'S+', 'MX'],
  AU: ['AU'], BH: ['BH'], CL: ['CL'], CO: ['CO'], IL: ['IL'], JO: ['JO'],
  KR: ['KR'], MA: ['MA'], OM: ['OM'], PA: ['PA'], PE: ['PE'], SG: ['SG'], JP: ['JP'],
  CR: ['P', 'P+'], DO: ['P', 'P+'], SV: ['P', 'P+'], GT: ['P', 'P+'], HN: ['P', 'P+'], NI: ['P', 'P+'],
};

// ---------- state ----------

const state = loadState();

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.lines)) {
      saved.settings = { ...DEFAULT_SETTINGS, ...saved.settings };
      saved.header = saved.header || {};
      return saved;
    }
  } catch { /* storage unavailable or corrupt */ }
  return {
    header: { invoiceDate: new Date().toISOString().slice(0, 10), mode: 'ocean', incoterm: 'FOB' },
    lines: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

// ---------- helpers ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const usd = n => (Number.isFinite(n) ? n : 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const digits = code => String(code || '').replace(/\D/g, '');
const uid = () => Math.random().toString(36).slice(2, 10);

// Format a digit string as an HTS number: 6109.10.00.12
function fmtHts(code) {
  const d = digits(code);
  const parts = [d.slice(0, 4), d.slice(4, 6), d.slice(6, 8), d.slice(8, 10)].filter(Boolean);
  return parts.join('.');
}

function cleanText(s) {
  // HTS descriptions sometimes contain simple HTML markup.
  const div = document.createElement('div');
  div.innerHTML = String(s ?? '');
  return div.textContent.trim();
}

async function api(path) {
  const res = await fetch(path);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

function asRows(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.results)) return data.results;
  if (data && Array.isArray(data.HTSData)) return data.HTSData;
  return [];
}

// ---------- HTS lookup ----------

const headingCache = new Map();

async function fetchHeading(code) {
  const heading = digits(code).slice(0, 4);
  if (heading.length < 4) throw new Error('HTS code needs at least 4 digits');
  if (!headingCache.has(heading)) {
    const next = String(Math.min(Number(heading) + 1, 9999)).padStart(4, '0');
    const p = api(`/api/range?from=${heading}&to=${next}`)
      .then(data => asRows(data).filter(r => digits(r.htsno).startsWith(heading) || (!r.htsno && r.description)))
      .catch(err => { headingCache.delete(heading); throw err; });
    headingCache.set(heading, p);
  }
  return headingCache.get(heading);
}

// Resolve a code to its row plus ancestors, inheriting rates from the nearest
// ancestor that carries one (10-digit statistical lines usually have none).
async function resolveCode(code) {
  const want = digits(code);
  const rows = await fetchHeading(want);
  let idx = -1, best = 0;
  rows.forEach((r, i) => {
    const d = digits(r.htsno);
    if (d && want.startsWith(d) && d.length > best) { best = d.length; idx = i; }
  });
  if (idx < 0) throw new Error(`HTS ${fmtHts(want)} not found`);

  const row = rows[idx];
  const path = [];
  let level = Number(row.indent);
  for (let i = idx - 1; i >= 0 && level > 0; i--) {
    const ind = Number(rows[i].indent);
    if (ind < level) { path.unshift(rows[i]); level = ind; }
  }
  const chain = [...path, row].reverse();
  const pick = key => (chain.find(r => (r[key] || '').trim()) || {})[key] || '';
  return {
    row,
    path,
    rows,
    exact: digits(row.htsno) === want,
    general: pick('general'),
    special: pick('special'),
    other: pick('other'),
    units: (row.units && row.units.length ? row.units : (chain.find(r => r.units && r.units.length) || {}).units) || [],
    fullDescription: [...path, row].map(r => cleanText(r.description)).filter(Boolean).join(' › '),
    footnotes: chain.flatMap(r => r.footnotes || []),
  };
}

// ---------- rate parsing ----------

// Parses rates like "Free", "5.3%", "2.2¢/kg", "37.5¢/kg + 4.4%", "$1.035/kg".
function parseRate(text) {
  const t = cleanText(text).replace(/\s+/g, ' ');
  if (!t) return { known: false, text: '' };
  if (/^free\b/i.test(t)) return { known: true, text: t, adval: 0, specific: [] };
  const out = { known: true, text: t, adval: 0, specific: [] };
  let matched = false;
  for (const part of t.split('+')) {
    const p = part.trim();
    let m;
    if ((m = p.match(/^([\d.]+)\s*%/))) { out.adval += Number(m[1]); matched = true; continue; }
    if ((m = p.match(/^([\d.]+)\s*¢\s*\/\s*([\w. ]+)/))) { out.specific.push({ amount: Number(m[1]) / 100, per: m[2].trim() }); matched = true; continue; }
    if ((m = p.match(/^\$\s*([\d.]+)\s*\/\s*([\w. ]+)/))) { out.specific.push({ amount: Number(m[1]), per: m[2].trim() }); matched = true; continue; }
    if (/^free/i.test(p)) { matched = true; continue; }
    out.known = false;
  }
  if (!matched) out.known = false;
  return out;
}

// Splits "Free (A,AU,BH) 2.5% (JP)" into [{rate:'Free', programs:['A','AU','BH']}, ...].
function parseSpecial(text) {
  const t = cleanText(text);
  const groups = [];
  const re = /([^()]+?)\s*\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(t))) {
    groups.push({ rate: m[1].trim(), programs: m[2].split(',').map(s => s.trim()) });
  }
  return groups;
}

function specialFor(line) {
  const codes = SPI_BY_COUNTRY[(line.origin || '').toUpperCase()] || [];
  for (const g of parseSpecial(line.special)) {
    if (g.programs.some(p => codes.includes(p))) return g;
  }
  return null;
}

function unitQuantity(per, line) {
  const u = per.toLowerCase().replace(/\./g, '');
  if (u === 'kg') return num(line.weightKg);
  if (u === 'g') return num(line.weightKg) * 1000;
  if (u === 't') return num(line.weightKg) / 1000;
  const lineUnit = (line.unit || '').toLowerCase().replace(/\./g, '');
  if (lineUnit && (lineUnit === u || (u === 'no' && lineUnit === 'pcs'))) return num(line.qty);
  if (u === 'doz' && lineUnit === 'no') return num(line.qty) / 12;
  if (u === 'no' && lineUnit === 'doz') return num(line.qty) * 12;
  return null;
}

function computeLine(line) {
  const value = num(line.qty) * num(line.unitValue);
  const origin = (line.origin || '').toUpperCase();
  let column = 'General', rateText = line.general;
  const notes = [];

  if (COLUMN2_COUNTRIES.has(origin)) {
    column = 'Column 2'; rateText = line.other;
  } else if (line.claimPreference) {
    const sp = specialFor(line);
    if (sp) { column = `Special (${sp.programs.filter(p => (SPI_BY_COUNTRY[origin] || []).includes(p)).join(',')})`; rateText = sp.rate; }
    else notes.push('No matching preference program for this origin');
  }

  const rate = parseRate(rateText);
  let duty = 0;
  if (!line.hts) {
    notes.push('No HTS code');
  } else if (!rate.text) {
    notes.push('Rate not loaded — click Lookup');
  } else if (!rate.known) {
    notes.push('Complex rate — review manually');
  } else {
    duty = value * rate.adval / 100;
    for (const s of rate.specific) {
      const q = unitQuantity(s.per, line);
      if (q == null) notes.push(`Needs quantity in "${s.per}"`);
      else duty += s.amount * q;
    }
  }
  const extra = value * num(line.extraPct) / 100;
  return { value, column, rateText: rate.text, duty, extra, total: duty + extra, notes };
}

function computeTotals() {
  const s = state.settings;
  const lines = state.lines.map(l => ({ line: l, calc: computeLine(l) }));
  const value = lines.reduce((a, x) => a + x.calc.value, 0);
  const duty = lines.reduce((a, x) => a + x.calc.duty, 0);
  const extra = lines.reduce((a, x) => a + x.calc.extra, 0);
  const formal = value > num(s.informalLimit);
  const mpf = !value ? 0 : formal
    ? Math.min(Math.max(value * num(s.mpfRate) / 100, num(s.mpfMin)), num(s.mpfMax))
    : num(s.mpfInformal);
  const hmf = state.header.mode === 'ocean' ? value * num(s.hmfRate) / 100 : 0;
  const landed = value + num(state.header.freight) + num(state.header.insurance) + duty + extra + mpf + hmf;
  return { lines, value, duty, extra, mpf, hmf, formal, landed, total: duty + extra + mpf + hmf };
}

// ---------- tabs ----------

$$('.tab').forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));

function showTab(name) {
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
  if (name === 'documents') renderInvoice();
}

// ---------- classify tab ----------

let lastResults = [];

$('#search-form').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('#search-input').value.trim();
  if (!q) return;
  const status = $('#search-status');
  status.textContent = 'Searching…';
  $('#results tbody').innerHTML = '';
  try {
    lastResults = asRows(await api(`/api/search?q=${encodeURIComponent(q)}`));
    status.textContent = lastResults.length ? `${lastResults.length} results` : 'No results. Try a broader keyword or fewer digits.';
    renderResults();
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  }
});

function renderResults() {
  $('#results tbody').innerHTML = lastResults.map((r, i) => {
    const hasRate = (r.general || '').trim();
    return `<tr class="${hasRate ? '' : 'heading-row'}">
      <td class="mono">${esc(r.htsno)}</td>
      <td style="padding-left:${0.5 + Number(r.indent || 0) * 0.8}rem">${esc(cleanText(r.description))}</td>
      <td>${esc(cleanText(r.general))}</td>
      <td class="small">${esc(cleanText(r.special))}</td>
      <td>${esc(cleanText(r.other))}</td>
      <td class="nowrap">${r.htsno ? `<button class="link" data-detail="${i}">Details</button>` : ''}</td>
    </tr>`;
  }).join('');
}

$('#results').addEventListener('click', e => {
  const i = e.target.dataset.detail;
  if (i != null) showDetail(lastResults[i].htsno);
});

async function showDetail(code) {
  const box = $('#detail');
  box.classList.remove('hidden');
  box.innerHTML = `<p class="muted">Loading ${esc(code)}…</p>`;
  try {
    const info = await resolveCode(code);
    const fn = info.footnotes.map(f => cleanText(f.value)).filter(Boolean);
    const ch99 = [...new Set(fn.join(' ').match(/99\d\d\.\d\d\.\d\d/g) || [])];
    box.innerHTML = `
      <div class="card-head"><h3 class="mono">${esc(info.row.htsno)}</h3><button class="link" id="close-detail">Close</button></div>
      <ol class="crumbs">${[...info.path, info.row].map(r =>
        `<li>${r.htsno ? `<span class="mono">${esc(r.htsno)}</span> ` : ''}${esc(cleanText(r.description))}</li>`).join('')}</ol>
      <dl class="rates">
        <dt>General</dt><dd>${esc(cleanText(info.general)) || '—'}</dd>
        <dt>Special</dt><dd>${esc(cleanText(info.special)) || '—'}</dd>
        <dt>Column 2</dt><dd>${esc(cleanText(info.other)) || '—'}</dd>
        <dt>Units</dt><dd>${esc(info.units.join(', ')) || '—'}</dd>
      </dl>
      ${fn.length ? `<h4>Footnotes</h4><ul class="small">${fn.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      ${ch99.length ? `<p class="warn small">References Chapter 99 provisions: ${ch99.map(esc).join(', ')} — additional duties may apply.</p>` : ''}
      <button id="add-from-detail">Add to shipment</button>`;
    $('#close-detail').onclick = () => box.classList.add('hidden');
    $('#add-from-detail').onclick = () => {
      state.lines.push(newLine(info));
      saveState();
      renderLines();
      showTab('shipment');
    };
  } catch (err) {
    box.innerHTML = `<p class="warn">Error: ${esc(err.message)}</p>`;
  }
}

// ---------- shipment tab ----------

function newLine(info) {
  const line = {
    id: uid(), description: '', hts: '', origin: state.header.exportCountry || '',
    qty: 1, unit: '', unitValue: 0, weightKg: 0, claimPreference: false, extraPct: 0,
    general: '', special: '', other: '', htsDescription: '',
  };
  if (info) applyInfo(line, info);
  return line;
}

function applyInfo(line, info) {
  line.hts = info.row.htsno;
  line.general = info.general;
  line.special = info.special;
  line.other = info.other;
  line.htsDescription = info.fullDescription;
  if (!line.unit && info.units.length) line.unit = info.units[0];
  if (!line.description) line.description = cleanText(info.row.description);
}

function bindForm(form, obj, onChange) {
  $$('input, select, textarea', form).forEach(el => {
    if (obj[el.name] != null) el.value = obj[el.name];
    el.addEventListener('input', () => { obj[el.name] = el.value; saveState(); onChange(); });
  });
}

bindForm($('#header-form'), state.header, () => { renderLines(false); });
bindForm($('#settings-form'), state.settings, renderSummary);

$('#reset-settings').addEventListener('click', () => {
  Object.assign(state.settings, DEFAULT_SETTINGS);
  $$('#settings-form input').forEach(el => { el.value = state.settings[el.name]; });
  saveState();
  renderSummary();
});

$('#add-line').addEventListener('click', () => {
  state.lines.push(newLine());
  saveState();
  renderLines();
});

$('#clear-shipment').addEventListener('click', () => {
  if (!confirm('Remove all line items?')) return;
  state.lines = [];
  saveState();
  renderLines();
});

const LINE_FIELDS = [
  ['description', 'text', 'wide'],
  ['hts', 'text', 'mono'],
  ['origin', 'text', 'tiny'],
  ['qty', 'number', 'short'],
  ['unit', 'text', 'tiny'],
  ['unitValue', 'number', 'short'],
  ['weightKg', 'number', 'short'],
];

function renderLines(rebuild = true) {
  const tbody = $('#lines tbody');
  if (rebuild) {
    tbody.innerHTML = state.lines.map(l => `
      <tr data-id="${l.id}">
        ${LINE_FIELDS.map(([k, type, cls]) => `<td><input class="${cls}" name="${k}" type="${type}" ${type === 'number' ? 'min="0" step="any"' : ''} value="${esc(l[k])}"${k === 'origin' ? ' maxlength="2" placeholder="CN"' : ''}>${k === 'hts' ? `<button class="link" data-act="lookup">Lookup</button>` : ''}</td>`).join('')}
        <td><input type="checkbox" name="claimPreference" ${l.claimPreference ? 'checked' : ''} title="Claim a free-trade / preference program"></td>
        <td><input class="short" name="extraPct" type="number" min="0" step="any" value="${esc(l.extraPct)}"></td>
        <td class="rate small"></td>
        <td class="num duty"></td>
        <td><button class="link danger" data-act="remove" title="Remove line">✕</button></td>
      </tr>
      ${l.htsDescription ? `<tr class="subrow" data-for="${l.id}"><td colspan="12" class="small muted">${esc(l.htsDescription)}</td></tr>` : ''}`).join('')
      || '<tr><td colspan="12" class="muted">No line items yet. Search in Classify and click “Add to shipment”, or add a line manually.</td></tr>';
  }
  updateLineCalcs();
  renderSummary();
}

function updateLineCalcs() {
  for (const l of state.lines) {
    const tr = $(`#lines tr[data-id="${l.id}"]`);
    if (!tr) continue;
    const c = computeLine(l);
    $('.rate', tr).innerHTML = `${esc(c.column)}: ${esc(c.rateText || '—')}${c.notes.map(n => `<div class="warn">${esc(n)}</div>`).join('')}`;
    $('.duty', tr).textContent = usd(c.total);
  }
}

$('#lines').addEventListener('input', e => {
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  const line = state.lines.find(l => l.id === tr.dataset.id);
  const el = e.target;
  line[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  if (el.name === 'origin') el.value = line.origin = el.value.toUpperCase();
  saveState();
  updateLineCalcs();
  renderSummary();
});

$('#lines').addEventListener('click', async e => {
  const act = e.target.dataset.act;
  if (!act) return;
  const tr = e.target.closest('tr[data-id]');
  const line = state.lines.find(l => l.id === tr.dataset.id);
  if (act === 'remove') {
    state.lines = state.lines.filter(l => l !== line);
  } else if (act === 'lookup') {
    e.target.textContent = '…';
    try {
      applyInfo(line, await resolveCode(line.hts));
    } catch (err) {
      alert(err.message);
    }
  }
  saveState();
  renderLines();
});

function renderSummary() {
  const t = computeTotals();
  $('#summary').innerHTML = `
    <h2>Estimated landed cost</h2>
    <dl class="totals">
      <dt>Entered value (${esc(state.header.incoterm || 'FOB')})</dt><dd>${usd(t.value)}</dd>
      <dt>International freight + insurance</dt><dd>${usd(num(state.header.freight) + num(state.header.insurance))}</dd>
      <dt>Duties (HTS columns)</dt><dd>${usd(t.duty)}</dd>
      <dt>Additional duties (Ch. 99 etc.)</dt><dd>${usd(t.extra)}</dd>
      <dt>Merchandise Processing Fee ${t.formal ? '(formal entry)' : '(informal entry)'}</dt><dd>${usd(t.mpf)}</dd>
      <dt>Harbor Maintenance Fee</dt><dd>${usd(t.hmf)}</dd>
      <dt class="strong">Total duties, taxes &amp; fees</dt><dd class="strong">${usd(t.total)}</dd>
      <dt class="strong">Estimated landed cost</dt><dd class="strong">${usd(t.landed)}</dd>
    </dl>
    <p class="small muted">US duty is assessed on transaction value, generally excluding international freight and insurance. ${t.formal ? 'Shipments over the informal limit require a formal entry (CBP Form 7501) and a customs bond.' : ''} The de minimis ($800) exemption is currently suspended, so low-value shipments are dutiable.</p>`;
}

// ---------- documents tab ----------

function renderInvoice() {
  const h = state.header;
  const t = computeTotals();
  const block = s => esc(s || '').replace(/\n/g, '<br>');
  $('#invoice').innerHTML = `
    <h2>Commercial Invoice</h2>
    <div class="inv-grid">
      <div><h4>Shipper / Exporter</h4><p>${block(h.shipper) || '—'}</p></div>
      <div><h4>Consignee</h4><p>${block(h.consignee) || '—'}</p></div>
      <div><h4>Importer of record</h4><p>${block(h.importer) || block(h.consignee) || '—'}</p></div>
      <div>
        <h4>Shipment</h4>
        <p>Invoice no.: ${esc(h.invoiceNo) || '—'}<br>
        Date: ${esc(h.invoiceDate) || '—'}<br>
        Country of export: ${esc(h.exportCountry) || '—'}<br>
        Port of entry: ${esc(h.port) || '—'}<br>
        Mode: ${esc(h.mode) || '—'} · Terms: ${esc(h.incoterm) || '—'}<br>
        Packages: ${esc(h.packages) || '—'}</p>
      </div>
    </div>
    <table class="grid inv-lines">
      <thead><tr><th>#</th><th>Description</th><th>HTS</th><th>Origin</th><th class="num">Qty</th><th>Unit</th><th class="num">Net kg</th><th class="num">Unit value</th><th class="num">Total</th></tr></thead>
      <tbody>${t.lines.map(({ line: l, calc }, i) => `
        <tr><td>${i + 1}</td><td>${esc(l.description)}</td><td class="mono">${esc(l.hts)}</td><td>${esc(l.origin)}</td>
        <td class="num">${esc(l.qty)}</td><td>${esc(l.unit)}</td><td class="num">${esc(l.weightKg)}</td>
        <td class="num">${usd(num(l.unitValue))}</td><td class="num">${usd(calc.value)}</td></tr>`).join('')}
      </tbody>
      <tfoot>
        <tr><td colspan="8" class="num">Merchandise total</td><td class="num">${usd(t.value)}</td></tr>
        <tr><td colspan="8" class="num">Freight</td><td class="num">${usd(num(h.freight))}</td></tr>
        <tr><td colspan="8" class="num">Insurance</td><td class="num">${usd(num(h.insurance))}</td></tr>
        <tr><td colspan="8" class="num strong">Invoice total (USD)</td><td class="num strong">${usd(t.value + num(h.freight) + num(h.insurance))}</td></tr>
      </tfoot>
    </table>
    <p class="small">Total net weight: ${t.lines.reduce((a, x) => a + num(x.line.weightKg), 0).toFixed(2)} kg</p>
    <p class="small">I declare that all information contained in this invoice is true and correct, and that the goods originate in the countries stated.</p>
    <p class="sig">Signature: ______________________ &nbsp; Name/Title: ______________________ &nbsp; Date: __________</p>`;
}

$('#print-invoice').addEventListener('click', () => { renderInvoice(); window.print(); });

function download(name, type, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('#export-csv').addEventListener('click', () => {
  const cols = ['Line', 'Description', 'HTS', 'Origin', 'Qty', 'Unit', 'Unit value', 'Line value', 'Net kg', 'Rate column', 'Rate', 'Duty', 'Extra duty', 'Notes'];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = computeTotals().lines.map(({ line: l, calc: c }, i) => [
    i + 1, l.description, l.hts, l.origin, l.qty, l.unit, l.unitValue, c.value.toFixed(2), l.weightKg,
    c.column, c.rateText, c.duty.toFixed(2), c.extra.toFixed(2), c.notes.join('; '),
  ]);
  download(`${state.header.invoiceNo || 'shipment'}.csv`, 'text/csv', [cols, ...rows].map(r => r.map(q).join(',')).join('\n'));
});

$('#export-json').addEventListener('click', () => {
  download(`${state.header.invoiceNo || 'shipment'}.json`, 'application/json', JSON.stringify(state, null, 2));
});

$('#import-json').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.lines)) throw new Error('Not a shipment file');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    location.reload();
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  }
});

// ---------- init ----------

renderLines();
