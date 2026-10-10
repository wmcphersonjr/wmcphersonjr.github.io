// Dandy Shipping Central — domain engine.
// Pure state + rules, no DOM. Every function takes the whole state object and mutates it.
// Time is "absolute sim minutes": day * 1440 + minute-of-day. Day 0 is the first sim day.

export const DAY = 1440;

// Carrier services. transit(zone) returns business days to deliver, or null if not offered to that zone.
// Costs are relative planning numbers (USD-ish), not contract rates.
export const SERVICES = {
  FX_PO:   { id: 'FX_PO',   carrier: 'FedEx',  name: 'FedEx Priority Overnight', code: 'FXPO',  cost: 30, transit: () => 1 },
  FX_2D:   { id: 'FX_2D',   carrier: 'FedEx',  name: 'FedEx 2Day',               code: 'FX2D',  cost: 16, transit: () => 2 },
  OT_GND:  { id: 'OT_GND',  carrier: 'OnTrac', name: 'OnTrac Ground',            code: 'OTGND', cost: 7,  transit: z => (z <= 3 ? 1 : z <= 5 ? 2 : null) },
  UPS_NDA: { id: 'UPS_NDA', carrier: 'UPS',    name: 'UPS Next Day Air',         code: 'UPSNDA', cost: 28, transit: () => 1 },
  UPS_2DA: { id: 'UPS_2DA', carrier: 'UPS',    name: 'UPS 2nd Day Air',          code: 'UPS2DA', cost: 15, transit: () => 2 },
  UPS_GND: { id: 'UPS_GND', carrier: 'UPS',    name: 'UPS Ground',               code: 'UPSGND', cost: 9,  transit: z => [1, 1, 1, 2, 2, 3, 4, 4, 5][z] ?? 5 },
};

export const BASE_DATE = new Date(2026, 9, 12); // Day 0 = Mon Oct 12 2026 (labels only)

export function defaultConfig() {
  return {
    pickups: [
      { id: 'FX12',  label: '12:00p FedEx',             time: 720,  services: ['FX_PO'] },
      { id: 'OT15',  label: '3:00p OnTrac Ground',      time: 900,  services: ['OT_GND'] },
      { id: 'FX15',  label: '3:00p FedEx',              time: 900,  services: ['FX_2D'] },
      { id: 'UPS16', label: '4:00p UPS Next Day Air',   time: 960,  services: ['UPS_NDA'] },
      { id: 'UPS21', label: '9:00p UPS 2 Day + Ground', time: 1260, services: ['UPS_2DA', 'UPS_GND'] },
    ],
    packByBufferMin: 30,      // pack-by = pickup - buffer (open item: per truck)
    packByOverride: {},       // { pickupId: minutes }
    releaseLeadMin: 30,       // cutoff release happens this long before pack-by, to leave time to pull + pack
    cutoffCostTolerance: 3,   // a held bin may wait for a later truck that costs up to this much more
    peak: { mode: 'off', windowMin: 45, releasedThreshold: 6, maxQueue: 10 },
    zones: [
      { id: 'A', bins: 24 },
      { id: 'B', bins: 24 },
      { id: 'C', bins: 24 },
      { id: 'OF', bins: 12, overflow: true },
    ],
    handoffSlots: 8,
    stations: 4,
    multiExtraCost: 1.5,      // added cost per extra order in a multi-pack
    autoCloseout: true,       // close + depart containers automatically at pickup time
  };
}

// ---------- time helpers ----------
export const dayOf = t => Math.floor(t / DAY);
export const minOf = t => t - dayOf(t) * DAY;
export const now = s => s.clock;

export function fmtTime(t) {
  const m = ((minOf(t) % DAY) + DAY) % DAY;
  let h = Math.floor(m / 60), mm = m % 60;
  const ap = h < 12 ? 'a' : 'p';
  h = h % 12 || 12;
  return `${h}:${String(mm).padStart(2, '0')}${ap}`;
}
export function dayDate(day) {
  const d = new Date(BASE_DATE);
  d.setDate(d.getDate() + day);
  return d;
}
export function fmtDay(day) {
  return dayDate(day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
export function dayCode(day) {
  const d = dayDate(day);
  return String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}
export function fmtDur(min) {
  if (min == null || !isFinite(min)) return '—';
  const m = Math.round(min);
  if (Math.abs(m) < 60) return `${m}m`;
  const h = Math.floor(Math.abs(m) / 60), r = Math.abs(m) % 60;
  return `${m < 0 ? '-' : ''}${h}h${r ? ' ' + r + 'm' : ''}`;
}

// ---------- state ----------
export function createState(config = defaultConfig()) {
  const s = {
    v: 1,
    config,
    clock: 6 * 60,
    seq: 1000,
    practices: {},
    orders: {},
    bins: {},
    sets: {},
    packages: {},
    containers: {},
    slots: [],
    stations: [],
    workers: {},
    events: [],
    missed: [],
    departed: {}, // `${pickupId}:${day}` -> true once the truck left
  };
  buildFloor(s);
  return s;
}

export function buildFloor(s) {
  const old = s.bins;
  s.bins = {};
  for (const z of s.config.zones) {
    for (let i = 1; i <= z.bins; i++) {
      const id = `${z.id}-${String(i).padStart(2, '0')}`;
      s.bins[id] = old[id] || emptyBin(id, z.id);
    }
  }
  const slots = [];
  for (let i = 1; i <= s.config.handoffSlots; i++) {
    slots.push(s.slots[i - 1] || { id: `H-${i}`, setId: null });
  }
  s.slots = slots;
  const st = [];
  for (let i = 1; i <= s.config.stations; i++) {
    st.push(s.stations[i - 1] || { id: `PS-${i}`, packageId: null });
  }
  s.stations = st;
}

function emptyBin(id, zone) {
  return {
    id, zone, practiceId: null, status: 'empty', orderIds: [], expectedIds: [],
    openedAt: null, cutoffAbs: null, plannedShipDay: null, plannedSvc: null,
    releasedAt: null, releaseReason: null, pullWorker: null, pullStartedAt: null,
    scanned: [], missing: [], setAside: [], inHand: [], leftBehind: [],
  };
}

export const nextId = (s, prefix) => `${prefix}-${++s.seq}`;

export function log(s, type, data = {}) {
  const e = { t: s.clock, type, ...data };
  s.events.push(e);
  return e;
}

export const EXCEPTION_TYPES = {
  'wrong-bin': 'Wrong bin scan',
  'wrong-slot': 'Wrong handoff slot',
  'wrong-container': 'Wrong container scan',
  'missing-at-pull': 'Order missing at pull',
  'found': 'Missing order found',
  'damaged': 'Damaged item',
  'cancelled-in-bin': 'Cancelled order set aside',
  'cancelled-after-pack': 'Cancelled after pack',
  'zones-full': 'Zones full: early release',
  'missed-truck': 'Missed truck: relabeled',
  'late-arrival': 'Late sibling after bin shipped',
  'eta-change': 'Production ETA changed',
};

// ---------- carrier + pickup rules ----------
export function pickupOf(s, svcId) {
  return s.config.pickups.find(p => p.services.includes(svcId));
}
export function packByAbs(s, pickupId, day) {
  const p = s.config.pickups.find(x => x.id === pickupId);
  const buf = s.config.packByOverride[pickupId] ?? s.config.packByBufferMin;
  return day * DAY + p.time - buf;
}
export const pickupAbs = (s, pickupId, day) => day * DAY + s.config.pickups.find(x => x.id === pickupId).time;

function svcOptions(s, zone, day, dueDay) {
  const out = [];
  for (const p of s.config.pickups) {
    for (const svcId of p.services) {
      const svc = SERVICES[svcId];
      const tr = svc.transit(zone);
      if (tr == null || day + tr > dueDay) continue;
      out.push({ svcId, pickupId: p.id, day, packBy: packByAbs(s, p.id, day), cost: svc.cost, arrive: day + tr });
    }
  }
  return out;
}

// Rule 4.1 (ship side): ship now on the slowest (cheapest) service that still makes the due date.
// Prefers shipping today; falls back to the next day that works; if nothing makes the date, fastest arrival.
export function chooseShipment(s, zone, dueDay, at = s.clock) {
  const today = dayOf(at);
  for (let d = today; d <= Math.max(today, dueDay); d++) {
    const opts = svcOptions(s, zone, d, dueDay).filter(o => !s.departed[`${o.pickupId}:${d}`] && o.packBy >= at);
    if (opts.length) {
      opts.sort((a, b) => a.cost - b.cost || a.packBy - b.packBy);
      const pick = opts[0];
      const base = svcOptions(s, zone, d, dueDay).sort((a, b) => a.cost - b.cost)[0];
      return { ...pick, late: false, upgrade: pick.cost > base.cost, baselineCost: base.cost };
    }
  }
  // Can't make the due date: fastest arrival, then cheapest.
  const all = [];
  for (let d = today; d <= today + 2; d++) {
    for (const p of s.config.pickups) {
      if (s.departed[`${p.id}:${d}`]) continue;
      for (const svcId of p.services) {
        const tr = SERVICES[svcId].transit(zone);
        const pb = packByAbs(s, p.id, d);
        if (tr == null || pb < at) continue;
        all.push({ svcId, pickupId: p.id, day: d, packBy: pb, cost: SERVICES[svcId].cost, arrive: d + tr });
      }
    }
  }
  all.sort((a, b) => a.arrive - b.arrive || a.packBy - b.packBy || a.cost - b.cost);
  const pick = all[0];
  return { ...pick, late: true, upgrade: false, baselineCost: pick.cost };
}

// Cheapest way to ship a held set on `day` that still meets dueDay, with time left to release it.
function holdOption(s, zone, day, dueDay, at) {
  const opts = svcOptions(s, zone, day, dueDay)
    .map(o => ({ ...o, releaseAbs: o.packBy - s.config.releaseLeadMin }))
    .filter(o => o.releaseAbs >= at && !s.departed[`${o.pickupId}:${day}`]);
  if (!opts.length) return null;
  // The bin's truck: the latest-releasing option within tolerance of the cheapest, so late-day
  // siblings still make it in without paying for a pricier service.
  const cheapest = Math.min(...opts.map(o => o.cost));
  const ok = opts.filter(o => o.cost <= cheapest + s.config.cutoffCostTolerance);
  ok.sort((a, b) => b.releaseAbs - a.releaseAbs || a.cost - b.cost);
  return ok[0];
}

const ACTIVE_PENDING = new Set(['production', 'inbound']);

// Rule 4.1 (hold side): hold only if siblings arrive in time to ship together AND still meet the
// earliest due date of the set. Greedily adds siblings in ETA order while the set stays feasible.
// Returns null when no sibling is worth waiting for.
export function planPractice(s, practiceId, presentIds, at = s.clock) {
  const zone = s.practices[practiceId].zone;
  const today = dayOf(at);
  const present = presentIds.map(id => s.orders[id]).filter(o => o && o.status !== 'cancelled');
  if (!present.length) return null;
  let due = Math.min(...present.map(o => o.dueDay));
  let ship = today;
  let best = null;
  const included = [];
  const pending = Object.values(s.orders)
    .filter(o => o.practiceId === practiceId && ACTIVE_PENDING.has(o.status) && !presentIds.includes(o.id))
    .map(o => ({ o, eff: Math.max(o.etaDay, today) }))
    .sort((a, b) => a.eff - b.eff || a.o.dueDay - b.o.dueDay);
  for (const { o, eff } of pending) {
    const nd = Math.min(due, o.dueDay), ns = Math.max(ship, eff);
    const opt = holdOption(s, zone, ns, nd, at);
    if (opt) { included.push(o.id); due = nd; ship = ns; best = opt; }
  }
  if (!included.length) return null;
  return { expectedIds: included, plannedShipDay: ship, dueDay: due, cutoffAbs: best.releaseAbs, svcId: best.svcId, pickupId: best.pickupId };
}

export function binOf(s, practiceId, statuses = ['open', 'released']) {
  return Object.values(s.bins).find(b => b.practiceId === practiceId && statuses.includes(b.status)) || null;
}

// Rule 4.2 + 4.3: one bin per practice; least-full regular zone first, then overflow.
function assignBin(s, practiceId) {
  const zones = s.config.zones;
  const free = z => Object.values(s.bins).filter(b => b.zone === z.id && b.status === 'empty');
  const regular = zones.filter(z => !z.overflow).map(z => ({ z, free: free(z) })).filter(x => x.free.length);
  regular.sort((a, b) => b.free.length / b.z.bins - a.free.length / a.z.bins);
  let bin = regular[0]?.free[0];
  if (!bin) bin = zones.filter(z => z.overflow).flatMap(free)[0];
  if (!bin) return null;
  bin.practiceId = practiceId;
  bin.status = 'open';
  bin.openedAt = s.clock;
  return bin;
}

function applyPlan(bin, plan) {
  bin.expectedIds = plan.expectedIds;
  bin.cutoffAbs = plan.cutoffAbs;
  bin.plannedShipDay = plan.plannedShipDay;
  bin.plannedSvc = plan.svcId;
}

export function setDueDay(s, orderIds) {
  return Math.min(...orderIds.map(id => s.orders[id].dueDay));
}

export function binShipment(s, bin) {
  const live = bin.orderIds.filter(id => s.orders[id].status !== 'cancelled');
  if (!live.length) return null;
  return chooseShipment(s, s.practices[bin.practiceId].zone, setDueDay(s, live));
}

export function releaseBin(s, bin, reason) {
  if (bin.status !== 'open') return;
  bin.status = 'released';
  bin.releasedAt = s.clock;
  bin.releaseReason = reason;
  bin.leftBehind = bin.expectedIds.filter(id => !bin.orderIds.includes(id) && ACTIVE_PENDING.has(s.orders[id].status));
  for (const id of bin.leftBehind) s.orders[id].leftBehindFrom = { binId: bin.id, reason, at: s.clock };
  log(s, 'release', { binId: bin.id, zone: bin.zone, reason, orders: bin.orderIds.length, leftBehind: bin.leftBehind.length });
}

// Zone full fallback 4.3.2: release the oldest open bin that can still make its date.
function releaseOldestEarly(s) {
  const open = Object.values(s.bins).filter(b => b.status === 'open').sort((a, b) => a.openedAt - b.openedAt);
  for (const b of open) {
    const sh = binShipment(s, b);
    if (sh && !sh.late) { releaseBin(s, b, 'zone-full'); return b; }
  }
  return null;
}

// ---------- sets (a group of orders that travel to a pack station together) ----------
function createSet(s, orderIds, { binId = null, worker = null, origin }) {
  const id = nextId(s, 'SET');
  const o0 = s.orders[orderIds[0]];
  const set = {
    id, orderIds: [...orderIds], practiceId: o0.practiceId, binId, origin,
    status: 'carried', owner: worker, slot: null, createdAt: s.clock, handoffAt: null, packageId: null,
  };
  s.sets[id] = set;
  for (const oid of orderIds) { s.orders[oid].status = 'in-set'; s.orders[oid].setId = id; s.orders[oid].binId = null; }
  return set;
}

export function setShipment(s, set) {
  return chooseShipment(s, s.practices[set.practiceId].zone, setDueDay(s, set.orderIds));
}

// ---------- 3.1 Receive and decide ----------
export function receive(s, orderId, worker) {
  const o = s.orders[orderId];
  if (!o) return { ok: false, msg: `Unknown order ${orderId}` };
  if (o.status === 'cancelled') return { ok: false, cancelled: true, msg: 'Order cancelled. Place in the exceptions tote.' };
  if (['to-put', 'binned', 'in-set', 'packed', 'containerized', 'shipped'].includes(o.status)) {
    return { ok: false, msg: `Already received (${o.status}${o.binId ? ' · ' + o.binId : ''})` };
  }
  if (o.status === 'missing') log(s, 'found', { orderId, worker });
  if (o.status === 'production') { o.arrivedAt = s.clock; log(s, 'arrive', { orderId, early: true }); }
  o.status = 'received';
  o.receivedAt = s.clock;
  o.receivedBy = worker;
  log(s, 'receive', { orderId, worker });

  // Late arrival after its bin shipped -> record the missed consolidation with its cause.
  if (o.leftBehindFrom) {
    const lb = o.leftBehindFrom;
    const cause = o.wasMissing ? 'missing at pull'
      : lb.reason === 'recalc' ? 'recalc (due date)'
      : lb.reason === 'zone-full' ? 'zone full'
      : o.etaSlipped || dayOf(o.arrivedAt) > o.etaDay ? 'production late'
      : 'cutoff release';
    s.missed.push({ orderId, practiceId: o.practiceId, binId: lb.binId, cause, at: s.clock });
    log(s, 'late-arrival', { orderId, cause });
    o.leftBehindFrom = null;
  }

  const pid = o.practiceId;
  const bin = binOf(s, pid);
  const present = bin ? [...bin.orderIds, orderId] : [orderId];
  const plan = planPractice(s, pid, present);

  if (bin && bin.status === 'released') {
    // Bin is waiting to be pulled; this sibling rides along.
    bin.orderIds.push(orderId);
    bin.inHand.push(orderId);
    o.status = 'binned'; o.binId = bin.id;
    bin.leftBehind = bin.leftBehind.filter(x => x !== orderId);
    log(s, 'decide', { orderId, decision: 'complete', binId: bin.id, worker });
    return { ok: true, decision: 'complete', binId: bin.id, joinedReleased: true };
  }
  if (!plan) {
    if (!bin) {
      const set = createSet(s, [orderId], { worker, origin: 'solo' });
      log(s, 'decide', { orderId, decision: 'ship', worker });
      return { ok: true, decision: 'ship', setId: set.id };
    }
    // A sibling the bin wasn't waiting for, and that can't wait itself: ship it solo, keep the bin waiting.
    if (!bin.expectedIds.includes(orderId) && planPractice(s, pid, bin.orderIds)) {
      const set = createSet(s, [orderId], { worker, origin: 'solo' });
      log(s, 'decide', { orderId, decision: 'ship', worker, reason: 'cannot-wait' });
      return { ok: true, decision: 'ship', setId: set.id, cannotWait: true, binId: bin.id };
    }
    // 3.1 Complete on arrival: last missing sibling -> skip shelving, pull the bin now.
    bin.orderIds.push(orderId);
    bin.inHand.push(orderId);
    o.status = 'binned'; o.binId = bin.id;
    const stillWaiting = bin.expectedIds.some(id => id !== orderId && ACTIVE_PENDING.has(s.orders[id].status));
    releaseBin(s, bin, stillWaiting ? 'recalc' : 'complete');
    log(s, 'decide', { orderId, decision: 'complete', binId: bin.id, worker });
    return { ok: true, decision: 'complete', binId: bin.id };
  }
  let target = bin;
  if (!target) target = assignBin(s, pid);
  if (!target) {
    // 4.3: overflow full too -> ship early: release the oldest bin that can still make its date.
    const early = releaseOldestEarly(s);
    log(s, 'zones-full', { orderId, released: early?.id || null });
    const set = createSet(s, [orderId], { worker, origin: 'solo' });
    log(s, 'decide', { orderId, decision: 'ship', worker, reason: 'zones-full' });
    return { ok: true, decision: 'ship', setId: set.id, zonesFull: true, releasedBin: early?.id || null };
  }
  applyPlan(target, plan);
  o.status = 'to-put';
  o.binId = target.id;
  log(s, 'decide', { orderId, decision: 'hold', binId: target.id, worker });
  return { ok: true, decision: 'hold', binId: target.id };
}

// ---------- 3.2 Put to bin ----------
export function put(s, orderId, binCode, worker) {
  const o = s.orders[orderId];
  if (!o || o.status !== 'to-put') return { ok: false, msg: 'Order is not waiting to be put' };
  const code = String(binCode).trim().toUpperCase();
  if (code !== o.binId) {
    log(s, 'wrong-bin', { orderId, expected: o.binId, scanned: code, worker });
    return { ok: false, wrong: true, msg: `Wrong bin. Put in ${o.binId}.` };
  }
  const bin = s.bins[o.binId];
  bin.orderIds.push(orderId);
  o.status = 'binned';
  o.putAt = s.clock;
  log(s, 'put', { orderId, binId: bin.id, zone: bin.zone, worker, dur: s.clock - o.receivedAt });
  return { ok: true, binId: bin.id };
}

// ---------- 3.3 Release (hybrid: complete OR cutoff, whichever first) ----------
export function isComplete(s, bin) {
  return bin.expectedIds.every(id => bin.orderIds.includes(id) || s.orders[id].status === 'cancelled');
}

// Recalculate a practice's open bin after a production change (remake, delay, cancel). Rule 5.
export function replanPractice(s, practiceId) {
  const bin = binOf(s, practiceId, ['open']);
  if (!bin) return null;
  const present = bin.orderIds.filter(id => s.orders[id].status !== 'cancelled');
  if (!present.length) {
    // Only cancelled orders left: release so someone pulls them to the exceptions tote.
    if (bin.orderIds.length) releaseBin(s, bin, 'recalc');
    else { Object.assign(bin, emptyBin(bin.id, bin.zone)); }
    return { released: true };
  }
  const plan = planPractice(s, practiceId, present);
  if (!plan) {
    const stillWaiting = bin.expectedIds.some(id => ACTIVE_PENDING.has(s.orders[id].status));
    releaseBin(s, bin, stillWaiting ? 'recalc' : 'complete');
    return { released: true };
  }
  applyPlan(bin, plan);
  return { released: false, plan };
}

// ---------- 3.4 Pull ----------
export function startPull(s, binId, worker) {
  const bin = s.bins[String(binId).toUpperCase()];
  if (!bin) return { ok: false, msg: `Unknown bin ${binId}` };
  if (bin.status === 'pulling' && bin.pullWorker !== worker) return { ok: false, msg: `${bin.id} is being pulled by ${bin.pullWorker}` };
  if (bin.status !== 'released' && bin.status !== 'pulling') return { ok: false, msg: `${bin.id} is not released (${bin.status})` };
  if (bin.status === 'released') {
    bin.status = 'pulling';
    bin.pullWorker = worker;
    bin.pullStartedAt = s.clock;
    bin.scanned = bin.inHand.filter(id => s.orders[id].status !== 'cancelled');
    bin.setAside = [];
    bin.missing = [];
    log(s, 'pull-start', { binId: bin.id, zone: bin.zone, worker });
  }
  return { ok: true, binId: bin.id };
}

export function scanPull(s, binId, orderId, worker) {
  const bin = s.bins[binId];
  const id = String(orderId).trim().toUpperCase();
  if (!bin.orderIds.includes(id)) {
    log(s, 'wrong-pull', { binId, orderId: id, worker });
    return { ok: false, msg: `${id} is not in ${bin.id}` };
  }
  if (bin.scanned.includes(id) || bin.setAside.includes(id)) return { ok: true, dup: true };
  bin.missing = bin.missing.filter(x => x !== id);
  if (s.orders[id].status === 'cancelled') {
    bin.setAside.push(id);
    log(s, 'cancelled-in-bin', { orderId: id, binId, worker });
    return { ok: true, cancelled: true, msg: `${id} is CANCELLED. Put it in the exceptions tote.` };
  }
  bin.scanned.push(id);
  log(s, 'pull-scan', { binId, orderId: id, worker });
  return { ok: true };
}

export function markMissing(s, binId, orderId, worker) {
  const bin = s.bins[binId];
  if (!bin.orderIds.includes(orderId) || bin.scanned.includes(orderId)) return { ok: false };
  if (!bin.missing.includes(orderId)) bin.missing.push(orderId);
  return { ok: true };
}

export const pullReady = (s, bin) =>
  bin.orderIds.length > 0 && bin.orderIds.every(id => bin.scanned.includes(id) || bin.missing.includes(id) || bin.setAside.includes(id));

export function finishPull(s, binId, worker) {
  const bin = s.bins[binId];
  if (!pullReady(s, bin)) return { ok: false, msg: 'Scan every order (or mark it missing) first' };
  for (const id of bin.missing) {
    const o = s.orders[id];
    o.status = 'missing'; o.binId = null; o.wasMissing = true;
    o.leftBehindFrom = { binId: bin.id, reason: 'missing', at: s.clock };
    log(s, 'missing-at-pull', { orderId: id, binId: bin.id, worker });
  }
  for (const id of bin.setAside) { s.orders[id].binId = null; s.orders[id].setAside = true; }
  let set = null;
  if (bin.scanned.length) set = createSet(s, bin.scanned, { binId: bin.id, worker, origin: 'bin' });
  log(s, 'pull-done', { binId: bin.id, zone: bin.zone, worker, setId: set?.id, orders: bin.scanned.length, dur: s.clock - bin.releasedAt, reason: bin.releaseReason });
  if (set) { set.releaseReason = bin.releaseReason; set.releasedAt = bin.releasedAt; set.zone = bin.zone; }
  Object.assign(bin, emptyBin(bin.id, bin.zone));
  return { ok: true, setId: set?.id || null };
}

// ---------- 3.5 Hand off + 4.4 peak mode ----------
export const handoffDepth = s => s.slots.filter(x => x.setId).length;
export const releasedInZone = (s, zone) => Object.values(s.bins).filter(b => b.zone === zone && b.status === 'released').length;

export function packChoice(s, set) {
  const pk = s.config.peak;
  const depth = handoffDepth(s);
  const freeSlot = s.slots.some(x => !x.setId);
  const guard = depth >= pk.maxQueue || !freeSlot;
  let forced = false, reason = '';
  if (pk.mode === 'on') { forced = true; reason = 'Peak mode is on'; }
  else if (pk.mode === 'auto') {
    const sh = setShipment(s, set);
    const zone = set.zone || 'A';
    const mins = sh.packBy - s.clock;
    const released = Object.values(s.bins).filter(b => b.status === 'released' && (!set.zone || b.zone === set.zone)).length;
    if (mins <= pk.windowMin && released > pk.releasedThreshold) {
      forced = true; reason = `Peak auto: ${fmtDur(mins)} to pack-by, ${released} bins released in zone ${zone}`;
    }
  }
  if (guard) return { self: true, handoff: false, forced: 'self', reason: !freeSlot ? 'All handoff slots full' : `Handoff queue at ${depth} (limit ${pk.maxQueue})` };
  if (forced) return { self: false, handoff: true, forced: 'handoff', reason };
  return { self: true, handoff: true, forced: null, reason: '' };
}

export function handoff(s, setId, slotCode, worker) {
  const set = s.sets[setId];
  if (!set || set.status !== 'carried') return { ok: false, msg: 'Set is not in hand' };
  if (!packChoice(s, set).handoff) return { ok: false, msg: 'Handoff is not available right now' };
  const code = String(slotCode).trim().toUpperCase();
  const slot = s.slots.find(x => x.id === code);
  if (!slot) { log(s, 'wrong-slot', { setId, scanned: code, worker }); return { ok: false, wrong: true, msg: `${code} is not a handoff slot` }; }
  if (slot.setId) { log(s, 'wrong-slot', { setId, scanned: code, worker }); return { ok: false, wrong: true, msg: `${code} is occupied` }; }
  slot.setId = setId;
  set.status = 'handoff'; set.slot = slot.id; set.handoffAt = s.clock; set.owner = null;
  log(s, 'handoff', { setId, slot: slot.id, worker });
  return { ok: true, slot: slot.id };
}

export const suggestSlot = s => s.slots.find(x => !x.setId)?.id || null;

// Packer queue: sorted by soonest truck, not drop time.
export function packQueue(s) {
  return s.slots.filter(x => x.setId).map(x => {
    const set = s.sets[x.setId];
    return { slot: x.id, set, ship: setShipment(s, set) };
  }).sort((a, b) => a.ship.packBy - b.ship.packBy || a.set.handoffAt - b.set.handoffAt);
}

// ---------- 3.6 Ship (shared by solo and consolidated) ----------
export function containerCode(svcId, day) { return `C-${SERVICES[svcId].code}-${dayCode(day)}`; }

function ensureContainer(s, svcId, day) {
  const id = containerCode(svcId, day);
  if (!s.containers[id]) {
    const p = pickupOf(s, svcId);
    s.containers[id] = { id, svcId, pickupId: p.id, day, status: 'open', packageIds: [], closedAt: null, departedAt: null };
  }
  return s.containers[id];
}

export function stationRead(s, stationId, code, worker) {
  const st = s.stations.find(x => x.id === stationId);
  if (!st) return { ok: false, msg: 'Unknown station' };
  if (st.packageId) return { ok: false, msg: `Station busy with ${st.packageId}. Scan its container first.` };
  const c = String(code).trim().toUpperCase();
  let set = s.sets[c];
  let fromSlot = null;
  if (!set) {
    const slot = s.slots.find(x => x.id === c);
    if (slot && slot.setId) { set = s.sets[slot.setId]; fromSlot = slot; }
    else if (slot) return { ok: false, msg: `${slot.id} is empty` };
  } else if (set.status === 'handoff') fromSlot = s.slots.find(x => x.id === set.slot);
  if (!set) return { ok: false, msg: `Nothing to pack for ${c}` };
  if (!['carried', 'handoff'].includes(set.status)) return { ok: false, msg: `${set.id} is already ${set.status}` };
  if (fromSlot) {
    fromSlot.setId = null;
    log(s, 'pack-pickup', { setId: set.id, slot: fromSlot.id, worker, wait: s.clock - set.handoffAt });
  }
  const pkg = makePackage(s, set, st.id, worker);
  st.packageId = pkg.id;
  set.status = 'packing'; set.slot = null; set.packer = worker;
  return { ok: true, packageId: pkg.id, setId: set.id };
}

function mailerFor(n) {
  if (n === 1) return 'Solo mailer';
  if (n <= 3) return 'Multi-pack mailer M';
  if (n <= 6) return 'Multi-pack mailer L';
  return 'Multi-pack box XL';
}

function makePackage(s, set, stationId, worker) {
  const sh = setShipment(s, set);
  const n = set.orderIds.length;
  const id = nextId(s, 'PKG');
  const pkg = {
    id, setId: set.id, practiceId: set.practiceId, orderIds: [...set.orderIds], station: stationId,
    svcId: sh.svcId, pickupId: sh.pickupId, shipDay: sh.day, packBy: sh.packBy, late: sh.late, upgrade: sh.upgrade,
    cost: SERVICES[sh.svcId].cost + (n - 1) * s.config.multiExtraCost,
    type: n > 1 ? 'multi' : 'single', mailer: mailerFor(n),
    tracking: trackingFor(sh.svcId, s.seq), printedAt: s.clock, printedBy: worker,
    containerId: null, containerizedAt: null, onTime: null, origin: set.origin,
    releaseReason: set.releaseReason || null, zone: set.zone || null, dueDay: setDueDay(s, set.orderIds),
  };
  // soloCost should be what each order would cost alone: use each order's own due date.
  pkg.soloCost = set.orderIds.reduce((sum, oid) => sum + chooseShipment(s, s.practices[set.practiceId].zone, s.orders[oid].dueDay).cost, 0);
  s.packages[id] = pkg;
  set.packageId = id;
  for (const oid of set.orderIds) s.orders[oid].status = 'packed';
  log(s, 'print', { packageId: id, setId: set.id, station: stationId, worker, svc: sh.svcId, orders: n });
  return pkg;
}

function trackingFor(svcId, n) {
  const c = SERVICES[svcId].carrier;
  const num = String(n * 7919 + 104729).padStart(10, '0');
  return c === 'UPS' ? `1Z9D4A${num}` : c === 'FedEx' ? `7749${num}` : `D1004${num}`;
}

export function expectedContainer(s, pkg) { return containerCode(pkg.svcId, pkg.shipDay); }

export function containerize(s, pkgId, code, worker) {
  const pkg = s.packages[pkgId];
  if (!pkg || pkg.containerId) return { ok: false, msg: 'Nothing to containerize' };
  // Truck already left for this label? Relabel to the next pickup that makes the date.
  if (s.departed[`${pkg.pickupId}:${pkg.shipDay}`] || (s.containers[expectedContainer(s, pkg)]?.status ?? 'open') !== 'open') {
    relabel(s, pkg, worker);
    return { ok: false, relabeled: true, msg: `Truck closed. New label printed: ${SERVICES[pkg.svcId].name}. Scan ${expectedContainer(s, pkg)}.` };
  }
  const exp = expectedContainer(s, pkg);
  const c = String(code).trim().toUpperCase();
  if (c !== exp) {
    log(s, 'wrong-container', { packageId: pkgId, expected: exp, scanned: c, worker });
    return { ok: false, wrong: true, msg: `Wrong container. Use ${exp}.` };
  }
  const box = ensureContainer(s, pkg.svcId, pkg.shipDay);
  box.packageIds.push(pkg.id);
  pkg.containerId = box.id;
  pkg.containerizedAt = s.clock;
  pkg.onTime = s.clock <= pkg.packBy;
  const set = s.sets[pkg.setId];
  set.status = 'packed';
  for (const oid of pkg.orderIds) s.orders[oid].status = 'containerized';
  const st = s.stations.find(x => x.packageId === pkg.id);
  if (st) st.packageId = null;
  log(s, 'containerize', { packageId: pkg.id, container: box.id, worker, onTime: pkg.onTime, orders: pkg.orderIds.length, cycle: s.clock - (set.createdAt ?? s.clock) });
  return { ok: true, container: box.id };
}

function relabel(s, pkg, worker) {
  const set = s.sets[pkg.setId];
  const sh = setShipment(s, set);
  log(s, 'missed-truck', { packageId: pkg.id, from: pkg.svcId, to: sh.svcId, worker });
  Object.assign(pkg, {
    svcId: sh.svcId, pickupId: sh.pickupId, shipDay: sh.day, packBy: sh.packBy, late: sh.late, upgrade: sh.upgrade || pkg.upgrade,
    cost: SERVICES[sh.svcId].cost + (pkg.orderIds.length - 1) * s.config.multiExtraCost,
    tracking: trackingFor(sh.svcId, ++s.seq), relabeled: true,
  });
}

// ---------- 3.7 Containerize and close out ----------
export function closeContainer(s, id) {
  const c = s.containers[id];
  if (!c || c.status !== 'open') return { ok: false };
  c.status = 'closed'; c.closedAt = s.clock;
  log(s, 'container-close', { container: id, packages: c.packageIds.length });
  return { ok: true };
}
export function departContainer(s, id) {
  const c = s.containers[id];
  if (!c || c.status === 'departed') return { ok: false };
  if (c.status === 'open') closeContainer(s, id);
  c.status = 'departed'; c.departedAt = s.clock;
  for (const pid of c.packageIds) for (const oid of s.packages[pid].orderIds) { s.orders[oid].status = 'shipped'; s.orders[oid].shippedAt = s.clock; }
  log(s, 'container-depart', { container: id, packages: c.packageIds.length });
  return { ok: true };
}

// ---------- 3.8 Follow the work ----------
// Rank by soonest pickup (pack-by). Ties: pull, then pack, then receive.
export function nextTask(s, workerId) {
  const mine = Object.values(s.sets).find(x => x.owner === workerId && x.status === 'carried');
  if (mine) return { type: 'carry', setId: mine.id, packBy: setShipment(s, mine).packBy };
  const putting = Object.values(s.orders).find(o => o.status === 'to-put' && o.receivedBy === workerId);
  if (putting) return { type: 'put', orderId: putting.id, binId: putting.binId };
  const pulling = Object.values(s.bins).find(b => b.status === 'pulling' && b.pullWorker === workerId);
  if (pulling) return { type: 'pull', binId: pulling.id, zone: pulling.zone, packBy: binShipment(s, pulling)?.packBy ?? Infinity };
  const tasks = [];
  const released = Object.values(s.bins).filter(b => b.status === 'released');
  const zoneSoonest = {};
  for (const b of released) {
    const pb = binShipment(s, b)?.packBy ?? Infinity;
    b._pb = pb;
    zoneSoonest[b.zone] = Math.min(zoneSoonest[b.zone] ?? Infinity, pb);
  }
  for (const b of released) tasks.push({ type: 'pull', binId: b.id, zone: b.zone, packBy: zoneSoonest[b.zone], binPackBy: b._pb, rank: 0 });
  for (const q of packQueue(s)) tasks.push({ type: 'pack', slot: q.slot, setId: q.set.id, packBy: q.ship.packBy, rank: 1 });
  const inbound = Object.values(s.orders).filter(o => o.status === 'inbound');
  if (inbound.length) {
    const today = dayOf(s.clock);
    const urgent = inbound.some(o => o.dueDay <= today + 1);
    const nda = packByAbs(s, 'UPS16', today);
    const last = Math.max(...s.config.pickups.map(p => packByAbs(s, p.id, today)));
    const pb = urgent && nda >= s.clock ? nda : (last >= s.clock ? last : last + DAY);
    tasks.push({ type: 'receive', count: inbound.length, packBy: pb, rank: 2 });
  }
  for (const b of released) delete b._pb;
  tasks.sort((a, b) => a.packBy - b.packBy || a.rank - b.rank || (a.binPackBy ?? 0) - (b.binPackBy ?? 0));
  return tasks[0] || { type: 'idle' };
}

// ---------- production changes + exceptions (lead actions) ----------
export function delayEta(s, orderId, days = 1, reason = 'remake') {
  const o = s.orders[orderId];
  if (!o || !ACTIVE_PENDING.has(o.status)) return { ok: false, msg: 'Only orders still in production can move' };
  o.etaDay += days;
  if (o.status === 'inbound') { o.status = 'production'; }
  o.actualArrival = o.etaDay * DAY + Math.max(minOf(o.actualArrival), 7 * 60);
  o.etaSlipped = true;
  log(s, 'eta-change', { orderId, reason, eta: o.etaDay });
  return { ok: true, replan: replanPractice(s, o.practiceId) };
}

export function cancelOrder(s, orderId) {
  const o = s.orders[orderId];
  if (!o) return { ok: false };
  const prev = o.status;
  if (['containerized', 'shipped'].includes(prev)) {
    log(s, 'cancelled-after-pack', { orderId, status: prev });
    return { ok: false, msg: 'Already packed. Intercept with the carrier (open item).' };
  }
  if (prev === 'packed') {
    log(s, 'cancelled-after-pack', { orderId, status: prev });
    return { ok: false, msg: 'Label printed. Pull it from the package at the station (open item).' };
  }
  if (prev === 'in-set') {
    const set = s.sets[o.setId];
    set.orderIds = set.orderIds.filter(x => x !== orderId);
    o.status = 'cancelled'; o.setId = null;
    log(s, 'cancel', { orderId, prev });
    if (!set.orderIds.length) dropSet(s, set);
    return { ok: true, msg: `Removed from ${set.id}. Put it in the exceptions tote.` };
  }
  o.status = 'cancelled';
  log(s, 'cancel', { orderId, prev });
  if (prev === 'to-put') { o.binId = null; }
  const replan = replanPractice(s, o.practiceId);
  return { ok: true, replan };
}

function dropSet(s, set) {
  if (set.slot) { const sl = s.slots.find(x => x.id === set.slot); if (sl) sl.setId = null; }
  set.status = 'void';
}

// Proposed default for the open "damaged item" rule: pull it, send back for remake (+1 day ETA),
// recalc the set as if production had slipped.
export function reportDamaged(s, orderId, worker) {
  const o = s.orders[orderId];
  if (!o) return { ok: false };
  const binId = o.binId;
  if (binId && s.bins[binId]) {
    const bin = s.bins[binId];
    bin.orderIds = bin.orderIds.filter(x => x !== orderId);
    bin.scanned = bin.scanned.filter(x => x !== orderId);
    bin.inHand = bin.inHand.filter(x => x !== orderId);
    bin.missing = bin.missing.filter(x => x !== orderId);
  }
  if (o.setId && s.sets[o.setId]) {
    const set = s.sets[o.setId];
    set.orderIds = set.orderIds.filter(x => x !== orderId);
    if (!set.orderIds.length) dropSet(s, set);
  }
  const today = dayOf(s.clock);
  o.status = 'production'; o.binId = null; o.setId = null;
  o.etaDay = today + 1; o.actualArrival = (today + 1) * DAY + 10 * 60; o.etaSlipped = true; o.remade = true;
  log(s, 'damaged', { orderId, worker, binId });
  const bin = binId && s.bins[binId];
  if (bin && !bin.orderIds.length && bin.status !== 'pulling') Object.assign(bin, emptyBin(bin.id, bin.zone));
  else if (bin && bin.status === 'open') replanPractice(s, o.practiceId);
  else if (!bin) replanPractice(s, o.practiceId);
  return { ok: true };
}

// ---------- clock: one simulated minute ----------
export function stepMinute(s) {
  s.clock += 1;
  const t = s.clock;
  const day = dayOf(t);
  // Production finishes: orders physically show up at inbound.
  for (const o of Object.values(s.orders)) {
    if (o.status === 'production' && o.actualArrival <= t) {
      o.status = 'inbound'; o.arrivedAt = t;
      log(s, 'arrive', { orderId: o.id, etaHit: dayOf(t) === o.etaDay });
    }
  }
  // Hybrid release: cutoff for the bin's truck.
  for (const b of Object.values(s.bins)) {
    if (b.status === 'open' && b.cutoffAbs != null && b.cutoffAbs <= t) releaseBin(s, b, isComplete(s, b) ? 'complete' : 'cutoff');
  }
  // Trucks.
  for (const p of s.config.pickups) {
    if (day * DAY + p.time === t) {
      s.departed[`${p.id}:${day}`] = true;
      if (s.config.autoCloseout) {
        for (const c of Object.values(s.containers)) {
          if (c.pickupId === p.id && c.day === day && c.status !== 'departed') departContainer(s, c.id);
        }
      }
      // Labels printed for this truck but not in its container -> flagged; relabel happens on container scan.
      for (const pkg of Object.values(s.packages)) {
        if (!pkg.containerId && pkg.pickupId === p.id && pkg.shipDay === day && !pkg.missedTruck) { pkg.missedTruck = true; }
      }
    }
  }
}

// ---------- worker sessions ----------
export function login(s, badge) {
  const id = String(badge).trim().toUpperCase();
  if (!/^W-\d{3}$/.test(id) && !/^BOT-\d+$/.test(id)) return { ok: false, msg: 'Scan a badge (W-###)' };
  if (!s.workers[id]) s.workers[id] = { id, name: WORKER_NAMES[id] || id, bot: id.startsWith('BOT'), loginAt: s.clock };
  s.workers[id].lastLogin = s.clock;
  log(s, 'login', { worker: id });
  return { ok: true, worker: s.workers[id] };
}

export const WORKER_NAMES = {
  'W-101': 'Maria G.', 'W-102': 'Tyler S.', 'W-103': 'Ana P.', 'W-104': 'Josh K.',
  'W-105': 'Lupe R.', 'W-106': 'Devin M.', 'W-107': 'Kenzie B.', 'W-108': 'Sam T.',
};

// ---------- at-risk ----------
// At risk: the set only makes its date if it ships today.
export function binAtRisk(s, bin) {
  const live = bin.orderIds.filter(id => s.orders[id].status !== 'cancelled');
  if (!live.length) return false;
  const due = setDueDay(s, live);
  const zone = s.practices[bin.practiceId].zone;
  const tomorrow = dayOf(s.clock) + 1;
  return svcOptions(s, zone, tomorrow, due).length === 0;
}
