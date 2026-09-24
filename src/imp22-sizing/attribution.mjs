// Atribución timing vs tamaño (§25.1 aceptación IMP-22; §13.7 identidad).
// Cada brazo comparte obligación, deadline, oportunidades, controller (§13.2),
// ejecución/costes (§13.6) y benchmark propio de la Mission. El cálculo es
// puro: no decide admisión ni promoción; produce componentes de Delta V para
// el veredicto del experimento versionado.

// Los cuatro brazos del diseño de atribución, todos sobre la misma Mission.
//  - baseline: calendar A0 + controller homogéneo (P5.2 aplicado a la Mission)
//  - timingOnly: cambia BUY/WAIT; sizing fijo en el controller
//  - sizingOnly: cambia sizing; timing fijo en calendar A0
//  - timingAndSizing: cambia ambos
export const ATTRIBUTION_ARMS = ["baseline", "timingOnly", "sizingOnly", "timingAndSizing"];

export function attributeTimingVsetSize(armValues) {
  const missing = ATTRIBUTION_ARMS.filter((arm) => typeof armValues?.[arm] !== "number" || !Number.isFinite(armValues[arm]));
  if (missing.length > 0) {
    return {
      computable: false,
      status: "HOLD",
      missingArms: missing,
      reason: `Valores V ausentes o no finitos para brazos: ${missing.join(", ")}; sin validez suficiente no se interpreta (§13.7 HOLD).`,
    };
  }

  // ΔV = V_variante − V_baseline = H_baseline − H_variante (§13.7); los V
  // que recibe esta función ya deben venir calculados con el B propio de la
  // Mission y costes dentro de H.
  const baselineValue = armValues.baseline;
  const timingOnlyValue = armValues.timingOnly;
  const sizingOnlyValue = armValues.sizingOnly;
  const timingAndSizingValue = armValues.timingAndSizing;

  const totalDeltaQ = timingAndSizingValue - baselineValue;
  const timingComponent = timingOnlyValue - baselineValue;
  const sizingComponentAtBaseline = sizingOnlyValue - baselineValue;
  const sizingComponentUnderTiming = timingAndSizingValue - timingOnlyValue;
  const timingComponentUnderSizing = timingAndSizingValue - sizingOnlyValue;

  const interactionResidue = timingComponent - timingComponentUnderSizing;

  return {
    computable: true,
    status: "COMPUTED",
    totalDeltaQ,
    timingComponent,
    sizingComponentAtBaseline,
    sizingComponentUnderTiming,
    timingComponentUnderSizing,
    interactionResidue,
    identityCitation: "§13.7 Delta V; componentes por pares de brazos que comparten controller/calendar (§13.2/§13.5).",
  };
}

// Un mismo par de brazos no puede compararse si cambia algún componente
// compartido; la paridad se declara ex-ante y se verifica por indentidad de
// contratos, no por outcome (§13.9).
// Un mismo par de brazos no puede compararse si cambia algún componente
// compartido; la paridad se declara ex-ante y se verifica por identidad de
// contratos, no por outcome (§13.9). El par executionContract/costLedger lo
// decide el contrato aceptado de ejecución (IMP-07): delegamos en
// assertArmParity los dos campos que ese contrato ya regula (§13.6 regla 3)
// en vez de re-implementarlos (Ref: hallazgo IMP22-H6).
import { assertArmParity } from "../execution-contract/execution-contract.mjs";

const PARITY_KEYS = ["obligationId", "deadline", "opportunitiesSchedule", "benchmarkBVersion", "splitVersion"];

export function validateArmParity(arms) {
  const errors = [];

  for (const armName of ATTRIBUTION_ARMS) {
    const arm = arms?.[armName];
    if (arm == null || typeof arm !== "object") {
      errors.push({ field: `arms.${armName}`, code: "ARM_MISSING", message: `Brazo ${armName} requerido para la atribución.` });
      continue;
    }
    for (const key of PARITY_KEYS) {
      if (typeof arm[key] !== "string" || arm[key].trim() === "") {
        errors.push({
          field: `arms.${armName}.${key}`,
          code: "PARITY_FIELD_REQUIRED",
          message: `Cada brazo debe declarar su ${key} identical entre brazos (§13.9 paridad).`,
        });
      }
    }
  }

  // Paridad de execution contract y cost ledger bajo el contrato aceptado
  // del IMP-07 (cada brazo vs baseline; §13.6 regla 3).
  if (arms?.baseline != null) {
    for (const armName of ATTRIBUTION_ARMS) {
      if (armName === "baseline") continue;
      const pairwise = assertArmParity({ a0: arms.baseline, a1: arms[armName] });
      for (const error of pairwise.errors) {
        errors.push({ field: `arms.${armName}.${error.field}`, code: error.code, message: error.message });
      }
    }
  }

  const identical = (key) => ATTRIBUTION_ARMS.every((armName) => arms?.[armName]?.[key] === arms?.baseline?.[key]);
  for (const key of PARITY_KEYS) {
    if (arms != null && !identical(key)) {
      errors.push({
        field: `arms.*.${key}`,
        code: "PARITY_VIOLATION",
        message: `Paridad violada: ${key} difiere del baseline entre brazos; la comparación sería INVALID (§13.6/§13.9).`,
      });
    }
  }

  return { ok: errors.length === 0, errors };
}
