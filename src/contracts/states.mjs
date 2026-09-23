// Contrato de estados separados por namespace. Fuente: SPEC v1.1 §0.3
// (seis estados de madurez; scope y materialización son clasificaciones
// aparte), §3.2 (veredicto de research, availability), §11.6.4 (admisión por
// rol), §14.10 (run statuses), §18.4 (transiciones de governance) y
// §§20.2.7–20.2.10 (receipts). Compartir una etiqueta no iguala contratos.

export const STATE_NAMESPACES = {
  // §0.3 define exactamente seis estados de madurez. OUT OF CURRENT SCOPE y
  // IMPLEMENTATION DETAIL no son un séptimo estado: tienen namespace propio.
  concept_maturity: {
    section: "§0.3",
    values: [
      "CANONICAL_FROZEN",
      "IMPLEMENTATION_READY",
      "AUDIT_DEPENDENT",
      "EVIDENCE_DEPENDENT",
      "BLOCKED",
      "OPEN_DECISION",
    ],
  },
  scope_classification: {
    section: "§0.3",
    values: ["OUT_OF_CURRENT_SCOPE"],
  },
  materialization_classification: {
    section: "§0.3",
    values: ["IMPLEMENTATION_DETAIL"],
  },
  run_validity: {
    section: "§14.10",
    values: [
      "VALID_RUN",
      "DATA_BLOCKED",
      "COVERAGE_INCOMPLETE",
      "BENCHMARK_PROVISIONAL",
      "INVALID_RUN",
    ],
  },
  data_readiness: {
    section: "§6.3/§3.2",
    values: ["DATA_READY", "DATA_PROVISIONAL", "FORWARD_ONLY", "DATA_BLOCKED"],
  },
  data_availability: {
    section: "§3.2",
    values: ["AVAILABLE_NOW", "FORWARD_CAPTURE", "PROXY", "UNAVAILABLE"],
  },
  research_verdict: {
    section: "§3.2/§5.8",
    values: ["PASS", "HOLD", "FAIL", "INVALID"],
  },
  // §11.6.4: outcomes de admisión por rol externo; no sustituyen
  // PASS/HOLD/FAIL/INVALID, run statuses ni niveles de autonomía.
  role_admission: {
    section: "§11.6.4",
    values: ["ADMIT", "HOLD", "REJECT"],
  },
  // §18.4 verbatim: PROMOTE, HOLD, DEMOTE, HALT y ROLLBACK.
  governance_event: {
    section: "§18.4",
    values: ["PROMOTE", "HOLD", "DEMOTE", "HALT", "ROLLBACK"],
  },
  receipt_kind: {
    section: "§20.2.7–§20.2.10/§14.9",
    values: ["WORK_PACKET", "ST_RECEIPT", "IMP_RECEIPT", "RUN_RECEIPT"],
  },
};

function fail(code, message, details = {}) {
  return { ok: false, code, message, ...details };
}

// Valida un estado dentro de su namespace. El mismo label en otro namespace
// es válido: los estados no se aplanan a una única escala.
export function resolveState(namespace, value) {
  const declared = STATE_NAMESPACES[namespace];
  if (!declared) {
    return fail("UNKNOWN_STATE_NAMESPACE", `Namespace de estado desconocido: "${namespace}".`, {
      allowedNamespaces: Object.keys(STATE_NAMESPACES),
    });
  }

  if (typeof value !== "string" || value.length === 0) {
    return fail("MISSING_STATE_VALUE", `Falta el valor para el namespace "${namespace}".`);
  }

  if (!declared.values.includes(value)) {
    return fail("UNKNOWN_STATE_VALUE", `"${value}" no pertenece al namespace "${namespace}".`, {
      namespace,
      allowedValues: declared.values,
    });
  }

  return { ok: true, canonicalId: `${namespace}:${value}`, namespace, value };
}

// Devuelve los namespaces que contienen un label compartido. Sirve para
// detectar usos ambiguos de etiquetas como DATA_BLOCKED o HOLD.
export function namespacesForLabel(label) {
  return Object.entries(STATE_NAMESPACES)
    .filter(([, declaration]) => declaration.values.includes(label))
    .map(([namespace, declaration]) => ({ namespace, section: declaration.section }));
}

// Verifica que un conjunto de `{ namespace, value }` no haya sido colapsado:
// exige que cada estado declare su namespace y que no se use un label ambiguo
// sin él cuando aparece en más de un namespace.
export function validateStateClaims(claims) {
  const errors = [];
  for (const claim of claims ?? []) {
    const outcome = resolveState(claim?.namespace, claim?.value);
    if (!outcome.ok) {
      errors.push(outcome);
    }
  }
  return { ok: errors.length === 0, errors };
}