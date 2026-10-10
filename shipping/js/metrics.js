// Section 7 metrics. Every touch is a scan, so everything here is derived from state + the event log.
import * as E from './engine.js';

const avg = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (a, b) => (b ? a / b : null);

export function compute(s, { day = null } = {}) {
  const inDay = t => day == null || E.dayOf(t) === day;
  const pkgs = Object.values(s.packages).filter(p => p.containerizedAt != null && inDay(p.containerizedAt));
  const ev = s.events.filter(e => inDay(e.t));
  const ordersPacked = pkgs.reduce((a, p) => a + p.orderIds.length, 0);
  const multi = pkgs.filter(p => p.orderIds.length > 1);
  const ordersInMulti = multi.reduce((a, p) => a + p.orderIds.length, 0);
  const freight = pkgs.reduce((a, p) => a + p.cost, 0);
  const soloFreight = pkgs.reduce((a, p) => a + p.soloCost, 0);

  const byZone = {};
  for (const p of pkgs) {
    const k = p.zone || 'Solo';
    (byZone[k] ||= { pkgs: 0, orders: 0 });
    byZone[k].pkgs++; byZone[k].orders += p.orderIds.length;
  }
  const bySvc = {};
  for (const p of pkgs) {
    (bySvc[p.svcId] ||= { pkgs: 0, orders: 0, cost: 0, upgrades: 0 });
    const b = bySvc[p.svcId];
    b.pkgs++; b.orders += p.orderIds.length; b.cost += p.cost; if (p.upgrade) b.upgrades++;
  }
  const byPractice = {};
  for (const p of pkgs) {
    (byPractice[p.practiceId] ||= { pkgs: 0, orders: 0 });
    byPractice[p.practiceId].pkgs++; byPractice[p.practiceId].orders += p.orderIds.length;
  }

  const missed = s.missed.filter(m => inDay(m.at));
  const missedByCause = {};
  for (const m of missed) missedByCause[m.cause] = (missedByCause[m.cause] || 0) + 1;

  const releases = ev.filter(e => e.type === 'release');
  const releaseMix = {};
  for (const r of releases) releaseMix[r.reason] = (releaseMix[r.reason] || 0) + 1;

  const arrivals = ev.filter(e => e.type === 'arrive' && e.etaHit !== undefined);
  const etaAccuracy = pct(arrivals.filter(e => e.etaHit).length, arrivals.length);

  // Throughput per worker per task.
  const workers = {};
  const bump = (w, k, n = 1) => { if (!w || w === 'SYSTEM') return; (workers[w] ||= { stow: 0, pull: 0, pack: 0, scans: 0, first: null, last: null }); workers[w][k] += n; };
  const scanTypes = new Set(['receive', 'put', 'pull-scan', 'handoff', 'print', 'containerize', 'pull-start', 'wrong-bin', 'wrong-container', 'wrong-slot']);
  for (const e of ev) {
    if (e.type === 'put') bump(e.worker, 'stow');
    if (e.type === 'decide' && e.decision !== 'hold') bump(e.worker, 'stow');
    if (e.type === 'pull-scan') bump(e.worker, 'pull');
    if (e.type === 'containerize') bump(e.worker, 'pack', e.orders);
    if (scanTypes.has(e.type) && e.worker && e.worker !== 'SYSTEM') {
      bump(e.worker, 'scans');
      const w = workers[e.worker];
      w.first = w.first == null ? e.t : Math.min(w.first, e.t);
      w.last = Math.max(w.last ?? e.t, e.t);
    }
  }
  for (const w of Object.values(workers)) {
    const hrs = Math.max(0.25, (w.last - w.first) / 60);
    w.ordersPerHour = (w.stow + w.pull + w.pack) / hrs;
    w.hours = hrs;
  }

  const putDur = avg(ev.filter(e => e.type === 'put' && e.dur != null).map(e => e.dur));
  const releaseToPull = avg(ev.filter(e => e.type === 'pull-done').map(e => e.dur));
  const pullToContainer = avg(ev.filter(e => e.type === 'containerize' && e.cycle != null).map(e => e.cycle));
  const handoffWait = avg(ev.filter(e => e.type === 'pack-pickup').map(e => e.wait));

  const scans = ev.filter(e => scanTypes.has(e.type)).length;
  const received = ev.filter(e => e.type === 'receive').length;
  const exceptions = {};
  for (const e of ev) if (E.EXCEPTION_TYPES[e.type]) exceptions[e.type] = (exceptions[e.type] || 0) + 1;
  const excTotal = Object.values(exceptions).reduce((a, b) => a + b, 0);

  const byHour = Array.from({ length: 24 }, () => ({ arrive: 0, packed: 0 }));
  for (const e of ev) {
    const h = Math.floor(E.minOf(e.t) / 60);
    if (e.type === 'arrive') byHour[h].arrive++;
    if (e.type === 'containerize') byHour[h].packed += e.orders;
  }

  const onTime = pct(pkgs.filter(p => p.onTime).length, pkgs.length);
  const byPickup = {};
  for (const p of pkgs) {
    const k = `${p.pickupId}`;
    (byPickup[k] ||= { pkgs: 0, onTime: 0 });
    byPickup[k].pkgs++; if (p.onTime) byPickup[k].onTime++;
  }

  return {
    pkgs: pkgs.length, ordersPacked,
    ordersPerPackage: pkgs.length ? ordersPacked / pkgs.length : null,
    consolidationRate: pct(ordersInMulti, ordersPacked),
    missed: missed.length, missedByCause,
    freight, freightPerOrder: ordersPacked ? freight / ordersPacked : null, savings: soloFreight - freight,
    upgrades: pkgs.filter(p => p.upgrade).length,
    releaseMix, releases: releases.length,
    onTime, byPickup, etaAccuracy, arrivals: arrivals.length,
    byZone, bySvc, byPractice, workers,
    putDur, releaseToPull, pullToContainer, handoffWait,
    touchesPerOrder: received ? scans / received : null,
    exceptions, excPer1000: received ? (excTotal / received) * 1000 : null,
    byHour,
  };
}

export function floorSnapshot(s) {
  const bins = Object.values(s.bins);
  const open = bins.filter(b => b.status === 'open');
  const zones = {};
  for (const z of s.config.zones) {
    const zb = bins.filter(b => b.zone === z.id);
    const zOpen = zb.filter(b => b.status === 'open');
    const oldest = zOpen.reduce((m, b) => (m == null || b.openedAt < m.openedAt ? b : m), null);
    zones[z.id] = {
      total: zb.length, used: zb.filter(b => b.status !== 'empty').length,
      open: zOpen.length, released: zb.filter(b => b.status === 'released').length,
      pulling: zb.filter(b => b.status === 'pulling').length, oldest,
    };
  }
  return {
    zones,
    atRisk: open.filter(b => E.binAtRisk(s, b)),
    openBins: open.length,
    inbound: Object.values(s.orders).filter(o => o.status === 'inbound').length,
    handoffDepth: E.handoffDepth(s),
    released: bins.filter(b => b.status === 'released').length,
  };
}
