// Elegibilidad de IMPs canónicos (IMP-26). Fuente: SPEC v1.1.1 §20.2.4
// ("Un IMP es elegible únicamente cuando se cumplen conjuntamente las
// condiciones aplicables") y §25.2.1/§25.2.2 (REQUIRES* consumidos vs
// RESOLVES_AUDIT/PRODUCES_EVIDENCE producidos).
//
// Regla dura: SÓLO REQUIRES* restringe el inicio. RESOLVES_AUDIT y
// PRODUCES_EVIDENCE del propio IMP pueden estar abiertos al comenzar (§20.2.3)
// y nunca bloquean. Un faltante no se sustituye por placeholder.

import { BLOCKER_KINDS, createBlocker } from "./blockers.mjs";
import { getImp, normalizeImpId } from "./canonical-graph.mjs";

export function acceptedImpSet(acceptedInstances) {
  const set = new Set();
  for (const instance of acceptedInstances ?? []) {
    const id = normalizeImpId(instance?.imp);
    if (id) set.add(id);
  }
  return set;
}

function normalizeLabel(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

// §25.2.1 (líneas 2191/2195): instancia de ejecución = SPEC + IMP + scope +
// versión del objeto/protocolo; no se denomina instancia nueva al mismo
// trabajo accepted para reabrirlo. Comparar menos es fail-closed: si la
// instancia declara menos campos que una accepted de igual scope/versión,
// la identidad no es verificable y NO cuenta como nueva.
export function sameInstance(left, right) {
  if (!left || !right) return false;
  const scope = normalizeLabel(left.scope);
  const version = normalizeLabel(left.version);
  const protocol = normalizeLabel(left.objectProtocolVersion ?? left.protocol);
  if (!scope || !version) return false;
  const sameScope = normalizeLabel(right.scope) === scope;
  const sameVersion = normalizeLabel(right.version) === version;
  const sameProtocol = normalizeLabel(right.objectProtocolVersion ?? right.protocol) === protocol;
  return sameScope && sameVersion && sameProtocol;
}

function sameScopeAndVersion(left, right) {
  if (!left || !right) return false;
  const scope = normalizeLabel(left.scope);
  const version = normalizeLabel(left.version);
  if (!scope || !version) return false;
  return normalizeLabel(right.scope) === scope && normalizeLabel(right.version) === version;
}

export function isNewInstance(instance, acceptedInstancesOfImp) {
  if (!instance?.scope || !instance?.version) return false;
  const protocolDeclared = normalizeLabel(instance.objectProtocolVersion ?? instance.protocol) !== "";
  for (const accepted of acceptedInstancesOfImp ?? []) {
    if (!sameScopeAndVersion(instance, accepted)) continue;
    // Mismo scope/versión que una accepted: sin protocolo declarado la
    // identidad es incompleta → no verificable → no nueva (fail-closed).
    if (!protocolDeclared || sameInstance(instance, accepted)) return false;
  }
  return true;
}

function blocker(kind, code, message, branch, detail = null) {
  return createBlocker({ kind, code, message, branch, detail }).blocker;
}

// §20.2.4: resuelve elegibilidad y devuelve blockers tipados. `concreteScope`
// declara que el trabajo instancia el scope concreto de una fila condicional;
// sin él, los requisitos condicionales no se exigen automáticamente.
export function evaluateEligibility({
  graph,
  impId,
  projectOn,
  acceptedInstances = [],
  instance = null,
  concreteScope = false,
  auditSatisfied = [],
  evidenceSatisfied = [],
  openSpecChangeRequests = [],
  humanGates = [],
}) {
  const id = normalizeImpId(impId);
  if (!id) {
    return { eligible: false, imp: null, blockers: [blocker(BLOCKER_KINDS.NORMAL_DEPENDENCY, "CANONICAL_ID_MISSING", "El trabajo no referencia un IMP canónico.", null)], notes: [] };
  }
  // (1) Project ON bajo el mecanismo existente.
  if (!projectOn) {
    return { eligible: false, imp: id, blockers: [blocker(BLOCKER_KINDS.NORMAL_DEPENDENCY, "PROJECT_OFF", "El proyecto no está ON: ningún dispatch es elegible (§20.2.4.1).", null)], notes: [] };
  }
  // (2) El IMP existe en la SPEC canónica vigente.
  const row = getImp(graph, id);
  if (!row) {
    return { eligible: false, imp: id, blockers: [blocker(BLOCKER_KINDS.NORMAL_DEPENDENCY, graph ? "CANONICAL_ID_UNKNOWN" : "CANONICAL_GRAPH_ABSENT", graph ? `${id} no existe en el grafo canónico.` : "No hay grafo canónico vinculado.", id)], notes: [] };
  }
  const notes = row.conditional ? ["fila condicional: Command decide el scope concreto (framework/validación/procedencia)"] : [];
  // (3) La instancia de ejecución todavía no está accepted.
  const accepted = acceptedImpSet(acceptedInstances);
  if (accepted.has(id)) {
    const instancesOfImp = (acceptedInstances ?? []).filter((entry) => normalizeImpId(entry?.imp) === id);
    if (!instance || !isNewInstance(instance, instancesOfImp)) {
      return { eligible: false, imp: id, blockers: [blocker(BLOCKER_KINDS.NORMAL_DEPENDENCY, "IMP_ALREADY_ACCEPTED", `${id} ya está accepted para esa instancia; no se reinicia un receipt aceptado (§20.2.4.3).`, id)], notes };
    }
    notes.push(`instancia nueva de ${id} aceptado (scope/versión declarados)`);
  }
  // (4) REQUIRES normales satisfechos (más los condicionales si hay scope concreto).
  const required = concreteScope ? [...row.requires, ...row.conditionalRequires] : row.requires;
  const missingRequires = required.filter((requiredId) => !accepted.has(requiredId));
  if (missingRequires.length > 0) {
    return { eligible: false, imp: id, blockers: [blocker(BLOCKER_KINDS.NORMAL_DEPENDENCY, "REQUIRES_MISSING", `${id} requiere IMPs aceptados que faltan: ${missingRequires.join(", ")}.`, id, { missing: missingRequires })], notes };
  }
  // (5) REQUIRES_AUDIT genuinamente satisfechos.
  const auditSet = new Set(auditSatisfied ?? []);
  const missingAudit = (row.requiresAuditDeps ?? []).filter((dep) => !auditSet.has(dep));
  if (missingAudit.length > 0) {
    return { eligible: false, imp: id, blockers: [blocker(BLOCKER_KINDS.AUDIT_DEPENDENT, "REQUIRED_AUDIT_MISSING", `${id} consume auditoría no satisfecha: ${missingAudit.join(", ")}.`, id, { missing: missingAudit })], notes };
  }
  // (6) REQUIRES_EVIDENCE con evidencia real.
  const evidenceSet = new Set(evidenceSatisfied ?? []);
  const missingEvidence = (row.requiresEvidenceDeps ?? []).filter((dep) => !evidenceSet.has(dep));
  if (missingEvidence.length > 0) {
    return { eligible: false, imp: id, blockers: [blocker(BLOCKER_KINDS.EVIDENCE_DEPENDENT, "REQUIRED_EVIDENCE_MISSING", `${id} consume evidencia no disponible: ${missingEvidence.join(", ")}.`, id, { missing: missingEvidence })], notes };
  }
  // (7) RESOLVES_AUDIT / PRODUCES_EVIDENCE propios pueden estar abiertos: no bloquean.
  // (8) Ningún SPEC_CHANGE_REQUEST sin resolver bloquea esa rama.
  const openScr = (openSpecChangeRequests ?? []).filter((request) => request?.resolved !== true && (request?.branch === null || request?.branch === undefined || request?.branch === id));
  if (openScr.length > 0) {
    return { eligible: false, imp: id, blockers: [blocker(BLOCKER_KINDS.SPEC_CONTRADICTION, "SPEC_CHANGE_REQUEST_OPEN", `${id} tiene un SPEC_CHANGE_REQUEST sin resolver (§20.2.12).`, id, { refs: openScr.map((request) => request?.id ?? null) })], notes };
  }
  // (9) Ningún human gate aplicable bloquea la ejecución.
  const gates = (humanGates ?? []).filter((gate) => gate?.branch === null || gate?.branch === undefined || gate?.branch === id);
  if (gates.length > 0) {
    return { eligible: false, imp: id, blockers: [blocker(BLOCKER_KINDS.HUMAN_DECISION, "HUMAN_GATE", `${id} está bloqueado por una decisión humana aplicable.`, id, { refs: gates.map((gate) => gate?.ref ?? null) })], notes };
  }
  return { eligible: true, imp: id, blockers: [], notes };
}

// IMPs canónicos elegibles (excluye accepted). Orden canónico (id ascendente).
export function eligibleImps(options) {
  const { graph, acceptedInstances = [] } = options;
  const accepted = acceptedImpSet(acceptedInstances);
  const rows = graph?.imps ? Object.values(graph.imps) : [];
  return rows
    .filter((row) => !accepted.has(row.id))
    .map((row) => ({ row, result: evaluateEligibility({ ...options, impId: row.id }) }))
    .filter(({ result }) => result.eligible)
    .map(({ row, result }) => ({ id: row.id, conditional: row.conditional, requires: row.requires, conditionalRequires: row.conditionalRequires, objective: row.objective, notes: result.notes }))
    .sort((left, right) => left.id.localeCompare(right.id));
}
