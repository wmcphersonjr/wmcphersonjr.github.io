// Handheld (Honeywell) screens: Stow (receive, decide, put) and Manifest (pull, hand off, pack, containerize).
// Built as a phone-sized web page that a keyboard-wedge scanner types into (build option 1/2).
import * as E from './engine.js';
import { esc, flash, toast, qr, svcName, practiceLine, dueLabel, packByLabel } from './ui.js';

export function initHH() {
  try { return JSON.parse(sessionStorage.getItem('dsc-hh')) || { worker: null, screen: 'login', ctx: {} }; }
  catch { return { worker: null, screen: 'login', ctx: {} }; }
}
function saveHH(app) { try { sessionStorage.setItem('dsc-hh', JSON.stringify(app.hh)); } catch { /* */ } }

function go(app, screen, ctx = {}, note = null) {
  app.hh.screen = screen; app.hh.ctx = ctx; app.hh.note = note;
  saveHH(app);
}

// ---------- scanning ----------
export function onScan(app, raw) {
  const s = app.s, hh = app.hh, w = hh.worker;
  const code = String(raw).trim().toUpperCase();
  if (!code) return;
  const bad = msg => { flash('bad'); hh.note = { kind: 'bad', text: msg }; };
  const good = () => flash('good');

  if (hh.screen === 'login' || !w) {
    const r = E.login(s, code);
    if (!r.ok) return bad(r.msg);
    good(); hh.worker = r.worker.id; go(app, 'home');
    return;
  }

  switch (hh.screen) {
    case 'home': {
      if (s.orders[code]) { hh.screen = 'receive'; return onScan(app, code); }
      if (s.bins[code]) {
        const b = s.bins[code];
        if (b.status === 'released' || (b.status === 'pulling' && b.pullWorker === w)) { go(app, 'pull', { binId: code }); return onScan(app, code); }
        return bad(`${code} is ${b.status}${b.status === 'open' ? ' (not released yet)' : ''}`);
      }
      if (s.sets[code] && s.sets[code].owner === w) { good(); go(app, 'carry', { setId: code }); return; }
      return bad(`Nothing to do with ${code} here`);
    }
    case 'receive': {
      const r = E.receive(s, code, w);
      if (!r.ok) return bad(r.msg);
      good();
      if (r.decision === 'hold') go(app, 'put', { orderId: code, binId: r.binId });
      else if (r.decision === 'ship') go(app, 'choice', { setId: r.setId, why: r.zonesFull ? `Zones full. Released ${r.releasedBin || 'nothing'} early.` : r.cannotWait ? `Can't wait for ${r.binId}: ships alone to make its date.` : null });
      else go(app, 'pull', { binId: r.binId, complete: true, inHand: code });
      return;
    }
    case 'put': {
      const r = E.put(s, hh.ctx.orderId, code, w);
      if (!r.ok) return bad(r.msg);
      good(); toast(`✓ ${hh.ctx.orderId} in ${r.binId}`);
      go(app, 'receive', {}, { kind: 'good', text: `Last: ${hh.ctx.orderId} → ${r.binId}` });
      return;
    }
    case 'pull': {
      const bin = s.bins[hh.ctx.binId];
      if (!hh.ctx.atBin) {
        if (code !== bin.id && !bin.orderIds.includes(code)) return bad(`Scan bin ${bin.id}`);
        const r = E.startPull(s, bin.id, w);
        if (!r.ok) return bad(r.msg);
        hh.ctx.atBin = true; saveHH(app);
        if (code === bin.id) { good(); hh.note = null; return; }
      }
      const r = E.scanPull(s, bin.id, code, w);
      if (!r.ok) return bad(r.msg);
      if (r.cancelled) { flash('bad'); hh.note = { kind: 'bad', text: r.msg }; return; }
      good(); hh.note = null;
      return;
    }
    case 'handoff': {
      const r = E.handoff(s, hh.ctx.setId, code, w);
      if (!r.ok) return bad(r.msg);
      good(); toast(`✓ Handed off in ${r.slot}`);
      go(app, 'home');
      return;
    }
    case 'carry':
    case 'station-pick': {
      // Scanning a station label = "I'm at this station"; the station reader picks up the set / slot.
      if (!/^PS-\d+$/.test(code)) return bad('Scan the pack station label (PS-#)');
      const src = hh.screen === 'carry' ? hh.ctx.setId : hh.ctx.slot;
      const r = E.stationRead(s, code, src, w);
      if (!r.ok) return bad(r.msg);
      good(); go(app, 'box', { packageId: r.packageId, station: code });
      return;
    }
    case 'box': {
      const r = E.containerize(s, hh.ctx.packageId, code, w);
      if (r.relabeled) { flash('bad'); hh.note = { kind: 'warn', text: r.msg }; return; }
      if (!r.ok) return bad(r.msg);
      good(); toast(`✓ ${hh.ctx.packageId} in ${r.container}`);
      go(app, 'home');
      return;
    }
    default:
      bad('Not expecting a scan here');
  }
}

// ---------- button actions ----------
export const actions = {
  'hh-start'(app) {
    const t = E.nextTask(app.s, app.hh.worker);
    startTask(app, t);
  },
  'hh-go'(app, d) {
    if (d.screen === 'pull' && d.bin) go(app, 'pull', { binId: d.bin });
    else go(app, d.screen);
  },
  'hh-home'(app) { go(app, 'home'); },
  'hh-logout'(app) { app.hh = { worker: null, screen: 'login', ctx: {} }; saveHH(app); },
  'hh-missing'(app, d) { E.markMissing(app.s, app.hh.ctx.binId, d.order, app.hh.worker); },
  'hh-damaged'(app, d) {
    E.reportDamaged(app.s, d.order, app.hh.worker);
    toast(`${d.order} sent back for remake`);
    if (app.hh.screen === 'put' || app.hh.screen === 'choice') go(app, 'receive');
    else if (app.hh.screen === 'pull' && !app.s.bins[app.hh.ctx.binId].orderIds.length) go(app, 'home');
  },
  'hh-ship'(app) {
    const r = E.finishPull(app.s, app.hh.ctx.binId, app.hh.worker);
    if (!r.ok) { flash('bad'); app.hh.note = { kind: 'bad', text: r.msg }; return; }
    if (!r.setId) { toast('Nothing left to ship'); go(app, 'home'); return; }
    go(app, 'choice', { setId: r.setId });
  },
  'hh-self'(app) { go(app, 'carry', { setId: app.hh.ctx.setId }); },
  'hh-handoff'(app) { go(app, 'handoff', { setId: app.hh.ctx.setId }); },
  'hh-trainer'(app) { app.trainer = !app.trainer; app.savePrefs(); },
  'hh-chip'(app, d) { onScan(app, d.code); },
};

function startTask(app, t) {
  switch (t.type) {
    case 'receive': go(app, 'receive'); break;
    case 'pull': go(app, 'pull', { binId: t.binId }); break;
    case 'pack': go(app, 'station-pick', { slot: t.slot }); break;
    case 'carry': go(app, 'carry', { setId: t.setId }); break;
    case 'put': go(app, 'put', { orderId: t.orderId, binId: t.binId }); break;
    default: toast('Nothing waiting. Check back in a minute.');
  }
}

// ---------- rendering ----------
function chips(app, list, label = 'Trainer: tap to simulate a scan') {
  if (!app.trainer || !list.length) return '';
  return `<div class="chips"><span class="label">${esc(label)}</span>${list.map(c =>
    `<button class="chip ${c.bad ? 'bad' : ''}" data-act="hh-chip" data-code="${esc(c.code)}" title="${esc(c.title || '')}">${esc(c.text || c.code)}</button>`).join('')}</div>`;
}

function note(hh) {
  if (!hh.note) return '';
  return `<div class="note ${hh.note.kind === 'bad' ? 'bad' : hh.note.kind === 'warn' ? 'warn' : ''}">${esc(hh.note.text)}</div>`;
}

function taskText(s, t) {
  switch (t.type) {
    case 'receive': return { title: 'Receive at inbound', sub: `${t.count} order${t.count === 1 ? '' : 's'} waiting to be scanned in` };
    case 'pull': {
      const b = s.bins[t.binId];
      return { title: `Pull bin ${t.binId}`, sub: `Zone ${t.zone} · ${b.orderIds.length} orders · released ${b.releaseReason}`, packBy: t.binPackBy ?? t.packBy };
    }
    case 'pack': return { title: `Pack slot ${t.slot}`, sub: `Handoff queue · ${s.sets[t.setId].orderIds.length} orders`, packBy: t.packBy };
    case 'carry': return { title: `Pack your set ${t.setId}`, sub: 'You chose to pack it yourself', packBy: t.packBy };
    case 'put': return { title: `Put ${t.orderId}`, sub: `in bin ${t.binId}` };
    default: return { title: 'All caught up', sub: 'Nothing is waiting. New work shows up here.' };
  }
}

export function render(app) {
  const s = app.s, hh = app.hh;
  // Station picked up the carried set from another screen? Jump to boxing.
  if (hh.screen === 'carry') {
    const set = s.sets[hh.ctx.setId];
    if (!set || set.status === 'void') go(app, 'home');
    else if (set.status !== 'carried') {
      if (set.status === 'packing' && s.packages[set.packageId] && !s.packages[set.packageId].containerId) go(app, 'box', { packageId: set.packageId });
      else go(app, 'home');
    }
  }
  if (hh.screen === 'pull' && hh.ctx.binId) {
    const b = s.bins[hh.ctx.binId];
    if (b.status === 'empty' || (b.status === 'pulling' && b.pullWorker !== hh.worker)) go(app, 'home', {}, { kind: 'warn', text: `${hh.ctx.binId} was pulled already` });
  }
  if (hh.screen === 'box') {
    const p = s.packages[hh.ctx.packageId];
    if (!p || p.containerId) go(app, 'home');
  }
  if (hh.screen === 'station-pick') {
    const sl = s.slots.find(x => x.id === hh.ctx.slot);
    if (!sl?.setId) go(app, 'home', {}, { kind: 'warn', text: `${hh.ctx.slot} was picked up by someone else` });
  }

  const worker = s.workers[hh.worker];
  const peak = s.config.peak.mode;
  const status = `<div class="hh-status">
      ${worker ? `<span class="who">${esc(worker.name)}</span><span class="faint mono">${esc(worker.id)}</span>` : '<span class="who">Dandy Shipping Central</span>'}
      <span class="right num">${E.fmtTime(s.clock)}</span>
      ${peak !== 'off' ? `<span class="pill warn">Peak ${peak}</span>` : ''}
    </div>`;
  const { body, scan, placeholder } = screen(app);
  const scanBar = scan === false ? '' : `<div class="hh-scan">
      ${scan || ''}
      <form data-scan-form="hh" autocomplete="off">
        <input id="scan-hh" name="code" placeholder="${esc(placeholder || 'Scan…')}" enterkeyhint="go" autocapitalize="characters" spellcheck="false" aria-label="Scan input">
        <button type="submit">Enter</button>
      </form>
    </div>`;
  return `<div class="hh-wrap">
    <div class="device" role="application" aria-label="Handheld">${status}<div class="hh-body">${body}</div>${scanBar}</div>
    ${side(app)}
  </div>`;
}

function screen(app) {
  const s = app.s, hh = app.hh, ctx = hh.ctx;
  switch (hh.screen) {
    case 'login': return {
      body: `<div class="hero ship"><div class="prompt">Dandy Shipping Central</div><div class="big">Scan your badge</div><div class="sub">Shared devices sign in by badge. No passwords.</div></div>${note(hh)}`,
      scan: chips(app, Object.keys(E.WORKER_NAMES).map(id => ({ code: id, text: `${id} ${E.WORKER_NAMES[id]}` }))),
      placeholder: 'Scan badge (W-###)',
    };
    case 'home': {
      const t = E.nextTask(s, hh.worker);
      const tt = taskText(s, t);
      const inbound = Object.values(s.orders).filter(o => o.status === 'inbound').length;
      const released = Object.values(s.bins).filter(b => b.status === 'released').length;
      const depth = E.handoffDepth(s);
      return {
        body: `
          <div class="hero ${t.type === 'idle' ? 'idle' : 'ship'}">
            <div class="prompt">Next up · follow the work</div>
            <div class="big" style="font-size:32px">${esc(tt.title)}</div>
            <div class="sub">${esc(tt.sub)}</div>
            ${tt.packBy && isFinite(tt.packBy) ? `<div style="margin-top:8px">${packByLabel(s, tt.packBy)}</div>` : ''}
          </div>
          ${t.type !== 'idle' ? `<button class="bigbtn go" data-act="hh-start">Start</button>` : ''}
          ${note(hh)}
          <div class="tile-grid">
            <button class="tile" data-act="hh-go" data-screen="receive"><span class="count">${inbound}</span><b>Stow</b><span>Receive · decide · put</span></button>
            <button class="tile" data-act="hh-go" data-screen="pull-list"><span class="count">${released}</span><b>Pull</b><span>Released bins</span></button>
            <button class="tile" data-act="hh-go" data-screen="queue"><span class="count">${depth}</span><b>Pack queue</b><span>Handoff slots</span></button>
            <button class="tile" data-act="hh-logout"><b>Sign out</b><span>${esc(hh.worker)}</span></button>
          </div>`,
        placeholder: 'Scan order, bin or set',
      };
    }
    case 'receive': {
      const inbound = Object.values(s.orders).filter(o => o.status === 'inbound').sort((a, b) => a.dueDay - b.dueDay || a.arrivedAt - b.arrivedAt);
      const missing = Object.values(s.orders).filter(o => o.status === 'missing');
      return {
        body: `<div class="hero idle"><div class="prompt">Stow · receive and decide</div><div class="big">Scan an order</div>
            <div class="sub">${inbound.length} waiting at inbound. The app decides hold or ship.</div></div>
          ${note(hh)}
          <button class="btn" data-act="hh-home">‹ Home</button>`,
        scan: chips(app, [
          ...inbound.slice(0, 6).map(o => ({ code: o.id, title: `due day ${o.dueDay}` })),
          ...missing.slice(0, 2).map(o => ({ code: o.id, text: `${o.id} (found)` })),
        ]),
        placeholder: 'Scan order label',
      };
    }
    case 'put': {
      const o = s.orders[ctx.orderId], bin = s.bins[ctx.binId];
      const here = bin.orderIds.length + 1;
      const waiting = bin.expectedIds.filter(id => !bin.orderIds.includes(id) && id !== o.id).length;
      const wrong = Object.keys(s.bins).find(id => id !== bin.id && s.bins[id].zone === bin.zone);
      return {
        body: `<div class="hero hold"><div class="prompt">Hold · put to bin</div><div class="huge">${esc(bin.id)}</div>
            <div class="sub">${practiceLine(s, o.practiceId)}</div>
            <div class="sub">${here} here · waiting on ${waiting} · releases by ${E.fmtTime(bin.cutoffAbs)}${E.dayOf(bin.cutoffAbs) !== E.dayOf(s.clock) ? ' ' + E.fmtDay(E.dayOf(bin.cutoffAbs)) : ''}</div></div>
          <div class="row wrap"><span class="mono">${esc(o.id)}</span>${dueLabel(s, o.dueDay)}<span class="pill">${esc(o.source)}</span></div>
          <div class="note">Bin is also printed on the order label. Scan the bin to confirm.</div>
          ${note(hh)}
          <div class="row"><button class="btn small danger" data-act="hh-damaged" data-order="${esc(o.id)}">Report damaged</button></div>`,
        scan: chips(app, [{ code: bin.id }, { code: wrong, bad: true, text: `${wrong} (wrong)` }]),
        placeholder: 'Scan bin label',
      };
    }
    case 'pull-list': {
      const rel = Object.values(s.bins).filter(b => b.status === 'released')
        .map(b => ({ b, sh: E.binShipment(s, b) })).sort((a, b) => (a.sh?.packBy ?? 0) - (b.sh?.packBy ?? 0));
      return {
        body: `<div class="prompt">Released bins · soonest truck first</div>
          <div class="biglist">${rel.length ? rel.map(({ b, sh }) => `<button class="item" style="text-align:left" data-act="hh-go" data-screen="pull" data-bin="${b.id}">
              <b class="mono" style="font-size:18px">${b.id}</b><span class="grow">${b.orderIds.length} orders · ${esc(b.releaseReason)}<br>${sh ? packByLabel(s, sh.packBy) : ''}</span></button>`).join('')
            : '<div class="note">No bins released. Bins release when complete or at their truck cutoff.</div>'}</div>
          <button class="btn" data-act="hh-home">‹ Home</button>`,
        placeholder: 'Scan a bin',
      };
    }
    case 'queue': {
      const q = E.packQueue(s);
      return {
        body: `<div class="prompt">Handoff queue · soonest truck first</div>
          <div class="biglist">${q.length ? q.map(x => `<button class="item" style="text-align:left" data-act="hh-pack-slot" data-slot="${x.slot}">
            <b class="mono" style="font-size:18px">${x.slot}</b><span class="grow">${x.set.orderIds.length} orders · ${esc(svcName(x.ship.svcId))}<br>${packByLabel(s, x.ship.packBy)}</span></button>`).join('')
            : '<div class="note">Queue is empty. Follow the work: go pull.</div>'}</div>
          <button class="btn" data-act="hh-home">‹ Home</button>`,
        placeholder: 'Scan…',
      };
    }
    case 'pull': {
      const bin = s.bins[ctx.binId];
      const sh = E.binShipment(s, bin);
      if (!ctx.atBin) {
        return {
          body: `<div class="hero ${ctx.complete ? 'complete' : 'hold'}"><div class="prompt">${ctx.complete ? 'Complete on arrival · pull now' : 'Pull · go to bin'}</div>
              <div class="huge">${esc(bin.id)}</div>
              <div class="sub">${practiceLine(s, bin.practiceId)}</div>
              <div class="sub">Zone ${esc(bin.zone)} · ${bin.orderIds.length} orders · released ${esc(bin.releaseReason || '')}</div></div>
            ${ctx.complete ? `<div class="note">Keep ${esc(ctx.inHand)} in hand. Skip the shelf.</div>` : ''}
            ${sh ? `<div>${packByLabel(s, sh.packBy)} <span class="pill">${esc(svcName(sh.svcId))}</span></div>` : ''}
            ${note(hh)}
            <button class="btn" data-act="hh-home">‹ Home</button>`,
          scan: chips(app, [{ code: bin.id }]),
          placeholder: 'Scan bin label',
        };
      }
      const ready = E.pullReady(s, bin);
      const live = bin.orderIds.filter(id => !bin.setAside.includes(id));
      const items = bin.orderIds.map(id => {
        const o = s.orders[id];
        const st = bin.scanned.includes(id) ? 'done' : bin.missing.includes(id) ? 'missing' : bin.setAside.includes(id) ? 'aside' : '';
        const mark = st === 'done' ? '✓' : st === 'missing' ? '?' : st === 'aside' ? '×' : '';
        const tag = st === 'missing' ? 'Missing: ships solo when found' : st === 'aside' ? 'Cancelled: exceptions tote' : bin.inHand.includes(id) ? 'In hand' : o.source;
        return `<div class="item ${st}"><span class="check">${mark}</span><span class="grow"><b class="mono">${esc(id)}</b><br><span class="faint">${esc(tag)}</span></span>
          ${!st ? `<button class="btn small" data-act="hh-missing" data-order="${esc(id)}">Missing</button>` : ''}
          ${st !== 'aside' ? `<button class="btn small danger" data-act="hh-damaged" data-order="${esc(id)}" title="Damaged">Dmg</button>` : ''}</div>`;
      }).join('');
      const unscanned = bin.orderIds.filter(id => !bin.scanned.includes(id) && !bin.setAside.includes(id));
      const nShip = bin.scanned.length;
      return {
        body: `<div class="row"><b class="mono" style="font-size:22px">${esc(bin.id)}</b><span class="faint">${bin.scanned.length + bin.setAside.length}/${bin.orderIds.length} scanned</span>
            <span class="right">${sh ? packByLabel(s, sh.packBy) : ''}</span></div>
          <div class="muted" style="font-size:13px">${practiceLine(s, bin.practiceId)}</div>
          ${note(hh)}
          <div class="biglist">${items}</div>
          <button class="bigbtn go" data-act="hh-ship" ${ready && nShip ? '' : 'disabled'}>${ready ? (nShip ? `Ship ${nShip} order${nShip === 1 ? '' : 's'}` : 'Nothing to ship') : `Scan ${live.length - bin.scanned.length - bin.missing.length} more`}</button>`,
        scan: chips(app, unscanned.map(id => ({ code: id }))),
        placeholder: 'Scan each order',
      };
    }
    case 'choice': {
      const set = s.sets[ctx.setId];
      const sh = E.setShipment(s, set);
      const ch = E.packChoice(s, set);
      return {
        body: `<div class="hero ship"><div class="prompt">${set.orderIds.length > 1 ? 'Ship · consolidated set' : 'Ship now · solo'}</div>
            <div class="big" style="font-size:34px">${esc(svcName(sh.svcId))}</div>
            <div class="sub">${set.orderIds.length} order${set.orderIds.length === 1 ? '' : 's'} · ${practiceLine(s, set.practiceId)}</div></div>
          <div class="row wrap">${packByLabel(s, sh.packBy)}${dueLabel(s, E.setDueDay(s, set.orderIds))}${sh.late ? '<span class="pill bad">will miss due date</span>' : ''}</div>
          ${ctx.why ? `<div class="note warn">${esc(ctx.why)}</div>` : ''}
          ${ch.forced ? `<div class="note warn">${esc(ch.reason)}</div>` : ''}
          <div class="choice">
            <button class="bigbtn" data-act="hh-self" ${ch.self ? '' : 'disabled'}>Pack it myself</button>
            <button class="bigbtn alt" data-act="hh-handoff" ${ch.handoff ? '' : 'disabled'}>Hand off<br><span style="font-size:13px;font-weight:600">queue ${E.handoffDepth(s)}/${s.config.peak.maxQueue}</span></button>
          </div>
          ${set.orderIds.length === 1 ? `<button class="btn small danger" data-act="hh-damaged" data-order="${esc(set.orderIds[0])}">Report damaged</button>` : ''}`,
        scan: false,
      };
    }
    case 'handoff': {
      const set = s.sets[ctx.setId];
      const slot = E.suggestSlot(s);
      const occupied = s.slots.find(x => x.setId);
      const others = s.slots.filter(x => !x.setId && x.id !== slot).slice(0, 2);
      return {
        body: `<div class="hero hold"><div class="prompt">Hand off · place set in slot</div><div class="huge">${esc(slot || 'FULL')}</div>
            <div class="sub">${set.orderIds.length} orders · ${esc(set.id)}. Scanning the slot hands ownership to the packers.</div></div>
          ${note(hh)}
          <button class="btn" data-act="hh-go" data-screen="choice-back">‹ Back</button>`,
        scan: chips(app, [
          ...(slot ? [{ code: slot }] : []),
          ...others.map(x => ({ code: x.id })),
          ...(occupied ? [{ code: occupied.id, bad: true, text: `${occupied.id} (full)` }] : []),
        ]),
        placeholder: 'Scan handoff slot (H-#)',
      };
    }
    case 'carry': {
      const set = s.sets[ctx.setId];
      const sh = E.setShipment(s, set);
      const free = s.stations.filter(x => !x.packageId);
      return {
        body: `<div class="prompt">Take it to a pack station</div>
          ${qr(set.id)}
          <div style="text-align:center"><b class="mono" style="font-size:20px">${esc(set.id)}</b><br><span class="faint">${set.orderIds.length} orders · ${esc(svcName(sh.svcId))}</span></div>
          <div class="row wrap" style="justify-content:center">${packByLabel(s, sh.packBy)}</div>
          <div class="note">Hold this screen to the station reader: slip and label print together. Or scan the station label here.</div>
          ${note(hh)}`,
        scan: chips(app, free.map(x => ({ code: x.id, text: `${x.id} reads QR` }))),
        placeholder: 'Scan station label (PS-#)',
      };
    }
    case 'station-pick': {
      const slot = s.slots.find(x => x.id === ctx.slot);
      const set = s.sets[slot.setId];
      const free = s.stations.filter(x => !x.packageId);
      return {
        body: `<div class="hero hold"><div class="prompt">Pack from handoff slot</div><div class="huge">${esc(slot.id)}</div>
            <div class="sub">${set.orderIds.length} orders · ${practiceLine(s, set.practiceId)}</div></div>
          <div class="note">Take the set to a free pack station and scan the station label. Slip and label print there.</div>
          ${note(hh)}
          <button class="btn" data-act="hh-home">‹ Home</button>`,
        scan: chips(app, free.map(x => ({ code: x.id }))),
        placeholder: 'Scan station label (PS-#)',
      };
    }
    case 'box': {
      const pkg = s.packages[ctx.packageId];
      const exp = E.expectedContainer(s, pkg);
      const wrong = E.containerCode(pkg.svcId === 'UPS_GND' ? 'UPS_2DA' : 'UPS_GND', pkg.shipDay);
      return {
        body: `<div class="hero ship"><div class="prompt">Printed at ${esc(pkg.station)} · pack it</div>
            <div class="big" style="font-size:30px">${esc(pkg.mailer)}</div>
            <div class="sub">${pkg.orderIds.length} order${pkg.orderIds.length === 1 ? '' : 's'} · ${esc(svcName(pkg.svcId))} · <span class="mono">${esc(pkg.tracking)}</span></div></div>
          <div class="prompt">Then scan into container</div>
          <div class="huge" style="font-size:34px">${esc(exp)}</div>
          <div class="row wrap">${packByLabel(s, pkg.packBy)}${pkg.upgrade ? '<span class="pill warn">service upgrade</span>' : ''}</div>
          ${note(hh)}`,
        scan: chips(app, [{ code: exp }, { code: wrong, bad: true, text: `${wrong} (wrong)` }]),
        placeholder: 'Scan container',
      };
    }
    default:
      go(app, 'home');
      return screen(app);
  }
}

actions['hh-pack-slot'] = (app, d) => go(app, 'station-pick', { slot: d.slot });
const prevGo = actions['hh-go'];
actions['hh-go'] = (app, d) => {
  if (d.screen === 'choice-back') { go(app, 'choice', { setId: app.hh.ctx.setId }); return; }
  prevGo(app, d);
};

function side(app) {
  const s = app.s;
  return `<aside class="hh-side">
    <div class="card stack">
      <h3>Handheld demo</h3>
      <p class="muted" style="margin:0;font-size:13px">This is the Honeywell screen. A keyboard-wedge scanner types into the scan field and presses Enter. On a desktop, type a code and press Enter, or turn on trainer chips to tap a simulated scan.</p>
      <label class="row" style="font-size:14px"><input type="checkbox" data-act="hh-trainer" ${app.trainer ? 'checked' : ''}> Trainer chips (simulated scans)</label>
      <p class="faint" style="margin:0;font-size:12px">Bots are working the floor too (set the crew size in Lead › Settings). Open Pack station or Lead in another tab to watch the same floor.</p>
    </div>
    <div class="card">
      <h3>Codes</h3>
      <table><tbody>
        <tr><td>Badge</td><td class="mono">W-101 … W-108</td></tr>
        <tr><td>Order</td><td class="mono">ORD-48###</td></tr>
        <tr><td>Bin</td><td class="mono">A-01 … C-24, OF-01</td></tr>
        <tr><td>Handoff slot</td><td class="mono">H-1 … H-${s.config.handoffSlots}</td></tr>
        <tr><td>Pack station</td><td class="mono">PS-1 … PS-${s.config.stations}</td></tr>
        <tr><td>Container</td><td class="mono">C-UPSNDA-${E.dayCode(E.dayOf(s.clock))}</td></tr>
      </tbody></table>
    </div>
  </aside>`;
}
