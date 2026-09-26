#!/usr/bin/env bash
# DATA-01: escaneo de TR-01, job de la cola automática (owner decision
# 2026-09-26). NO se corre a mano: lo lanza la unidad systemd --user cuando el
# archivo sellado del cliente termina con `CHECKSUM OK`.
#
# Fuente: el archivo sellado del cliente, verificado por SHA-256 y tamaño. Lee el
# archivo en streaming (`zstd -dc | tar`), no acumula la historia en memoria.
# Salida: TRADES_MEASUREMENT + inventario de eex_derivative_reference, la
# verificación del archivo y la decisión de fuente de TR-01 (ambas por mercado).
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

archive_common=(--source archive --archive "$DATA_ARCHIVE_PATH"
  --expected-sha256 "$DATA_ARCHIVE_SHA256" --expected-bytes "$DATA_ARCHIVE_BYTES")

# 1. Trades por mercado desde el archivo verificado (streaming).
python3 operations/trades/TR-01/extract-trades-rows.py "${archive_common[@]}" \
  --area cmdty=NATGAS/area=THE \
  --out "$DATA_SCRATCH_DIR/tr01-gas-the.ndjson" \
  --reference-out "$DATA_SCRATCH_DIR/tr01-reference-gas-the.ndjson"
python3 operations/trades/TR-01/extract-trades-rows.py "${archive_common[@]}" \
  --area cmdty=POWER/area=DE \
  --out "$DATA_SCRATCH_DIR/tr01-power-de.ndjson" \
  --reference-out "$DATA_SCRATCH_DIR/tr01-reference-power-de.ndjson"

# 2. Medición (dedup, elegibilidad, Delete PIT, cobertura) por mercado, day-local.
#    Cada mercado publica su artefacto + manifest (no se pisa uno con el otro).
node operations/trades/TR-01/aggregate-trades-rows.mjs \
  --in "$DATA_SCRATCH_DIR/tr01-gas-the.ndjson" \
  --out operations/trades/TR-01/TRADES_MEASUREMENT-gas-the.json \
  --market gas-the --start "$DATA_WINDOW_START" --end "$DATA_WINDOW_END" \
  --reference "$DATA_SCRATCH_DIR/tr01-reference-gas-the.ndjson"
node operations/trades/TR-01/aggregate-trades-rows.mjs \
  --in "$DATA_SCRATCH_DIR/tr01-power-de.ndjson" \
  --out operations/trades/TR-01/TRADES_MEASUREMENT-power-de.json \
  --market power-de --start "$DATA_WINDOW_START" --end "$DATA_WINDOW_END" \
  --reference "$DATA_SCRATCH_DIR/tr01-reference-power-de.ndjson"

# 3. Registra la verificación del archivo en source-candidates.json y reconstruye
#    la decisión de fuente. La comparación lago/archivo es la que decide si la
#    fuente canónica es el archivo sellado o el lago (fallback).
node operations/trades/TR-01/record-archive-verification.mjs \
  --gas-rows "$DATA_SCRATCH_DIR/tr01-gas-the.ndjson" \
  --power-rows "$DATA_SCRATCH_DIR/tr01-power-de.ndjson" \
  --archive "$DATA_ARCHIVE_PATH" --sha256 "$DATA_ARCHIVE_SHA256" --bytes "$DATA_ARCHIVE_BYTES"
node operations/trades/TR-01/build-trades-source-decision.mjs
