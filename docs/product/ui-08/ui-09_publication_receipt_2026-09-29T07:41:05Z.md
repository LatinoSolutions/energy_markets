# UI-09 · Publication receipt · energy-markets-ui.service (UI08-10)

generatedAt: 2026-09-29T07:41:05Z
expectedCommit (main): 8b461b5ce707917e40f0861e25d39a8a88ec39f5

## P1: live service serves the main containing the UI-08 merge

Three readings cohere:

1. ```git rev-parse main``` (production checkout /srv/hot-data/energy-markets/app) = `8b461b5ce707917e40f0861e25d39a8a88ec39f5` (= HEAD, no tracked changes).
2. `systemctl --user show energy-markets-ui.service -p MainPID -p ActiveEnterTimestamp`:
   before restart: MainPID=796583, active since Sat 2026-09-26 14:10:22 UTC (pre-UI-08 process);
   after restart: MainPID=3807188, active since Tue 2026-09-29 07:40:26 UTC.
3. `GET /health` declares build.commit = `8b461b5ce707917e40f0861e25d39a8a88ec39f5`, dirty=false, capturedAt 2026-09-29T07:40:27.457Z.

## P2: verify-served-build.mjs exit 0 against the live service

`node docs/product/ui-08/verify-served-build.mjs http://100.92.44.106:8788/ 8b461b5ce707917e40f0861e25d39a8a88ec39f5` -> **exit 0**.
Full JSON output: ui-09_served_build_receipt_2026-09-29T07:41:05Z.json (12 responses, errors: [], ok: true).

## Pre-restart idle-runners gate (none running)

- No backtest/hypothesis process found at check time (ps list clean).
- /health before restart: backtestJobs.configured=true, statusReadable=true, running=false.
- production checkout git status: only untracked runtime dirs (operations/backtest-runs, operations/data-runs, operations/audit/IMP-03/EEX-THE-20260921/ST-03.4).
- data queue timer (energy-markets-data-queue.timer) disabled/inactive; last data job 2026-09-26 13:09:08 UTC finished SUCCESS.
