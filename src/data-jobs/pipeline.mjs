// DATA-01 (PLAN_STATUS, owner decision 2026-09-26): la cola automática de jobs
// de data. Cuando la descarga del archivo del cliente termina con `CHECKSUM OK`,
// esta cola descomprime y lanza EN ORDEN: el escaneo de TR-01, la medición del
// puente de TR-03 y la extracción + backtest de Power de BT-06.
//
// Este módulo sólo declara los pasos (tipo de job, comando, techo de memoria y
// artefactos que publica). No ejecuta nada: el runner los corre de a uno y deja
// el receipt de cada uno. Los tests inyectan pasos con scripts de fixture.
//
// Fuente de la ventana y los mercados: TRADES_MODE_PLAN.md TR-03 (puente
// 2025-08-12 .. 2026-07-28) y src/trades-bridge/constants.mjs (BRIDGE_WINDOW).

import { BRIDGE_WINDOW } from "../trades-bridge/index.mjs";
import { POWER_EXPLORATORY_RELEASE } from "../exploratory/missions.mjs";

const GIB = 1024 ** 3;

// Marca que deja el job de descompresión al terminar. Su mtime se reescribe en
// cada extracción, así que sirve como prueba de frescura, a diferencia del
// directorio extraído (su mtime no cambia al volver a extraer encima: hallazgo
// DATA01-DECOMPRESS-STALE-DIR). Vive al lado del directorio, no dentro, para no
// contaminar el árbol extraído del cliente. Contiene el sha/tamaño del archivo.
export const DATA_DECOMPRESS_MARKER_NAME = ".decompress-complete.json";

export function decompressMarkerPath(archive) {
  return `${archive.extractDir}${DATA_DECOMPRESS_MARKER_NAME}`;
}

// Fuente: /srv/data/eex-client-archive/descargar.sh (declara TAM y SHA del
// archivo sellado del cliente, 25-sep-2026). El trigger exige que el sha256 de la
// línea `CHECKSUM OK` sea este: sin ese anclaje, un OK de otro contenido no dispara.
export const DATA_ARCHIVE = Object.freeze({
  path: "/srv/data/eex-client-archive/eex-sealed-production-outright-2020-11-02--2026-09-11.tar.zst",
  logPath: "/srv/data/eex-client-archive/descarga.log",
  extractDir: "/srv/data/eex-client-archive/extracted",
  expectedSha256: "c0b8389dd2eae768e0144ebffa2eb8c557c1407ec8bbccb014c0ecdee075cdd3",
  expectedBytes: 108015856868,
});

export const DATA_JOB_KIND = Object.freeze({
  DECOMPRESS: "DECOMPRESS",
  TR01_SCAN: "TR01_SCAN",
  TR03_BRIDGE: "TR03_BRIDGE",
  BT06_EXTRACT: "BT06_EXTRACT",
  BT06_BACKTEST: "BT06_BACKTEST",
});

// PROVISIONAL (REGLA 2): techos de arranque, NO canónicos. El owner pidió que
// cada job corra con MemoryMax y registre memory.peak en su receipt; estos
// valores se recalibran con el pico medido del primer run real (misma disciplina
// que BT-05). No son una decisión de producto.
export const PROVISIONAL_MEMORY_MAX_BYTES = Object.freeze({
  [DATA_JOB_KIND.DECOMPRESS]: 1 * GIB,
  [DATA_JOB_KIND.TR01_SCAN]: 2 * GIB,
  [DATA_JOB_KIND.TR03_BRIDGE]: 2 * GIB,
  [DATA_JOB_KIND.BT06_EXTRACT]: 4 * GIB,
  [DATA_JOB_KIND.BT06_BACKTEST]: 2 * GIB,
});

// PROVISIONAL (REGLA 2): techo de tiempo por job para que uno colgado no bloquee
// la cola. Recalcular con la duración medida del primer run real.
export const PROVISIONAL_TIMEOUT_MS = Object.freeze({
  [DATA_JOB_KIND.DECOMPRESS]: 6 * 60 * 60 * 1000,
  [DATA_JOB_KIND.TR01_SCAN]: 12 * 60 * 60 * 1000,
  [DATA_JOB_KIND.TR03_BRIDGE]: 12 * 60 * 60 * 1000,
  [DATA_JOB_KIND.BT06_EXTRACT]: 12 * 60 * 60 * 1000,
  [DATA_JOB_KIND.BT06_BACKTEST]: 6 * 60 * 60 * 1000,
});

const WINDOW_START = BRIDGE_WINDOW.startIso;
const WINDOW_END = BRIDGE_WINDOW.endIso;

// Artefactos que cada paso publica. El runner verifica que existan al terminar:
// un paso que "termina bien" sin dejar su artefacto es un fallo, no un éxito.
export const STEP_ARTIFACTS = Object.freeze({
  [DATA_JOB_KIND.DECOMPRESS]: [decompressMarkerPath(DATA_ARCHIVE)],
  [DATA_JOB_KIND.TR01_SCAN]: [
    "operations/trades/TR-01/TRADES_MEASUREMENT-gas-the.json",
    "operations/trades/TR-01/TRADES_MEASUREMENT-gas-the.json.MANIFEST.json",
    "operations/trades/TR-01/TRADES_MEASUREMENT-power-de.json",
    "operations/trades/TR-01/TRADES_MEASUREMENT-power-de.json.MANIFEST.json",
    "operations/trades/TR-01/DATA_SOURCE_DECISION.json",
    "operations/trades/TR-01/DATA_SOURCE_DECISION.MANIFEST.json",
  ],
  // El manifest de la medición vive en `bridge-measurement.MANIFEST.json` (misma
  // convención que el status de TR-03 y la UI, src/ui/trades-panels.mjs:96).
  [DATA_JOB_KIND.TR03_BRIDGE]: [
    "operations/trades/TR-03/bridge-measurement.json",
    "operations/trades/TR-03/bridge-measurement.MANIFEST.json",
  ],
  [DATA_JOB_KIND.BT06_EXTRACT]: [POWER_EXPLORATORY_RELEASE.slots],
  // Los mismos paths que la UI carga como release Power v3
  // (src/exploratory/missions.mjs POWER_EXPLORATORY_RELEASE): el resultado se ve
  // en Backtests sin tocar la UI.
  [DATA_JOB_KIND.BT06_BACKTEST]: [POWER_EXPLORATORY_RELEASE.results, POWER_EXPLORATORY_RELEASE.manifest],
});

function envForArchive({ archive }) {
  return {
    DATA_ARCHIVE_PATH: archive.path,
    DATA_ARCHIVE_SHA256: archive.expectedSha256,
    DATA_ARCHIVE_BYTES: String(archive.expectedBytes),
    DATA_EXTRACT_DIR: archive.extractDir,
    DATA_DECOMPRESS_MARKER: decompressMarkerPath(archive),
    DATA_WINDOW_START: WINDOW_START,
    DATA_WINDOW_END: WINDOW_END,
  };
}

// Construye los pasos ordenados de la cola. `scratchDir` guarda los NDJSON/JSON
// intermedios (nunca en el repo: pueden pesar GB).
export function buildDataQueueSteps({ repoRoot, archive = DATA_ARCHIVE, scratchDir }) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0) throw new TypeError("buildDataQueueSteps requiere repoRoot.");
  if (typeof scratchDir !== "string" || scratchDir.length === 0) throw new TypeError("buildDataQueueSteps requiere scratchDir.");
  const env = { ...envForArchive({ archive }), DATA_SCRATCH_DIR: scratchDir, DATA_REPO_ROOT: repoRoot, DATA_BT06_SLOTS: POWER_EXPLORATORY_RELEASE.slots };
  // El artefacto de DECOMPRESS sale del `archive` que se pasa (no del default
  // global): es la marca que el script escribe en DATA_DECOMPRESS_MARKER, al lado
  // de extractDir, no dentro (decompressMarkerPath, :25-27), para no contaminar
  // el árbol extraído del cliente.
  const artifactsFor = (jobKind) => (jobKind === DATA_JOB_KIND.DECOMPRESS ? [decompressMarkerPath(archive)] : [...STEP_ARTIFACTS[jobKind]]);
  const step = (jobKind, command, extra = {}) => ({
    jobKind,
    command,
    env,
    memoryMaxBytes: PROVISIONAL_MEMORY_MAX_BYTES[jobKind],
    timeoutMs: PROVISIONAL_TIMEOUT_MS[jobKind],
    publishes: artifactsFor(jobKind),
    ...extra,
  });
  return [
    // El owner pidió descomprimir en /srv/data/eex-client-archive. El script crea
    // el directorio de extracción antes de tar (`tar -C` falla con exit 2 si no
    // existe, hallazgo DATA01-DECOMPRESS-MKDIR). Nota de ingeniería (OPEN_ITEM):
    // el extractor de TR-01 lee el `.tar.zst` en streaming (`zstd -dc | tar`), así
    // que este paso deja el árbol extraído en disco pero hoy no lo consume ningún
    // job; se conserva porque el owner lo pidió explícito.
    step(DATA_JOB_KIND.DECOMPRESS, ["bash", "operations/data-jobs/jobs/decompress-archive.sh"]),
    step(DATA_JOB_KIND.TR01_SCAN, ["bash", "operations/data-jobs/jobs/tr01-scan.sh"]),
    step(DATA_JOB_KIND.TR03_BRIDGE, ["bash", "operations/data-jobs/jobs/tr03-bridge.sh"]),
    // La fuente la decide TR-01 (PLAN_STATUS BT-06): el script lee
    // DATA_SOURCE_DECISION.json y extrae del lago o del archivo sellado, el que
    // TR-01 haya declarado canónico (hallazgo DATA01-BT06-SOURCE-GATE).
    step(DATA_JOB_KIND.BT06_EXTRACT, ["bash", "operations/data-jobs/jobs/bt06-extract.sh"]),
    step(DATA_JOB_KIND.BT06_BACKTEST, [
      "node",
      POWER_EXPLORATORY_RELEASE.generator,
      "--repo-root", repoRoot,
      "--slots", POWER_EXPLORATORY_RELEASE.slots,
      "--out", POWER_EXPLORATORY_RELEASE.results,
    ]),
  ];
}
