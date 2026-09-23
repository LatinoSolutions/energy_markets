// Outcomes de admisión por rol y límite de autoridad. Fuente: SPEC v1.1
// §11.6.4 (ADMIT/HOLD/REJECT y su autoridad), §3.2/§3.3 (una etiqueta
// compartida no iguala contratos) y §11.6.3 (la evaluación inicial no concede
// autoridad productiva). El namespace `role_admission` ya está declarado en el
// contrato aceptado de IMP-01; se reutiliza read-only, sin editar su índice.

import { namespacesForLabel, resolveState } from "../contracts/states.mjs";

export const ROLE_ADMISSION_NAMESPACE = "role_admission";

export const ROLE_ADMISSION = Object.freeze({
  ADMIT: "ADMIT",
  HOLD: "HOLD",
  REJECT: "REJECT",
});

export const ROLE_ADMISSION_VALUES = Object.freeze(Object.keys(ROLE_ADMISSION));

// §11.6.4: un outcome de admisión por rol nunca sustituye PASS/HOLD/FAIL/
// INVALID del experimento, los run statuses ni los niveles de autonomía.
export const RESEARCH_VERDICT_NAMESPACE = "research_verdict";

function fail(code, message, details = {}) {
  return { ok: false, code, message, ...details };
}

export function resolveRoleAdmissionValue(value) {
  return resolveState(ROLE_ADMISSION_NAMESPACE, value);
}

// Lo que un outcome concede. ADMIT admite el rol dentro de su ámbito; ninguno
// otorga BUY/WAIT, órdenes, sizing, ejecución, governance, reward económico
// propio ni promoción de autonomía (§11.6.4).
export const ROLE_ADMISSION_AUTHORITY = Object.freeze({
  section: "§11.6.4",
  grants: Object.freeze({
    ADMIT: Object.freeze(["ROLE_SCOPED_ADMISSION"]),
    HOLD: Object.freeze([]),
    REJECT: Object.freeze([]),
  }),
  denies: Object.freeze([
    "BUY_WAIT_AUTHORITY",
    "ORDER_AUTHORITY",
    "SIZING_AUTHORITY",
    "PROCUREMENT_EXECUTION_AUTHORITY",
    "GOVERNANCE_AUTHORITY",
    "AUTONOMY_PROMOTION",
    "INDEPENDENT_ECONOMIC_REWARD",
  ]),
});

export function roleAdmissionAuthority(outcomeValue) {
  const resolved = resolveRoleAdmissionValue(outcomeValue);
  if (!resolved.ok) {
    return resolved;
  }
  return {
    ok: true,
    namespace: ROLE_ADMISSION_NAMESPACE,
    value: resolved.value,
    grants: ROLE_ADMISSION_AUTHORITY.grants[resolved.value],
    denies: ROLE_ADMISSION_AUTHORITY.denies,
  };
}

// La evaluación inicial no parte con autoridad alguna: lo concedido siempre
// empieza vacío y sólo un outcome explícito de ADMIT agrega elegibilidad de
// alcance de rol, nunca autoridad productiva (§11.6.3).
export function initialAuthorityGrant() {
  return Object.freeze([]);
}

export function hasProductiveAuthority() {
  return false;
}

// §3.3/§11.6.4: HOLD vive también en research_verdict y governance; se expone
// el namespace real de una etiqueta para detectar usos ambiguos.
export function namespacesClaimingRoleLabel(label) {
  return namespacesForLabel(label);
}

export function isRoleAdmissionLabel(label) {
  return ROLE_ADMISSION_VALUES.includes(label);
}