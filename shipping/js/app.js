// App shell: state persistence, sim clock, routing between Handheld / Pack station / Lead, event delegation.
import * as E from './engine.js';
import * as S from './sim.js';
import * as HH from './handheld.js';
import * as ST from './station.js';
import * as LD from './lead.js';
import { esc } from './ui.js';

const KEY = 'dsc-state-v1';
const PREFS = 'dsc-prefs-v1';
const root = document.getElementById('app');

const app = {
  s: null,
  view: 'handheld',
  running: false,
  speed: 1,
  trainer: true,
  hh: HH.initHH(),
  st: { stationId: 'PS-1', packer: 'W-108', note: null },
  lead: { tab: 'floor', filter: '', metricDay: 'all' },
  savePrefs() {
    try {
      localStorage.setItem(PREFS, JSON.stringify({ trainer: app.trainer, speed: app.speed, st: { stationId: app.st.stationId, packer: app.st.packer }, lead: { tab: app.lead.tab } }));
    } catch { /* storage blocked */ }
  },
  reset(opts) {
    app.running = false;
    app.s = S.newSimulation(opts);
    app.hh = { worker: null, screen: 'login', ctx: {} };
    try { sessionStorage.removeItem('dsc-hh'); } catch { /* */ }
    save();
  },
  setBots(n) { S.setBots(app.s, Math.max(0, Math.min(30, n | 0))); },
};

function load() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) || '{}');
    if (typeof p.trainer === 'boolean') app.trainer = p.trainer;
    if (p.speed) app.speed = p.speed;
    if (p.st) Object.assign(app.st, p.st);
    if (p.lead) Object.assign(app.lead, p.lead);
  } catch { /* */ }
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw && JSON.parse(raw);
    if (s && s.v === 1 && s.orders && s.sim) { app.s = s; return; }
  } catch { /* fall through */ }
  app.s = S.newSimulation();
}

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(app.s)); } catch { /* quota or blocked: keep running in memory */ }
  }, 150);
}

// Another tab changed the floor: pick it up.
window.addEventListener('storage', e => {
  if (e.key !== KEY || !e.newValue || app.running) return;
  try { app.s = JSON.parse(e.newValue); render(); } catch { /* */ }
});

// ---------- clock ----------
let timer;
function setRunning(on) {
  app.running = on;
  clearInterval(timer);
  if (on) timer = setInterval(() => { S.advance(app.s, app.speed); save(); render(true); }, 1000);
}

function nextTruck(s) {
  const today = E.dayOf(s.clock);
  let best = null;
  for (const d of [today, today + 1]) for (const p of s.config.pickups) {
    const pb = E.packByAbs(s, p.id, d);
    if (pb >= s.clock && (!best || pb < best.pb)) best = { p, pb };
  }
  return best;
}

const shellActions = {
  view(_, d) { app.view = d.view; location.hash = d.view; },
  play() { setRunning(!app.running); },
  'step'(_, d) {
    const n = Number(d.min);
    if (n >= 600) toast2('Simulating…');
    setTimeout(() => { S.advance(app.s, n); save(); render(); }, 10);
  },
  'next-day'() {
    toast2('Simulating to 6:00a tomorrow…');
    setTimeout(() => { S.advanceTo(app.s, (E.dayOf(app.s.clock) + 1) * E.DAY + 6 * 60); save(); render(); }, 10);
  },
  theme() {
    const r = document.documentElement;
    const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    r.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('dsc-theme', r.dataset.theme); } catch { /* */ }
  },
};
const shellChanges = {
  speed(_, d, el) { app.speed = Number(el.value); app.savePrefs(); },
};

function toast2(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1500);
}

const ACTIONS = { ...shellActions, ...HH.actions, ...ST.actions, ...LD.actions };
const CHANGES = { ...shellChanges, ...LD.changes, ...{ 'st-packer': ST.actions['st-packer'] } };

// ---------- render ----------
function topbar() {
  const s = app.s;
  const nt = nextTruck(s);
  const views = [['handheld', 'Handheld'], ['station', 'Pack station'], ['lead', 'Lead']];
  return `<header class="topbar">
    <div class="brand">Dandy Shipping Central<small>Prototype · simulated data</small></div>
    <nav class="tabs" aria-label="Views">${views.map(([k, l]) => `<button data-act="view" data-view="${k}" aria-pressed="${app.view === k}">${l}</button>`).join('')}</nav>
    <div class="clock">
      <span class="time">${E.fmtDay(E.dayOf(s.clock))} · ${E.fmtTime(s.clock)}</span>
      <button data-act="play" aria-label="${app.running ? 'Pause' : 'Run'} clock">${app.running ? '❚❚ Pause' : '▶ Run'}</button>
      <select data-change="speed" aria-label="Clock speed">${[1, 5, 15, 30].map(v => `<option value="${v}" ${app.speed === v ? 'selected' : ''}>${v} min/s</option>`).join('')}</select>
      <button data-act="step" data-min="15">+15m</button>
      <button data-act="step" data-min="60">+1h</button>
      <button data-act="next-day">Next day</button>
      <button data-act="theme" aria-label="Toggle dark mode">◐</button>
      ${nt ? `<span class="next">Next truck: ${esc(nt.p.label)} · pack by ${E.fmtTime(nt.pb)} (${E.fmtDur(nt.pb - s.clock)})</span>` : ''}
    </div>
  </header>`;
}

function render(fromTick = false) {
  const active = document.activeElement;
  // Don't stomp on a lead typing into a settings field while the clock ticks.
  if (fromTick && active && active.matches('input:not(#scan-hh):not(#scan-st), select') && root.contains(active)) {
    const tb = root.querySelector('.topbar');
    if (tb) tb.outerHTML = topbar();
    return;
  }
  const scanId = active?.id;
  const draft = scanId && active.value;
  let body;
  try {
    body = app.view === 'station' ? ST.render(app) : app.view === 'lead' ? LD.render(app) : HH.render(app);
  } catch (err) {
    console.error(err);
    body = `<div class="card"><b>Something went wrong rendering this view.</b><pre class="mono" style="white-space:pre-wrap">${esc(err.stack || err)}</pre><button class="btn" data-act="lead-reset-hard">Reset demo data</button></div>`;
  }
  root.innerHTML = topbar() + `<main class="${app.view === 'handheld' ? 'hh' : ''}">${body}</main>`;
  const scan = document.getElementById(app.view === 'station' ? 'scan-st' : 'scan-hh');
  if (scan) {
    if (scanId === scan.id && draft) scan.value = draft;
    // Keyboard-wedge scanners type into the focused field, so keep it focused (desktop only: avoid popping phone keyboards).
    if (!fromTick || scanId === scan.id) {
      if (matchMedia('(pointer: fine)').matches || scanId === scan.id) scan.focus({ preventScroll: true });
    }
  }
}

ACTIONS['lead-reset-hard'] = () => app.reset({});

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !root.contains(el)) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  if (el.tagName === 'BUTTON') e.preventDefault();
  fn(app, el.dataset, el);
  save();
  render();
});

document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  const fn = CHANGES[el.dataset.change];
  if (!fn) return;
  fn(app, el.dataset, el);
  save();
  render();
});

document.addEventListener('submit', e => {
  const form = e.target.closest('[data-scan-form]');
  if (!form) return;
  e.preventDefault();
  const input = form.querySelector('input');
  const code = input.value;
  input.value = '';
  if (form.dataset.scanForm === 'hh') HH.onScan(app, code);
  else ST.onScan(app, code);
  save();
  render();
  const again = document.getElementById(form.dataset.scanForm === 'hh' ? 'scan-hh' : 'scan-st');
  again?.focus({ preventScroll: true });
});

window.addEventListener('hashchange', () => {
  const v = location.hash.slice(1);
  if (['handheld', 'station', 'lead'].includes(v) && v !== app.view) { app.view = v; render(); }
});

try { const t = localStorage.getItem('dsc-theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* */ }
load();
const h = location.hash.slice(1);
if (['handheld', 'station', 'lead'].includes(h)) app.view = h;
render();
window.addEventListener('load', () => render()); // re-render once the QR library is in
window.dsc = app; // handy for debugging in the console
