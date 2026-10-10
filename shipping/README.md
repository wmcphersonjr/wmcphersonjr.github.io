# Dandy Shipping Central — MVP

A working, clickable MVP of the consolidation redesign for the Provo shipping floor. It covers **Stow** (receive, decide, put, release), **Manifest** (pull, hand off, ship, containerize), **follow the work**, and the **Lead view**. A floor simulator runs alongside it so the rules can be tested at volume.

Open `shipping/index.html` from any static host (GitHub Pages serves it at `/shipping/`). No build step. No backend: state lives in the browser (`localStorage`), so tabs on the same device share one floor.

| View | Who | What |
|---|---|---|
| **Handheld** | Floor workers on Honeywell devices | Badge sign-in, next task, Stow, Pull, Hand off, Pack myself, containerize |
| **Pack station** | Packers at desktops with fixed scanners and printers | Packer queue sorted by soonest truck, packing slip + carrier label, container scan |
| **Lead** | Shift lead | Bins by zone, aging, at-risk, handoff depth, peak mode, trucks and close-out, production changes, metrics, settings |

The top bar holds the sim clock: **Run** (1–30 sim minutes per second), **+15m**, **+1h**, **Next day**.

## Try it in two minutes

1. Handheld: tap badge `W-101` (trainer chips simulate scans; a real wedge scanner just types and presses Enter).
2. Press **+1h** a few times so orders arrive at inbound, then **Stow** and scan orders. Each one comes back **Hold → put to bin**, **Ship now**, or **Complete on arrival → pull bin now**.
3. Scan the wrong bin once to see the red screen.
4. Run the clock past 2:00p. Bins release at their truck cutoff. **Pull** one: scan the bin, scan each order (or mark one missing), then **Ship**.
5. Choose **Pack it myself** (scan a station `PS-#`) or **Hand off** (scan slot `H-#`), then scan the package into its container.
6. Open **Lead** to watch the zones, flip peak mode, remake or cancel a sibling in **Production**, and read **Metrics**.

Bots work the floor through the same app functions a person uses (crew size in Lead › Settings). They leave fresh work alone for 20 minutes so a person on a handheld gets first pick.

## How the spec maps to code

All decision rules live in `js/engine.js` (no DOM, unit tested). This is the part to port to the real Manifest backend.

| Spec | Function |
|---|---|
| 3.1 Receive and decide, complete on arrival | `receive()` |
| 3.2 Put to bin, wrong bin scan | `put()` |
| 3.3 Release: complete OR cutoff | `stepMinute()`, `releaseBin()`, `isComplete()` |
| 3.4 Pull, ship enabled only when every order is scanned | `startPull()`, `scanPull()`, `markMissing()`, `pullReady()`, `finishPull()` |
| 3.5 Hand off, packer queue by soonest truck | `handoff()`, `packQueue()` |
| 3.6 Ship (solo and consolidated share one path) | `stationRead()`, `containerize()` |
| 3.7 Containers per carrier + service, close, confirm on truck | `closeContainer()`, `departContainer()` |
| 3.8 Follow the work | `nextTask()` |
| 4.1 Hold or ship | `planPractice()`, `chooseShipment()` |
| 4.2 One bin per practice, earliest due governs | `binOf()`, `assignBin()`, `setDueDay()` |
| 4.3 Zone full: overflow, then ship early | `assignBin()`, `releaseOldestEarly()` |
| 4.4 Pack choice, peak mode off / auto / always on, reverse guard | `packChoice()` |
| 5 Exceptions | `markMissing()`, `delayEta()`, `cancelOrder()`, `reportDamaged()`, relabel on missed truck |
| 7 Metrics | `js/metrics.js` |

### Decision rules as built

- **Hold or ship.** Starting from what's physically in hand (plus the practice's bin), add siblings still in production in ETA order while the whole set can still ship and meet its **earliest** due date. If none qualify, ship now on the cheapest service that makes the date today. ETA is treated as reliable to the day, not the hour.
- **Bin's truck and cutoff.** A held bin targets a truck on its planned ship day (the day the last expected sibling is due). It releases at that truck's pack-by minus a release lead (default 30 min), or as soon as it's complete. It may target a later truck that costs up to `cutoffCostTolerance` more (default $3), so late-day siblings can still join without paying for a faster service.
- **Stray sibling that can't wait** (due too soon to join the bin's plan): ships alone; the bin keeps waiting.
- **Peak mode auto:** forces handoff when within the window of the set's pack-by (default 45 min) and released bins in the zone exceed the threshold (default 6). **Reverse guard:** handoff stops being offered at queue depth 10 or when every slot is full.
- **Follow the work:** tasks ranked by soonest pack-by. Pull ranks by the zone's soonest truck. Ties go pull, then pack, then receive. A packer with an empty queue gets routed to pulling.

### Proposed defaults for open items (flagged in the UI)

- **Damaged item:** pull it, send it back for remake (+1 day ETA), recalculate the set.
- **Cancelled order in a bin:** flagged red at pull, scanned into the exceptions tote, rest of the bin ships. Cancelled after label print: logged for a manual intercept.
- **Missed truck:** a package labeled for a truck that already left gets relabeled to the next service that makes the date when it's scanned into a container.
- **Close-out:** containers can auto-close and depart at pickup time, or the lead closes them and confirms they left on the truck. The carrier manifest is not built.

## Assumptions to check

- The 12:00p FedEx truck is modeled as Priority Overnight and the 3:00p FedEx truck as 2Day.
- Service costs and transit tables are planning placeholders (Lead › Settings shows them), not contract rates. Transit is keyed by UPS-style zone 2–8 and ignores weekends.
- Floor counts default to 3 zones × 24 bins, 12 overflow bins, 8 handoff slots, 4 pack stations. All are reset parameters in Settings.
- The sim generates ~180 orders/day across 60 practices with ~7% arriving a day late, which is scaled down from about 7,000/day.

## Build path to production

This MVP is build option 1 (mobile web + keyboard-wedge scanner) from the plan. The scan field stays focused, and every scan gives a green or red flash, a beep and, on red, a vibration. To go live:

1. Move `engine.js` rules server-side next to Manifest (or call Manifest APIs from it), backed by real order, production ETA, and transit data.
2. Replace `localStorage` with the backend, and add badge auth.
3. Send print jobs server-side to the station's printer (slip + label together), using the chosen label integration.
4. Run it on the Honeywell browser in kiosk mode, or in Enterprise Browser for native scan events.

## Tests

```
cd shipping && node --test test/
```

These cover the hold/ship rule, complete on arrival, the hybrid cutoff release, wrong bin scans, missing at pull, recalc on remake, cancelled-in-bin, zone full, peak mode and the reverse guard, packer queue order, follow the work, the ship path, and a full simulated day.
