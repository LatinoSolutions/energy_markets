// Lifecycle de admisión namespaced y su separación de data-readiness, run
// status, research verdict y autoridad. Fuente: SPEC v1.1 §8.7.3 (hitos),
// §8.7.4 (autoridad) y §3.2/§3.3 (una etiqueta compartida no iguala
// contratos). Los estados de admisión no sustituyen los namespaces de
// data-readiness, run status ni research verdict.

import { STATE_NAMESPACES, namespacesForLabel, resolveState } from "../contracts/states.mjs";

export const STRATEGY_LIFECYCLE_NAMESPACE = "strategy_lifecycle";
export const STRATEGY_ADMISSION_NAMESPACE = "strategy_admission";
export const RESEARCH_VERDICT_NAMESPACE = "research_verdict";

export const STRATEGY_LIFECYCLE = Object.freeze({
  PROPOSED: { section: "§8.7.3" },
  FORMALIZED: { section: "§8.7.3" },
  EXPERIMENT_READY: { section: "§8.7.3" },
  UNDER_TEST: { section: "§8.7.3" },
});

export const STRATEGY_ADMISSION = Object.freeze({
  NOT_ADMITTED: { section: "§8.7.3/§8.7.4" },
  ADMITTED_EVIDENCE_GENERATOR: { section: "§8.7.3/§8.7.4" },
});

// §8.7.3: el proceso distingue hitos equivalentes a esta secuencia. Cada hito
// queda en su namespace: los cuatro primeros en strategy_lifecycle, el
// veredicto en research_verdict y la admisión en strategy_admission. No se
// aplanan a una única escala.
export const MILESTONE_SEQUENCE = Object.freeze([
  Object.freeze({ milestone: "PROPOSED", namespace: STRATEGY_LIFECYCLE_NAMESPACE, value: "PROPOSED" }),
  Object.freeze({ milestone: "FORMALIZED", namespace: STRATEGY_LIFECYCLE_NAMESPACE, value: "FORMALIZED" }),
  Object.freeze({ milestone: "EXPERIMENT-READY", namespace: STRATEGY_LIFECYCLE_NAMESPACE, value: "EXPERIMENT_READY" }),
  Object.freeze({ milestone: "UNDER TEST", namespace: STRATEGY_LIFECYCLE_NAMESPACE, value: "UNDER_TEST" }),
  Object.freeze({
    milestone: "PASS / HOLD / FAIL / INVALID",
    namespace: RESEARCH_VERDICT_NAMESPACE,
    values: STATE_NAMESPACES.research_verdict.values,
  }),
  Object.freeze({
    milestone: "ADMITTED EVIDENCE GENERATOR",
    namespace: STRATEGY_ADMISSION_NAMESPACE,
    value: "ADMITTED_EVIDENCE_GENERATOR",
  }),
]);

// Transiciones deterministas entre hitos de lifecycle. El veredicto y la
// admisión no son transiciones de lifecycle: se registran por separado.
const ALLOWED_LIFECYCLE_TRANSITIONS = Object.freeze({
  PROPOSED: Object.freeze(["FORMALIZED"]),
  FORMALIZED: Object.freeze(["EXPERIMENT_READY"]),
  EXPERIMENT_READY: Object.freeze(["UNDER_TEST"]),
  UNDER_TEST: Object.freeze([]),
});

function fail(code, message, details = {}) {
  return { ok: false, code, message, ...details };
}

export function resolveLifecycleValue(value) {
  if (typeof value !== "string" || !Object.prototype.hasOwnProperty.call(STRATEGY_LIFECYCLE, value)) {
    return fail("UNKNOWN_LIFECYCLE_VALUE", `"${value}" no es un hito de lifecycle de §8.7.3.`, {
      allowedValues: Object.keys(STRATEGY_LIFECYCLE),
    });
  }
  return { ok: true, namespace: STRATEGY_LIFECYCLE_NAMESPACE, value, section: "§8.7.3" };
}

export function resolveAdmissionValue(value) {
  if (typeof value !== "string" || !Object.prototype.hasOwnProperty.call(STRATEGY_ADMISSION, value)) {
    return fail("UNKNOWN_ADMISSION_VALUE", `"${value}" no es un estado de admisión de §8.7.3/§8.7.4.`, {
      allowedValues: Object.keys(STRATEGY_ADMISSION),
    });
  }
  return { ok: true, namespace: STRATEGY_ADMISSION_NAMESPACE, value, section: "§8.7.3/§8.7.4" };
}

// Resuelve una situación de proceso declarada (§8.7.2 "Admission status") sin
// permitir un label ambiguo sin namespace. Acepta lifecycle y admisión; el
// veredicto se resuelve aparte para no confundir proceso con resultado.
export function resolveAdmissionStatus(namespace, value) {
  if (namespace === STRATEGY_LIFECYCLE_NAMESPACE) {
    return resolveLifecycleValue(value);
  }
  if (namespace === STRATEGY_ADMISSION_NAMESPACE) {
    return resolveAdmissionValue(value);
  }
  return fail("UNKNOWN_ADMISSION_STATUS_NAMESPACE", `Namespace de situación de proceso desconocido: "${namespace}".`, {
    allowedNamespaces: [STRATEGY_LIFECYCLE_NAMESPACE, STRATEGY_ADMISSION_NAMESPACE],
  });
}

export function resolveMilestoneStatus(namespace, value) {
  if (namespace === STRATEGY_LIFECYCLE_NAMESPACE) {
    return resolveLifecycleValue(value);
  }
  if (namespace === STRATEGY_ADMISSION_NAMESPACE) {
    return resolveAdmissionValue(value);
  }
  if (namespace === RESEARCH_VERDICT_NAMESPACE) {
    return resolveState(RESEARCH_VERDICT_NAMESPACE, value);
  }
  return fail("UNKNOWN_MILESTONE_NAMESPACE", `Namespace de hito desconocido: "${namespace}".`, {
    allowedNamespaces: [STRATEGY_LIFECYCLE_NAMESPACE, STRATEGY_ADMISSION_NAMESPACE, RESEARCH_VERDICT_NAMESPACE],
  });
}

export function nextLifecycleStages(value) {
  return ALLOWED_LIFECYCLE_TRANSITIONS[value] ?? [];
}

export function canTransition(from, to) {
  return nextLifecycleStages(from).includes(to);
}

// Una referencia de prerequisite puede ser un string no vacío o un objeto con
// `ref`/`id`/`reference` no vacío que no declare no satisfacción. El framework
// no decide verdad factual: rechaza las formas que no pueden representar un
// prerequisite satisfecho (false, null, vacíos, `satisfied:false`, etc.).
function isSatisfiedPrerequisite(value) {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const ref = value.ref ?? value.id ?? value.reference;
  if (typeof ref !== "string" || ref.trim().length === 0) {
    return false;
  }
  if (value.satisfied === false || value.met === false) {
    return false;
  }
  if (typeof value.status === "string" && /UNSATISFIED|NOT_SATISFIED|PENDING|FAILED/i.test(value.status)) {
    return false;
  }
  return true;
}

// §8.7.3 EXPERIMENT-READY: "no basta completar nominalmente un formulario".
// Por eso la transición exige prerequisites aplicables satisfechos y su
// evidencia; completar los campos del contrato no es suficiente.
export function validateExperimentReadiness(context) {
  const errors = [];
  if (!context || typeof context !== "object") {
    return fail("MISSING_READINESS_CONTEXT", "La transición a EXPERIMENT_READY exige contexto de readiness explícito.", {
      errors: [
        {
          field: "readiness",
          code: "MISSING_READINESS",
          message: "Completar nominalmente el contrato no demuestra experiment readiness (§8.7.3).",
        },
      ],
    });
  }

  const prerequisites = context.prerequisitesSatisfied;
  if (!Array.isArray(prerequisites) || prerequisites.length === 0) {
    errors.push({
      field: "prerequisitesSatisfied",
      code: "MISSING_PREREQUISITES",
      message: "EXPERIMENT-READY exige prerequisites aplicables realmente satisfechos, no sólo campos completos.",
    });
  } else {
    // §8.7.3: el framework valida la FORMA de cada prerequisite, no su verdad
    // factual (eso lo aporta la verificación externa citada). Un `false`, un
    // nulo, una referencia vacía o una declaración explícita de no
    // satisfacción no cuentan como prerequisite satisfecho.
    prerequisites.forEach((prerequisite, index) => {
      if (!isSatisfiedPrerequisite(prerequisite)) {
        errors.push({
          field: `prerequisitesSatisfied[${index}]`,
          code: "UNSATISFIED_PREREQUISITE",
          message: "Cada prerequisite debe ser una referencia no vacía o un objeto que no declare no satisfacción.",
        });
      }
    });
  }

  const evidenceRefs = context.readinessEvidence;
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) {
    errors.push({
      field: "readinessEvidence",
      code: "MISSING_READINESS_EVIDENCE",
      message: "EXPERIMENT-READY exige evidencia de readiness; la afirmación del worker no basta.",
    });
  }

  return { ok: errors.length === 0, errors };
}

// §8.7.4: la admisión sólo convierte la Strategy en Evidence Generator. No
// concede BUY/WAIT, órdenes, sizing ni reward económico independiente.
export const ADMISSION_AUTHORITY = Object.freeze({
  section: "§8.7.4",
  grants: Object.freeze(["EVIDENCE_GENERATOR_FOR_GLOBAL_CANDIDATE_POLICY"]),
  denies: Object.freeze(["BUY_WAIT_AUTHORITY", "ORDER_AUTHORITY", "SIZING_AUTHORITY", "INDEPENDENT_ECONOMIC_REWARD"]),
});

// Un veredicto PASS nunca admite por sí mismo: sin una decisión de admisión
// explícita el resultado es NOT_ADMITTED.
export function resolveAdmissionFromVerdict() {
  return { namespace: STRATEGY_ADMISSION_NAMESPACE, value: "NOT_ADMITTED" };
}

// Prueba de no-aplanamiento: cuántos namespaces distintos contienen una
// etiqueta. PASS sólo vive en research_verdict; DATA_BLOCKED/HOLD son
// ambiguos y exigen namespace explícito.
export function namespacesClaimingLabel(label) {
  return namespacesForLabel(label);
}
