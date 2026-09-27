#!/usr/bin/env bash
# FIX-03 bounded job payload. Run only after DATA02_LAKE_SCAN has published both
# measured markets and SOURCE_PERIOD_COVERAGE with RULE_APPLIED. This script is
# not invoked by a test or by an Office agent's interactive shell.
set -euo pipefail
: "${DATA_REPO_ROOT:?}"
cd "$DATA_REPO_ROOT"

node operations/trades/DATA-02/build-source-period-coverage.mjs --check
node --input-type=module -e 'import {readFileSync} from "node:fs"; const c=JSON.parse(readFileSync("operations/trades/DATA-02/SOURCE_PERIOD_COVERAGE.json")); if(c.ownerDecision?.verificationStatus!=="RULE_APPLIED") throw new Error("DATA-02 lake measurement is pending")'

python3 -B operations/audit/BT-01/extract-campaign-proxy-rows.py --release v3
node operations/audit/BT-01/build-campaign-benchmarks.mjs --version v3
node operations/audit/BT-01/build-campaign-benchmarks.mjs --version v3 --check

python3 -B operations/audit/IMP-05/extract-lake-proxy-rows.py --release v3
node operations/audit/IMP-05/build-lake-benchmark.mjs --release v3
node operations/audit/IMP-05/build-lake-benchmark.mjs --release v3 --check

node operations/exploratory/reconcile-bt02.mjs --version v3
node operations/exploratory/reconcile-bt02.mjs --version v3 --check
python3 -B operations/audit/FIX-03/verify-source-files.py --repo-root "$DATA_REPO_ROOT"
node --input-type=module -e 'import {readFileSync} from "node:fs"; import {assessBenchmarkFreshness} from "./src/ui/benchmark-freshness.mjs"; const m=JSON.parse(readFileSync("operations/exploratory/v3/reconciled-results-BT-02.MANIFEST.json")); const result=assessBenchmarkFreshness(process.cwd(),m); if(result.status!=="CURRENT") throw new Error(`FIX-03 release gate: ${result.status}: ${result.reason}`)'
