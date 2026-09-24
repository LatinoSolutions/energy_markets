// Typed blockers de la Oficina canónica (IMP-26). Fuente: SPEC v1.1.1 §20.2.11
// ("Los blockers conservan su significado... Un bloqueo afecta sólo a la rama
// dependiente; no detiene otro IMP elegible") y §20.2.4 (condiciones de
// elegibilidad).
//
// Un blocker tipado nunca sustituye un requisito abierto por una interpretación
// local, y su `branch` (IMP/scope afectado) limita el bloqueo a esa rama.

export const BLOCKER_KINDS = Object.freeze({
  NORMAL_DEPENDENCY: "NORMAL_DEPENDENCY",
  AUDIT_DEPENDENT: "AUDIT_DEPENDENT",
  EVIDENCE_DEPENDENT: "EVIDENCE_DEPENDENT",
  HUMAN_DECISION: "HUMAN_DECISION",
  SPEC_CONTRADICTION: "SPEC_CONTRADICTION",
  TOOL_PROVIDER_WORKER_FAILURE: "TOOL_PROVIDER_WORKER_FAILURE",
});

export const BLOCKER_KIND_VALUES = Object.freeze(Object.values(BLOCKER_KINDS));

export function isBlockerKind(kind) {
  return BLOCKER_KIND_VALUES.includes(kind);
}

// branch === null significa "afecta a cualquier rama" (p. ej. Project OFF).
export function createBlocker({ kind, branch = null, code, message, detail = null }) {
  if (!isBlockerKind(kind)) {
    return { ok: false, code: "INVALID_BLOCKER_KIND", message: `Tipo de blocker desconocido: ${kind}.` };
  }
  return {
    ok: true,
    blocker: Object.freeze({
      kind,
      branch: branch === null ? null : String(branch),
      code: code ?? kind,
      message: message ?? null,
      detail: detail ?? null,
    }),
  };
}

export function affectsBranch(blocker, branch) {
  if (blocker?.branch === null || blocker?.branch === undefined) return true;
  return blocker.branch === branch;
}

export function blockersForBranch(blockers, branch) {
  return (blockers ?? []).filter((blocker) => affectsBranch(blocker, branch));
}

export function hasBlockingFor(blockers, branch) {
  return blockersForBranch(blockers, branch).length > 0;
}
