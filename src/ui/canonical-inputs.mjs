// Carga el estado canónico que la UI puede mostrar hoy (UI-04, owner 24-sep-2026,
// docs/product/UI-04_OWNER_BRIEF_2026-09-24.md §Work 3). Solo lee artifacts
// registrados en un IMP_RECEIPT aceptado y pasa por el verificador PIT
// (buildPitManifestFromAudit); nunca lee el lago EEX ni fixtures.
//
// Replay exige además un decision boundary canónico (buildOperatorTimeline). Ningún
// artifact acreditado lo declara todavía, así que no se construye timeline: Replay
// queda ERROR con la causa explícita, en vez de inventar un boundary.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { DEFAULT_REPO_ROOT } from "../pit-views/index.mjs";
import { buildPitManifestFromAudit } from "../pit-views/views.mjs";
import { backendIndexFromManifest } from "../operator-interface/index.mjs";
import { BT02_CURRENT_RELEASE, BT02_RELEASES } from "../exploratory/reconciliation.mjs";
import { POWER_EXPLORATORY_RELEASE } from "../exploratory/missions.mjs";
import { mergeExploratoryResults, productsOfResults } from "../exploratory/exploratory-merge.mjs";
import { loadTradesPanels } from "./trades-panels.mjs";

export const TEMPORAL_MANIFEST_RECEIPT = "operations/receipts/IMP-03-IMP_RECEIPT.json";
export const TEMPORAL_MANIFEST_PATH = "operations/audit/IMP-03/temporal-manifest.json";

export const BACKEND_GAP = Object.freeze({
  NO_CANONICAL_DECISION_BOUNDARY: "NO_CANONICAL_DECISION_BOUNDARY",
  NO_VALUE_ATTESTATIONS: "NO_VALUE_ATTESTATIONS",
});

function emptyResult(errors) {
  return {
    inputs: {},
    backend: { manifestLoaded: false, recordCount: 0, bindableIdentities: 0, sources: [], gaps: [], errors },
  };
}

// El sha256 sale del receipt aceptado, no de este archivo: si el artifact cambia
// sin nuevo receipt, la carga falla cerrada.
function temporalManifestRef(repoRoot) {
  const receipt = JSON.parse(readFileSync(path.join(repoRoot, TEMPORAL_MANIFEST_RECEIPT), "utf8"));
  const entry = (receipt.evidenceTestHashes ?? []).find((item) => item?.path === TEMPORAL_MANIFEST_PATH);
  if (entry === undefined) {
    return null;
  }
  return { path: entry.path, sha256: entry.sha256 };
}

// La UI muestra sólo la versión vigente del backend (BT02_CURRENT_RELEASE); las
// anteriores se conservan en disco pero no se consumen (BT-04, 2026-09-25).
const BT02_RELEASE = BT02_RELEASES[BT02_CURRENT_RELEASE];
export const EXPLORATORY_MANIFEST_PATH = BT02_RELEASE.exploratoryManifest;
export const BT02_MANIFEST_PATH = BT02_RELEASE.manifest;
const BT02_EXPECTED_OUTPUT = BT02_RELEASE.artifact;
const BT02_EXPECTED_INPUTS = Object.freeze({
  exploratoryResults: BT02_RELEASE.exploratoryResults,
  exploratoryManifest: BT02_RELEASE.exploratoryManifest,
  bt01Benchmark: BT02_RELEASE.bt01Benchmark,
  bt01Manifest: BT02_RELEASE.bt01Manifest,
});

const sha256Of = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Backtest exploratorio (owner patch EM-SPEC-OWNER-PATCH-2026-09-24-02 §4). No es
// un record canónico del boundary: se muestra aparte y etiquetado EXPLORATORY.
// Solo se acepta si resultados e input coinciden byte a byte con el manifest.
const GAS_EXPLORATORY_RELEASE = Object.freeze({
  release: "v2",
  market: "GAS_THE",
  manifest: EXPLORATORY_MANIFEST_PATH,
  results: BT02_RELEASE.exploratoryResults,
});

// BT-06: un release exploratorio se acepta sólo si cada pieza (resultados, slots y
// generadores) coincide con el sha256 que declara su manifest.
function verifiedExploratoryRelease(repoRoot, spec) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path.join(repoRoot, spec.manifest), "utf8"));
  } catch {
    return { ok: false, code: "EXPLORATORY_MANIFEST_MISSING", path: spec.manifest };
  }
  if (manifest?.artifactKind !== "EXPLORATORY_BACKTEST_MANIFEST" || manifest?.results?.path !== spec.results) {
    return { ok: false, code: "EXPLORATORY_MANIFEST_INVALID", path: spec.manifest };
  }
  for (const entry of [manifest.results, manifest.slots, ...(manifest.generators ?? [])]) {
    let bytes;
    try {
      bytes = readFileSync(path.join(repoRoot, entry?.path ?? ""));
    } catch {
      return { ok: false, code: "EXPLORATORY_ARTIFACT_MISSING", path: entry?.path ?? null };
    }
    if (sha256Of(bytes) !== entry.sha256) {
      return { ok: false, code: "EXPLORATORY_HASH_MISMATCH", path: entry.path };
    }
  }
  const results = JSON.parse(readFileSync(path.join(repoRoot, manifest.results.path), "utf8"));
  if (results.status !== "EXPLORATORY" || results.inputs?.slots?.sha256 !== manifest.slots.sha256) {
    return { ok: false, code: "EXPLORATORY_INPUT_MISMATCH" };
  }
  return {
    ok: true,
    results,
    provenance: {
      release: spec.release,
      market: manifest.market ?? spec.market ?? null,
      manifestPath: spec.manifest,
      resultsPath: manifest.results.path,
      resultsSha256: manifest.results.sha256,
      slotsPath: manifest.slots.path,
      slotsSha256: manifest.slots.sha256,
    },
  };
}

function byProductProvenance(provenance, products) {
  return Object.fromEntries(products.map((product) => [product, provenance]));
}

// BT-06: el release v3 de Power vive en una ruta versionada nueva; hasta que el job
// de DATA-01 lo produzca, su ausencia es un estado (fail-closed), no un error.
export function loadPowerExploratoryBacktestAt(repoRoot) {
  return verifiedExploratoryRelease(repoRoot, POWER_EXPLORATORY_RELEASE);
}

export function loadExploratoryBacktestAt(repoRoot) {
  const gas = verifiedExploratoryRelease(repoRoot, GAS_EXPLORATORY_RELEASE);
  if (!gas.ok) {
    return gas;
  }
  const gasProvenance = {
    ...gas.provenance,
    releases: [gas.provenance],
    byProduct: byProductProvenance(gas.provenance, productsOfResults(gas.results)),
  };
  const power = loadPowerExploratoryBacktestAt(repoRoot);
  if (!power.ok) {
    return { ok: true, results: gas.results, provenance: gasProvenance, power: { loaded: false, code: power.code } };
  }
  const merged = mergeExploratoryResults(gas.results, power.results);
  if (!merged.ok) {
    return { ok: false, code: merged.code };
  }
  const byProduct = {
    ...byProductProvenance(gas.provenance, productsOfResults(gas.results)),
    ...byProductProvenance(power.provenance, productsOfResults(power.results)),
  };
  return {
    ok: true,
    results: merged.results,
    provenance: { ...gas.provenance, releases: [gas.provenance, power.provenance], byProduct },
    power: { loaded: true, ...power.provenance },
  };
}

export function containsOfficialStatus(value) {
  if (value === "OFFICIAL") return true;
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some(containsOfficialStatus);
}

// BT-03: sólo entrega el registro de medición después de comprobar el artifact
// BT-02, cada una de sus entradas declaradas y la identidad del producer.
// Las mediciones conservan así el binding al manifiesto y al resultado backend.
export function loadBacktestReadinessAt(repoRoot) {
  let manifest;
  let manifestBytes;
  try {
    manifestBytes = readFileSync(path.join(repoRoot, BT02_MANIFEST_PATH));
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    return { ok: false, code: "BT02_MANIFEST_MISSING" };
  }
  if (manifest.artifactKind !== "BT-02_EXPLORATORY_BENCHMARK_RECONCILIATION_MANIFEST"
    || manifest.schemaVersion !== "1.0"
    || manifest.status !== "EXPLORATORY_PROVISIONAL"
    || manifest.producer !== "src/exploratory/reconciliation.mjs"
    || manifest.artifact?.path !== BT02_EXPECTED_OUTPUT
    || typeof manifest.artifact?.sha256 !== "string"
    || manifest.inputs === null
    || typeof manifest.inputs !== "object"
    || Object.keys(manifest.inputs).length !== Object.keys(BT02_EXPECTED_INPUTS).length
    || Object.entries(BT02_EXPECTED_INPUTS).some(([name, expectedPath]) => manifest.inputs[name]?.path !== expectedPath)) {
    return { ok: false, code: "BT02_MANIFEST_INVALID" };
  }
  const artifacts = { output: manifest.artifact, ...manifest.inputs };
  let results;
  for (const [name, entry] of Object.entries(artifacts)) {
    if (typeof entry?.path !== "string" || typeof entry.sha256 !== "string") {
      return { ok: false, code: "BT02_ARTIFACT_REFERENCE_INVALID", name };
    }
    let bytes;
    try {
      bytes = readFileSync(path.join(repoRoot, entry.path));
    } catch {
      return { ok: false, code: "BT02_ARTIFACT_MISSING", path: entry.path };
    }
    if (sha256Of(bytes) !== entry.sha256) {
      return { ok: false, code: "BT02_HASH_MISMATCH", path: entry.path };
    }
    if (name === "output") {
      try {
        results = JSON.parse(bytes.toString("utf8"));
      } catch {
        return { ok: false, code: "BT02_ARTIFACT_INVALID", path: entry.path };
      }
    }
  }
  if (results?.artifactKind !== "BT-02_EXPLORATORY_BENCHMARK_RECONCILIATION"
    || results.schemaVersion !== "1.0"
    || results.status !== manifest.status
    || !Array.isArray(results.campaigns)) {
    return { ok: false, code: "BT02_ARTIFACT_INVALID", path: manifest.artifact.path };
  }
  // Plan BT-03 (BACKTEST_TABLE_UNLOCK_PLAN.md §BT-03): official/canonical sigue
  // unavailable donde falta evidencia; un artifact EXPLORATORY_PROVISIONAL no la
  // aporta, así que cualquier estado OFFICIAL dentro de él se rechaza entero.
  if (containsOfficialStatus(results)) {
    return { ok: false, code: "BT02_OFFICIAL_WITHOUT_EVIDENCE", path: manifest.artifact.path };
  }
  for (const [name, entry] of Object.entries(manifest.inputs)) {
    const declared = results.inputs?.[name];
    if (declared?.path !== entry.path || declared?.sha256 !== entry.sha256) {
      return { ok: false, code: "BT02_INPUT_BINDING_MISMATCH", path: entry.path };
    }
  }
  return {
    ok: true,
    results,
    provenance: {
      manifestPath: BT02_MANIFEST_PATH,
      manifestSha256: sha256Of(manifestBytes),
      artifactPath: manifest.artifact.path,
      artifactSha256: manifest.artifact.sha256,
      inputHashes: Object.fromEntries(Object.entries(manifest.inputs).map(([name, entry]) => [name, entry.sha256])),
    },
  };
}

function withExploratory(result) {
  const exploratory = loadExploratoryBacktestAt(DEFAULT_REPO_ROOT);
  const backtestReadiness = loadBacktestReadinessAt(DEFAULT_REPO_ROOT);
  // TR-07: paneles TRADES de Backtests, atados por SHA-256 a los manifests de
  // TR-01/TR-02/TR-03 (trades-panels.mjs). Su ausencia/desajuste queda fail-closed.
  const tradesPanels = loadTradesPanels(DEFAULT_REPO_ROOT);
  return {
    inputs: {
      ...result.inputs,
      exploratoryBacktest: exploratory.ok ? exploratory : null,
      backtestReadiness: backtestReadiness.ok ? backtestReadiness : null,
      tradesPanels,
    },
    backend: {
      ...result.backend,
      exploratory: exploratory.ok ? { loaded: true, ...exploratory.provenance } : { loaded: false, code: exploratory.code },
      powerExploratory: exploratory.ok ? exploratory.power ?? { loaded: false, code: "POWER_RELEASE_NOT_LOADED" } : { loaded: false, code: exploratory.code },
      backtestReadiness: backtestReadiness.ok ? { loaded: true, ...backtestReadiness.provenance } : { loaded: false, code: backtestReadiness.code },
    },
  };
}

export function loadCanonicalUiInputs() {
  return withExploratory(loadCanonicalManifestInputs());
}

function loadCanonicalManifestInputs() {
  let artifactRef;
  try {
    artifactRef = temporalManifestRef(DEFAULT_REPO_ROOT);
  } catch (error) {
    return emptyResult([{ code: "RECEIPT_UNREADABLE", message: String(error?.message ?? error) }]);
  }
  if (artifactRef === null) {
    return emptyResult([{ code: "ARTIFACT_NOT_IN_RECEIPT", message: `${TEMPORAL_MANIFEST_PATH} no figura en ${TEMPORAL_MANIFEST_RECEIPT}` }]);
  }

  const built = buildPitManifestFromAudit({ manifestId: "ui-04-canonical", manifestVersion: "1", artifactRef });
  if (!built.ok) {
    return emptyResult(built.errors ?? []);
  }
  const backendIndex = backendIndexFromManifest(built.manifest);
  if (backendIndex === null) {
    return emptyResult([{ code: "BACKEND_NOT_VERIFIED", message: "el manifest no salió del verificador PIT" }]);
  }

  const records = built.manifest.records ?? [];
  const gaps = [
    { code: BACKEND_GAP.NO_CANONICAL_DECISION_BOUNDARY, surface: "replay", message: "ningún artifact acreditado declara decision boundary, as-of ni working mode" },
  ];
  if (backendIndex.byIdentity.size === 0) {
    gaps.push({ code: BACKEND_GAP.NO_VALUE_ATTESTATIONS, surface: "all", message: `${records.length} records del manifest temporal IMP-03, ninguno con valor ni revisionId atestado` });
  }
  return {
    inputs: { backendIndex },
    backend: {
      manifestLoaded: true,
      recordCount: records.length,
      bindableIdentities: backendIndex.byIdentity.size,
      sources: [{ path: artifactRef.path, sha256: artifactRef.sha256, receiptPath: TEMPORAL_MANIFEST_RECEIPT }],
      gaps,
      errors: [],
    },
  };
}
