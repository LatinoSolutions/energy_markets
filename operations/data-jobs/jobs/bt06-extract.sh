#!/usr/bin/env bash
# DATA-01: extracción del top of book de Power de BT-06, job de la cola
# automática (owner decision 2026-09-26). NO se corre a mano.
#
# La fuente la decide TR-01 (PLAN_STATUS BT-06): el job lee la decisión de fuente
# y extrae del lago o del archivo sellado del cliente, el que TR-01 haya declarado
# canónico. Antes esto estaba fijo al lago y el archivo canónico detenía la cola
# (hallazgo DATA01-BT06-SOURCE-GATE). Si TR-01 no cerró una decisión extraíble, el
# paso falla cerrado: nunca se extrae de una fuente provisional.
set -euo pipefail

: "${DATA_REPO_ROOT:?DATA_REPO_ROOT es obligatorio}"
: "${DATA_SCRATCH_DIR:?DATA_SCRATCH_DIR es obligatorio}"
: "${DATA_WINDOW_START:?DATA_WINDOW_START es obligatorio}"
: "${DATA_WINDOW_END:?DATA_WINDOW_END es obligatorio}"
: "${DATA_BT06_SLOTS:?DATA_BT06_SLOTS es obligatorio}"
: "${DATA_ARCHIVE_PATH:?DATA_ARCHIVE_PATH es obligatorio}"
: "${DATA_ARCHIVE_SHA256:?DATA_ARCHIVE_SHA256 es obligatorio}"
: "${DATA_ARCHIVE_BYTES:?DATA_ARCHIVE_BYTES es obligatorio}"

cd "$DATA_REPO_ROOT"
DECISION="operations/trades/TR-01/DATA_SOURCE_DECISION.json"
if [ ! -f "$DECISION" ]; then
  echo "BT-06: falta la decisión de fuente de TR-01 ($DECISION)" >&2
  exit 1
fi

selected=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("selectedSource") or "")' "$DECISION")

case "$selected" in
  EEX_LAKE)
    exec python3 operations/exploratory/v3/build_tob_slots.py \
      --source lake --market POWER_DE --products DEBQ,DEBM \
      --start "$DATA_WINDOW_START" --end "$DATA_WINDOW_END" \
      --source-decision "$DECISION" --out "$DATA_BT06_SLOTS"
    ;;
  CLIENT_SEALED_ARCHIVE)
    exec python3 operations/exploratory/v3/build_tob_slots.py \
      --source archive --archive "$DATA_ARCHIVE_PATH" \
      --expected-sha256 "$DATA_ARCHIVE_SHA256" --expected-bytes "$DATA_ARCHIVE_BYTES" \
      --market POWER_DE --products DEBQ,DEBM \
      --start "$DATA_WINDOW_START" --end "$DATA_WINDOW_END" \
      --source-decision "$DECISION" --out "$DATA_BT06_SLOTS"
    ;;
  *)
    echo "BT-06: TR-01 no declaró una fuente canónica extraíble (selectedSource=${selected:-none})" >&2
    exit 1
    ;;
esac
