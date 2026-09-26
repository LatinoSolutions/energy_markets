#!/usr/bin/env bash
# DATA-01: medición del puente de TR-03, job de la cola automática (owner decision
# 2026-09-26). NO se corre a mano. Mide en el puente (2025-08-12 .. 2026-07-28)
# sin estrategia: trades desde el archivo sellado verificado, best ask desde el
# lago EEX. Las reglas viven en src/trades-bridge (única fuente de verdad).
set -euo pipefail

: "${DATA_ARCHIVE_PATH:?DATA_ARCHIVE_PATH es obligatorio}"
: "${DATA_ARCHIVE_SHA256:?DATA_ARCHIVE_SHA256 es obligatorio}"
: "${DATA_ARCHIVE_BYTES:?DATA_ARCHIVE_BYTES es obligatorio}"
: "${DATA_SCRATCH_DIR:?DATA_SCRATCH_DIR es obligatorio}"
: "${DATA_REPO_ROOT:?DATA_REPO_ROOT es obligatorio}"
: "${DATA_WINDOW_START:?DATA_WINDOW_START es obligatorio}"
: "${DATA_WINDOW_END:?DATA_WINDOW_END es obligatorio}"

mkdir -p "$DATA_SCRATCH_DIR"
cd "$DATA_REPO_ROOT"

# 1. Trades del puente desde el archivo verificado (streaming, sin acumular).
python3 operations/trades/TR-01/extract-trades-rows.py --source archive \
  --archive "$DATA_ARCHIVE_PATH" --expected-sha256 "$DATA_ARCHIVE_SHA256" --expected-bytes "$DATA_ARCHIVE_BYTES" \
  --area cmdty=NATGAS/area=THE --start "$DATA_WINDOW_START" --end "$DATA_WINDOW_END" \
  --out "$DATA_SCRATCH_DIR/tr03-gas-the.ndjson"
python3 operations/trades/TR-01/extract-trades-rows.py --source archive \
  --archive "$DATA_ARCHIVE_PATH" --expected-sha256 "$DATA_ARCHIVE_SHA256" --expected-bytes "$DATA_ARCHIVE_BYTES" \
  --area cmdty=POWER/area=DE --start "$DATA_WINDOW_START" --end "$DATA_WINDOW_END" \
  --out "$DATA_SCRATCH_DIR/tr03-power-de.ndjson"

# 2. Best ask por slot del puente desde el lago (regla de slots v2, sin reescribir).
python3 operations/trades/TR-03/extract-tob-rows.py --source lake \
  --area cmdty=NATGAS/area=THE --products G0BQ,G0BM \
  --start "$DATA_WINDOW_START" --end "$DATA_WINDOW_END" \
  --out "$DATA_SCRATCH_DIR/tr03-tob-gas.json"
python3 operations/trades/TR-03/extract-tob-rows.py --source lake \
  --area cmdty=POWER/area=DE --products DEBQ,DEBM \
  --start "$DATA_WINDOW_START" --end "$DATA_WINDOW_END" \
  --out "$DATA_SCRATCH_DIR/tr03-tob-power.json"

# 3. Medición determinista del puente (escribe artefacto + manifest).
node operations/trades/TR-03/build-bridge-measurement.mjs \
  --gas-trades "$DATA_SCRATCH_DIR/tr03-gas-the.ndjson" \
  --power-trades "$DATA_SCRATCH_DIR/tr03-power-de.ndjson" \
  --gas-tob "$DATA_SCRATCH_DIR/tr03-tob-gas.json" \
  --power-tob "$DATA_SCRATCH_DIR/tr03-tob-power.json"
