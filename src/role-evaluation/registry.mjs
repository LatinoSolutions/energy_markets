// Registro de evaluación por componente/rol. Fuente: SPEC v1.1 §11.6.1
// (cuatro clases), §11.6.2 (contrato e identidad), §11.6.3 (evaluación sin
// autoridad) y §11.6.4 (outcomes independientes por rol). Es un proceso local
// sin dependencias: no evalúa componentes reales, no compara empíricamente, no
// integra nada y no concede autoridad productiva. El framework de IMP-27 se
// referencia sólo como gate externo del rol Strategy/Evidence, sin importar su
// código ni editarlo.

import { isVersionLike, isSha256 } from "../contracts/identities.mjs";
import { validateRoleEvaluation } from "./contract.mjs";
import {
  ROLE_ADMISSION_NAMESPACE,
  hasProductiveAuthority,
  initialAuthorityGrant,
  resolveRoleAdmissionValue,
  roleAdmissionAuthority,
} from "./outcomes.mjs";
import { resolveRoleClass, roleRequiresSeparateAuthorityValidation, roleRequiresStrategyAdmissionGate, validateValueClaimDomain } from "./roles.mjs";

export const EVALUATION_STATE = Object.freeze({
  REGISTERED: "REGISTERED",
  EVALUATION_READY: "EVALUATION_READY",
  OUTCOME_RECORDED: "OUTCOME_RECORDED",
});

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
  }
  return value;
}

function fail(code, message, details = {}) {
  return { ok: false, code, message, ...details };
}

function recordKey(componentId, roleClass) {
  return `${componentId}::${roleClass}`;
}

function versionKey(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return `hash:${value.contentHash}`;
  }
  return `version:${value}`;
}

// Una referencia de evidencia se liga a un artefacto trazable; sin kind/ref no
// puede sostener un gate ni un outcome (§11.6.2/§11.6.4).
export function validateEvidenceRef(evidenceRef) {
  const errors = [];
  if (!evidenceRef || typeof evidenceRef !== "object" || Array.isArray(evidenceRef)) {
    return { ok: false, errors: [{ field: "evidenceRef", code: "INVALID_EVIDENCE_REF", message: "Evidence ref ausente o no es objeto." }] };
  }
  if (!isNonEmptyString(evidenceRef.kind)) {
    errors.push({ field: "evidenceRef.kind", code: "MISSING_EVIDENCE_KIND", message: "Evidence ref sin kind." });
  }
  if (!isNonEmptyString(evidenceRef.ref)) {
    errors.push({ field: "evidenceRef.ref", code: "MISSING_EVIDENCE_REF", message: "Evidence ref sin referencia." });
  }
  if (evidenceRef.sha256 !== undefined && !isSha256(evidenceRef.sha256)) {
    errors.push({ field: "evidenceRef.sha256", code: "INVALID_SHA256", message: "evidenceRef.sha256 malformado." });
  }
  return { ok: errors.length === 0, errors };
}

function validateEvidenceList(evidenceRefs, label) {
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) {
    return {
      ok: false,
      code: "MISSING_EVIDENCE",
      message: `${label}: se exige evidencia real, no una afirmación.`,
      errors: [{ field: "evidenceRefs", code: "MISSING_EVIDENCE", message: `${label}: se exige evidencia real, no una afirmación.` }],
    };
  }
  const errors = [];
  for (const evidenceRef of evidenceRefs) {
    const outcome = validateEvidenceRef(evidenceRef);
    if (!outcome.ok) {
      errors.push(...outcome.errors);
    }
  }
  if (errors.length > 0) {
    return { ok: false, code: "INVALID_EVIDENCE", message: `${label}: evidencia malformada.`, errors };
  }
  return { ok: true, errors: [] };
}

// La evidencia se clona antes de congelarla: el registro no congela objetos del
// llamante (misma propiedad que registerComponent garantiza con structuredClone).
function cloneEvidence(evidenceRef) {
  return structuredClone(evidenceRef);
}

function cloneEvidenceList(evidenceRefs) {
  return (evidenceRefs ?? []).map(cloneEvidence);
}

function appendEvidence(existing, added) {
  return deepFreeze([...(existing ?? []), ...cloneEvidenceList(added)]);
}

// Gate externo del rol Strategy/Evidence: §11.6.3 exige además §8.7, cuyo
// framework materializa IMP-27. El gate se declara por referencia aceptada; el
// framework no importa ni altera ese código.
function validateStrategyAdmissionGate(roleClass, context) {
  if (!roleRequiresStrategyAdmissionGate(roleClass)) {
    return { ok: true };
  }
  const gate = context?.strategyAdmissionGate;
  if (!gate || typeof gate !== "object" || gate.accepted !== true || !isNonEmptyString(gate.frameworkRef)) {
    return fail(
      "MISSING_STRATEGY_ADMISSION_GATE",
      "El rol Strategy/Evidence no puede declararse evaluation-ready sin el gate aceptado de IMP-27/§8.7 aplicable.",
      { field: "strategyAdmissionGate" },
    );
  }
  if (gate.section !== "§8.7") {
    return fail("INVALID_STRATEGY_ADMISSION_GATE", "El gate de Strategy/Evidence debe referenciar §8.7.", {
      field: "strategyAdmissionGate.section",
    });
  }
  return { ok: true };
}

export class RoleEvaluationRegistry {
  #current = new Map();
  #versions = new Map();

  has(componentId, roleClass) {
    return this.#current.has(recordKey(componentId, roleClass));
  }

  get(componentId, roleClass) {
    return this.#current.get(recordKey(componentId, roleClass)) ?? null;
  }

  history(componentId, roleClass) {
    return [...(this.#versions.get(recordKey(componentId, roleClass)) ?? [])];
  }

  list(componentId) {
    const records = [...this.#current.values()];
    return componentId === undefined ? records : records.filter((record) => record.componentId === componentId);
  }

  // La unidad de evaluación es el componente en un rol concreto: el mismo
  // componente puede registrarse en varios roles y cada uno lleva su propio
  // proceso. Ningún componente recibe un rol por defecto.
  registerComponent(evaluation) {
    const outcome = validateRoleEvaluation(evaluation);
    if (!outcome.ok) {
      return fail("CONTRACT_INCOMPLETE", "La evaluación no satisface el contrato §11.6.2 completo.", { errors: outcome.errors });
    }

    const roleResolved = resolveRoleClass(evaluation.roleClass);
    if (!roleResolved.ok) {
      return roleResolved;
    }

    const key = recordKey(evaluation.componentId, evaluation.roleClass);
    if (this.#current.has(key)) {
      return fail("IDENTITY_COLLISION", `Ya existe una evaluación de "${evaluation.componentId}" en el rol "${evaluation.roleClass}".`, {
        field: "componentId/roleClass",
      });
    }

    const storedContract = structuredClone(evaluation);
    const record = deepFreeze({
      componentId: evaluation.componentId,
      roleClass: evaluation.roleClass,
      role: roleResolved.label,
      // Se toma de la copia, no del objeto del llamante: deepFreeze(record) no
      // debe congelar campos del caller (hallazgo R2-C1).
      componentVersion: storedContract.componentVersion,
      protocolId: storedContract.protocolId,
      protocolVersion: storedContract.protocolVersion,
      versionIndex: 0,
      priorVersionId: null,
      contract: storedContract,
      state: EVALUATION_STATE.REGISTERED,
      readiness: null,
      outcome: null,
      outcomeHistory: [],
      priorFindings: [],
      evidenceRefs: [],
      authorityRequested: [...(evaluation.authorityRequested ?? [])],
      authorityGranted: initialAuthorityGrant(),
      materialChange: null,
    });

    this.#appendVersion(record);
    return { ok: true, record };
  }

  // §11.6.3: la evaluación inicial se realiza sin autoridad productiva.
  // Completar el contrato no basta para readiness: se exigen prerequisites y
  // evidencia; el rol Strategy/Evidence exige además el gate externo de §8.7.
  markEvaluationReady(componentId, roleClass, context = {}) {
    const current = this.#current.get(recordKey(componentId, roleClass));
    if (!current) {
      return fail("UNKNOWN_EVALUATION", `No hay evaluación registrada para "${componentId}" en el rol "${roleClass}".`);
    }
    if (current.state !== EVALUATION_STATE.REGISTERED) {
      return fail("NOT_REGISTERED_STATE", "Sólo una evaluación en REGISTERED pasa a EVALUATION_READY; un outcome ya registrado exige nueva versión.", {
        state: current.state,
      });
    }

    const errors = [];
    if (!Array.isArray(context.prerequisitesSatisfied) || context.prerequisitesSatisfied.length === 0) {
      errors.push({
        field: "prerequisitesSatisfied",
        code: "MISSING_PREREQUISITES",
        message: "EVALUATION-READY exige prerequisites aplicables realmente satisfechos, no sólo campos completos.",
      });
    }
    const readinessEvidenceOutcome = validateEvidenceList(context.readinessEvidence, "readinessEvidence");
    if (!readinessEvidenceOutcome.ok) {
      errors.push(...readinessEvidenceOutcome.errors);
    }
    if (errors.length > 0) {
      return fail("NOT_EVALUATION_READY", "La evaluación no alcanza readiness estructural.", { errors });
    }

    const gateOutcome = validateStrategyAdmissionGate(roleClass, context);
    if (!gateOutcome.ok) {
      return gateOutcome;
    }

    const next = deepFreeze({
      ...current,
      state: EVALUATION_STATE.EVALUATION_READY,
      readiness: deepFreeze({
        prerequisitesSatisfied: [...context.prerequisitesSatisfied],
        evidenceRefs: cloneEvidenceList(context.readinessEvidence),
        strategyAdmissionGate: context.strategyAdmissionGate ?? null,
      }),
      evidenceRefs: appendEvidence(current.evidenceRefs, context.readinessEvidence),
    });
    this.#store(next);
    return { ok: true, record: next };
  }

  // §11.6.4: el outcome pertenece a este componente en este rol. Registrar
  // ADMIT en un rol no admite otro rol ni escribe en él. Un outcome por
  // versión/protocolo es inmutable: para reevaluar hace falta una nueva
  // versión/experimento.
  recordOutcome(componentId, roleClass, outcomeValue, context = {}) {
    const current = this.#current.get(recordKey(componentId, roleClass));
    if (!current) {
      return fail("UNKNOWN_EVALUATION", `No hay evaluación registrada para "${componentId}" en el rol "${roleClass}".`);
    }
    if (current.outcome !== null) {
      return fail(
        "OUTCOME_ALREADY_RECORDED",
        `La versión "${current.componentVersion}" ya tiene outcome ${current.outcome.value}; reevaluar exige createNewEvaluationVersion() (§11.6.4).`,
        { version: current.componentVersion, existingOutcome: current.outcome.value },
      );
    }
    if (current.state !== EVALUATION_STATE.EVALUATION_READY) {
      return fail("NOT_EVALUATION_READY", "Sólo una evaluación en EVALUATION-READY recibe un outcome (§11.6.3).", {
        state: current.state,
      });
    }

    const resolved = resolveRoleAdmissionValue(outcomeValue);
    if (!resolved.ok) {
      return resolved;
    }

    const evidenceOutcome = validateEvidenceList(context.evidenceRefs, "evidenceRefs");
    if (!evidenceOutcome.ok) {
      return evidenceOutcome;
    }

    const authority = roleAdmissionAuthority(resolved.value);
    const clonedEvidence = cloneEvidenceList(context.evidenceRefs);
    const outcomeRecord = deepFreeze({
      namespace: ROLE_ADMISSION_NAMESPACE,
      value: resolved.value,
      componentVersion: current.componentVersion,
      protocolId: current.protocolId,
      protocolVersion: current.protocolVersion,
      evidenceRefs: clonedEvidence,
    });

    const priorFindings =
      resolved.value === "HOLD" || resolved.value === "REJECT"
        ? [...current.priorFindings, outcomeRecord]
        : [...current.priorFindings];

    const next = deepFreeze({
      ...current,
      state: EVALUATION_STATE.OUTCOME_RECORDED,
      outcome: outcomeRecord,
      outcomeHistory: [...current.outcomeHistory, outcomeRecord],
      priorFindings,
      evidenceRefs: appendEvidence(current.evidenceRefs, context.evidenceRefs),
      authorityGranted: deepFreeze([...(authority.grants ?? [])]),
    });
    this.#store(next);
    return { ok: true, record: next, authority };
  }

  // Un outcome inmutable no se reescribe. Un cambio material crea una nueva
  // versión que preserva evidence refs, el historial de outcomes y los
  // HOLD/REJECT previos; la autoridad concedida no se hereda (§11.6.4).
  createNewEvaluationVersion(componentId, roleClass, change = {}) {
    const current = this.#current.get(recordKey(componentId, roleClass));
    if (!current) {
      return fail("UNKNOWN_EVALUATION", `No hay evaluación registrada para "${componentId}" en el rol "${roleClass}".`);
    }
    if (change.materialChange !== true) {
      return fail("MATERIAL_CHANGE_REQUIRED", "Sólo un cambio material crea una nueva versión/experimento (§11.6.4).");
    }
    if (!isNonEmptyString(change.changeSummary)) {
      return fail("MISSING_CHANGE_SUMMARY", "El cambio material exige resumen trazable.");
    }
    if (!isVersionLike(change.newVersion)) {
      return fail("MISSING_VERSION", "La nueva versión exige identidad de versión.");
    }
    if (versionKey(change.newVersion) === versionKey(current.componentVersion)) {
      return fail("VERSION_NOT_CHANGED", "La nueva versión debe diferir de la evaluada; no se reetiqueta el mismo experimento.");
    }

    const candidate = structuredClone(change.contract ?? { ...current.contract, componentVersion: change.newVersion });
    if (candidate.componentId !== componentId || candidate.roleClass !== roleClass) {
      return fail("IDENTITY_MISMATCH", "Una nueva versión conserva la identidad componente/rol.");
    }
    // La versión declarada y la del contrato almacenado deben coincidir; si no,
    // el registro afirmaría evaluar una versión mientras la hipótesis §11.6.2
    // almacenada pertenece a otra (hallazgo A de la ronda 1).
    if (versionKey(candidate.componentVersion) !== versionKey(change.newVersion)) {
      return fail(
        "VERSION_IDENTITY_MISMATCH",
        "La versión del contrato debe coincidir con newVersion; no se atribuye la hipótesis de una versión a otra.",
        { contractVersion: candidate.componentVersion, newVersion: change.newVersion },
      );
    }
    // Un cambio de protocolo de evaluación no puede colarse sin declararse
    // (hallazgo A2 de la ronda 1).
    const protocolChanged =
      candidate.protocolId !== current.protocolId ||
      versionKey(candidate.protocolVersion) !== versionKey(current.protocolVersion);
    if (protocolChanged && (change.protocolChange !== true || !isNonEmptyString(change.protocolChangeSummary))) {
      return fail(
        "PROTOCOL_CHANGE_NOT_DECLARED",
        "Cambiar el protocolo de evaluación exige declararlo explícitamente en el cambio material (hallazgo A2).",
        { field: "protocolChange" },
      );
    }
    // §25.2.1: una identidad de ejecución ya evaluada no se rehabilita. Se
    // comprueba componente/rol/versión/protocolo contra TODO el historial, no
    // sólo contra la versión vigente: si no, una versión REJECT previa puede
    // reintroducirse y volver a admitirse bajo la misma identidad (CMD-1).
    const newVersionKey = versionKey(change.newVersion);
    const newProtocolVersionKey = versionKey(candidate.protocolVersion);
    for (const past of this.history(componentId, roleClass)) {
      const sameVersion = versionKey(past.componentVersion) === newVersionKey;
      const sameProtocol =
        past.protocolId === candidate.protocolId && versionKey(past.protocolVersion) === newProtocolVersionKey;
      if (sameVersion && sameProtocol) {
        return fail(
          "VERSION_ALREADY_EVALUATED",
          "La identidad componente/rol/versión/protocolo ya existe en el historial; una versión evaluada no se rehabilita (§25.2.1).",
          { componentVersion: change.newVersion, protocolId: candidate.protocolId, protocolVersion: candidate.protocolVersion },
        );
      }
    }
    const contractOutcome = validateRoleEvaluation(candidate);
    if (!contractOutcome.ok) {
      return fail("CONTRACT_INCOMPLETE", "La nueva versión debe satisfacer de nuevo el contrato §11.6.2.", { errors: contractOutcome.errors });
    }

    const newEvidence = change.evidenceRefs ?? [];
    if (newEvidence.length > 0) {
      const evidenceOutcome = validateEvidenceList(newEvidence, "evidenceRefs");
      if (!evidenceOutcome.ok) {
        return evidenceOutcome;
      }
    }

    const seenFindings = new Set();
    const priorFindings = [];
    for (const finding of [...current.priorFindings, ...current.outcomeHistory]) {
      if (finding.value !== "HOLD" && finding.value !== "REJECT") {
        continue;
      }
      // La clave usa serialización JSON de la identidad completa
      // (componentVersion, protocolId, protocolVersion, value): incluye
      // protocolId y evita colisiones por delimitadores. Omitir protocolId
      // colapsaba dos protocolos distintos y perdía un REJECT previo (CMD-2).
      const key = JSON.stringify([
        versionKey(finding.componentVersion),
        finding.protocolId,
        versionKey(finding.protocolVersion),
        finding.value,
      ]);
      if (seenFindings.has(key)) {
        continue;
      }
      seenFindings.add(key);
      priorFindings.push(finding);
    }

    const next = deepFreeze({
      ...current,
      // candidate.componentVersion es la copia ya validada; no se congela el
      // objeto newVersion del llamante (R2-C1).
      componentVersion: candidate.componentVersion,
      protocolId: candidate.protocolId,
      protocolVersion: candidate.protocolVersion,
      versionIndex: current.versionIndex + 1,
      priorVersionId: current.componentVersion,
      contract: candidate,
      state: EVALUATION_STATE.REGISTERED,
      readiness: null,
      outcome: null,
      evidenceRefs: appendEvidence(current.evidenceRefs, newEvidence),
      priorFindings,
      authorityGranted: initialAuthorityGrant(),
      materialChange: deepFreeze({
        changeSummary: change.changeSummary,
        fromVersion: current.componentVersion,
        protocolChanged,
        protocolChangeSummary: protocolChanged ? change.protocolChangeSummary : null,
      }),
    });
    this.#appendVersion(next);
    return { ok: true, record: next };
  }

  // La evidencia es append-only: nunca se retira y queda ligada a la versión.
  attachEvidence(componentId, roleClass, evidenceRef) {
    const current = this.#current.get(recordKey(componentId, roleClass));
    if (!current) {
      return fail("UNKNOWN_EVALUATION", `No hay evaluación registrada para "${componentId}" en el rol "${roleClass}".`);
    }
    const outcome = validateEvidenceRef(evidenceRef);
    if (!outcome.ok) {
      return { ...fail("INVALID_EVIDENCE", "Evidence ref malformada."), errors: outcome.errors };
    }
    const next = deepFreeze({
      ...current,
      evidenceRefs: appendEvidence(current.evidenceRefs, [evidenceRef]),
    });
    this.#store(next);
    return { ok: true, record: next };
  }

  // §11.6.2: el camino de retirada/rollback debe permanecer disponible y
  // declarado; no se borra al cambiar de versión.
  getRemovalRollback(componentId, roleClass) {
    const current = this.#current.get(recordKey(componentId, roleClass));
    if (!current) {
      return fail("UNKNOWN_EVALUATION", `No hay evaluación registrada para "${componentId}" en el rol "${roleClass}".`);
    }
    return { ok: true, removalRollbackPath: current.contract.removalRollbackPath };
  }

  // §11.6.3: el claim de valor se contrasta con el dominio del rol declarado;
  // una herramienta de ingeniería no se presenta como procurement edge.
  validateValueClaim(componentId, roleClass, claimDomain) {
    const current = this.#current.get(recordKey(componentId, roleClass));
    if (!current) {
      return fail("UNKNOWN_EVALUATION", `No hay evaluación registrada para "${componentId}" en el rol "${roleClass}".`);
    }
    return validateValueClaimDomain(roleClass, claimDomain);
  }

  // §11.6.4: ningún outcome de este framework concede autoridad real. El rol
  // Execution/Governance exige además su validación separada de §§16–18 antes
  // de cualquier acción real. En ningún caso este registro devuelve autoridad.
  validateRealActionPrerequisite(componentId, roleClass, context = {}) {
    const current = this.#current.get(recordKey(componentId, roleClass));
    if (!current) {
      return fail("UNKNOWN_EVALUATION", `No hay evaluación registrada para "${componentId}" en el rol "${roleClass}".`);
    }
    if (roleRequiresSeparateAuthorityValidation(roleClass) && context?.authorityValidation?.accepted !== true) {
      return fail(
        "MISSING_AUTHORITY_VALIDATION",
        "El rol Execution/Governance exige validación separada de §§16–18 antes de cualquier acción real (§11.6.4).",
        { roleClass },
      );
    }
    return fail(
      "NO_PRODUCTIVE_AUTHORITY",
      "El framework de evaluación por rol no concede autoridad productiva; una acción real exige sus gates separados (§11.6.3/§11.6.4).",
      { roleClass },
    );
  }

  // §11.6.4: "sin valor suficiente en ningún rol, componente fuera". La
  // elegibilidad de integración existe sólo si algún rol recibió ADMIT; este
  // framework nunca integra por sí mismo.
  evaluateIntegration(componentId) {
    const records = this.list(componentId);
    if (records.length === 0) {
      return fail("UNKNOWN_COMPONENT", `No hay ninguna evaluación registrada para "${componentId}".`);
    }
    const admittedRoles = records.filter((record) => record.outcome?.value === "ADMIT").map((record) => record.roleClass);
    return deepFreeze({
      ok: true,
      componentId,
      integrated: false,
      eligible: admittedRoles.length > 0,
      admittedRoles: [...admittedRoles],
      reason: admittedRoles.length > 0 ? "ROLE_SCOPED_ELIGIBILITY_ONLY" : "NO_QUALIFYING_ROLE",
      authorityGranted: initialAuthorityGrant(),
      note: "La elegibilidad por rol no integra ni concede autoridad productiva (§11.6.3/§11.6.4).",
    });
  }

  get hasProductiveAuthority() {
    return hasProductiveAuthority();
  }

  // #store actualiza el registro vigente y también su entrada en la cadena de
  // versiones, indexada por versionIndex. Así history() refleja readiness y
  // outcome de cada versión y no una instantánea previa (hallazgo B ronda 1).
  #store(record) {
    const key = recordKey(record.componentId, record.roleClass);
    this.#current.set(key, record);
    const versions = this.#versions.get(key) ?? [];
    versions[record.versionIndex] = record;
    this.#versions.set(key, versions);
  }

  // Sólo el registro inicial y un cambio material añaden una versión a la
  // cadena; readiness y outcome reemplazan la entrada vigente vía #store.
  #appendVersion(record) {
    this.#store(record);
  }
}

export function createRoleEvaluationRegistry() {
  return new RoleEvaluationRegistry();
}