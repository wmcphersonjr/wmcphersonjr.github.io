// Small shared UI helpers: escaping, feedback (flash, beep, vibrate, toast), QR + barcode drawing.
import * as E from './engine.js';

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let audio;
function beep(freq, ms) {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = freq; o.type = 'square';
    g.gain.value = 0.04;
    o.connect(g); g.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + ms / 1000);
  } catch { /* no audio */ }
}

let flashTimer;
export function flash(kind) {
  const el = document.getElementById('flash');
  el.className = kind;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.className = ''; }, kind === 'bad' ? 450 : 250);
  if (kind === 'good') beep(1760, 70);
  else { beep(220, 220); try { navigator.vibrate?.([120, 60, 120]); } catch { /* */ } }
}

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

export function qr(code) {
  try {
    if (window.qrcode) {
      const q = window.qrcode(0, 'M');
      q.addData(code); q.make();
      return `<div class="qr">${q.createSvgTag({ cellSize: 6, margin: 2, scalable: true })}</div>`;
    }
  } catch { /* fall through */ }
  return `<div class="qr"><div class="fallback">${esc(code)}</div></div>`;
}

// Decorative barcode stripes derived from the code (stand-in for a real carrier barcode).
export function bars(code) {
  let h = 2166136261;
  let out = '';
  for (let i = 0; i < 70; i++) {
    h ^= code.charCodeAt(i % code.length) + i;
    h = Math.imul(h, 16777619) >>> 0;
    const w = 1 + (h % 3);
    out += `<i style="width:${w}px;margin-right:${1 + ((h >> 3) % 3)}px"></i>`;
  }
  return `<div class="bars">${out}</div>`;
}

export const svcName = id => E.SERVICES[id]?.name || id;
export const pct = v => (v == null ? '—' : `${Math.round(v * 100)}%`);
export const num = (v, d = 1) => (v == null ? '—' : Number(v).toFixed(d));
export const money = v => (v == null ? '—' : `$${Math.round(v).toLocaleString()}`);

export function practiceLine(s, pid) {
  const p = s.practices[pid];
  if (!p) return pid;
  return `${esc(p.name)} <span class="faint">· ${esc(p.city || '')}${p.state ? ', ' + esc(p.state) : ''}</span>`;
}

export function dueLabel(s, dueDay) {
  const d = dueDay - E.dayOf(s.clock);
  if (d < 0) return `<span class="pill bad">overdue</span>`;
  if (d === 0) return `<span class="pill bad">due today</span>`;
  if (d === 1) return `<span class="pill warn">due tomorrow</span>`;
  return `<span class="pill">due ${E.fmtDay(dueDay)}</span>`;
}

export function packByLabel(s, packBy) {
  const m = packBy - s.clock;
  const day = E.dayOf(packBy) === E.dayOf(s.clock) ? '' : E.fmtDay(E.dayOf(packBy)) + ' ';
  const cls = m < 0 ? 'bad' : m <= 45 ? 'warn' : 'info';
  return `<span class="pill ${cls}">pack by ${day}${E.fmtTime(packBy)}${m >= 0 && m < 600 ? ' · ' + E.fmtDur(m) : ''}</span>`;
}
