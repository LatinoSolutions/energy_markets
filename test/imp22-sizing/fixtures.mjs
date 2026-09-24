// Fixtures para los tests de IMP-22. Todos los valores numéricos son
// sintéticos y nunca evidencia económica (§25.1: fixtures explícitos permitidos).

import { EXPERIMENT_DESIGNS } from "../../src/imp22-sizing/designs.mjs";
import { ATTRIBUTION_ARMS } from "../../src/imp22-sizing/attribution.mjs";

export function syntheticGuard(projectedQuantity, remainingVolume) {
  if (projectedQuantity <= 0) return 0;
  return Math.min(projectedQuantity, remainingVolume);
}

// Los diseños contienen guardFunction (función de código versionado, no
// estado): structuredClone no admite funciones, así que clonamos datos
// profundo y conservamos las funciones por referencia.
export function deepCloneDesign(value) {
  if (Array.isArray(value)) return value.map(deepCloneDesign);
  if (value !== null && typeof value === "object") {
    const clone = {};
    for (const [key, item] of Object.entries(value)) {
      clone[key] = typeof item === "function" ? item : deepCloneDesign(item);
    }
    return clone;
  }
  return value;
}

export function gasMonthlyDesign() {
  return deepCloneDesign(EXPERIMENT_DESIGNS.find((design) => design.identity.experimentId === "IMP22-EX-SZ01-01"));
}

export function powerMonthlyDesign() {
  return deepCloneDesign(EXPERIMENT_DESIGNS.find((design) => design.identity.experimentId === "IMP22-EX-SZ02-01"));
}

// Reserva RESERVED de ejemplo para la Mission de un diseño: la frontera y el
// audit-scope existen antes de la calibración (DEP-12). Gas Monthly usa su
// minimum canónico (24 meses); no hay cobertura real acreditada aquí.
export function reservedStateFor(design) {
  const missionMinimum = design.identity.missionId.endsWith("QUARTERLY")
    ? { cadence: "QUARTERLY", minCompleteQuartersOos: 8, minCalendarYearsOos: 2 }
    : { cadence: "MONTHLY", minMonthsOos: 24 };
  design.reserve.minimumEvidence = missionMinimum;
  design.reserve.status = "RESERVED";
  design.reserve.split.boundary = "2026-08-31T23:59:59Z/chronological";
  return design;
}

export function candidateWithAudit(design) {
  const candidate = design.candidates[0];
  candidate.constraintStatus = "AUDITED";
  candidate.constraints.lotSizeAvailable = true;
  candidate.constraints.roundingRuleAvailable = true;
  candidate.constraints.deadlineRuleAvailable = true;
  candidate.constraints.unknownsDeclared = [];
  return design;
}

// Cadena completa de freeze aceptable: reserva previa (con frontera) +
// brazos paritarios + predeclaración antes de calibrar (DEP-12; §13.9).
export function frozenStateFor(design) {
  design.freeze = { preDeclaredBeforeParameterSelection: true, reserveStatusLocked: true };
  return design;
}

// Brazos sintéticos paritarios: todos comparten los contratos declarados;
// sólo difiere el rol del brazo (§13.9 paridad ex-ante).
export function attributionArmsFor(design, contractVersions) {
  const shared = {
    obligationId: `OB-SYNTH-${design.identity.missionId}`,
    deadline: "2027-03-31T23:59:59Z",
    opportunitiesSchedule: "SCHED-SYNTH-V1",
    executionContractVersion: contractVersions.executionContractVersion ?? "EXEC-SYNTH-V1",
    benchmarkBVersion: contractVersions.benchmarkBVersion ?? "B-SYNTH-V1",
    costLedgerVersion: "COST-SYNTH-V1",
    splitVersion: "SPLIT-SYNTH-V1",
  };
  design.attribution.arms = {};
  for (const armName of ATTRIBUTION_ARMS) {
    design.attribution.arms[armName] = { ...shared, description: `Descripción de arm ${armName}. Un arm se activa sólo con datos auditados de su Mission.` };
  }
  return design;
}
