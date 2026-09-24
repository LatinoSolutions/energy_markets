// Plantilla y constructor de diseños IMP-22. Todo dato real de las Mission
// nuevas es AUDIT-DEPENDENT (DEP-01–08 [Mission/sizing del nuevo experimento];
// DEP-12): el builder fabrica el esqueleto fail-closed determinista y los
// candidatos inyectan sólo lo declarado. Nada aquí declara un dato real ni
// un resultado.

import { MISSION_MINIMUM_EVIDENCE } from "./missions.mjs";
import { IMP22_SPEC_IDENTITY, MISSION_IDS } from "./identity.mjs";
import { CONTROLLER_KIND } from "../sizing-controller/sizing-controller.mjs";

const ISO_NOW = () => new Date().toISOString();

// DEP-01–08 [producto/Mission/sizing del nuevo experimento]: el registro de
// desconocidos visibles del diseño. Entrada por hallazgo audit-dependiente,
// con sujeto y razón preservados (§6.4; mismo criterio que
// src/imp20-experiments/unknowns.mjs). Ref: hallazgo IMP22-H2.
function unknownEntries(missionId) {
  const entries = [
    ["DEP-01", "cantidades/contrato/warmup de la Mission", "DEP-01 [Mission]: cantidades/hub/contrato/delivery/liquidación del nuevo experimento"],
    ["DEP-03", "calendario/deadline/oportunidades propios", "DEP-03 [Mission]: calendario/deadline/oportunidades propios"],
    ["DEP-04", "rule de coverage del terminal de la Mission", "DEP-04 [Mission]: terminal coverage rule propia"],
    ["DEP-05", "lotes/fees/parciales/redondeo de la Mission", "DEP-05 [Mission]: lotes/fees/parciales/redondeo"],
    ["DEP-06/07", "PIT y disponibilidad de la serie de la propia Mission", "DEP-06/07 [Mission]: PIT y disponibilidad de la serie de la propia Mission"],
    ["DEP-08", "benchmark B propio reconciliado de la Mission", "DEP-08 [Mission]: benchmark B propio reconciliado"],
    ["DEP-12", "reserva/split propia de esta evaluación separada", "DEP-12: reserva/split propia de esta evaluación separada"],
  ];
  return entries.map(([unknownId, subject, reason]) => ({
    unknownId,
    subject,
    kind: "AUDIT_MISSING",
    reason,
    blockedAct: `Evaluar/calibrar el experimento de sizing de ${missionId} sin los datos auditados de ${unknownId}.`,
  }));
}

export function makeDesign(experimentId, missionId, reserveId) {
  const referenceScope = [
    "DEP-01 [Mission]: cantidades/hub/contrato/delivery/liquidación del nuevo experimento",
    "DEP-03 [Mission]: calendario/deadline/oportunidades propios",
    "DEP-04 [Mission]: terminal coverage rule propia",
    "DEP-05 [Mission]: lotes/fees/parciales/redondeo",
    "DEP-06/07 [Mission]: PIT y disponibilidad de la serie de la propia Mission",
    "DEP-08 [Mission]: benchmark B propio reconciliado",
    "DEP-12: reserva/split propia de esta evaluación separada",
  ];
  return {
    identity: {
      experimentId,
      missionId,
      actionSpaceVersion: "BUY-WAIT-V1",
      createdAt: ISO_NOW(),
      // §25.2.1 identidad de instancia: SPEC hash + parent IMP + scope +
      // versiones del objeto/protocolo (Ref: hallazgo IMP22-H3).
      specId: IMP22_SPEC_IDENTITY.id,
      specVersion: IMP22_SPEC_IDENTITY.version,
      specSha256: IMP22_SPEC_IDENTITY.sha256,
      parentImp: "IMP-22",
      scope: `Investigación de Sizing Policy y extensiones de Mission ${missionId} (§25.1 fila IMP-22; §§4,5,11,23)`,
      objectVersion: "1.0",
      protocolVersion: "1.0",
    },
    mission: {
      missionId,
      extensionCheck: "validateMissionExtension",
      ownBenchmarkBDeclaration: true,
      separateEvaluationDeclaration: true,
      minimumEvidenceDeclaration: true,
      minimumEvidenceSource: "MISSION_MINIMUM_EVIDENCE missions.mjs",
    },
    reserve: {
      reserveId,
      missionId,
      minimumEvidence: MISSION_MINIMUM_EVIDENCE[missionId] ?? null,
      status: "HOLD",
      split: {
        boundary: null,
        randomShuffle: false,
        chronology: "chronological-walk-forward-before-final-reserve",
      },
      reusesGasQuarterlyImp09Reservation: false,
      missionAuditScopeDeclaresOwnHistory: true,
    },
    candidates: [],
    attribution: {
      arms: null,
      sharedController: "P5_2-HOMOGENEOUS-CONTROLLER",
    },
    // §4.3 cobertura válida: la identidad Opening = Executed + Remaining y la
    // prohibición de doble conteo se declaran ex-ante; el trace material se
    // valida con validateCoverageTrace cuando exista run (Ref: IMP22-H7).
    coverage: {
      identity: "OPENING = EXECUTED + REMAINING (§4.3)",
      doubleCountForbidden: true,
      trace: null,
    },
    separateEvaluation: { byProduct: true, byMission: true, ownBenchmarkPerMission: true },
    controllerKind: CONTROLLER_KIND,
    honestUnknowns: MISSION_IDS.includes(missionId) ? unknownEntries(missionId) : [],
    honestUnknownReferenceScope: referenceScope,
    actionSpaceModification: "NONE",
    controllerIsFinalSizingPolicy: false,
    freeze: null,
  };
}
