// Run: node --test shipping/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import * as S from '../js/sim.js';

const { DAY } = E;
const at = (day, h, m = 0) => day * DAY + h * 60 + m;

function world({ zone = 3, clock = at(0, 8) } = {}) {
  const s = E.createState(E.defaultConfig());
  s.clock = clock;
  s.practices.P1 = { id: 'P1', name: 'Test Dental', zone };
  s.practices.P2 = { id: 'P2', name: 'Other Dental', zone };
  return s;
}
function order(s, id, { practiceId = 'P1', eta = 0, due = 3, arrive = null, status = 'inbound' } = {}) {
  s.orders[id] = { id, practiceId, etaDay: eta, dueDay: due, actualArrival: arrive ?? eta * DAY + 9 * 60, status, source: '3P' };
  return s.orders[id];
}

test('solo order with no siblings ships now on the cheapest service that makes the date', () => {
  const s = world({ zone: 3 });
  order(s, 'O1', { due: 2 });
  const r = E.receive(s, 'O1', 'W-101');
  assert.equal(r.decision, 'ship');
  const sh = E.setShipment(s, s.sets[r.setId]);
  assert.equal(sh.svcId, 'OT_GND'); // OnTrac 1 day to zone 3, cheapest
});

test('due tomorrow and nothing arriving today ships Next Day Air today', () => {
  const s = world({ zone: 8 });
  order(s, 'O1', { due: 1 });
  order(s, 'O2', { eta: 1, due: 4, status: 'production', arrive: at(1, 9) });
  const r = E.receive(s, 'O1', 'W-101');
  assert.equal(r.decision, 'ship');
  const sh = E.setShipment(s, s.sets[r.setId]);
  assert.equal(sh.day, 0);
  assert.equal(E.SERVICES[sh.svcId].transit(8), 1);
  assert.equal(sh.svcId, 'UPS_NDA'); // cheaper of the overnight options
});

test('holds when a sibling arrives in time for the earliest due date, then completes on arrival', () => {
  const s = world({ zone: 2 });
  order(s, 'O1', { due: 3 });
  order(s, 'O2', { eta: 1, due: 5, status: 'production', arrive: at(1, 9) });
  const r1 = E.receive(s, 'O1', 'W-101');
  assert.equal(r1.decision, 'hold');
  const bin = s.bins[r1.binId];
  assert.deepEqual(bin.expectedIds, ['O2']);
  assert.equal(bin.plannedShipDay, 1);
  assert.ok(E.put(s, 'O1', r1.binId, 'W-101').ok);
  s.clock = at(1, 9); s.orders.O2.status = 'inbound';
  const r2 = E.receive(s, 'O2', 'W-101');
  assert.equal(r2.decision, 'complete');
  assert.equal(r2.binId, r1.binId);
  assert.equal(bin.status, 'released');
  assert.equal(bin.releaseReason, 'complete');
});

test('does not hold for a sibling that would blow the earliest due date', () => {
  const s = world({ zone: 8 });
  order(s, 'O1', { due: 1 });
  order(s, 'O2', { eta: 1, due: 3, status: 'production' });
  assert.equal(E.receive(s, 'O1', 'W-101').decision, 'ship');
});

test('wrong bin scan is rejected and logged', () => {
  const s = world();
  order(s, 'O1');
  order(s, 'O2', { eta: 1, due: 4, status: 'production' });
  const r = E.receive(s, 'O1', 'W-101');
  const bad = E.put(s, 'O1', 'C-24', 'W-101');
  assert.equal(bad.ok, false);
  assert.ok(s.events.some(e => e.type === 'wrong-bin'));
  assert.ok(E.put(s, 'O1', r.binId.toLowerCase(), 'W-101').ok);
});

test('hybrid release: bin releases at its truck cutoff if the sibling is not here', () => {
  const s = world({ zone: 3 });
  order(s, 'O1', { due: 2 });
  order(s, 'O2', { eta: 0, due: 2, status: 'production', arrive: at(0, 20, 30) });
  const r = E.receive(s, 'O1', 'W-101');
  E.put(s, 'O1', r.binId, 'W-101');
  const bin = s.bins[r.binId];
  assert.ok(bin.cutoffAbs > s.clock && bin.cutoffAbs < at(0, 20, 30));
  while (s.clock < bin.cutoffAbs) E.stepMinute(s);
  assert.equal(bin.status, 'released');
  assert.equal(bin.releaseReason, 'cutoff');
  assert.deepEqual(bin.leftBehind, ['O2']);
});

test('pull: ship enabled only when every order is scanned or marked missing; missing ships solo later', () => {
  const s = world({ zone: 2 });
  order(s, 'O1', { due: 4 }); order(s, 'O2', { due: 4 }); order(s, 'O3', { eta: 1, due: 4, status: 'production' });
  const r = E.receive(s, 'O1', 'W'); E.put(s, 'O1', r.binId, 'W');
  E.receive(s, 'O2', 'W'); E.put(s, 'O2', r.binId, 'W');
  const bin = s.bins[r.binId];
  E.releaseBin(s, bin, 'cutoff');
  assert.ok(E.startPull(s, bin.id, 'W-102').ok);
  E.scanPull(s, bin.id, 'O1', 'W-102');
  assert.equal(E.pullReady(s, bin), false);
  assert.equal(E.finishPull(s, bin.id, 'W-102').ok, false);
  E.markMissing(s, bin.id, 'O2', 'W-102');
  assert.equal(E.pullReady(s, bin), true);
  const done = E.finishPull(s, bin.id, 'W-102');
  assert.deepEqual(s.sets[done.setId].orderIds, ['O1']);
  assert.equal(s.orders.O2.status, 'missing');
  assert.equal(bin.status, 'empty');
  // Found later: decided again, cause recorded.
  const again = E.receive(s, 'O2', 'W-103');
  assert.ok(again.ok);
  assert.equal(s.missed.at(-1).cause, 'missing at pull');
});

test('handoff: packer queue sorts by soonest truck; reverse guard stops handoff at max depth', () => {
  const s = world({ zone: 8 });
  s.config.peak.maxQueue = 2;
  s.practices.P3 = { id: 'P3', zone: 8 };
  order(s, 'A', { due: 5 }); order(s, 'B', { due: 1, practiceId: 'P2' }); order(s, 'C', { due: 5, practiceId: 'P3' });
  const a = E.receive(s, 'A', 'W').setId, b = E.receive(s, 'B', 'W').setId, c = E.receive(s, 'C', 'W').setId;
  assert.ok(E.handoff(s, a, 'H-1', 'W').ok);
  assert.ok(E.handoff(s, b, 'H-2', 'W').ok);
  assert.equal(E.packQueue(s)[0].set.id, b); // NDA truck before the 9pm ground truck
  const choice = E.packChoice(s, s.sets[c]);
  assert.equal(choice.handoff, false);
  assert.equal(choice.forced, 'self');
});

test('peak mode on forces handoff', () => {
  const s = world();
  s.config.peak.mode = 'on';
  order(s, 'A', { due: 5 });
  const set = s.sets[E.receive(s, 'A', 'W').setId];
  const ch = E.packChoice(s, set);
  assert.equal(ch.self, false);
  assert.equal(ch.forced, 'handoff');
});

test('ship: station read prints label, container scan must match carrier + service', () => {
  const s = world({ zone: 3 });
  order(s, 'A', { due: 4 });
  const setId = E.receive(s, 'A', 'W').setId;
  E.handoff(s, setId, 'H-3', 'W');
  const r = E.stationRead(s, 'PS-1', 'H-3', 'W-2');
  assert.ok(r.ok);
  const pkg = s.packages[r.packageId];
  assert.equal(pkg.type, 'single');
  assert.equal(E.containerize(s, pkg.id, 'C-WRONG', 'W-2').ok, false);
  const ok = E.containerize(s, pkg.id, E.expectedContainer(s, pkg), 'W-2');
  assert.ok(ok.ok);
  assert.equal(pkg.onTime, true);
  assert.equal(s.stations[0].packageId, null);
});

test('sibling delayed in production: recalc releases the bin when it can no longer make the earliest due date', () => {
  const s = world({ zone: 2 });
  order(s, 'O1', { due: 2 });
  order(s, 'O2', { eta: 1, due: 5, status: 'production' });
  const r = E.receive(s, 'O1', 'W'); E.put(s, 'O1', r.binId, 'W');
  E.delayEta(s, 'O2', 2);
  const bin = s.bins[r.binId];
  assert.equal(bin.status, 'released');
  assert.equal(bin.releaseReason, 'recalc');
});

test('cancelled sibling completes the bin; cancelled order in a bin is set aside at pull', () => {
  const s = world({ zone: 2 });
  order(s, 'O1', { due: 4 }); order(s, 'O2', { due: 4 }); order(s, 'O3', { eta: 1, due: 4, status: 'production' });
  const r = E.receive(s, 'O1', 'W'); E.put(s, 'O1', r.binId, 'W');
  E.receive(s, 'O2', 'W'); E.put(s, 'O2', r.binId, 'W');
  E.cancelOrder(s, 'O2');
  E.cancelOrder(s, 'O3');
  const bin = s.bins[r.binId];
  assert.equal(bin.status, 'released');
  E.startPull(s, bin.id, 'W');
  E.scanPull(s, bin.id, 'O1', 'W');
  const ca = E.scanPull(s, bin.id, 'O2', 'W');
  assert.ok(ca.cancelled);
  const done = E.finishPull(s, bin.id, 'W');
  assert.deepEqual(s.sets[done.setId].orderIds, ['O1']);
});

test('zones full: overflow first, then early release of the oldest bin', () => {
  const s = world({ zone: 2 });
  s.config.zones = [{ id: 'A', bins: 1 }, { id: 'OF', bins: 1, overflow: true }];
  s.bins = {}; E.buildFloor(s);
  for (const p of ['P1', 'P2', 'P3']) {
    s.practices[p] = { id: p, zone: 2 };
    order(s, p + 'a', { practiceId: p, due: 4 });
    order(s, p + 'b', { practiceId: p, eta: 1, due: 4, status: 'production' });
  }
  const r1 = E.receive(s, 'P1a', 'W'); E.put(s, 'P1a', r1.binId, 'W');
  s.clock += 5;
  const r2 = E.receive(s, 'P2a', 'W'); E.put(s, 'P2a', r2.binId, 'W');
  assert.equal(r1.binId, 'A-01');
  assert.equal(r2.binId, 'OF-01');
  const r3 = E.receive(s, 'P3a', 'W');
  assert.equal(r3.decision, 'ship');
  assert.equal(r3.releasedBin, 'A-01');
  assert.equal(s.bins['A-01'].releaseReason, 'zone-full');
});

test('follow the work ranks by soonest pickup', () => {
  const s = world({ zone: 8, clock: at(0, 13) });
  order(s, 'A', { due: 1 }); order(s, 'B', { due: 6, practiceId: 'P2' });
  const a = E.receive(s, 'A', 'W').setId; E.handoff(s, a, 'H-1', 'W');
  const b = E.receive(s, 'B', 'W').setId; E.handoff(s, b, 'H-2', 'W');
  const t = E.nextTask(s, 'W-9');
  assert.equal(t.type, 'pack');
  assert.equal(t.setId, a);
});

test('simulated day runs clean: every packed order is accounted for and on-time packages hit the truck', () => {
  const s = S.newSimulation({ bots: 6, seed: 11 });
  S.advanceTo(s, at(0, 22));
  const pk = Object.values(s.packages);
  assert.ok(pk.length > 20);
  const orders = pk.reduce((a, p) => a + p.orderIds.length, 0);
  assert.ok(orders / pk.length > 1.5, `orders per package ${orders / pk.length}`);
  for (const o of Object.values(s.orders)) {
    if (o.binId && o.status === 'binned') assert.ok(s.bins[o.binId].orderIds.includes(o.id), `${o.id} in ${o.binId}`);
  }
  // Nobody is double-booked across sets.
  const seen = new Set();
  for (const set of Object.values(s.sets)) if (set.status !== 'void') for (const id of set.orderIds) { assert.ok(!seen.has(id), id); seen.add(id); }
});
