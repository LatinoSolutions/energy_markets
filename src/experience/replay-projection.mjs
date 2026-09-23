// Proyección de Experience desde el output bundle P6 (IMP-17). Fuente: SPEC
// v1.1.1 §12.2 (piezas del registro), §12.1 (Historical Replay/Simulation:
// acciones reproducidas, execution y outcomes calculados por el evaluador se
// etiquetan como simulated Experience), §14.6 (el replay no computa B/H/V:
// evaluación downstream — la Experience proyectada queda outcome-pending,
// nunca calculada aquí) y §25.2 notas IMP-17 ("Provenance/PIT y versiones del
// material realmente utilizado"; "Casos sintéticos no cierran DEP-22 ni
// generan Real Experience").
//
// La proyección no calcula ni completa nada: cada pieza viene de las filas
// reales de los ledgers P6 materializados por IMP-12 y firmados por el
// receipt de IMP-14. Lo que un run no produjo (fills, timestamps, outcome)
// queda explicit-pending en el record, no rellenado.

import { buildExperienceRecord, ARTIFACT_KIND } from "./record.mjs";

function decisionTimeOf(decisionRow) {
  return decisionRow.decisionTimestamp ?? null;
}

function fillsFromExecutionRow({ executionRow }) {
  if (!executionRow || executionRow.noFill) {
    return [];
  }
  return [{
    evidenceKind: "SIMULATED_FILL",
    quantity: executionRow.filledQuantity,
    price: executionRow.executionPrice,
    timestampUtc: executionRow.eligibleExecutionTimestamp,
    requestId: executionRow.requestId,
    lotRoundingTreatment: executionRow.lotRoundingTreatment,
    executionContractVersion: executionRow.executionContractVersion,
  }];
}

function stateSnapshotOf({ decisionRow, receipt }) {
  return {
    // §12.2 state snapshot / data frontier: qué información estaba disponible
    // bajo known-at semantics. Las referencias PIT reales las asentó el
    // decision ledger de IMP-12 en esa frontera; la referencia de datos es la
    // del manifest PIT firmado por el receipt de IMP-14 (IMP-06), no una
    // etiqueta.
    frontierUtc: decisionTimeOf(decisionRow),
    frontierDate: decisionRow.frontier ?? null,
    knownAtSemantics: "decision-view boundaries del manifest PIT recorridas por el replay (§14.3 paso 2)",
    pitReferences: decisionRow.pitReferences ?? [],
    dataReference: {
      kind: "PIT_DATA_MANIFEST",
      manifestId: receipt.datasetManifestId ?? null,
      manifestVersion: receipt.datasetManifestVersion ?? null,
      contentHash: receipt.datasetManifestContentHash ?? null,
    },
    inputBundleContentHash: receipt.frozenBundleContentHash ?? null,
  };
}

function nextStateOf({ coverageRow }) {
  if (!coverageRow) {
    return null;
  }
  return {
    // §12.2 Next Procurement State: transición de obligación/cobertura/
    // volumen/tiempo. Proviene de la fila real del coverage ledger P6 (§14.5).
    source: "P6_COVERAGE_LEDGER",
    asOfDate: coverageRow.asOfDate,
    executedVolume: coverageRow.executedVolume,
    remainingVolume: coverageRow.remainingVolume,
    unit: coverageRow.unit,
    conservationDeclaration: coverageRow.conservation?.declaration ?? null,
  };
}

// §25.2 nota IMP-17: alcance DEP-22. Los records proyectados del replay son
// simulated Experience (§12.1): no cierran DEP-22 (Shadow prospectiva ni
// Real) y el corpus lo declara expresamente.
export const REPLAY_PROJECTION_SCOPE = Object.freeze({
  dep22ClosedByProjection: false,
  generatesRealExperience: false,
  note: "Proyección desde replay P6: acción y ejecución reproducidas/simuladas (§12.1); no produce Shadow factual prospectiva ni Real Execution, y no cierra DEP-22.",
});

// Materializa un record Experience por fila del decision ledger del output
// bundle P6. El outcome queda pending: la evaluación B/H/V es downstream
// (§14.6); el cierre lo producirá quien la materialice, no la proyección.
export function experienceFromReplayOutput({ outputBundle, recordedAtUtc = null, synthetic = false }) {
  if (!outputBundle || typeof outputBundle !== "object" || Array.isArray(outputBundle) || outputBundle.bundleKind !== "P6_OUTPUT_BUNDLE") {
    return { ok: false, code: "MISSING_OUTPUT_BUNDLE", message: "La proyección sólo parte del output bundle P6 materializado por IMP-12 (§14.10)." };
  }
  const receipt = outputBundle.receipt;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) || typeof receipt.receiptId !== "string") {
    return { ok: false, code: "MISSING_RUN_RECEIPT", message: "El provenance del record apunta al run receipt real de IMP-14 (§12.2 provenance)." };
  }
  const decisionRows = outputBundle.ledgers?.decision;
  const executionRows = outputBundle.ledgers?.execution;
  const coverageRows = outputBundle.ledgers?.coverage;
  if (!Array.isArray(decisionRows) || !Array.isArray(executionRows) || !Array.isArray(coverageRows)) {
    return { ok: false, code: "MALFORMED_LEDGERS", message: "El output bundle P6 debe exponer ledgers decision/execution/coverage (§14.10)." };
  }

  const executionBySequence = new Map(executionRows.map((row) => [row.sequence, row]));
  const coverageBySequence = new Map(coverageRows.map((row) => [row.sequence, row]));

  const failures = [];
  const records = [];
  for (const decisionRow of decisionRows) {
    const executionRow = executionBySequence.get(decisionRow.sequence) ?? null;
    const coverageRow = coverageBySequence.get(decisionRow.sequence) ?? null;
    const hasExecution = decisionRow.action === "BUY" && executionRow !== null;
    const executedAction = hasExecution
      ? (executionRow.noFill ? "BUY" : "BUY")
      : (decisionRow.action === "BUY" ? "BUY" : decisionRow.action);

    const built = buildExperienceRecord({
      recordState: "OPEN",
      sourceType: "REPLAY",
      policyVersion: decisionRow.policyVersion,
      stateSnapshot: stateSnapshotOf({ decisionRow, receipt }),
      strategyOutputs: [],
      uncertainty: null,
      recommendedAction: decisionRow.action,
      noRecommendationReason: decisionRow.action === null ? (decisionRow.reason ?? (decisionRow.statusCodes ?? []).join(",")) : null,
      execution: hasExecution
        ? {
            executedAction: executedAction,
            requestedQuantity: executionRow.requestedQuantity,
            noFill: executionRow.noFill === true,
            fills: fillsFromExecutionRow({ executionRow }),
          }
        : (decisionRow.action === "WAIT" ? { executedAction: "WAIT", fills: [] } : null),
      humanIntervention: null,
      nextState: nextStateOf({ coverageRow }),
      outcome: null,
      recommendedAtUtc: decisionTimeOf(decisionRow),
      recordedAtUtc,
      synthetic,
      provenance: {
        kind: "P6_RUN_RECEIPT",
        receiptId: receipt.receiptId,
        experimentId: receipt.experimentId ?? null,
        experimentVersion: receipt.experimentVersion ?? null,
        campaignId: receipt.campaignId ?? null,
        armVersion: receipt.armVersion ?? null,
        evaluatorVersion: receipt.evaluatorVersion ?? null,
        scope: REPLAY_PROJECTION_SCOPE,
      },
    });
    if (!built.ok) {
      failures.push({ sequence: decisionRow.sequence, errors: built.errors });
      continue;
    }
    records.push(built.record);
  }

  if (failures.length > 0) {
    return { ok: false, code: "RECORD_BUILD_FAILED", failures };
  }
  return { ok: true, records, scope: REPLAY_PROJECTION_SCOPE };
}

export { ARTIFACT_KIND };
