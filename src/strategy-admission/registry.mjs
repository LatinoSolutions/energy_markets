// Registro único y proceso de validación común a los tres canales de §8.7.1.
// Fuente: SPEC v1.1 §8.7.2 (contrato), §8.7.3 (lifecycle y preservación ante
// cambio material) y §8.7.4 (autoridad). El registro es un proceso local sin
// dependencias: no ejecuta candidatos, no adjudica evidencia y no concede
// autoridad BUY/WAIT, sizing, órdenes ni reward.

import { isVersionLike, isSha256 } from "../contracts/identities.mjs";
import { resolveState } from "../contracts/states.mjs";
import { validateStrategyCandidate } from "./contract.mjs";
import {
  ADMISSION_AUTHORITY,
  RESEARCH_VERDICT_NAMESPACE,
  STRATEGY_ADMISSION_NAMESPACE,
  STRATEGY_LIFECYCLE_NAMESPACE,
  canTransition,
  resolveLifecycleValue,
  validateExperimentReadiness,
} from "./lifecycle.mjs";

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

function versionKey(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return `hash:${value.contentHash}`;
  }
  return `version:${value}`;
}

// Una referencia de evidencia se liga a una versión; sin `kind`/`ref` no es
// trazable y no puede sostener admisión (§8.7.2 "Evidence output").
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

function validateEvidenceList(evidenceRefs) {
  const errors = [];
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) {
    return { ok: false, errors: [{ field: "evidenceRefs", code: "MISSING_EVIDENCE", message: "Se exige evidencia real, no una afirmación." }] };
  }
  for (const evidenceRef of evidenceRefs) {
    const outcome = validateEvidenceRef(evidenceRef);
    if (!outcome.ok) {
      errors.push(...outcome.errors);
    }
  }
  return { ok: errors.length === 0, errors };
}

function appendEvidence(existing, added) {
  return deepFreeze([...(existing ?? []), ...(added ?? [])]);
}

// §8.7.2/§8.7.3: un candidato sólo entra en PROPOSED/NOT_ADMITTED. La misma
// invariante vale en el registro inicial y en cada nueva versión.
function isInitialAdmissionStatus(declared) {
  return (
    (declared?.namespace === STRATEGY_LIFECYCLE_NAMESPACE && declared?.value === "PROPOSED") ||
    (declared?.namespace === STRATEGY_ADMISSION_NAMESPACE && declared?.value === "NOT_ADMITTED")
  );
}

export class StrategyAdmissionRegistry {
  #current = new Map();
  #versions = new Map();

  has(strategyId) {
    return this.#current.has(strategyId);
  }

  get(strategyId) {
    return this.#current.get(strategyId) ?? null;
  }

  history(strategyId) {
    return [...(this.#versions.get(strategyId) ?? [])];
  }

  list() {
    return [...this.#current.values()];
  }

  // §8.7.2/§8.7.3: registra una propuesta con su procedencia. Rechaza
  // colisiones de identidad y provenance/versión ausentes. Todo candidato
  // entra en PROPOSED y NOT_ADMITTED: no se registra una admisión ya concedida.
  register(candidate) {
    const outcome = validateStrategyCandidate(candidate);
    if (!outcome.ok) {
      return fail("CONTRACT_INCOMPLETE", "El Strategy Candidate no satisface el contrato común §8.7.2.", { errors: outcome.errors });
    }

    const strategyId = candidate.strategyId;
    if (this.#current.has(strategyId)) {
      return fail("IDENTITY_COLLISION", `Ya existe un Strategy Candidate con id "${strategyId}".`, { field: "strategyId" });
    }
    for (const record of this.#current.values()) {
      if (record.canonicalName === candidate.canonicalName) {
        return fail("IDENTITY_COLLISION", `El canonical name "${candidate.canonicalName}" ya está registrado.`, { field: "canonicalName" });
      }
    }

    const declared = candidate.admissionStatus;
    if (!isInitialAdmissionStatus(declared)) {
      return fail("NON_INITIAL_ADMISSION_STATUS", "Un candidato sólo se registra en PROPOSED/NOT_ADMITTED; la admisión exige decisión explícita.", {
        field: "admissionStatus",
      });
    }

    // El registro congela su propia copia: no congela el objeto del llamante.
    const storedContract = structuredClone(candidate);

    const record = deepFreeze({
      strategyId,
      canonicalName: candidate.canonicalName,
      version: candidate.version,
      versionIndex: 0,
      priorVersionId: null,
      channel: candidate.intakeChannel,
      provenance: storedContract.provenance,
      contract: storedContract,
      lifecycle: { namespace: STRATEGY_LIFECYCLE_NAMESPACE, value: "PROPOSED" },
      admission: { namespace: STRATEGY_ADMISSION_NAMESPACE, value: "NOT_ADMITTED" },
      verdict: null,
      verdictHistory: [],
      experimentId: null,
      evidenceRefs: [],
      oosConsumption: { consumed: false, references: [] },
      priorFindings: [],
      materialChange: null,
    });

    this.#appendVersion(record);
    return { ok: true, record };
  }

  // §8.7.3: transiciones deterministas. EXPERIMENT-READY exige prerequisites y
  // evidencia de readiness; UNDER TEST exige la versión/experimento declarado.
  transition(strategyId, toValue, context = {}) {
    const current = this.#current.get(strategyId);
    if (!current) {
      return fail("UNKNOWN_STRATEGY", `No hay candidato registrado con id "${strategyId}".`);
    }

    const target = resolveLifecycleValue(toValue);
    if (!target.ok) {
      return target;
    }

    if (!canTransition(current.lifecycle.value, target.value)) {
      return fail("ILLEGAL_TRANSITION", `No se puede pasar de ${current.lifecycle.value} a ${target.value} (§8.7.3).`, {
        from: current.lifecycle.value,
        to: target.value,
      });
    }

    if (target.value === "EXPERIMENT_READY") {
      const readiness = validateExperimentReadiness(context);
      if (!readiness.ok) {
        return fail("NOT_EXPERIMENT_READY", "Completar nominalmente el contrato no demuestra experiment readiness (§8.7.3).", {
          errors: readiness.errors,
        });
      }
    }

    if (target.value === "UNDER_TEST" && !isNonEmptyString(context.experimentId)) {
      return fail("MISSING_EXPERIMENT", "UNDER TEST exige el experimento/versión declarado que se evalúa (§8.7.3).", {
        field: "experimentId",
      });
    }
    // §8.7.3: un cambio material crea una versión *y experimento* nuevos. Un
    // experimentId ya veredictado no se reutiliza: dejaría FAIL y PASS sobre el
    // mismo id de experimento.
    if (
      target.value === "UNDER_TEST" &&
      current.verdictHistory.some((entry) => entry.experimentId === context.experimentId)
    ) {
      return fail("EXPERIMENT_ID_REUSED", "El experimentId ya fue veredictado en una versión anterior; un nuevo experimento exige un id nuevo (§8.7.3).", {
        field: "experimentId",
      });
    }

    const newEvidence = structuredClone([...(context.evidenceRefs ?? []), ...(context.readinessEvidence ?? [])]);
    const evidenceOutcome = newEvidence.length > 0 ? validateEvidenceList(newEvidence) : { ok: true };
    if (!evidenceOutcome.ok) {
      return fail("INVALID_EVIDENCE", "La transición trae evidencia malformada.", { errors: evidenceOutcome.errors });
    }

    const next = deepFreeze({
      ...current,
      lifecycle: { namespace: target.namespace, value: target.value },
      experimentId: context.experimentId ?? current.experimentId,
      evidenceRefs: appendEvidence(current.evidenceRefs, newEvidence),
    });
    this.#store(next);
    return { ok: true, record: next };
  }

  // §8.7.3/§8.7.4: el veredicto del experimento vive en research_verdict y no
  // toca la admisión. FAIL/INVALID/HOLD conservan su significado.
  recordVerdict(strategyId, verdictValue, context = {}) {
    const current = this.#current.get(strategyId);
    if (!current) {
      return fail("UNKNOWN_STRATEGY", `No hay candidato registrado con id "${strategyId}".`);
    }
    if (current.lifecycle.value !== "UNDER_TEST") {
      return fail("NOT_UNDER_TEST", "Sólo se registra un veredicto bajo UNDER TEST (§8.7.3).", { lifecycle: current.lifecycle.value });
    }
    // §8.7.3: una versión/experimento recibe un único veredicto. Reescribirlo
    // sobre la misma versión resetearía en silencio un FAIL/INVALID; para
    // continuar hace falta createNewVersion().
    if (current.verdict !== null) {
      return fail(
        "VERDICT_ALREADY_RECORDED",
        `La versión "${current.version}" ya tiene veredicto ${current.verdict.value}; un nuevo veredicto exige createNewVersion() (§8.7.3).`,
        { version: current.version, existingVerdict: current.verdict.value },
      );
    }

    const verdict = resolveState(RESEARCH_VERDICT_NAMESPACE, verdictValue);
    if (!verdict.ok) {
      return verdict;
    }

    if (!isNonEmptyString(context.experimentId) || context.experimentId !== current.experimentId) {
      return fail("EXPERIMENT_MISMATCH", "El veredicto debe corresponder a la versión/experimento declarado en UNDER TEST.", {
        field: "experimentId",
      });
    }

    const evidenceOutcome = validateEvidenceList(context.evidenceRefs);
    if (!evidenceOutcome.ok) {
      return fail("INVALID_EVIDENCE", "El veredicto exige evidencia real.", { errors: evidenceOutcome.errors });
    }

    // Clonar antes de congelar: el veredicto no congela el array del llamante.
    const evidenceRefs = structuredClone(context.evidenceRefs);

    const verdictRecord = deepFreeze({
      namespace: RESEARCH_VERDICT_NAMESPACE,
      value: verdict.value,
      version: current.version,
      experimentId: context.experimentId,
      evidenceRefs,
    });

    const next = deepFreeze({
      ...current,
      verdict: verdictRecord,
      verdictHistory: [...current.verdictHistory, verdictRecord],
      evidenceRefs: appendEvidence(current.evidenceRefs, evidenceRefs),
    });
    this.#store(next);
    return { ok: true, record: next };
  }

  // §8.7.3/§8.7.4: PASS no admite automáticamente. La admisión es una decisión
  // explícita, justificada y con evidencia; FAIL/INVALID exigen nueva versión y
  // HOLD no basta. La admisión sólo otorga rol Evidence Generator.
  admit(strategyId, decision = {}) {
    const current = this.#current.get(strategyId);
    if (!current) {
      return fail("UNKNOWN_STRATEGY", `No hay candidato registrado con id "${strategyId}".`);
    }
    if (!current.verdict) {
      return fail("NO_VERDICT", "No se admite un candidato sin veredicto de experimento registrado (§8.7.3).");
    }
    // La decisión de admisión es append-only: una segunda admisión no
    // sobrescribe la anterior. Cualquier cambio requiere una nueva versión.
    if (current.admission.value === "ADMITTED_EVIDENCE_GENERATOR") {
      return fail("ADMISSION_ALREADY_DECIDED", "El candidato ya fue admitido; una nueva admisión exige una nueva versión/experimento (§8.7.4).");
    }
    if (current.verdict.value === "FAIL" || current.verdict.value === "INVALID") {
      return fail("REFUTED_REQUIRES_NEW_VERSION", "Un FAIL/INVALID válido exige una nueva versión/experimento; no se admite la versión refutada (§8.7.3).");
    }
    if (current.verdict.value === "HOLD") {
      return fail("INSUFFICIENT_EVIDENCE", "HOLD no demuestra validez; no se admite sin evidencia suficiente (§8.7.3).");
    }
    // Defensa adicional: ninguna versión con un FAIL/INVALID en su historial
    // puede admitirse, aunque el último veredicto pareciera favorable.
    const refutedThisVersion = current.verdictHistory.some(
      (entry) => versionKey(entry.version) === versionKey(current.version) && (entry.value === "FAIL" || entry.value === "INVALID"),
    );
    if (refutedThisVersion) {
      return fail("REFUTED_REQUIRES_NEW_VERSION", "La versión vigente tiene un FAIL/INVALID registrado; exige nueva versión/experimento (§8.7.3).");
    }

    const errors = [];
    if (!isNonEmptyString(decision.justification)) {
      errors.push({ field: "justification", code: "MISSING_JUSTIFICATION", message: "La admisión exige justificación explícita (§8.7.3)." });
    }
    if (!isNonEmptyString(decision.authority)) {
      errors.push({ field: "authority", code: "MISSING_AUTHORITY", message: "La admisión exige autoridad identificada." });
    }
    const evidenceOutcome = validateEvidenceList(decision.evidenceRefs);
    if (!evidenceOutcome.ok) {
      errors.push(...evidenceOutcome.errors);
    }
    if (errors.length > 0) {
      return fail("ADMISSION_DECISION_INCOMPLETE", "La admisión explícita está incompleta.", { errors });
    }

    // Clonar antes de congelar: la decisión no congela los arrays del llamante.
    const evidenceRefs = structuredClone(decision.evidenceRefs);

    const next = deepFreeze({
      ...current,
      admission: { namespace: STRATEGY_ADMISSION_NAMESPACE, value: "ADMITTED_EVIDENCE_GENERATOR" },
      evidenceRefs: appendEvidence(current.evidenceRefs, evidenceRefs),
      admissionDecision: deepFreeze({
        justification: decision.justification,
        authority: decision.authority,
        evidenceRefs,
      }),
    });
    this.#store(next);
    return { ok: true, record: next, authority: ADMISSION_AUTHORITY };
  }

  // §8.7.3/§15.2: un cambio material crea una nueva versión/experimento y
  // preserva FAIL/INVALID previos, la provenance de evidencia y las
  // referencias de OOS consumido. Ningún reset silencioso.
  createNewVersion(strategyId, change = {}) {
    const current = this.#current.get(strategyId);
    if (!current) {
      return fail("UNKNOWN_STRATEGY", `No hay candidato registrado con id "${strategyId}".`);
    }
    if (change.materialChange !== true) {
      return fail("MATERIAL_CHANGE_REQUIRED", "Sólo un cambio material crea una nueva versión/experimento (§8.7.3).");
    }
    if (!isNonEmptyString(change.changeSummary)) {
      return fail("MISSING_CHANGE_SUMMARY", "El cambio material exige resumen trazable.");
    }
    if (!isVersionLike(change.newVersion)) {
      return fail("MISSING_VERSION", "La nueva versión/experimento exige identidad de versión.");
    }
    if (versionKey(change.newVersion) === versionKey(current.version)) {
      return fail("VERSION_NOT_CHANGED", "La nueva versión debe diferir de la versión evaluada; no se reetiqueta el mismo experimento.");
    }

    // Clonar evita congelar el objeto del llamante y no comparte estructuras
    // mutables con la versión anterior.
    const candidate = structuredClone(change.contract ?? { ...current.contract, version: change.newVersion });
    if (candidate.strategyId !== strategyId) {
      return fail("IDENTITY_MISMATCH", "Una nueva versión conserva el strategyId de la identidad.");
    }
    // La misma invariante que register(): la Versión del contrato §8.7.2 debe
    // coincidir con la versión/experimento de la nueva entrada, y el contrato
    // no puede declararse ya admitido. Sin esto la segunda puerta rompe la
    // ligadura versión/evidencia en silencio.
    if (versionKey(candidate.version) !== versionKey(change.newVersion)) {
      return fail("VERSION_MISMATCH", "La Version del contrato debe coincidir con change.newVersion (ligadura versión/evidencia, §8.7.2).", {
        field: "contract.version",
        contractVersion: candidate.version,
        newVersion: change.newVersion,
      });
    }
    if (!isInitialAdmissionStatus(candidate.admissionStatus)) {
      return fail("NON_INITIAL_ADMISSION_STATUS", "Una nueva versión no puede declarar una admisión ya concedida; su estado autoritativo arranca en NOT_ADMITTED.", {
        field: "contract.admissionStatus",
      });
    }
    // La segunda puerta conserva la identidad estable: el canonical name y el
    // intake channel de una versión no se renombran (sería otra procedencia,
    // §8.7.1/§8.7.2). El provenance se toma del contrato entrante para que
    // record y contrato tengan una única respuesta por versión.
    if (candidate.canonicalName !== current.canonicalName) {
      return fail("IDENTITY_MISMATCH", "Una nueva versión conserva el canonical name estable de la identidad (§8.7.2).", {
        field: "contract.canonicalName",
      });
    }
    if (candidate.intakeChannel !== current.channel) {
      return fail("IDENTITY_MISMATCH", "Una nueva versión conserva el intake channel de la identidad; cambiar de canal es otra procedencia (§8.7.1/§8.7.2).", {
        field: "contract.intakeChannel",
      });
    }
    const contractOutcome = validateStrategyCandidate(candidate);
    if (!contractOutcome.ok) {
      return fail("CONTRACT_INCOMPLETE", "La nueva versión debe satisfacer de nuevo el contrato común §8.7.2.", { errors: contractOutcome.errors });
    }

    if (current.oosConsumption.consumed && candidate.oosConsumption && candidate.oosConsumption.consumed === false) {
      return fail("OOS_RESET_ATTEMPT", "No se reutiliza como intacto un OOS consumido (§8.7.3/§15.2).", { field: "oosConsumption" });
    }

    const newEvidence = structuredClone(change.evidenceRefs ?? []);
    if (newEvidence.length > 0) {
      const evidenceOutcome = validateEvidenceList(newEvidence);
      if (!evidenceOutcome.ok) {
        return fail("INVALID_EVIDENCE", "La nueva versión trae evidencia malformada.", { errors: evidenceOutcome.errors });
      }
    }

    // `verdictHistory` se arrastra entre versiones; deduplicar evita inflar el
    // número de refutaciones en `priorFindings` tras cambios sucesivos.
    const seenFindings = new Set();
    const priorFindings = [];
    for (const finding of [...current.priorFindings, ...current.verdictHistory]) {
      if (finding.value !== "FAIL" && finding.value !== "INVALID") {
        continue;
      }
      const key = `${finding.version}:${finding.experimentId}:${finding.value}`;
      if (seenFindings.has(key)) {
        continue;
      }
      seenFindings.add(key);
      priorFindings.push(finding);
    }

    const oosReferences = [
      ...current.oosConsumption.references,
      ...(candidate.oosConsumption?.references ?? []),
    ];

    const next = deepFreeze({
      ...current,
      canonicalName: candidate.canonicalName,
      channel: candidate.intakeChannel,
      provenance: candidate.provenance,
      version: change.newVersion,
      versionIndex: current.versionIndex + 1,
      priorVersionId: current.version,
      contract: candidate,
      lifecycle: { namespace: STRATEGY_LIFECYCLE_NAMESPACE, value: "FORMALIZED" },
      admission: { namespace: STRATEGY_ADMISSION_NAMESPACE, value: "NOT_ADMITTED" },
      verdict: null,
      experimentId: null,
      evidenceRefs: appendEvidence(current.evidenceRefs, newEvidence),
      oosConsumption: { consumed: current.oosConsumption.consumed, references: oosReferences },
      priorFindings,
      admissionDecision: null,
      materialChange: deepFreeze({ changeSummary: change.changeSummary, fromVersion: current.version }),
    });
    this.#appendVersion(next);
    return { ok: true, record: next };
  }

  // El consumo de OOS es irreversible: se registra y se arrastra a cada nueva
  // versión. No existe API para volver a "intacto" (§15.2).
  consumeOos(strategyId, reference) {
    const current = this.#current.get(strategyId);
    if (!current) {
      return fail("UNKNOWN_STRATEGY", `No hay candidato registrado con id "${strategyId}".`);
    }
    const value = typeof reference === "string" ? reference : reference?.reference;
    if (!isNonEmptyString(value)) {
      return fail("MISSING_OOS_REFERENCE", "El consumo de OOS exige referencia trazable.");
    }

    const next = deepFreeze({
      ...current,
      oosConsumption: {
        consumed: true,
        references: [...current.oosConsumption.references, deepFreeze({ reference: value })],
      },
    });
    this.#store(next);
    return { ok: true, record: next };
  }

  // La evidencia es append-only: nunca se retira, y queda ligada a la versión.
  attachEvidence(strategyId, evidenceRef) {
    const current = this.#current.get(strategyId);
    if (!current) {
      return fail("UNKNOWN_STRATEGY", `No hay candidato registrado con id "${strategyId}".`);
    }
    const outcome = validateEvidenceRef(evidenceRef);
    if (!outcome.ok) {
      return fail("INVALID_EVIDENCE", "Evidence ref malformada.", { errors: outcome.errors });
    }
    // Clonar antes de congelar: la evidencia no congela el objeto del llamante.
    const storedEvidenceRef = structuredClone(evidenceRef);
    const next = deepFreeze({
      ...current,
      evidenceRefs: appendEvidence(current.evidenceRefs, [storedEvidenceRef]),
    });
    this.#store(next);
    return { ok: true, record: next };
  }

  getAdmissionAuthority() {
    return ADMISSION_AUTHORITY;
  }

  #store(record) {
    this.#current.set(record.strategyId, record);
  }

  // Sólo el registro inicial y un cambio material añaden una versión a la
  // cadena; las transiciones y veredictos actualizan la versión vigente.
  #appendVersion(record) {
    const versions = this.#versions.get(record.strategyId) ?? [];
    versions.push(record);
    this.#versions.set(record.strategyId, versions);
    this.#store(record);
  }
}

export function createStrategyAdmissionRegistry() {
  return new StrategyAdmissionRegistry();
}
