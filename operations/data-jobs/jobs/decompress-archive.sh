#!/usr/bin/env bash
# DATA-01: descompresión del archivo sellado del cliente, job de la cola
# automática (owner decision 2026-09-26). NO se corre a mano.
#
# Crea el directorio de extracción antes de invocar tar: `tar -C` falla con exit 2
# si el directorio no existe (hallazgo DATA01-DECOMPRESS-MKDIR), y la cola no
# puede depender de que alguien lo haya creado a mano.
set -euo pipefail

: "${DATA_ARCHIVE_PATH:?DATA_ARCHIVE_PATH es obligatorio}"
: "${DATA_EXTRACT_DIR:?DATA_EXTRACT_DIR es obligatorio}"

mkdir -p "$DATA_EXTRACT_DIR"
exec tar --zstd -xf "$DATA_ARCHIVE_PATH" -C "$DATA_EXTRACT_DIR"
