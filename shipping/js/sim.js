// Floor simulator: seeds practices + orders, runs bot workers through the same engine API a person uses.
import * as E from './engine.js';

const { DAY } = E;

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES_A = ['Bright', 'Canyon', 'Summit', 'Wasatch', 'Timp', 'Lakeview', 'Riverside', 'Cedar', 'Aspen', 'Granite',
  'Pioneer', 'Sunrise', 'Maple', 'Harbor', 'Prairie', 'Redwood', 'Bayside', 'Highland', 'Willow', 'Liberty', 'Juniper', 'Copper'];
const NAMES_B = ['Dental', 'Family Dentistry', 'Smiles', 'Dental Arts', 'Dental Group', 'Dental Care'];
const CITIES = {
  2: [['Orem', 'UT', '84057'], ['Salt Lake City', 'UT', '84111'], ['Ogden', 'UT', '84401']],
  3: [['Boise', 'ID', '83702'], ['Las Vegas', 'NV', '89101'], ['Phoenix', 'AZ', '85004']],
  4: [['Denver', 'CO', '80202'], ['Los Angeles', 'CA', '90012'], ['Albuquerque', 'NM', '87102']],
  5: [['Seattle', 'WA', '98101'], ['Dallas', 'TX', '75201'], ['Portland', 'OR', '97204']],
  6: [['Chicago', 'IL', '60601'], ['Minneapolis', 'MN', '55401']],
  7: [['Atlanta', 'GA', '30303'], ['Nashville', 'TN', '37203']],
  8: [['New York', 'NY', '10001'], ['Boston', 'MA', '02108'], ['Miami', 'FL', '33130']],
};
const ZONE_WEIGHTS = [[2, 0.18], [3, 0.16], [4, 0.18], [5, 0.16], [6, 0.12], [7, 0.1], [8, 0.1]];
const SOURCES = [['3P', 0.35], ['1P auto', 0.45], ['1P manual', 0.2]];

function pick(r, weighted) {
  let x = r();
  for (const [v, w] of weighted) { if ((x -= w) <= 0) return v; }
  return weighted[weighted.length - 1][0];
}

// botGraceMin: bots leave fresh work alone this long so a person on a handheld gets first pick.
export const DEFAULT_SIM = { seed: 7, practices: 60, ordersPerDay: 180, lateRate: 0.07, days: 6, bots: 4, botSpeed: 1, botGraceMin: 20 };

export function newSimulation(opts = {}) {
  const { zoneBins, overflowBins, slots, stations, ...simOpts } = opts;
  const sim = { ...DEFAULT_SIM, ...simOpts };
  const config = E.defaultConfig();
  if (zoneBins) for (const z of config.zones) if (!z.overflow) z.bins = zoneBins;
  if (overflowBins != null) for (const z of config.zones) if (z.overflow) z.bins = overflowBins;
  if (slots) config.handoffSlots = slots;
  if (stations) config.stations = stations;
  const s = E.createState(config);
  s.sim = sim;
  const r = rng(sim.seed);
  s.simRng = sim.seed;

  // Practices: a few big accounts, many small ones.
  for (let i = 0; i < sim.practices; i++) {
    const zone = pick(r, ZONE_WEIGHTS);
    const [city, st, zip] = CITIES[zone][Math.floor(r() * CITIES[zone].length)];
    const id = `PR-${String(i + 1).padStart(3, '0')}`;
    s.practices[id] = {
      id, zone, city, state: st, zip,
      name: `${NAMES_A[i % NAMES_A.length]} ${NAMES_B[Math.floor(r() * NAMES_B.length)]}${i >= NAMES_A.length ? ' ' + city : ''}`,
      weight: r() < 0.2 ? 4 + r() * 4 : 0.5 + r() * 1.5,
    };
  }
  const plist = Object.values(s.practices);
  const totalW = plist.reduce((a, p) => a + p.weight, 0);
  const pickPractice = () => {
    let x = r() * totalW;
    for (const p of plist) { if ((x -= p.weight) <= 0) return p; }
    return plist[plist.length - 1];
  };

  // Orders for day -1 .. days-1. eta = production finish day; due = delivery date.
  let n = 48000;
  for (let d = -1; d < sim.days; d++) {
    const count = Math.round(sim.ordersPerDay * (d === -1 ? 0.6 : 0.85 + r() * 0.3));
    for (let k = 0; k < count; k++) {
      const p = pickPractice();
      const lead = pick(r, [[1, 0.28], [2, 0.27], [3, 0.25], [4, 0.12], [5, 0.08]]);
      // Arrivals cluster in waves off the production lines.
      const wave = pick(r, [[7 * 60, 0.2], [10 * 60, 0.3], [13 * 60, 0.3], [16 * 60, 0.2]]);
      let minute = Math.min(19 * 60 + 30, Math.max(6 * 60 + 30, Math.round(wave + (r() - 0.3) * 150)));
      let arriveDay = d;
      if (r() < sim.lateRate) arriveDay = d + 1;
      const id = `ORD-${++n}`;
      s.orders[id] = {
        id, practiceId: p.id, source: pick(r, SOURCES), etaDay: d, dueDay: d + lead,
        actualArrival: arriveDay * DAY + minute, status: 'production',
        arrivedAt: null, receivedAt: null, binId: null, setId: null,
      };
    }
  }

  // Yesterday: already stowed. Whatever would have shipped is history; holds sit in bins.
  s.clock = -1 * DAY + 22 * 60;
  const ys = Object.values(s.orders).filter(o => o.etaDay === -1 && o.actualArrival < 0).sort((a, b) => a.actualArrival - b.actualArrival);
  for (const o of ys) {
    o.status = 'inbound'; o.arrivedAt = o.actualArrival;
    const res = E.receive(s, o.id, 'SYSTEM');
    if (res.decision === 'hold') E.put(s, o.id, res.binId, 'SYSTEM');
    else if (res.decision === 'ship') historic(s, s.sets[res.setId].orderIds, res.setId);
    else if (res.decision === 'complete') {
      const bin = s.bins[res.binId];
      historic(s, bin.orderIds);
      Object.assign(bin, { ...blankBin(bin) });
    }
  }
  for (const o of Object.values(s.orders)) delete o.leftBehindFrom;
  s.events = [];
  s.missed = [];
  s.clock = 6 * 60;
  s.bots = [];
  setBots(s, sim.bots);
  // Open the demo mid-morning so there is work on the floor.
  advance(s, 150);
  return s;
}

function blankBin(bin) {
  return { practiceId: null, status: 'empty', orderIds: [], expectedIds: [], openedAt: null, cutoffAbs: null, plannedShipDay: null,
    plannedSvc: null, releasedAt: null, releaseReason: null, pullWorker: null, pullStartedAt: null, scanned: [], missing: [], setAside: [], inHand: [], leftBehind: [] };
}

function historic(s, orderIds, setId) {
  for (const id of orderIds) { const o = s.orders[id]; o.status = 'shipped'; o.historic = true; o.binId = null; }
  if (setId) delete s.sets[setId];
}

export function setBots(s, count) {
  s.bots = s.bots || [];
  while (s.bots.length < count) {
    const id = `BOT-${s.bots.length + 1}`;
    s.bots.push({ id, busyUntil: s.clock, doing: 'idle' });
    E.login(s, id);
  }
  s.bots.length = count;
  s.sim.bots = count;
}

// Advance the sim clock minute by minute, letting bots work.
export function advance(s, minutes) {
  for (let i = 0; i < minutes; i++) {
    E.stepMinute(s);
    runBots(s);
  }
  trimEvents(s);
}

export function advanceTo(s, abs) {
  if (abs > s.clock) advance(s, abs - s.clock);
}

function trimEvents(s) {
  if (s.events.length > 60000) s.events.splice(0, s.events.length - 50000);
}

function botRng(s) {
  s.simRng = (s.simRng * 1103515245 + 12345) >>> 0;
  return (s.simRng % 100000) / 100000;
}

function runBots(s) {
  for (const bot of s.bots || []) {
    if (bot.busyUntil > s.clock) continue;
    const t = E.nextTask(s, bot.id);
    let dur = 1;
    const grace = s.clock - (s.sim.botGraceMin ?? 0);
    if (t.type === 'pull' && s.bins[t.binId].status === 'released' && s.bins[t.binId].releasedAt > grace && t.binPackBy - s.clock > 30) { bot.busyUntil = s.clock + 1; continue; }
    if (t.type === 'pack' && s.sets[t.setId].handoffAt > grace && t.packBy - s.clock > 30) { bot.busyUntil = s.clock + 1; continue; }
    try {
      if (t.type === 'receive') dur = botReceive(s, bot);
      else if (t.type === 'pull') dur = botPull(s, bot, t.binId);
      else if (t.type === 'pack') dur = botPack(s, bot, t.slot);
      else if (t.type === 'carry') dur = botCarry(s, bot, t.setId);
      else if (t.type === 'put') { E.put(s, t.orderId, t.binId, bot.id); dur = 1; }
      bot.doing = t.type;
    } catch (err) {
      console.error('bot error', err);
      bot.doing = 'error';
    }
    bot.busyUntil = s.clock + Math.max(1, Math.round(dur / (s.sim.botSpeed || 1)));
  }
}

function botReceive(s, bot) {
  const grace = s.clock - (s.sim.botGraceMin ?? 0);
  const inbound = Object.values(s.orders).filter(o => o.status === 'inbound' && (o.arrivedAt <= grace || o.dueDay <= E.dayOf(s.clock) + 1)).sort((a, b) => a.dueDay - b.dueDay || a.arrivedAt - b.arrivedAt);
  const o = inbound[0];
  if (!o) return 1;
  const res = E.receive(s, o.id, bot.id);
  if (!res.ok) return 1;
  if (res.decision === 'hold') {
    if (botRng(s) < 0.02) E.put(s, o.id, 'A-99', bot.id); // wrong bin scan, then rescan
    E.put(s, o.id, res.binId, bot.id);
    return 2;
  }
  if (res.decision === 'complete') return 1 + botPull(s, bot, res.binId);
  return 1 + botShip(s, bot, res.setId);
}

function botPull(s, bot, binId) {
  const st = E.startPull(s, binId, bot.id);
  if (!st.ok) return 1;
  const bin = s.bins[binId];
  const n = bin.orderIds.length;
  for (const id of [...bin.orderIds]) {
    if (bin.scanned.includes(id)) continue;
    if (s.orders[id].status !== 'cancelled' && botRng(s) < 0.006) { E.markMissing(s, binId, id, bot.id); continue; }
    E.scanPull(s, binId, id, bot.id);
  }
  const res = E.finishPull(s, binId, bot.id);
  const pullMin = 2 + Math.ceil(n * 0.5);
  if (!res.setId) return pullMin;
  return pullMin + botShip(s, bot, res.setId);
}

function botShip(s, bot, setId) {
  const set = s.sets[setId];
  const choice = E.packChoice(s, set);
  const wantHandoff = choice.forced === 'handoff' || (choice.handoff && botRng(s) < 0.45);
  if (wantHandoff && choice.handoff) {
    const slot = E.suggestSlot(s);
    if (slot && E.handoff(s, setId, slot, bot.id).ok) return 1;
  }
  return botCarry(s, bot, setId);
}

function botCarry(s, bot, setId) {
  const st = s.stations.find(x => !x.packageId);
  if (!st) return 2; // wait for a station
  const r = E.stationRead(s, st.id, setId, bot.id);
  if (!r.ok) return 1;
  return 1 + botBox(s, bot, r.packageId);
}

function botPack(s, bot, slot) {
  const st = s.stations.find(x => !x.packageId);
  if (!st) return 2;
  const r = E.stationRead(s, st.id, slot, bot.id);
  if (!r.ok) return 1;
  return 1 + botBox(s, bot, r.packageId);
}

function botBox(s, bot, pkgId) {
  const pkg = s.packages[pkgId];
  let res = E.containerize(s, pkgId, E.expectedContainer(s, pkg), bot.id);
  if (res.relabeled) res = E.containerize(s, pkgId, E.expectedContainer(s, pkg), bot.id);
  return 2 + Math.ceil(pkg.orderIds.length * 0.5);
}
