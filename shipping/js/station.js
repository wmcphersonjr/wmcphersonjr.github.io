// Pack station (desktop + fixed scanner + printers). 3.6 Ship and the packer side of 3.5 Hand off.
import * as E from './engine.js';
import { esc, flash, toast, bars, svcName, practiceLine, packByLabel, dueLabel } from './ui.js';

export function onScan(app, raw) {
  const s = app.s, st = s.stations.find(x => x.id === app.st.stationId);
  const code = String(raw).trim().toUpperCase();
  if (!code) return;
  const packer = app.st.packer || 'W-108';
  if (st.packageId) {
    const r = E.containerize(s, st.packageId, code, packer);
    if (r.relabeled) { flash('bad'); app.st.note = { kind: 'warn', text: r.msg }; return; }
    if (!r.ok) { flash('bad'); app.st.note = { kind: 'bad', text: r.msg }; return; }
    flash('good'); toast(`✓ In ${r.container}`); app.st.note = null;
    return;
  }
  const r = E.stationRead(s, st.id, code, packer);
  if (!r.ok) { flash('bad'); app.st.note = { kind: 'bad', text: r.msg }; return; }
  flash('good'); app.st.note = null;
}

export const actions = {
  'st-station'(app, d) { app.st.stationId = d.id; app.st.note = null; app.savePrefs(); },
  'st-chip'(app, d) { onScan(app, d.code); },
  'st-packer'(app, d, el) { app.st.packer = el.value; app.savePrefs(); },
};

export function render(app) {
  const s = app.s;
  const st = s.stations.find(x => x.id === app.st.stationId) || s.stations[0];
  app.st.stationId = st.id;
  const pkg = st.packageId ? s.packages[st.packageId] : null;
  const q = E.packQueue(s);
  const carried = Object.values(s.sets).filter(x => x.status === 'carried');

  const left = pkg ? packing(app, s, pkg) : idle(app, s, q, carried);
  return `
  <div class="row wrap" style="margin-bottom:12px">
    <div class="subtabs" style="margin:0">${s.stations.map(x => `<button data-act="st-station" data-id="${x.id}" aria-pressed="${x.id === st.id}">${x.id}${x.packageId ? ' ●' : ''}</button>`).join('')}</div>
    <label class="row right" style="font-size:13px">Packer
      <select data-change="st-packer" style="border:1px solid var(--line);border-radius:8px;padding:4px 6px;background:var(--surface)">
        ${Object.keys(E.WORKER_NAMES).map(id => `<option value="${id}" ${id === (app.st.packer || 'W-108') ? 'selected' : ''}>${id} ${E.WORKER_NAMES[id]}</option>`).join('')}
      </select></label>
  </div>
  <div class="station-grid">
    <div class="stack">${left}</div>
    <div class="stack">
      <div class="card"><h3>Handoff slots <span class="faint">· ${E.handoffDepth(s)}/${s.config.handoffSlots} full · reverse guard at ${s.config.peak.maxQueue}</span></h3>
        <div class="slots">${s.slots.map(sl => {
          if (!sl.setId) return `<div class="slot"><b>${sl.id}</b><span class="faint">empty</span></div>`;
          const set = s.sets[sl.setId], sh = E.setShipment(s, set);
          const hot = sh.packBy - s.clock <= 45;
          return `<div class="slot full ${hot ? 'hot' : ''}"><b>${sl.id}</b>${set.orderIds.length} ord · ${esc(E.SERVICES[sh.svcId].code)}<br><span class="faint">by ${E.fmtTime(sh.packBy)} · ${E.fmtDur(s.clock - set.handoffAt)}</span></div>`;
        }).join('')}</div>
      </div>
      ${containers(s)}
    </div>
  </div>`;
}

function scanBox(app, placeholder, chipList) {
  return `<div class="card station-scan">
    <form data-scan-form="st" autocomplete="off"><input id="scan-st" name="code" placeholder="${esc(placeholder)}" autocapitalize="characters" spellcheck="false" aria-label="Station scanner"><button class="btn primary" type="submit">Enter</button></form>
    ${app.st.note ? `<div class="note ${app.st.note.kind === 'bad' ? 'bad' : 'warn'}" style="margin-top:8px">${esc(app.st.note.text)}</div>` : ''}
    ${app.trainer && chipList.length ? `<div class="chips" style="margin:10px 0 0"><span class="label">Trainer: tap to simulate the station scanner</span>${chipList.map(c => `<button class="chip ${c.bad ? 'bad' : ''}" data-act="st-chip" data-code="${esc(c.code)}">${esc(c.text || c.code)}</button>`).join('')}</div>` : ''}
  </div>`;
}

function idle(app, s, q, carried) {
  const next = E.nextTask(s, app.st.packer || 'W-108');
  const follow = !q.length && next.type === 'pull'
    ? `<div class="note warn">Queue empty. Follow the work: pull bin <b>${esc(next.binId)}</b> in zone ${esc(next.zone)}.</div>`
    : !q.length ? `<div class="note">Queue empty. Nothing released to pull right now.</div>` : '';
  return `
    ${scanBox(app, 'Scan handheld QR or handoff slot', [
      ...q.slice(0, 4).map(x => ({ code: x.slot })),
      ...carried.slice(0, 3).map(x => ({ code: x.id, text: `${x.id} (device QR)` })),
    ])}
    <div class="card"><h3>Packer queue <span class="faint">· sorted by soonest truck, not drop time</span></h3>
      ${q.length ? `<div class="table-scroll"><table><thead><tr><th>Slot</th><th>Practice</th><th class="n">Orders</th><th>Service</th><th>Pack by</th><th class="n">Waiting</th></tr></thead><tbody>
        ${q.map(x => `<tr><td class="mono"><b>${x.slot}</b></td><td>${practiceLine(s, x.set.practiceId)}</td><td class="n">${x.set.orderIds.length}</td><td>${esc(svcName(x.ship.svcId))}</td><td>${packByLabel(s, x.ship.packBy)}</td><td class="n">${E.fmtDur(s.clock - x.set.handoffAt)}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
      ${follow}
    </div>`;
}

function packing(app, s, pkg) {
  const p = s.practices[pkg.practiceId];
  const svc = E.SERVICES[pkg.svcId];
  const exp = E.expectedContainer(s, pkg);
  const wrong = E.containerCode(pkg.svcId === 'UPS_GND' ? 'UPS_2DA' : 'UPS_GND', pkg.shipDay);
  return `
    <div class="card">
      <div class="row wrap"><span class="pill good">Printed to ${esc(pkg.station)} printer</span>${packByLabel(s, pkg.packBy)}${dueLabel(s, pkg.dueDay)}
        ${pkg.upgrade ? '<span class="pill warn">service upgrade</span>' : ''}${pkg.late ? '<span class="pill bad">misses due date</span>' : ''}${pkg.relabeled ? '<span class="pill serious">relabeled</span>' : ''}</div>
      <div style="margin:12px 0" class="row"><span class="prompt">Pack in</span><span class="mailer">${esc(pkg.mailer)}</span><span class="faint">${pkg.type === 'multi' ? 'multi-pack' : 'single'} · ${pkg.orderIds.length} order${pkg.orderIds.length === 1 ? '' : 's'}</span></div>
      <div class="papers">
        <div class="paper">
          <h4>Packing slip · ${esc(pkg.id)}</h4>
          <div><b>${esc(p.name)}</b><br>${esc(p.city)}, ${esc(p.state)} ${esc(p.zip)}</div>
          <table style="margin-top:8px"><thead><tr><th>Order</th><th>Source</th><th>Due</th></tr></thead><tbody>
            ${pkg.orderIds.map(id => `<tr><td class="mono">${esc(id)}</td><td>${esc(s.orders[id].source)}</td><td>${E.fmtDay(s.orders[id].dueDay)}</td></tr>`).join('')}
          </tbody></table>
        </div>
        <div class="paper label4x6">
          <div class="svc"><span>${esc(svc.carrier)}</span><small>${esc(svc.name)}</small></div>
          <div>SHIP TO:<br><b>${esc(p.name.toUpperCase())}</b><br>${esc(p.city.toUpperCase())} ${esc(p.state)} ${esc(p.zip)}</div>
          ${bars(pkg.tracking)}
          <div style="font-size:12px">TRK# ${esc(pkg.tracking)}</div>
          <div style="font-size:11px;margin-top:6px">FROM: PROVO UT · ${E.fmtDay(pkg.shipDay)} · ${esc(pkg.pickupId)}</div>
          <div class="sample">SAMPLE · SIMULATED · NOT A SHIPPING LABEL</div>
        </div>
      </div>
    </div>
    <div class="card"><div class="prompt">Scan package into container</div><div class="huge" style="font-size:36px;margin:6px 0">${esc(exp)}</div></div>
    ${scanBox(app, 'Scan container', [{ code: exp }, { code: wrong, bad: true, text: `${wrong} (wrong)` }])}`;
}

function containers(s) {
  const today = E.dayOf(s.clock);
  const list = Object.values(s.containers).filter(c => c.day === today || c.status !== 'departed');
  list.sort((a, b) => E.packByAbs(s, a.pickupId, a.day) - E.packByAbs(s, b.pickupId, b.day));
  return `<div class="card"><h3>Containers <span class="faint">· per carrier + service</span></h3>
    ${list.length ? `<table><thead><tr><th>Container</th><th>Truck</th><th class="n">Pkgs</th><th>Status</th></tr></thead><tbody>
    ${list.map(c => `<tr><td class="mono">${c.id}</td><td>${E.fmtTime(E.pickupAbs(s, c.pickupId, c.day))}${c.day !== today ? ' ' + E.fmtDay(c.day) : ''}</td><td class="n">${c.packageIds.length}</td><td><span class="pill ${c.status === 'open' ? 'info' : c.status === 'closed' ? 'warn' : ''}">${c.status}</span></td></tr>`).join('')}
    </tbody></table>` : '<div class="faint">No containers yet today. One opens with the first package scanned in.</div>'}
  </div>`;
}
