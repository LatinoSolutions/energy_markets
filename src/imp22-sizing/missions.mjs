// Registro de extensiones de misión (§25.1 fila IMP-22; §23 OD-01, D18 D5).
// Las cuatro misiones se evalúan separadamente: cada una conserva su
// población, su benchmark B propio y sus mínimos de evidencia P3/DEP-12.
// Ninguna función aquí produce score combinado ni pool de muestras.

import { MISSION_IDS } from "./identity.mjs";

export const PRODUCTS = { GAS: "GAS", POWER: "POWER" };

export const CADENCES = { MONTHLY: "MONTHLY", QUARTERLY: "QUARTERLY" };

// Mínimos DEP-12 §24: "evaluaciones Quarterly respetan >=8/>=2 años y
// Monthly >=24 meses, separadas" (P3 §5.6 aplica por Mission).
export const MISSION_MINIMUM_EVIDENCE = {
  "GAS-MONTHLY": { cadence: "MONTHLY", minMonthsOos: 24 },
  "GAS-QUARTERLY": { cadence: "QUARTERLY", minCompleteQuartersOos: 8, minCalendarYearsOos: 2 },
  "POWER-MONTHLY": { cadence: "MONTHLY", minMonthsOos: 24 },
  "POWER-QUARTERLY": { cadence: "QUARTERLY", minCompleteQuartersOos: 8, minCalendarYearsOos: 2 },
};

export const MISSIONS = [
  { missionId: "GAS-MONTHLY", product: "GAS", cadence: "MONTHLY", minimumEvidence: MISSION_MINIMUM_EVIDENCE["GAS-MONTHLY"], ownBenchmarkB: true, separateEvaluation: true },
  { missionId: "GAS-QUARTERLY", product: "GAS", cadence: "QUARTERLY", minimumEvidence: MISSION_MINIMUM_EVIDENCE["GAS-QUARTERLY"], ownBenchmarkB: true, separateEvaluation: true },
  { missionId: "POWER-MONTHLY", product: "POWER", cadence: "MONTHLY", minimumEvidence: MISSION_MINIMUM_EVIDENCE["POWER-MONTHLY"], ownBenchmarkB: true, separateEvaluation: true },
  { missionId: "POWER-QUARTERLY", product: "POWER", cadence: "QUARTERLY", minimumEvidence: MISSION_MINIMUM_EVIDENCE["POWER-QUARTERLY"], ownBenchmarkB: true, separateEvaluation: true },
];

export function getMission(missionId) {
  return MISSIONS.find((mission) => mission.missionId === missionId) ?? null;
}

export function isMissionId(missionId) {
  return MISSION_IDS.includes(missionId);
}

// Cada extensión de misión usada por un experimento debe verificar su estado
// separado: B propio, evaluación independiente y mínimos instalados. La
// verificación es fail-closed; no inventa cobertura faltante (DEP-12 §24).
export function isMinimumEvidenceInstalled(mission) {
  if (mission == null) return false;
  if (mission.cadence === "MONTHLY") return mission.minimumEvidence?.minMonthsOos === 24;
  return mission.minimumEvidence?.minCompleteQuartersOos === 8 && mission.minimumEvidence?.minCalendarYearsOos === 2;
}

export function validateMissionExtension(missionId) {
  const errors = [];
  const mission = getMission(missionId);

  if (mission == null) {
    return { ok: false, errors: [{ field: "missionId", code: "MISSION_UNKNOWN", message: `Mission desconocida: ${missionId} (§23 separación).` }] };
  }

  if (mission.ownBenchmarkB !== true) {
    errors.push({
      field: "ownBenchmarkB",
      code: "OWN_B_UNDECLARED",
      message: "La Mission debe conservar/evaluar su Benchmark B propio (§25.1 aceptación IMP-22).",
    });
  }

  if (mission.separateEvaluation !== true) {
    errors.push({
      field: "separateEvaluation",
      code: "SEPARATE_EVALUATION_UNDECLARED",
      message: "La evaluación debe ser separada por producto/Mission (D18 D5; §23).",
    });
  }

  if (!isMinimumEvidenceInstalled(mission)) {
    errors.push({
      field: "minimumEvidence",
      code: "MINIMUM_EVIDENCE_UNINSTALLED",
      message: "Los mínimos OOS de la Mission deben estar instalados sin valores sustituidos (DEP-12 §24).",
    });
  }

  return { ok: errors.length === 0, errors };
}
