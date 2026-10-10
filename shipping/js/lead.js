// Lead view (3.9): bins by zone, aging, at-risk, handoff depth, peak mode, trucks, production changes, metrics.
import * as E from './engine.js';
import * as M from './metrics.js';
import { esc, toast, pct, num, money, svcName, practiceLine, packByLabel } from './ui.js';

const TABS = [['floor', 'Floor'], ['trucks', 'Trucks & close-out'], ['production', 'Production & exceptions'], ['metrics', 'Metrics'], ['settings', 'Settings']];

export const actions = {
  'lead-tab'(app, d) { app.lead.tab = d.tab; app.lead.confirmReset = false; app.savePrefs(); },
  'lead-peak'(app, d) { app.s.config.peak.mode = d.mode; E.log(app.s, 'peak-mode', { mode: d.mode }); },
  'lead-close'(app, d) { E.closeContainer(app.s, d.id); },
  'lead-depart'(app, d) { E.departContainer(app.s, d.id); toast(`${d.id} left on the truck`); },
  'lead-delay'(app, d) {
    const r = E.delayEta(app.s, d.order, 1);
    toast(r.ok ? (r.replan?.released ? `ETA +1 day. Bin released: set can't wait.` : `ETA +1 day. Plan recalculated.`) : r.msg);
  },
  'lead-cancel'(app, d) {
    const r = E.cancelOrder(app.s, d.order);
    toast(r.msg || (r.replan?.released ? 'Cancelled. Bin released.' : 'Cancelled. Plan recalculated.'));
  },
  'lead-metric-day'(app, d) { app.lead.metricDay = d.day; },
  'lead-reset'(app) {
    const f = id => Number(document.getElementById(id)?.value);
    // Two-step confirm in the page itself (browser dialogs are not available everywhere this runs).
    if (!app.lead.confirmReset) { app.lead.confirmReset = true; return; }
    app.lead.confirmReset = false;
    app.reset({
      seed: f('rs-seed') || 7, ordersPerDay: f('rs-opd') || 180, practices: f('rs-pr') || 60, bots: f('rs-bots') || 0,
      zoneBins: f('rs-zb') || 24, overflowBins: f('rs-of') || 12, slots: f('rs-slots') || 8, stations: f('rs-st') || 4,
    });
  },
};

export const changes = {
  'lead-set'(app, d, el) {
    const path = d.key.split('.');
    let o = app.s.config;
    for (const k of path.slice(0, -1)) o = o[k];
    const v = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? el.value : Number(el.value);
    if (typeof v === 'number' && !isFinite(v)) return;
    o[path.at(-1)] = v;
    toast('Saved');
  },
  'lead-bots'(app, d, el) { app.setBots(Number(el.value)); },
  'lead-botspeed'(app, d, el) { app.s.sim.botSpeed = Number(el.value); },
  'lead-filter'(app, d, el) { app.lead.filter = el.value; },
};

export function render(app) {
  const tab = app.lead.tab || 'floor';
  const body = { floor, trucks, production, metrics, settings }[tab](app);
  return `<div class="subtabs">${TABS.map(([k, l]) => `<button data-act="lead-tab" data-tab="${k}" aria-pressed="${k === tab}">${l}</button>`).join('')}</div>${body}`;
}

function kpi(k, v, sub = '') { return `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`; }

function floor(app) {
  const s = app.s;
  const today = E.dayOf(s.clock);
  const m = M.compute(s, { day: today });
  const f = M.floorSnapshot(s);
  const pk = s.config.peak;
  const autoHot = pk.mode === 'auto' ? autoState(s) : null;
  return `
  <div class="kpis">
    ${kpi('Orders per package', num(m.ordersPerPackage, 2), `baseline ≈ 3 · ${m.pkgs} pkgs today`)}
    ${kpi('Missed consolidations', m.missed, Object.entries(m.missedByCause).map(([k, v]) => `${v} ${k}`).join(' · ') || 'none today')}
    ${kpi('On time to truck', pct(m.onTime), 'in container by pack-by')}
    ${kpi('Consolidation rate', pct(m.consolidationRate), 'orders shipped in multi-packs')}
    ${kpi('Freight saved', money(m.savings), 'vs every order shipped solo')}
    ${kpi('Inbound waiting', f.inbound, 'to receive')}
    ${kpi('Released bins', f.released, 'waiting to pull')}
    ${kpi('Handoff queue', `${f.handoffDepth}<span class="faint" style="font-size:15px">/${pk.maxQueue}</span>`, f.handoffDepth >= pk.maxQueue ? 'guard on: handoff paused' : 'sets in slots')}
  </div>
  <div class="grid" style="grid-template-columns:minmax(0,2.2fr) minmax(280px,1fr);margin-top:12px">
    <div class="card">
      <div class="row wrap" style="margin-bottom:10px"><h3 style="margin:0">Bins by zone</h3>
        <div class="legend right">
          <span><i style="background:var(--bin-empty)"></i>empty</span><span><i style="background:var(--accent-soft)"></i>holding</span>
          <span><i style="background:var(--warn-soft);border-color:var(--warn)"></i>at risk</span><span><i style="background:var(--serious-soft);border-color:var(--serious)"></i>released</span>
          <span><i style="background:var(--good-soft);border-color:var(--good)"></i>pulling</span></div></div>
      ${s.config.zones.map(z => zoneGrid(s, z, f.zones[z.id])).join('')}
    </div>
    <div class="stack">
      <div class="card"><h3>Peak mode</h3>
        <div class="subtabs" style="margin-bottom:8px">${['off', 'auto', 'on'].map(md => `<button data-act="lead-peak" data-mode="${md}" aria-pressed="${pk.mode === md}">${md === 'on' ? 'Always on' : md[0].toUpperCase() + md.slice(1)}</button>`).join('')}</div>
        <div class="faint" style="font-size:12px">${pk.mode === 'off' ? 'Workers always choose pack-myself or hand off.'
          : pk.mode === 'on' ? 'Forcing handoff on every set (reverse guard still applies).'
          : `Forces handoff within ${pk.windowMin}m of a truck's pack-by when a zone has more than ${pk.releasedThreshold} released bins. ${autoHot}`}</div>
      </div>
      <div class="card"><h3>At-risk bins <span class="faint">· only make their date if they ship today</span></h3>
        ${f.atRisk.length ? `<table><tbody>${f.atRisk.slice(0, 8).map(b => `<tr><td class="mono"><b>${b.id}</b></td><td>${practiceLine(s, b.practiceId)}</td><td>${E.fmtTime(b.cutoffAbs)}</td></tr>`).join('')}</tbody></table>` : '<div class="faint">None.</div>'}
      </div>
      <div class="card"><h3>Oldest bin per zone</h3>
        <table><tbody>${s.config.zones.map(z => { const o = f.zones[z.id].oldest; return `<tr><td>Zone ${z.id}</td><td class="mono">${o ? o.id : '—'}</td><td class="n">${o ? E.fmtDur(s.clock - o.openedAt) : ''}</td><td class="n faint">${f.zones[z.id].used}/${f.zones[z.id].total} used</td></tr>`; }).join('')}</tbody></table>
      </div>
      <div class="card"><h3>Recent exceptions</h3>${exceptionLog(s, 8)}</div>
    </div>
  </div>`;
}

function autoState(s) {
  const zones = s.config.zones.map(z => ({ z: z.id, n: E.releasedInZone(s, z.id) })).filter(x => x.n > s.config.peak.releasedThreshold);
  return zones.length ? `<b>Hot now:</b> ${zones.map(x => `zone ${x.z} (${x.n})`).join(', ')}.` : 'Not triggered right now.';
}

function zoneGrid(s, z, snap) {
  const bins = Object.values(s.bins).filter(b => b.zone === z.id);
  return `<div class="zone"><div class="zone-head"><b>Zone ${esc(z.id)}${z.overflow ? ' · overflow' : ''}</b>
    <span class="faint">${snap.used}/${snap.total} used · ${snap.released} released · ${snap.pulling} pulling</span></div>
    <div class="bins">${bins.map(b => {
      if (b.status === 'empty') return `<div class="bin"><b>${b.id}</b></div>`;
      const risk = b.status === 'open' && E.binAtRisk(s, b);
      const cls = b.status === 'open' ? (risk ? 'risk' : 'open') : b.status;
      const p = s.practices[b.practiceId];
      const exp = new Set([...b.orderIds, ...b.expectedIds]).size;
      const age = E.fmtDur(s.clock - b.openedAt);
      const tip = `${b.id} · ${p?.name}\n${b.orderIds.length} of ${exp} here · open ${age}\n${b.status === 'open' ? 'releases by ' + E.fmtTime(b.cutoffAbs) + ' ' + E.fmtDay(E.dayOf(b.cutoffAbs)) : b.status + ' (' + b.releaseReason + ')'}`;
      return `<div class="bin ${cls}" title="${esc(tip)}"><b>${b.id}</b>${b.orderIds.length}/${exp}<br><span class="faint">${age}</span></div>`;
    }).join('')}</div></div>`;
}

function exceptionLog(s, n) {
  const ex = s.events.filter(e => E.EXCEPTION_TYPES[e.type]).slice(-n).reverse();
  if (!ex.length) return '<div class="faint">None yet.</div>';
  return `<div class="eventlog">${ex.map(e => `<div><span class="faint num">${E.fmtTime(e.t)}</span> <b>${esc(E.EXCEPTION_TYPES[e.type])}</b> ${esc(e.orderId || e.packageId || e.setId || e.container || '')}${e.expected ? ` <span class="faint">expected ${esc(e.expected)}, scanned ${esc(e.scanned)}</span>` : ''}${e.cause ? ` <span class="faint">${esc(e.cause)}</span>` : ''}${e.worker ? ` <span class="faint">${esc(e.worker)}</span>` : ''}</div>`).join('')}</div>`;
}

function trucks(app) {
  const s = app.s;
  const today = E.dayOf(s.clock);
  const m = M.compute(s, { day: today });
  const rows = s.config.pickups.map(p => {
    const pb = E.packByAbs(s, p.id, today), at = E.pickupAbs(s, p.id, today);
    const gone = s.departed[`${p.id}:${today}`];
    const boxes = Object.values(s.containers).filter(c => c.pickupId === p.id && c.day === today);
    const printed = Object.values(s.packages).filter(x => x.pickupId === p.id && x.shipDay === today && !x.containerId).length;
    const bp = m.byPickup[p.id];
    return `<div class="truck ${gone ? 'gone' : ''}">
      <div><b>${esc(p.label)}</b> <span class="faint">· ${p.services.map(svcName).join(', ')}</span><br>
        ${gone ? '<span class="pill">departed</span>' : packByLabel(s, pb)} <span class="faint">pickup ${E.fmtTime(at)}</span>
        ${printed ? `<span class="pill warn">${printed} labeled, not in container</span>` : ''}
        ${bp ? `<span class="pill ${bp.onTime === bp.pkgs ? 'good' : 'warn'}">${bp.onTime}/${bp.pkgs} on time</span>` : ''}</div>
      <div class="right"></div>
      <div style="grid-column:1/-1">${boxes.length ? `<table><tbody>${boxes.map(c => `<tr><td class="mono">${c.id}</td><td class="n">${c.packageIds.length} pkgs · ${c.packageIds.reduce((a, id) => a + s.packages[id].orderIds.length, 0)} orders</td>
          <td><span class="pill ${c.status === 'open' ? 'info' : c.status === 'closed' ? 'warn' : ''}">${c.status}</span></td>
          <td class="n">${c.status === 'open' ? `<button class="btn small" data-act="lead-close" data-id="${c.id}">Close</button>` : ''}
          ${c.status !== 'departed' ? `<button class="btn small" data-act="lead-depart" data-id="${c.id}">Confirm on truck</button>` : `<span class="faint">${E.fmtTime(c.departedAt)}</span>`}</td></tr>`).join('')}</tbody></table>` : '<span class="faint">No containers yet.</span>'}</div>
    </div>`;
  }).join('');
  return `<div class="grid cols-2">
    <div class="card"><h3>Today's trucks <span class="faint">· ${E.fmtDay(today)}</span></h3><div class="trucks">${rows}</div></div>
    <div class="card stack"><h3>Close-out</h3>
      <label class="row" style="font-size:14px"><input type="checkbox" data-change="lead-set" data-key="autoCloseout" ${s.config.autoCloseout ? 'checked' : ''}> Auto close and depart containers at pickup time</label>
      <p class="muted" style="font-size:13px;margin:0">Open item: carrier manifest and "confirm it left on the truck" flow. Today the MVP closes a container (no more packages), then a lead confirms it left, which marks every order shipped. Packages labeled for a truck that already left get relabeled to the next service that makes the date when scanned into a container.</p>
      <p class="muted" style="font-size:13px;margin:0">Pack-by is ${s.config.packByBufferMin} min before pickup (Settings). Bins release ${s.config.releaseLeadMin} min before pack-by when their siblings haven't shown up.</p>
    </div>
  </div>`;
}

function production(app) {
  const s = app.s;
  const q = (app.lead.filter || '').trim().toUpperCase();
  const openBins = Object.values(s.bins).filter(b => b.status === 'open' || b.status === 'released');
  const rows = [];
  for (const b of openBins) {
    for (const id of new Set([...b.orderIds, ...b.expectedIds])) {
      const o = s.orders[id];
      if (!o) continue;
      rows.push({ o, b });
    }
  }
  const filtered = rows.filter(({ o, b }) => !q || o.id.includes(q) || b.id.includes(q) || s.practices[o.practiceId].name.toUpperCase().includes(q))
    .sort((a, b) => a.b.id.localeCompare(b.b.id));
  return `<div class="grid" style="grid-template-columns:minmax(0,2fr) minmax(280px,1fr)">
    <div class="card"><h3>Sets waiting on production <span class="faint">· remake, delay or cancel to see the recalc rule</span></h3>
      <input placeholder="Filter by order, bin or practice" value="${esc(app.lead.filter || '')}" data-change="lead-filter" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;margin-bottom:8px;background:var(--surface)">
      <div class="table-scroll"><table><thead><tr><th>Bin</th><th>Order</th><th>Practice</th><th>Status</th><th>ETA</th><th>Due</th><th></th></tr></thead><tbody>
      ${filtered.slice(0, 80).map(({ o, b }) => {
        const inProd = o.status === 'production' || o.status === 'inbound';
        return `<tr><td class="mono">${b.id}</td><td class="mono">${o.id}</td><td>${esc(s.practices[o.practiceId].name)}</td>
          <td><span class="pill ${o.status === 'cancelled' ? 'bad' : inProd ? 'info' : ''}">${o.status === 'binned' ? 'in bin' : o.status}</span></td>
          <td>${E.fmtDay(o.etaDay)}</td><td>${E.fmtDay(o.dueDay)}</td>
          <td class="n" style="white-space:nowrap">${inProd ? `<button class="btn small" data-act="lead-delay" data-order="${o.id}">Remake +1d</button>` : ''}
            ${o.status !== 'cancelled' ? `<button class="btn small danger" data-act="lead-cancel" data-order="${o.id}">Cancel</button>` : ''}</td></tr>`;
      }).join('')}
      </tbody></table></div>
      ${filtered.length > 80 ? `<div class="faint">${filtered.length - 80} more. Filter to narrow.</div>` : ''}
    </div>
    <div class="stack">
      <div class="card"><h3>Exception rules</h3>
        <table><tbody>
          <tr><td>Missing at pull</td><td>Ship what is there. Missing order ships solo when found.</td></tr>
          <tr><td>Remade or cancelled</td><td>Recalculate. If the set can't make the earliest due date, release now.</td></tr>
          <tr><td>Late after bin shipped</td><td>Ship solo on the service that makes its date, or pair with a sibling arriving in time.</td></tr>
          <tr><td>Wrong bin scan</td><td>Red screen, no check, rescan. Logged.</td></tr>
          <tr><td>Damaged <span class="pill warn">proposed</span></td><td>Pull it, send back for remake (+1 day), recalc the set.</td></tr>
          <tr><td>Cancelled in bin <span class="pill warn">proposed</span></td><td>Flag at pull, scan into the exceptions tote, ship the rest.</td></tr>
        </tbody></table>
      </div>
      <div class="card"><h3>Exception log</h3>${exceptionLog(s, 40)}</div>
    </div>
  </div>`;
}

function metrics(app) {
  const s = app.s;
  const today = E.dayOf(s.clock);
  const sel = app.lead.metricDay ?? 'all';
  const m = M.compute(s, { day: sel === 'all' ? null : today });
  const maxHour = Math.max(1, ...m.byHour.map(h => h.arrive));
  const hb = (label, v, max, txt) => `<div class="hbar"><span>${label}</span><div class="track"><div class="fill" style="width:${max ? (v / max) * 100 : 0}%"></div></div><span class="num" style="text-align:right">${txt ?? v}</span></div>`;
  const relTotal = Object.values(m.releaseMix).reduce((a, b) => a + b, 0);
  const missMax = Math.max(1, ...Object.values(m.missedByCause));
  const workers = Object.entries(m.workers).sort((a, b) => b[1].ordersPerHour - a[1].ordersPerHour);
  return `
  <div class="row wrap" style="margin-bottom:12px"><div class="subtabs" style="margin:0">
    <button data-act="lead-metric-day" data-day="today" aria-pressed="${sel === 'today'}">Today</button>
    <button data-act="lead-metric-day" data-day="all" aria-pressed="${sel === 'all'}">All days</button></div>
    <span class="faint" style="font-size:13px">Every touch is a scan, so these come straight from the app's event log.</span></div>
  <div class="kpis">
    ${kpi('Orders per package', num(m.ordersPerPackage, 2), 'headline · baseline ≈ 3')}
    ${kpi('Missed consolidations', m.missed, 'headline · the money metric')}
    ${kpi('On time to truck', pct(m.onTime), 'headline')}
    ${kpi('Freight per order', m.freightPerOrder == null ? '—' : '$' + m.freightPerOrder.toFixed(2), `${money(m.freight)} total`)}
    ${kpi('Service upgrades', m.upgrades, 'faster + pricier than needed')}
    ${kpi('ETA accuracy', pct(m.etaAccuracy), `${m.arrivals} arrivals on predicted day`)}
    ${kpi('Touches per order', num(m.touchesPerOrder, 1), 'scans ÷ orders received')}
    ${kpi('Exceptions / 1,000', num(m.excPer1000, 0), 'orders received')}
  </div>
  <div class="grid cols-3" style="margin-top:12px">
    <div class="card"><h3>Missed consolidations by cause</h3>
      ${Object.keys(m.missedByCause).length ? Object.entries(m.missedByCause).map(([k, v]) => hb(k, v, missMax)).join('') : '<div class="faint">None.</div>'}</div>
    <div class="card"><h3>Release mix <span class="faint">· rising cutoff share = production timing is costing consolidations</span></h3>
      ${relTotal ? Object.entries(m.releaseMix).map(([k, v]) => hb(k, v, relTotal, pct(v / relTotal))).join('') : '<div class="faint">No releases yet.</div>'}</div>
    <div class="card"><h3>Cycle times</h3><table><tbody>
      <tr><td>Scan to put</td><td class="n">${E.fmtDur(m.putDur)}</td></tr>
      <tr><td>Release to pulled</td><td class="n">${E.fmtDur(m.releaseToPull)}</td></tr>
      <tr><td>Pulled to container</td><td class="n">${E.fmtDur(m.pullToContainer)}</td></tr>
      <tr><td>Handoff wait</td><td class="n">${E.fmtDur(m.handoffWait)}</td></tr></tbody></table></div>
    <div class="card"><h3>Orders per package by zone</h3><table><thead><tr><th>Zone</th><th class="n">Pkgs</th><th class="n">Orders</th><th class="n">Per pkg</th></tr></thead><tbody>
      ${Object.entries(m.byZone).map(([z, v]) => `<tr><td>${esc(z)}</td><td class="n">${v.pkgs}</td><td class="n">${v.orders}</td><td class="n">${num(v.orders / v.pkgs, 2)}</td></tr>`).join('')}</tbody></table></div>
    <div class="card"><h3>Freight by service</h3><table><thead><tr><th>Service</th><th class="n">Pkgs</th><th class="n">$/order</th><th class="n">Upgr.</th></tr></thead><tbody>
      ${Object.entries(m.bySvc).map(([k, v]) => `<tr><td>${esc(svcName(k))}</td><td class="n">${v.pkgs}</td><td class="n">${(v.cost / v.orders).toFixed(2)}</td><td class="n">${v.upgrades}</td></tr>`).join('')}</tbody></table></div>
    <div class="card"><h3>Exceptions</h3><table><tbody>
      ${Object.entries(m.exceptions).map(([k, v]) => `<tr><td>${esc(E.EXCEPTION_TYPES[k])}</td><td class="n">${v}</td></tr>`).join('') || '<tr><td colspan="2" class="faint">None.</td></tr>'}</tbody></table></div>
  </div>
  <div class="grid cols-2" style="margin-top:12px">
    <div class="card"><h3>Arrivals by hour <span class="faint">· volume vs staffing, sizes shifts and peak thresholds</span></h3>
      <div class="vbars">${m.byHour.map((h, i) => `<div class="col"><i style="height:${(h.arrive / maxHour) * 100}%"></i><span class="tip">${i}:00 · ${h.arrive} arrived · ${h.packed} packed</span></div>`).join('')}</div>
      <div class="vlabels">${m.byHour.map((_, i) => `<span>${i % 3 === 0 ? i : ''}</span>`).join('')}</div></div>
    <div class="card"><h3>Throughput per person</h3><div class="table-scroll"><table><thead><tr><th>Worker</th><th class="n">Stow</th><th class="n">Pull</th><th class="n">Pack</th><th class="n">Orders/hr</th></tr></thead><tbody>
      ${workers.map(([id, w]) => `<tr><td>${esc(s.workers[id]?.name || id)}</td><td class="n">${w.stow}</td><td class="n">${w.pull}</td><td class="n">${w.pack}</td><td class="n">${num(w.ordersPerHour, 0)}</td></tr>`).join('') || '<tr><td colspan="5" class="faint">No scans yet.</td></tr>'}</tbody></table></div></div>
  </div>`;
}

function settings(app) {
  const s = app.s, c = s.config, pk = c.peak;
  const numIn = (key, val, label, help = '') => `<label class="field">${label}<input type="number" value="${val}" data-change="lead-set" data-key="${key}">${help ? `<span class="faint" style="font-size:11px">${help}</span>` : ''}</label>`;
  return `<div class="grid cols-3">
    <div class="card stack"><h3>Peak mode thresholds</h3>
      ${numIn('peak.windowMin', pk.windowMin, 'Window before pack-by (min)', 'Auto forces handoff inside this window')}
      ${numIn('peak.releasedThreshold', pk.releasedThreshold, 'Released bins in zone above', 'and the zone has more released bins than this')}
      ${numIn('peak.maxQueue', pk.maxQueue, 'Reverse guard: handoff queue depth', 'Stop offering handoff at this depth')}
    </div>
    <div class="card stack"><h3>Trucks and release</h3>
      ${numIn('packByBufferMin', c.packByBufferMin, 'Pack-by buffer (min before pickup)', 'Open item: per-truck buffer')}
      ${numIn('releaseLeadMin', c.releaseLeadMin, 'Cutoff release lead (min before pack-by)', 'Time to pull and pack a released bin')}
      ${numIn('cutoffCostTolerance', c.cutoffCostTolerance, 'Wait for a later truck if it costs at most $ more', 'Lets late-day siblings join without paying for a faster service')}
      ${numIn('multiExtraCost', c.multiExtraCost, 'Multi-pack cost per extra order ($)')}
    </div>
    <div class="card stack"><h3>Simulation</h3>
      <label class="field">Bot crew (simulated workers)<input type="number" min="0" max="30" value="${s.sim.bots}" data-change="lead-bots"></label>
      <label class="field">Bot speed<select data-change="lead-botspeed">${[0.5, 1, 1.5, 2].map(v => `<option value="${v}" ${s.sim.botSpeed == v ? 'selected' : ''}>${v}×</option>`).join('')}</select></label>
      <p class="faint" style="font-size:12px;margin:0">Bots follow the work through the same app functions a person uses, so you can test the rules at volume and jump in on a handheld at any time.</p>
    </div>
    <div class="card stack"><h3>Reset floor <span class="faint">· physical counts are open items</span></h3>
      <div class="grid" style="grid-template-columns:1fr 1fr">
        <label class="field">Seed<input id="rs-seed" type="number" value="${s.sim.seed}"></label>
        <label class="field">Orders/day<input id="rs-opd" type="number" value="${s.sim.ordersPerDay}"></label>
        <label class="field">Practices<input id="rs-pr" type="number" value="${s.sim.practices}"></label>
        <label class="field">Bots<input id="rs-bots" type="number" value="${s.sim.bots}"></label>
        <label class="field">Bins per zone (A–C)<input id="rs-zb" type="number" value="${c.zones[0].bins}"></label>
        <label class="field">Overflow bins<input id="rs-of" type="number" value="${c.zones.find(z => z.overflow)?.bins ?? 0}"></label>
        <label class="field">Handoff slots<input id="rs-slots" type="number" value="${c.handoffSlots}"></label>
        <label class="field">Pack stations<input id="rs-st" type="number" value="${c.stations}"></label>
      </div>
      <button class="btn danger" data-act="lead-reset">${app.lead.confirmReset ? 'Click again to clear and reset' : 'Reset simulation'}</button>
      ${app.lead.confirmReset ? '<span class="faint" style="font-size:12px">All progress on this device is cleared.</span>' : ''}
    </div>
    <div class="card"><h3>Carrier services <span class="faint">· planning costs, not contract rates</span></h3>
      <table><thead><tr><th>Truck</th><th>Service</th><th class="n">Cost</th><th>Transit</th></tr></thead><tbody>
      ${c.pickups.flatMap(p => p.services.map(id => { const v = E.SERVICES[id]; return `<tr><td>${esc(p.label)}</td><td>${esc(v.name)}</td><td class="n">$${v.cost}</td><td>${[2, 3, 4, 5, 6, 7, 8].map(z => v.transit(z) ?? '–').join(' ')}</td></tr>`; })).join('')}
      </tbody></table><div class="faint" style="font-size:11px;margin-top:4px">Transit days by UPS-style zone 2→8. Assumption: the 12p FedEx truck is Priority Overnight and the 3p FedEx truck is 2Day.</div></div>
  </div>`;
}
