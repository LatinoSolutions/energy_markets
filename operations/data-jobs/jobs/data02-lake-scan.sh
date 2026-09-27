#!/usr/bin/env bash
# DATA-02: lectura completa del lago mediante la cola acotada de jobs.
# No se ejecuta desde la Oficina. Los NDJSON quedan en scratch; el productor
# canónico publica cada medición y su manifest ligado a los bytes de entrada.
set -euo pipefail
: "${DATA_REPO_ROOT:?}"
: "${DATA_SCRATCH_DIR:?}"
mkdir -p "$DATA_SCRATCH_DIR"
cd "$DATA_REPO_ROOT"

for market in gas-the power-de; do
  case "$market" in
    gas-the) area=cmdty=NATGAS/area=THE ;;
    power-de) area=cmdty=POWER/area=DE ;;
  esac
  rows="$DATA_SCRATCH_DIR/data02-lake-$market.ndjson"
  python3 operations/trades/TR-01/extract-trades-rows.py \
    --source lake --area "$area" --out "$rows"
  node operations/trades/TR-01/aggregate-trades-rows.mjs \
    --in "$rows" --market "$market" \
    --out "operations/trades/DATA-02/TRADES_MEASUREMENT-lake-$market.json"
done
node operations/trades/DATA-02/build-source-period-coverage.mjs
node operations/trades/DATA-02/build-source-period-coverage.mjs --check
