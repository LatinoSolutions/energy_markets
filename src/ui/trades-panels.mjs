// TR-07 — soporte backend de los paneles TRADES de la pantalla de Backtests
// (TRADES_MODE_PLAN.md TR-07; OWNER_PATCH_TRADES_MODE_2026-09-25.md §3–§4).
//
// Este módulo NO dibuja la UI (esa composición depende del gate visual de TR-07:
// captura aprobada por Bru antes de implementar). Aporta la única capa que la UI
// podrá consumir: carga los artifacts ya producidos por TR-01/TR-02/TR-03, los
// ata por SHA-256 a su manifest y proyecta el estado de cada panel.
//
// Reglas no negociables:
//   - cero cálculo económico: sólo se seleccionan campos que el artifact ya trae;
//   - cero datos inventados: un panel sin artifact verificado queda UNAVAILABLE/
//     ERROR con su causa, jamás con un valor;
//   - nunca se abre una columna de precio (`Px`, `AskPx`, `BidPx`): los artifacts
//     de zona/cobertura/catálogo no las traen y aquí no se derivan.
//
// Estado real hoy (25-sep-2026, artifacts aceptados en PLAN_STATUS):
//   - TR-01/TR-02/TR-03 existen; cobertura y calibración son PENDING_SCAN_JOB
//     (el escaneo lo lanza Bru), así que sus valores están ausentes, no en cero;
//   - TR-04 (contrato congelado) y TR-06 (resultados) no existen todavía.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { DEFAULT_REPO_ROOT } from "../pit-views/index.mjs";

// Modos del mismo backtest (patch 03 §2). El control TOB no se reescribe.
export const TRADES_MODES = Object.freeze(["TOB", "TRADES"]);

// Modo de observación elegido en la UI (TRADES_MODE_PLAN.md TR-07: "selector de
// mercado/misión y de modo TOB · TRADES"). La etiqueta `source` es el texto con el
// que se describe la observación de cada modo; en TRADES la observación es el último
// trade y el slot VWAP, nunca el best ask (patch 03 §3.3).
export const TRADES_OBSERVATION_MODES = Object.freeze({
  TOB: Object.freeze({
    id: "TOB",
    label: "TOB",
    source: "real EEX best ask",
    caption: "bridge · 2025-08-12 → 2026-07-28 · release v2",
    zones: Object.freeze(["PUENTE"]),
  }),
  TRADES: Object.freeze({
    id: "TRADES",
    label: "TRADES",
    source: "last trade · slot VWAP",
    caption: "Development · historical OOS · bridge",
    zones: Object.freeze(["DEVELOPMENT", "OOS_HISTORICO", "PUENTE"]),
  }),
});

// Las seis zonas de evidencia del patch 03 §4, en orden. La barra de zonas de la UI
// marca cuáles cubre el modo elegido; las etiquetas son las canónicas del artifact de
// TR-02 (DEVELOPMENT … FORWARD).
export const TRADES_ZONE_PLAN = Object.freeze([
  Object.freeze({ id: "DEVELOPMENT", label: "Development", from: "2021", to: "2024-05" }),
  Object.freeze({ id: "OOS_HISTORICO", label: "Historical OOS", from: "2024-06", to: "2025-05" }),
  Object.freeze({ id: "EMBARGO", label: "embargo", from: "2025-06", to: "2025-08-11" }),
  Object.freeze({ id: "PUENTE", label: "Bridge", from: "2025-08-12", to: "2026-07-28" }),
  Object.freeze({ id: "POST_PUENTE", label: "post", from: "2026-07-29", to: "freeze" }),
  Object.freeze({ id: "FORWARD", label: "Forward", from: "freeze", to: "→" }),
]);

export function observationFor(mode) {
  return TRADES_OBSERVATION_MODES[mode] ?? TRADES_OBSERVATION_MODES.TOB;
}

// Cada artifact se declara con el nombre exacto de su referencia dentro del
// manifest (los manifests de TR-01/TR-03 usan "artifact"; el de TR-02 usa "plan").
export const TRADES_PANEL_ARTIFACTS = Object.freeze({
  sourceDecision: {
    artifact: "operations/trades/TR-01/DATA_SOURCE_DECISION.json",
    manifest: "operations/trades/TR-01/DATA_SOURCE_DECISION.MANIFEST.json",
    manifestRef: "artifact",
  },
  zonePlan: {
    artifact: "operations/trades/TR-02/trades-zone-plan.json",
    manifest: "operations/trades/TR-02/trades-zone-plan.MANIFEST.json",
    manifestRef: "plan",
  },
  bridgeStatus: {
    artifact: "operations/trades/TR-03/BRIDGE_MEASUREMENT_STATUS.json",
    manifest: "operations/trades/TR-03/BRIDGE_MEASUREMENT_STATUS.json.MANIFEST.json",
    manifestRef: "artifact",
  },
});

const BRIDGE_MEASUREMENT = Object.freeze({
  artifact: "operations/trades/TR-03/bridge-measurement.json",
  manifest: "operations/trades/TR-03/bridge-measurement.MANIFEST.json",
});

function sha256Of(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJson(repoRoot, relativePath) {
  try {
    const bytes = readFileSync(path.join(repoRoot, relativePath));
    return { ok: true, bytes, json: JSON.parse(bytes.toString("utf8")) };
  } catch {
    return { ok: false };
  }
}

// Atadura por hash: el SHA-256 del artifact debe ser el que declara su manifest en
// la ranura canónica. Si el manifest falta, no declara la ranura o el contenido no
// coincide, la carga falla cerrada (no se muestra un valor no atado).
function loadVerified(repoRoot, spec) {
  const manifestRead = readJson(repoRoot, spec.manifest);
  if (!manifestRead.ok) {
    return { ok: false, code: "TRADES_PANEL_MANIFEST_MISSING", path: spec.manifest };
  }
  const declared = manifestRead.json?.[spec.manifestRef];
  if (declared?.path !== spec.artifact || typeof declared?.sha256 !== "string") {
    return { ok: false, code: "TRADES_PANEL_MANIFEST_REF_INVALID", path: spec.manifest };
  }
  const artifactRead = readJson(repoRoot, spec.artifact);
  if (!artifactRead.ok) {
    return { ok: false, code: "TRADES_PANEL_ARTIFACT_MISSING", path: spec.artifact };
  }
  if (sha256Of(artifactRead.bytes) !== declared.sha256) {
    return { ok: false, code: "TRADES_PANEL_HASH_MISMATCH", path: spec.artifact };
  }
  return { ok: true, json: artifactRead.json, provenance: { path: spec.artifact, sha256: declared.sha256, manifestPath: spec.manifest, manifestRef: spec.manifestRef } };
}

export function loadTradesPanelsAt(repoRoot = DEFAULT_REPO_ROOT) {
  const sourceDecision = loadVerified(repoRoot, TRADES_PANEL_ARTIFACTS.sourceDecision);
  const zonePlan = loadVerified(repoRoot, TRADES_PANEL_ARTIFACTS.zonePlan);
  const bridgeStatus = loadVerified(repoRoot, TRADES_PANEL_ARTIFACTS.bridgeStatus);
  // La medición del puente sólo aparecerá cuando Bru lance el job de TR-03; si no
  // existe, su ausencia es un estado, no un error (fail-closed).
  const bridgeMeasurement = loadVerified(repoRoot, BRIDGE_MEASUREMENT);
  return { sourceDecision, zonePlan, bridgeStatus, bridgeMeasurement };
}

// El artifact de TR-02 (aceptado) declara cada campaign en NO_COVERAGE con ceros
// mientras el escaneo de TR-01 no ha corrido. Un cero no medido no es un dato: si el
// nivel general sigue PENDING_SCAN_JOB, TR-07 presenta las cifras como pendientes en
// vez de propagar los ceros (TRADES_MODE_PLAN.md TR-07; hallazgo TR07-PENDING-ZEROS).
const COVERAGE_PENDING_STATUSES = Object.freeze(new Set(["PENDING_SCAN_JOB"]));

// Una fila de cobertura: sólo se copian campos del artifact de TR-02 (que a su vez
// los toma de TR-01_COVERAGE). Ningún campo de precio. `overallStatus` decide si la
// medición existe; cuando no, los campos medidos salen null (ausentes, no cero).
function coverageCell(coverage, overallStatus) {
  if (coverage === null || typeof coverage !== "object") {
    return { status: "UNAVAILABLE", reason: "cobertura no declarada en el plan de zonas" };
  }
  const measurementPending = COVERAGE_PENDING_STATUSES.has(overallStatus);
  return {
    status: measurementPending ? overallStatus : coverage.status,
    artifactStatus: coverage.status,
    measurementPending,
    source: coverage.source,
    legacyMaturity: coverage.legacyMaturity,
    contract: coverage.contract,
    windowDays: coverage.windowDays,
    daysWithTrades: measurementPending ? null : coverage.daysWithTrades,
    totalEligibleTrades: measurementPending ? null : coverage.totalEligibleTrades,
    volumeSum: measurementPending ? null : coverage.volumeSum,
    firstDate: measurementPending ? null : coverage.firstDate,
    lastDate: measurementPending ? null : coverage.lastDate,
    density: measurementPending ? null : coverage.density,
  };
}

function campaignEntry(campaign, zone, overallStatus) {
  return {
    campaignId: campaign.campaignId,
    product: campaign.product,
    mission: campaign.mission,
    market: campaign.market,
    maturity: campaign.maturity,
    shortCode: campaign.shortCode,
    zone,
    windowStart: campaign.windowStart,
    windowEnd: campaign.windowEnd ?? null,
    deadline: campaign.deadline ?? null,
    windowRule: campaign.windowRule ?? null,
    coverage: coverageCell(campaign.coverage, overallStatus),
  };
}

// Panel de cobertura (TR-01/TR-02). Agrupa por misión y zona; la zona queda
// visible en cada fila (TR-07: "zona visible en cada resultado").
function projectCoverage(zonePlan, sourceDecision) {
  if (zonePlan?.ok !== true) {
    return { status: "ERROR", code: zonePlan?.code ?? "TRADES_PANEL_ARTIFACT_MISSING", reason: "sin plan de zonas verificado no hay cobertura que mostrar" };
  }
  const plan = zonePlan.json;
  const coverageStatus = plan.coverageStatus ?? { status: "UNAVAILABLE", reason: "el artifact no declara coverageStatus" };
  const missions = Object.entries(plan.missions ?? {}).map(([missionId, mission]) => ({
    missionId,
    market: mission.market,
    product: mission.product,
    shortCode: mission.shortCode,
    zones: Object.entries(mission.zones ?? {}).map(([zone, campaigns]) => ({
      zone,
      campaigns: campaigns.map((campaign) => campaignEntry(campaign, zone, coverageStatus.status)),
    })),
  }));
  return {
    status: coverageStatus.status,
    reason: coverageStatus.reason ?? null,
    source: coverageStatus.source ?? null,
    sourceDecisionStatus: sourceDecision?.ok === true ? sourceDecision.json?.status ?? null : "UNAVAILABLE",
    sourceDecisionPolicy: sourceDecision?.ok === true ? sourceDecision.json?.brokenSpreadPolicy ?? null : null,
    missions,
  };
}

// Panel de zonas y registro OOS (TR-02): ventanas por misión, purge, puente,
// episodios TOB ya vistos y registro de accesos al OOS histórico.
function projectZones(zonePlan) {
  if (zonePlan?.ok !== true) {
    return { status: "ERROR", code: zonePlan?.code ?? "TRADES_PANEL_ARTIFACT_MISSING", reason: "sin plan de zonas verificado no hay zonas que mostrar" };
  }
  const plan = zonePlan.json;
  return {
    status: plan.decision ?? "UNAVAILABLE",
    reservationId: plan.reservationId ?? null,
    missions: Object.entries(plan.missions ?? {}).map(([missionId, mission]) => ({
      missionId,
      market: mission.market,
      shortCode: mission.shortCode,
      zones: Object.entries(mission.zones ?? {}).map(([zone, campaigns]) => ({ zone, count: campaigns.length, campaignIds: campaigns.map((campaign) => campaign.campaignId) })),
    })),
    purge: (plan.purge ?? []).map((entry) => ({ campaignId: entry.campaignId, tobSeen: entry.tobSeen ?? false, reason: entry.reason })),
    bridge: plan.bridge ?? null,
    tobSeen: plan.tobSeen ?? null,
    forward: plan.forward ?? null,
    accessRegistry: plan.accessRegistry ?? null,
  };
}

// Panel de calibración (TR-03): si el job aún no corrió, la ausencia es explícita.
// Cuando exista `bridge-measurement.json` atado por hash, se expone su contenido.
function projectCalibration(bridgeStatus, bridgeMeasurement) {
  if (bridgeStatus?.ok !== true) {
    return { status: "ERROR", code: bridgeStatus?.code ?? "TRADES_PANEL_ARTIFACT_MISSING", reason: "sin estado de medición verificado no hay calibración que mostrar" };
  }
  const status = bridgeStatus.json;
  return {
    status: status.status,
    reason: status.reason ?? null,
    window: status.window ?? null,
    freshnessLimitsSeconds: status.freshnessLimitsSeconds ?? [],
    observationRules: status.observationRules ?? [],
    bridgeCampaigns: status.bridgeCampaigns ?? null,
    measurementArtifact: status.measurementArtifact ?? null,
    measurementManifest: status.measurementManifest ?? null,
    measurement: bridgeMeasurement?.ok === true
      ? { status: "MEASURED", content: bridgeMeasurement.json }
      : { status: status.status === "PENDING_SCAN_JOB" ? "PENDING_SCAN_JOB" : "UNAVAILABLE", reason: status.reason ?? null },
  };
}

// Panel del contrato congelado (TR-04). TR-07 depende del freeze, que es un gate
// humano y todavía no está aprobado: se declara UNAVAILABLE, sin inventar un path
// ni una versión de contrato.
function projectFrozenContract(sourceDecision) {
  const policy = sourceDecision?.ok === true ? sourceDecision.json?.brokenSpreadPolicy ?? null : null;
  return {
    status: "UNAVAILABLE",
    reason: "El contrato TRADES-v1 (TR-04) no está congelado ni aprobado por Bru; no se muestra versión, frescura ni penalización inventadas.",
    brokenSpreadPolicy: policy,
  };
}

// Panel de resultados (TR-06). Depende de BT-05/TR-04/TR-05: sin runs no hay
// resultados, y un backtest no se inventa.
function projectResults() {
  return {
    status: "UNAVAILABLE",
    reason: "No hay runs TRADES de las 4 misiones (TR-06 los lanza Bru desde BT-05, después del freeze de TR-04). Ningún resultado se fabrica.",
  };
}

function selectorFrom(zonePlan) {
  if (zonePlan?.ok !== true) {
    return { status: "ERROR", marketMissions: [], modes: TRADES_MODES };
  }
  const marketMissions = Object.entries(zonePlan.json.missions ?? {}).map(([missionId, mission]) => ({
    missionId,
    market: mission.market,
    product: mission.product,
    shortCode: mission.shortCode,
  }));
  return { status: "OK", marketMissions, modes: TRADES_MODES };
}

// Proyección completa de los paneles TRADES. La UI sólo podrá dibujar esto.
export function projectTradesPanels(loaded, selection = {}) {
  const hasArtifacts = loaded?.zonePlan?.ok === true || loaded?.bridgeStatus?.ok === true || loaded?.sourceDecision?.ok === true;
  const mode = TRADES_OBSERVATION_MODES[selection.mode] ? selection.mode : "TOB";
  return {
    ok: hasArtifacts,
    surface: "backtests",
    selector: selectorFrom(loaded?.zonePlan),
    observation: observationFor(mode),
    modes: TRADES_MODES,
    coverage: projectCoverage(loaded?.zonePlan, loaded?.sourceDecision),
    zones: projectZones(loaded?.zonePlan),
    calibration: projectCalibration(loaded?.bridgeStatus, loaded?.bridgeMeasurement),
    frozenContract: projectFrozenContract(loaded?.sourceDecision),
    results: projectResults(),
    provenance: {
      sourceDecision: loaded?.sourceDecision?.ok === true ? loaded.sourceDecision.provenance : null,
      zonePlan: loaded?.zonePlan?.ok === true ? loaded.zonePlan.provenance : null,
      bridgeStatus: loaded?.bridgeStatus?.ok === true ? loaded.bridgeStatus.provenance : null,
      bridgeMeasurement: loaded?.bridgeMeasurement?.ok === true ? loaded.bridgeMeasurement.provenance : null,
    },
  };
}

export function loadTradesPanels(repoRoot = DEFAULT_REPO_ROOT) {
  return projectTradesPanels(loadTradesPanelsAt(repoRoot));
}
