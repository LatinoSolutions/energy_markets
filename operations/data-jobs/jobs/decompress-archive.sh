#!/usr/bin/env bash
# DATA-01: descompresión del archivo sellado del cliente, job de la cola
# automática (owner decision 2026-09-26). NO se corre a mano.
#
# Crea el directorio de extracción antes de invocar tar: `tar -C` falla con exit 2
# si el directorio no existe (hallazgo DATA01-DECOMPRESS-MKDIR), y la cola no
# puede depender de que alguien lo haya creado a mano.
#
# Al terminar bien escribe una MARCA propia (`DATA_DECOMPRESS_MARKER`) con el sha
# y el tamaño del archivo. La frescura del paso la mide el runner contra esa
# marca, no contra el mtime del directorio: `tar` reextrae sobre un árbol que ya
# existe sin cambiar el mtime del directorio, así que la reanudación tras un corte
# y un evento nuevo de checksum quedaban bloqueados como STEP_ARTIFACT_STALE
# (hallazgo DATA01-DECOMPRESS-STALE-DIR). La marca se reescribe en cada corrida.
set -euo pipefail

: "${DATA_ARCHIVE_PATH:?DATA_ARCHIVE_PATH es obligatorio}"
: "${DATA_EXTRACT_DIR:?DATA_EXTRACT_DIR es obligatorio}"
: "${DATA_DECOMPRESS_MARKER:?DATA_DECOMPRESS_MARKER es obligatorio}"
: "${DATA_ARCHIVE_SHA256:?DATA_ARCHIVE_SHA256 es obligatorio}"
: "${DATA_ARCHIVE_BYTES:?DATA_ARCHIVE_BYTES es obligatorio}"

mkdir -p "$DATA_EXTRACT_DIR"
tar --zstd -xf "$DATA_ARCHIVE_PATH" -C "$DATA_EXTRACT_DIR"

printf '{"schemaVersion":"1","archive":"%s","sha256":"%s","bytes":%s,"completedAt":"%s"}\n' \
  "$DATA_ARCHIVE_PATH" "$DATA_ARCHIVE_SHA256" "$DATA_ARCHIVE_BYTES" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  > "$DATA_DECOMPRESS_MARKER"
