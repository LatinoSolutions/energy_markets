// Paridad de contabilidad para los experimentos de IMP-20. Fuente: SPEC v1.1.1
// §25.1 fila IMP-20 ("valor marginal y redundancia medidos con misma
// contabilidad"), §8.6 ("comparaciones preservan obligación, baseline,
// oportunidades, ejecución y evaluator compatibles con el experimento"),
// §10.1/§10.2 (un solo reward global; Contribution_i con el mismo contrato
// experimental), §13.9 (A0 vs A1 con condiciones idénticas) y §19 (gates de
// comparabilidad). El núcleo aceptado de IMP-16 es el comparator: se
// referencia su evidencia (DEP-13/14) en modo read-only, sin copiar números.

export const ACCOUNTING_FIELDS = Object.freeze([
  { key: "benchmarkIdentity", specCitation: "§5 / §8.6 baseline B compartido usado por todas las arms" },
  { key: "controllerAndSizing", specCitation: "§13.4/P5.2 population+controller compartidos; el controller no es la capa ensayada" },
  { key: "executionContract", specCitation: "§13.6/P5.6 execution and cost parity auditado y aplicado idénticamente a todas las arms" },
  { key: "evaluatorIdentity", specCitation: "§14/§19.1 evaluator/suite P6 probada, reproducible; el evaluator no entrena ni arregla diseño" },
  { key: "oosFrontier", specCitation: "§15/§25.2 (reserva OOS intacta; ningún refit ni re-consumo por la capa nueva)" },
  { key: "rewardIdentity", specCitation: "§10.1 ONE GLOBAL PROCUREMENT REWARD; no existen rewards económicos independientes por capa" },
]);

export const COMPARATOR_RULE = {
  specCitation: "§25.2 IMP-20 REQUIRES_EVIDENCE: evidencia previa disponible del núcleo (resultado y límites de IMP-16) como comparator; no exige DEP-15/16 demostradas",
  semantics:
    "El comparator de cada experimento es la evidencia previa conservada del núcleo: la identidad de la versión P5 ensayada de IMP-16 (DEP-13/14: resultado A0/A1, Delta V, métricas, verdict y límites), consumida read-only. El diseño no redeclara, no reescribe ni amplía ese resultado.",
};

const KNOWN_ACCOUNTING_KEYS = ACCOUNTING_FIELDS.map((field) => field.key);

// Cada arm del experimento debe declarar contabilidad idéntica. Un arm sin
// paridad declarada, o con un campo distinto a otro arm, contamina la
// comparación y se rechaza fail-closed.
export function validateAccountingParity(arms, accountingIdentity) {
  const errors = [];

  if (accountingIdentity === undefined || accountingIdentity === null) {
    for (const field of KNOWN_ACCOUNTING_KEYS) {
      errors.push({
        field: `accountingIdentity.${field}`,
        code: "MISSING_ACCOUNTING",
        message: `Falta la identidad de contabilidad "${field}" (${ACCOUNTING_FIELDS.find((f) => f.key === field).specCitation}).`,
      });
    }
    return { ok: false, errors };
  }

  for (const field of KNOWN_ACCOUNTING_KEYS) {
    if (accountingIdentity?.[field] === undefined || accountingIdentity?.[field] === null) {
      errors.push({
        field: `accountingIdentity.${field}`,
        code: "MISSING_ACCOUNTING",
        message: `Falta la identidad de contabilidad "${field}" (${ACCOUNTING_FIELDS.find((f) => f.key === field).specCitation}).`,
      });
    }
  }

  // 'unknown' es la única forma de dejar un campo sin valor definitivo:
  // los desconocidos deben verse, nunca disimularse.
  for (const field of KNOWN_ACCOUNTING_KEYS) {
    const value = accountingIdentity?.[field];
    if (value !== undefined && value !== null && typeof value !== "string") {
      errors.push({
        field: `accountingIdentity.${field}`,
        code: "INVALID_ACCOUNTING",
        message: `La identidad de contabilidad "${field}" debe declararse como referencia explícita (texto o "UNKNOWN" con su desconocido registrado).`,
      });
    }
  }

  if (!Array.isArray(arms) || arms.length < 2) {
    errors.push({
      field: "arms",
      code: "MISSING_ARMS",
      message: "Un experimento predeclarado necesita al menos dos arms con paridad de contabilidad (§8.6).",
    });
    return { ok: false, errors };
  }

  for (const arm of arms) {
    if (arm?.accounting !== undefined && arm.accounting !== accountingIdentity) {
      errors.push({
        field: "arms[].accounting",
        code: "ACCOUNTING_PARITY_BROKEN",
        message: "Un arm que declara su contabilidad debe usar exactamente la misma identidad compartida del experimento; una comparación con contabilidad distinta no se interpreta (§8.6, §13.9, §15).",
      });
      break;
    }
  }

  return { ok: errors.length === 0, errors };
}

export const MARGINAL_VALUE_DECLARATION = Object.freeze({
  specCitation: "§10.2 / §25.1 fila IMP-20",
  method:
    "Contribution_i = R_full − R_without_i sobre el mismo reward global y la misma contabilidad; Delta V entre arms declaradas ex-ante; refutation según P5.7/§5.8 aplicada al experimento (FAIL se conserva, sin capas de rescate §13.9).",
  limit:
    "Un buen outcome no acredita automáticamente a todas las Strategies activas ni concede admisión; la admisión sigue §8.7 con su ciclo y evidencia (§10.2, UNLOCKS IMP-20).",
});

export const REDUNDANCY_DECLARATION = Object.freeze({
  specCitation: "§25.1 fila IMP-20 (redundancia con misma contabilidad); §8.4/§8.6 (Probar redundancia con Dynamic Mode)",
  method:
    "Cada capa/representación ensayada declara su redundancia/overlap frente a las capas ya admitidas del núcleo y frente a las demás capas del experimento (P4/podas por ablation), sin atribuir todo resultado positivo a todas las señales (§10.2).",
});
