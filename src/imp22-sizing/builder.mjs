// Plantilla y constructor de diseños IMP-22. Todo dato real de las Mission
// nuevas es AUDIT-DEPENDENT (DEP-01–08 [Mission/sizing del nuevo experimento];
// DEP-12): el builder fabrica el esqueleto fail-closed determinista y los
// candidatos inyectan sólo lo declarado. Nada aquí declara un dato real ni
// un resultado.

import { MISSION_MINIMUM_EVIDENCE } from "./missions.mjs";

const ISO_NOW = () => new Date().toISOString();

export function makeDesign(experimentId, missionId, reserveId) {
  return {
    identity: {
      experimentId,
      missionId,
      actionSpaceVersion: "BUY-WAIT-V1",
      createdAt: ISO_NOW(),
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
    separateEvaluation: { byProduct: true, byMission: true, ownBenchmarkPerMission: true },
    honestUnknowns: [],
    honestUnknownReferenceScope: [
      "DEP-01 [Mission]: cantidades/hub/contrato/delivery/liquidación del nuevo experimento",
      "DEP-03 [Mission]: calendario/deadline/oportunidades propios",
      "DEP-04 [Mission]: terminal coverage rule propia",
      "DEP-05 [Mission]: lotes/fees/parciales/redondeo",
      "DEP-06/07 [Mission]: PIT y disponibilidad de la serie de la propia Mission",
      "DEP-08 [Mission]: benchmark B propio reconciliado",
      "DEP-12: reserva/split propia de esta evaluación separada",
    ],
    actionSpaceModification: "NONE",
    controllerIsFinalSizingPolicy: false,
    freeze: null,
  };
}
