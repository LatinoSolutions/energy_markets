// TR-07 — soporte backend de los paneles TRADES de la pantalla de Backtests
// (TRADES_MODE_PLAN.md TR-07; OWNER_PATCH_TRADES_MODE_2026-09-25.md §3–§4).
//
// El render de estos paneles ya existe en src/ui/render.mjs (gate visual cerrado,
// P-010 opción B). Este módulo es la única capa que la UI consume: carga los
// artifacts ya producidos por TR-01/TR-02/TR-03/TR-04, los ata por SHA-256 a su manifest y
// proyecta el estado de cada panel. Aquí no se dibuja ni se calcula nada.
//
// Reglas no negociables:
//   - cero cálculo económico: sólo se seleccionan campos que el artifact ya trae;
//   - cero datos inventados: un panel sin artifact verificado queda UNAVAILABLE/
//     ERROR con su causa, jamás con un valor;
//   - nunca se abre una columna de precio (`Px`, `AskPx`, `BidPx`): los artifacts
//     de zona/cobertura/catálogo no las traen y aquí no se derivan.
//
// UI-07 (2026-09-26): cobertura, calibración y contrato leen las mediciones reales
// que dejó la cola DATA-01 (TR-01, TR-03) y el candidato de TR-04, cada uno atado por
// SHA-256 a su manifest. TR-06 (resultados) sigue sin runs.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { DEFAULT_REPO_ROOT } from "../pit-views/index.mjs";
import { freezeApprovalProblem } from "../execution-contract/trades-contract.mjs";
import { TRADES_MISSIONS } from "../oos-reservation/trades-windows.mjs";
import { FRESHNESS_LIMIT_CANDIDATES_SECONDS } from "../trades-bridge/constants.mjs";

// Modos del mismo backtest (patch 03 §2). El control TOB no se reescribe.
export const TRADES_MODES = Object.freeze(["TOB", "TRADES"]);

// Las 4 misiones canónicas del patch 03 §6. `TRADES_MISSIONS` (trades-windows.mjs)
// es la única fuente; esta lista es la que la UI acepta como misión conocida al
// leer la URL. Un valor fuera de ella cae al default fail-closed (server.mjs),
// nunca deja la pantalla sin misión marcada ni muestra otro producto.
export const TRADES_MISSION_IDS = Object.freeze(Object.keys(TRADES_MISSIONS));

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
  bridgeMeasurement: {
    artifact: "operations/trades/TR-03/bridge-measurement.json",
    manifest: "operations/trades/TR-03/bridge-measurement.MANIFEST.json",
    manifestRef: "artifact",
  },
  tradesFreeze: {
    artifact: "operations/trades/TR-04/TRADES_CONTRACT_V1_FREEZE.json",
    manifest: "operations/trades/TR-04/TRADES_CONTRACT_V1_FREEZE.MANIFEST.json",
    manifestRef: "artifact",
  },
  tradesRuns: {
    artifact: "operations/trades/TR-06/trades-runs.json",
    manifest: "operations/trades/TR-06/trades-runs.MANIFEST.json",
    manifestRef: "artifact",
  },
});

// La aprobación de Bru del freeze (TR-04, gate humano). Sólo cuenta si su hash es
// el que ató el manifest del freeze y si cubre el configHash exacto del contrato.
export const OWNER_FREEZE_APPROVAL_PATH = "operations/trades/TR-04/OWNER_FREEZE_APPROVAL.json";

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

function hashOfFile(repoRoot, relativePath) {
  try {
    return sha256Of(readFileSync(path.join(repoRoot, relativePath)));
  } catch {
    return null;
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
  return { ok: true, json: artifactRead.json, manifest: manifestRead.json, provenance: { path: spec.artifact, sha256: declared.sha256, manifestPath: spec.manifest, manifestRef: spec.manifestRef } };
}

// El plan de zonas proyecta la cobertura desde las mediciones de TR-01; su manifest
// ata cada una por SHA-256 (`sources.tradesMeasurement_*`). Si una medición cambió
// después de construir el plan, la cobertura mostrada ya no es la de la fuente.
function verifyZonePlanMeasurements(repoRoot, zonePlan) {
  if (zonePlan?.ok !== true) {
    return zonePlan;
  }
  const bound = Object.entries(zonePlan.manifest?.sources ?? {}).filter(([name]) => name.startsWith("tradesMeasurement_"));
  for (const [, source] of bound) {
    if (hashOfFile(repoRoot, source.path) !== source.sha256) {
      return { ok: false, code: "TRADES_PANEL_TR01_MEASUREMENT_STALE", path: source.path };
    }
  }
  return zonePlan;
}

// La aprobación se lee sólo si existe; su ausencia es el estado normal del gate.
function loadOwnerApproval(repoRoot) {
  const read = readJson(repoRoot, OWNER_FREEZE_APPROVAL_PATH);
  if (!read.ok) {
    return { present: false };
  }
  return { present: true, json: read.json, sha256: sha256Of(read.bytes) };
}

export function loadTradesPanelsAt(repoRoot = DEFAULT_REPO_ROOT) {
  const sourceDecision = loadVerified(repoRoot, TRADES_PANEL_ARTIFACTS.sourceDecision);
  const zonePlan = verifyZonePlanMeasurements(repoRoot, loadVerified(repoRoot, TRADES_PANEL_ARTIFACTS.zonePlan));
  const bridgeStatus = loadVerified(repoRoot, TRADES_PANEL_ARTIFACTS.bridgeStatus);
  // Sin el job de TR-03 la medición no existe: es un estado, no un error.
  const bridgeMeasurement = loadVerified(repoRoot, TRADES_PANEL_ARTIFACTS.bridgeMeasurement);
  const tradesFreeze = loadVerified(repoRoot, TRADES_PANEL_ARTIFACTS.tradesFreeze);
  const tradesRuns = loadVerified(repoRoot, TRADES_PANEL_ARTIFACTS.tradesRuns);
  const ownerApproval = loadOwnerApproval(repoRoot);
  return { sourceDecision, zonePlan, bridgeStatus, bridgeMeasurement, tradesFreeze, tradesRuns, ownerApproval };
}

// Sin medición de TR-01 el artifact de TR-02 declara cada campaign NO_COVERAGE con
// ceros. Un cero no medido no es un dato: con el nivel general PENDING_SCAN_JOB las
// cifras salen pendientes (TRADES_MODE_PLAN.md TR-07; hallazgo TR07-PENDING-ZEROS).
// Con medición (UI-07), una ventana entera anterior al primer día con trades de la
// fuente canónica tampoco es un cero medido: la fuente no trae esos días (DATA-02).
const COVERAGE_PENDING_STATUSES = Object.freeze(new Set(["PENDING_SCAN_JOB"]));
const SOURCE_RANGE_STATUS = Object.freeze({
  WINDOW_BEFORE_SOURCE_START: "BEFORE_SOURCE_START",
  WINDOW_PARTIALLY_BEFORE_SOURCE_START: "PARTIAL_SOURCE_RANGE",
});

// Una fila de cobertura: sólo se copian campos del artifact de TR-02 (que a su vez
// los toma de TR-01_COVERAGE). Ningún campo de precio. `overallStatus` decide si la
// medición existe; cuando no, los campos medidos salen null (ausentes, no cero).
function coverageCell(coverage, overallStatus, sourceRange = null) {
  if (coverage === null || typeof coverage !== "object") {
    return { status: "UNAVAILABLE", reason: "cobertura no declarada en el plan de zonas" };
  }
  const beforeSource = sourceRange?.extent === "WINDOW_BEFORE_SOURCE_START";
  const measurementPending = COVERAGE_PENDING_STATUSES.has(overallStatus) || beforeSource;
  const rangeStatus = sourceRange === null ? null : SOURCE_RANGE_STATUS[sourceRange.extent] ?? "UNAVAILABLE";
  return {
    status: COVERAGE_PENDING_STATUSES.has(overallStatus) ? overallStatus : rangeStatus ?? coverage.status,
    artifactStatus: coverage.status,
    measurementPending,
    sourceRange,
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

function campaignEntry(campaign, zone, overallStatus, sourceRange) {
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
    coverage: coverageCell(campaign.coverage, overallStatus, sourceRange),
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
  const sourceRangeById = new Map((coverageStatus.campaignsBeforeSourceStart ?? []).map((entry) => [entry.campaignId, entry]));
  const missions = Object.entries(plan.missions ?? {}).map(([missionId, mission]) => ({
    missionId,
    market: mission.market,
    product: mission.product,
    shortCode: mission.shortCode,
    zones: Object.entries(mission.zones ?? {}).map(([zone, campaigns]) => ({
      zone,
      campaigns: campaigns.map((campaign) => campaignEntry(campaign, zone, coverageStatus.status, sourceRangeById.get(campaign.campaignId) ?? null)),
    })),
  }));
  return {
    status: coverageStatus.status,
    reason: coverageStatus.reason ?? null,
    source: coverageStatus.source ?? null,
    brokenSpreadPolicy: coverageStatus.brokenSpreadPolicy ?? null,
    measurements: (coverageStatus.measurements ?? []).map((entry) => ({
      market: entry.market,
      path: entry.path,
      sha256: entry.sha256,
      dateMin: entry.dateMin,
      dateMax: entry.dateMax,
      eligibleTrades: entry.eligibleTrades,
    })),
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

// Candidato de TR-04 utilizable por la calibración y el contrato: el freeze atado a
// su manifest y derivado de ESTA medición del puente (generatedFrom), no de otra.
function candidateFor(tradesFreeze, bridgeMeasurement) {
  if (tradesFreeze?.ok !== true) {
    return { ok: false, code: tradesFreeze?.code ?? "TRADES_PANEL_ARTIFACT_MISSING" };
  }
  const candidate = tradesFreeze.json.candidate ?? tradesFreeze.json.frozenContract ?? null;
  if (candidate === null) {
    return { ok: false, code: "TR04_NO_CANDIDATE" };
  }
  if (bridgeMeasurement?.ok !== true || candidate.generatedFrom?.bridgeMeasurementSha256 !== bridgeMeasurement.provenance.sha256) {
    return { ok: false, code: "TR04_CANDIDATE_NOT_FROM_VERIFIED_MEASUREMENT" };
  }
  return { ok: true, candidate };
}

// Por misión y regla de observación: frescura elegida, su cobertura en la mitad de
// calibración y la penalización trade->ask por grupo agresor, tal como las publica
// el candidato de TR-04 desde la medición de TR-03 (patch 03 §3.3–§3.4).
function calibrationMissions(candidate, measurement) {
  return Object.values(candidate.markets ?? {}).flatMap((market) =>
    Object.entries(market.missions ?? {}).map(([missionId, mission]) => ({
      missionId,
      market: market.market,
      shortCode: mission.shortCode,
      rules: Object.entries(mission.observations ?? {}).map(([rule, observation]) => ({
        rule,
        freshness: {
          status: observation.freshness?.status ?? "UNAVAILABLE",
          gridSeconds: observation.freshness?.candidatesSeconds ?? [],
          limitSeconds: observation.freshness?.selectedSeconds ?? null,
          coverage: observation.freshness?.selectedSeconds === null ? null : measurement?.markets?.[market.market]?.missions?.[missionId]?.summary?.coverage?.[rule]?.byHalf?.CALIBRATION?.coverageByLimit?.[String(observation.freshness.selectedSeconds)]?.coverage ?? null,
          reason: observation.freshness?.reason ?? null,
        },
        penalty: {
          status: observation.penalty?.status ?? "UNAVAILABLE",
          valueEurMwh: observation.penalty?.value ?? null,
          observations: observation.penalty?.observations ?? null,
          freshnessLimitSeconds: observation.penalty?.freshnessLimitSeconds ?? null,
          byAggressor: (observation.penalty?.byAggressor ?? []).map((group) => ({ aggressor: group.aggressor, count: group.count, penaltyEurMwh: group.penaltyEurMwh })),
          reason: observation.penalty?.reason ?? null,
        },
      })),
    })));
}

// Gate del puente predeclarado en TR-04 (antes de cualquier run TRADES).
function bridgeGateOf(candidate) {
  const gate = candidate.bridgeGate;
  if (!gate) {
    return null;
  }
  return {
    id: gate.id,
    thresholdStatus: gate.thresholdStatus ?? null,
    independence: gate.independence ?? null,
    declaration: gate.declaration ?? null,
    arms: gate.arms ?? [],
    metrics: (gate.metrics ?? []).map((metric) => ({ id: metric.id, description: metric.description, unit: metric.unit ?? null, passCriterion: metric.passCriterion ?? null })),
  };
}

// Distribución (observación TRADES − ask) medida en TR-03 por misión y regla, sólo
// sus cuantiles ya calculados (vista expandida del prototipo).
function gapDistributions(measurement) {
  return Object.values(measurement.markets ?? {}).flatMap((market) =>
    Object.entries(market.missions ?? {}).map(([missionId, mission]) => ({
      missionId,
      rules: Object.entries(mission.summary?.gaps ?? {}).map(([rule, gaps]) => ({
        rule,
        overall: gaps.overall ?? null,
        byHalf: gaps.byHalf ?? null,
        byAgeBucket: JSON.stringify(measurement.freshnessLimitsSeconds) === JSON.stringify(FRESHNESS_LIMIT_CANDIDATES_SECONDS) ? gaps.byAgeBucket ?? null : null,
      })),
    })));
}

// Panel de calibración (TR-03 + candidato TR-04). MEASURED sólo si el estado de
// TR-03 lo declara y la medición cargada es la misma que el estado verificó.
function projectCalibration(bridgeStatus, bridgeMeasurement, tradesFreeze) {
  if (bridgeStatus?.ok !== true) {
    return { status: "ERROR", code: bridgeStatus?.code ?? "TRADES_PANEL_ARTIFACT_MISSING", reason: "sin estado de medición verificado no hay calibración que mostrar" };
  }
  const status = bridgeStatus.json;
  const base = {
    status: status.status,
    reason: status.reason ?? null,
    window: status.window ?? null,
    freshnessLimitsSeconds: status.freshnessLimitsSeconds ?? [],
    gridStatus: JSON.stringify(status.freshnessLimitsSeconds) === JSON.stringify(FRESHNESS_LIMIT_CANDIDATES_SECONDS) ? "CURRENT" : "STALE_REMEASURE_REQUIRED",
    observationRules: status.observationRules ?? [],
    bridgeCampaigns: status.bridgeCampaigns ?? null,
    measurementArtifact: status.measurementArtifact ?? null,
    measurementManifest: status.measurementManifest ?? null,
  };
  if (status.status !== "MEASURED") {
    return { ...base, measurement: { status: status.status, reason: status.reason ?? null } };
  }
  if (bridgeMeasurement?.ok !== true || bridgeMeasurement.provenance.sha256 !== status.measurement?.sha256) {
    return {
      ...base,
      status: "ERROR",
      code: bridgeMeasurement?.ok === true ? "TR03_MEASUREMENT_NOT_THE_VERIFIED_ONE" : bridgeMeasurement?.code ?? "TRADES_PANEL_ARTIFACT_MISSING",
      reason: "El estado de TR-03 declara MEASURED pero la medición cargada no es la que verificó; no se muestra ninguna cifra.",
      measurement: { status: "ERROR" },
    };
  }
  const measurement = bridgeMeasurement.json;
  const candidate = candidateFor(tradesFreeze, bridgeMeasurement);
  return {
    ...base,
    brokenSpreadPolicy: measurement.brokenSpreadPolicy ?? null,
    halves: measurement.halves ?? null,
    measurement: { status: "MEASURED", sha256: bridgeMeasurement.provenance.sha256 },
    parameters: candidate.ok
      ? { status: "MEASURED", source: TRADES_PANEL_ARTIFACTS.tradesFreeze.artifact, missions: calibrationMissions(candidate.candidate, measurement) }
      : { status: "UNAVAILABLE", code: candidate.code, missions: [] },
    gate: candidate.ok ? bridgeGateOf(candidate.candidate) : null,
    gapDistributions: gapDistributions(measurement),
  };
}

// La aprobación sólo es válida si es el archivo que ató el manifest del freeze y si
// cubre el configHash exacto (mismo validador que TR-04: freezeApprovalProblem).
function approvalProblem(tradesFreeze, ownerApproval, configHash) {
  if (ownerApproval?.present !== true) {
    return "OWNER_APPROVAL_MISSING";
  }
  if (tradesFreeze.manifest?.sources?.ownerApproval?.sha256 !== ownerApproval.sha256) {
    return "OWNER_APPROVAL_NOT_BOUND";
  }
  return freezeApprovalProblem(ownerApproval.json, configHash)?.code ?? null;
}

// Panel del contrato (TR-04). El candidato se muestra con su configHash y como
// pendiente de aprobación de Bru; FROZEN sólo con OWNER_FREEZE_APPROVAL.json válido.
function projectFrozenContract(tradesFreeze, bridgeMeasurement, ownerApproval) {
  if (tradesFreeze?.ok !== true) {
    return {
      status: "UNAVAILABLE",
      code: tradesFreeze?.code ?? "TRADES_PANEL_ARTIFACT_MISSING",
      reason: "Sin artifact de freeze de TR-04 atado a su manifest no se muestra versión, frescura ni penalización.",
    };
  }
  const freeze = tradesFreeze.json;
  const candidate = candidateFor(tradesFreeze, bridgeMeasurement);
  if (!candidate.ok) {
    return { status: freeze.status ?? "UNAVAILABLE", code: candidate.code, reason: freeze.reason ?? null, blockedBy: freeze.blockedBy ?? [] };
  }
  const contract = candidate.candidate;
  const summary = {
    contractId: contract.contractId,
    versionLabel: contract.versionLabel,
    contractVersion: contract.contractVersion,
    configHash: contract.configHash,
    brokenSpreadPolicy: contract.tradeEligibility?.brokenSpreadPolicy ?? null,
    observationRules: contract.observationRules ?? null,
    sharedParameters: (contract.sharedParameters ?? []).map((entry) => ({ key: entry.key, status: entry.status, value: entry.value, unit: entry.unit })),
    sensitivityGrid: contract.sensitivityGrid ?? null,
    freshnessSelection: contract.freshnessSelection ?? null,
  };
  if (freeze.decision === "FROZEN") {
    const problem = approvalProblem(tradesFreeze, ownerApproval, contract.configHash);
    if (problem !== null || freeze.humanGate?.configHash !== contract.configHash) {
      return {
        status: "ERROR",
        code: problem ?? "CONFIG_HASH_MISMATCH",
        reason: "El artifact de TR-04 declara FROZEN sin una OWNER_FREEZE_APPROVAL.json válida y atada al mismo configHash; no se presenta como congelado.",
        candidate: summary,
      };
    }
    return {
      status: "FROZEN",
      reason: `Contrato ${contract.versionLabel} congelado con la aprobación de Bru (${freeze.humanGate.approvalRef}).`,
      approvalRef: freeze.humanGate.approvalRef,
      candidate: summary,
    };
  }
  return {
    status: freeze.status ?? "HOLD",
    decision: freeze.decision ?? "HOLD",
    reason: freeze.status === "PENDING_OWNER_APPROVAL"
      ? `Candidato ${contract.versionLabel} pendiente de aprobación de Bru (configHash ${contract.configHash}); no está congelado y ningún run TRADES arranca.`
      : freeze.reason ?? null,
    blockedBy: freeze.blockedBy ?? [],
    candidate: summary,
  };
}

// Panel de resultados (TR-06). Depende de BT-05/TR-04/TR-05: sin runs no hay
// resultados, y un backtest no se inventa.
function projectResults(tradesRuns, tradesFreeze) {
  if (tradesRuns?.ok === true && tradesFreeze?.ok === true
    && tradesRuns.json?.inputs?.freeze?.sha256 === tradesFreeze.provenance.sha256
    && !tradesRuns.json?.blockedBy?.includes("RUN_ARTIFACTS_MIXED_VERSIONS")) {
    const bridge = (tradesRuns.json.runs ?? []).filter((run) => run.phase === "BRIDGE" && run.bridgeGate?.gateId === "TRADES_BRIDGE_CONTRAST_V2");
    if (bridge.length > 0) return {
      status: "REPORTED",
      bridge: bridge.map((run) => ({ missionKey: run.missionKey, observationRule: run.observationRule, perArm: run.bridgeGate.perArm, deltaV: run.bridgeGate.deltaV, decision: run.bridgeGate.decision })),
    };
  }
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
    calibration: projectCalibration(loaded?.bridgeStatus, loaded?.bridgeMeasurement, loaded?.tradesFreeze),
    frozenContract: projectFrozenContract(loaded?.tradesFreeze, loaded?.bridgeMeasurement, loaded?.ownerApproval),
    results: projectResults(loaded?.tradesRuns, loaded?.tradesFreeze),
    provenance: {
      sourceDecision: loaded?.sourceDecision?.ok === true ? loaded.sourceDecision.provenance : null,
      zonePlan: loaded?.zonePlan?.ok === true ? loaded.zonePlan.provenance : null,
      bridgeStatus: loaded?.bridgeStatus?.ok === true ? loaded.bridgeStatus.provenance : null,
      bridgeMeasurement: loaded?.bridgeMeasurement?.ok === true ? loaded.bridgeMeasurement.provenance : null,
      tradesFreeze: loaded?.tradesFreeze?.ok === true ? loaded.tradesFreeze.provenance : null,
    },
  };
}

export function loadTradesPanels(repoRoot = DEFAULT_REPO_ROOT) {
  return projectTradesPanels(loadTradesPanelsAt(repoRoot));
}
