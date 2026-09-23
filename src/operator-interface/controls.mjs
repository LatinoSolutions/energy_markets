// Operator Interface Boundary — boundary de controles. Fuente: SPEC v1.1.1
// §26.5 (la UI no es segunda Source of Truth; toda escritura/acción exige un
// comando explícitamente autorizado y su receipt cuando governance lo requiera;
// un control visible no sustituye el envelope, la aprobación ni las condiciones
// de §§16–18) y §26.2 (human approval/veto/delay/modification vinculada a la
// recomendación original y a la acción efectiva).
//
// Este módulo no concede autoridad productiva: verifica que un comando venga
// autorizado y devuelve la marca de que la autoridad procede del backend, no de
// la interfaz. Un control de pantalla sin autorización explícita se rechaza
// (fail-closed).

import { isSha256 } from "../contracts/identities.mjs";
import { canonicalValueSha256 } from "../pit-views/pit-record.mjs";
import { toUtcTimestamp } from "../pit-views/time.mjs";
import { backendIndexFromManifest, parseBackendRef, resolveBackendRecord } from "./backend-records.mjs";

// Comandos que §18.4 reconoce como eventos de governance. La UI puede
// originarlos, pero el estado resultante lo produce el backend.
export const GOVERNANCE_COMMAND = Object.freeze({
  PROMOTE: "PROMOTE",
  HALT: "HALT",
  DEMOTE: "DEMOTE",
  ROLLBACK: "ROLLBACK",
});

export const GOVERNANCE_COMMANDS = Object.freeze(Object.values(GOVERNANCE_COMMAND));

// Intervenciones operativas humanas de §12/§26.2.
export const INTERVENTION_COMMAND = Object.freeze({
  APPROVE: "APPROVE",
  VETO: "VETO",
  DELAY: "DELAY",
  MODIFY: "MODIFY",
});

export const INTERVENTION_COMMANDS = Object.freeze(Object.values(INTERVENTION_COMMAND));

export const AUTHORIZED_COMMANDS = Object.freeze([...GOVERNANCE_COMMANDS, ...INTERVENTION_COMMANDS]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function fail(field, code, message) {
  return { ok: false, errors: [{ field, code, message }] };
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

// OI29-03 (review 2026-09-23): la autoridad no se acepta por su forma. La
// referencia (§26.5: comando explícitamente autorizado, §25.2: procedencia)
// se contrasta contra el manifest backend verificado; fail-closed sin él.
// PLACEHOLDER de contrato (no canónico): la SPEC §26.5 no fija la sintaxis de
// authorityRef; forma asumida "<recordKey>@<revisionId>" (backend-records).
function requireBackendRecord(index, ref, errors, field, what) {
  if (index === null) {
    errors.push({
      field,
      code: "AUTHORIZATION_BACKEND_UNVERIFIED",
      message: `Verificar ${what} exige un manifest backend verificado (buildPitManifest); sin él nada acredita autoridad ni procedencia (§26.5/§25.2).`,
    });
    return null;
  }
  const parsed = parseBackendRef(ref);
  if (parsed === null) {
    errors.push({
      field,
      code: "INVALID_BACKEND_REF",
      message: `${ref ?? "La referencia"} no es una referencia a registro/versión canónico "<recordKey>@<revisionId>" (§26.5).`,
    });
    return null;
  }
  const resolved = resolveBackendRecord(index, parsed.recordKey, parsed.revisionId);
  if (resolved === null) {
    errors.push({
      field,
      code: "RECORD_NOT_IN_BACKEND",
      message: `"${ref}" no existe en el manifest backend verificado; ${what} no remite a un registro canónico (§26.5).`,
    });
    return null;
  }
  return resolved;
}

// La autorización no es la presencia del control en pantalla: exige una
// autoridad concreta que la otorga (registrada en el backend) y un instante.
// Sin ellas no hay comando.
function validateAuthorization(authorization, errors, backendIndex) {
  if (authorization === undefined || authorization === null || typeof authorization !== "object" || Array.isArray(authorization)) {
    errors.push({
      field: "authorization",
      code: "MISSING_AUTHORIZATION",
      message: "Un comando de la UI exige autorización explícita; un control visible no la sustituye (§26.5/§16–18).",
    });
    return null;
  }
  if (!isNonEmptyString(authorization.authorityRef) || !isNonEmptyString(authorization.grantedBy)) {
    errors.push({
      field: "authorization",
      code: "INCOMPLETE_AUTHORIZATION",
      message: "La autorización requiere authorityRef y grantedBy (§26.5).",
    });
    return null;
  }
  const grantedAt = toUtcTimestamp(authorization.grantedAtUtc);
  if (!grantedAt.ok) {
    errors.push({
      field: "authorization.grantedAtUtc",
      code: grantedAt.code,
      message: "grantedAtUtc requiere zona explícita (§6.1).",
    });
    return null;
  }
  const authorityRecord = requireBackendRecord(backendIndex, authorization.authorityRef, errors, "authorization.authorityRef", "la autoridad otorgada");
  if (authorityRecord === null) {
    return null;
  }
  return deepFreeze({
    authorityRef: authorization.authorityRef,
    grantedBy: authorization.grantedBy,
    grantedAtUtc: grantedAt.utc,
    origin: { recordKey: authorityRecord.key, revisionId: authorityRecord.revisionId, claimedInBackend: true },
  });
}

// Los comandos de governance exigen el receipt aplicable (§26.5). El receipt
// no vale por ser un texto con hash: su contenido debe estar registrado y
// verificado en el manifest backend.
function validateGovernanceReceipt(receipt, errors, backendIndex) {
  if (receipt === undefined || receipt === null || typeof receipt !== "object" || Array.isArray(receipt)
    || !isNonEmptyString(receipt.receiptRef) || !isSha256(receipt.receiptSha256)) {
    errors.push({
      field: "receipt",
      code: "MISSING_RECEIPT",
      message: "Un comando de governance exige el receipt aplicable (receiptRef + sha256) (§26.5).",
    });
    return null;
  }
  const receiptRecord = requireBackendRecord(backendIndex, receipt.receiptRef, errors, "receipt.receiptRef", "el receipt");
  if (receiptRecord === null) {
    return null;
  }
  if (receiptRecord.valueSha256 !== receipt.receiptSha256.toLowerCase()) {
    errors.push({
      field: "receipt.receiptSha256",
      code: "RECEIPT_CONTENT_MISMATCH",
      message: `El hash del receipt no coincide con el contenido registrado por el backend para "${receipt.receiptRef}": no se declara un receipt que el backend no verificó (§26.5).`,
    });
    return null;
  }
  return deepFreeze({ receiptRef: receipt.receiptRef, receiptSha256: receipt.receiptSha256.toLowerCase(), origin: { recordKey: receiptRecord.key, revisionId: receiptRecord.revisionId } });
}

// Autoriza y normaliza un comando originado en la UI. Nunca devuelve autoridad
// productiva: sólo registra que el backend la otorgó.
//
// OI29-03: el comando se valida contra el manifest backend verificado
// (context.backendManifest): la autoridad y el receipt deben existir en el
// backend y el hash del receipt coincidir con su registro. Sin backend,
// fail-closed; la etiqueta authoritySource:"BACKEND" por sí sola no demuestra
// nada.
export function authorizeOperatorCommand(input, context = {}) {
  const backendIndex = context?.backendManifest === undefined || context?.backendManifest === null
    ? null
    : backendIndexFromManifest(context.backendManifest);
  if (context?.backendManifest !== undefined && context?.backendManifest !== null && backendIndex === null) {
    return fail(
      "backendManifest",
      "UNVERIFIED_BACKEND_MANIFEST",
      "El manifest backend no proviene de buildPitManifest; sus registros no acreditan autoridad ni receipts (§6.1/§25.2).",
    );
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return fail("(command)", "MISSING_COMMAND", "Comando ausente.");
  }
  if (!AUTHORIZED_COMMANDS.includes(input.command)) {
    return fail("command", "UNKNOWN_COMMAND", `"${input.command}" no es un comando autorizado de §26.5.`);
  }
  const errors = [];
  const authorization = validateAuthorization(input.authorization, errors, backendIndex);
  const isGovernance = GOVERNANCE_COMMANDS.includes(input.command);
  const isIntervention = INTERVENTION_COMMANDS.includes(input.command);

  let receipt = null;
  if (isGovernance) {
    receipt = validateGovernanceReceipt(input.receipt, errors, backendIndex);
  }
  // §26.2/§26.3: una intervención se vincula a la recomendación original y a la
  // acción efectiva; sin ellas no es una intervención trazable. OI29-03: el
  // vínculo además debe resolver a una recomendación canónica del backend.
  if (isIntervention && (!isNonEmptyString(input.recommendationRef) || !isNonEmptyString(input.effectiveAction))) {
    errors.push({
      field: "recommendationRef",
      code: "MISSING_INTERVENTION_LINK",
      message: "Una intervención humana exige recommendationRef y effectiveAction (§26.2/§26.3).",
    });
  } else if (isIntervention) {
    const recommendationRecord = requireBackendRecord(backendIndex, input.recommendationRef, errors, "recommendationRef", "la recomendación vinculada");
    if (recommendationRecord !== null && recommendationRecord.viewScope !== "decision") {
      errors.push({
        field: "recommendationRef",
        code: "RECOMMENDATION_REF_NOT_IN_DECISION_SCOPE",
        message: `"${input.recommendationRef}" no es una versión del decision view; una intervención se vincula a la recomendación conocida al decidir (§26.2/§26.3).`,
      });
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    command: deepFreeze({
      command: input.command,
      actor: isNonEmptyString(input.actor) ? input.actor : null,
      authorization,
      receipt,
      recommendationRef: isIntervention ? input.recommendationRef : null,
      effectiveAction: isIntervention ? input.effectiveAction : null,
      // La autoridad exhibida procede del backend; la interfaz no la crea.
      authorityGranted: false,
      authoritySource: "BACKEND",
    }),
  };
}

// Registro de intervención humana: distingue la recomendación original de la
// acción efectiva y no atribuye lo actuado a la policy (§26.3/§12).
//
// OI29-07 (review 2026-09-23): ni la referencia ni la procedencia valen por su
// forma; ambas se contrastan contra el manifest backend verificado (§25.1:
// datos/proyecciones remiten a sus registros/versiones; §26.5). Fail-closed
// sin manifest verificado.
export function buildHumanIntervention({
  recommendationRef,
  command,
  effectiveAction,
  occurredAtUtc,
  provenance,
} = {}, context = {}) {
  const errors = [];
  if (!INTERVENTION_COMMANDS.includes(command)) {
    errors.push({
      field: "command",
      code: "UNKNOWN_INTERVENTION_COMMAND",
      message: `La intervención debe usar ${INTERVENTION_COMMANDS.join(", ")} (§26.2).`,
    });
  }
  if (!isNonEmptyString(recommendationRef) || !isNonEmptyString(effectiveAction)) {
    errors.push({
      field: "recommendationRef",
      code: "MISSING_INTERVENTION_LINK",
      message: "La intervención exige recommendationRef y effectiveAction (§26.2).",
    });
  }
  const occurred = toUtcTimestamp(occurredAtUtc);
  if (!occurred.ok) {
    errors.push({ field: "occurredAtUtc", code: occurred.code, message: "occurredAtUtc requiere zona explícita (§6.1)." });
  }
  if (provenance === undefined || provenance === null || !isNonEmptyString(provenance.recordKey) || !isNonEmptyString(provenance.revisionId)) {
    errors.push({
      field: "provenance",
      code: "MISSING_PROVENANCE",
      message: "La intervención requiere procedencia a un registro/versión canónico (§25.2/§26.5).",
    });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const backendIndex = context?.backendManifest === undefined || context?.backendManifest === null
    ? null
    : backendIndexFromManifest(context.backendManifest);
  if (backendIndex === null) {
    return {
      ok: false,
      errors: [{
        field: "provenance",
        code: "INTERVENTION_BACKEND_UNVERIFIED",
        message: "La intervención exige contrastar su procedencia y su vínculo contra un manifest backend verificado (buildPitManifest); sin él nada remite a un registro canónico (§26.5/§25.2).",
      }],
    };
  }
  // OI29-07: el vínculo a la recomendación debe resolver a una versión
  // canónica del decision view (§26.2/§26.3: la intervención se vincula a la
  // recomendación conocida al decidir).
  const parsed = parseBackendRef(recommendationRef);
  if (parsed === null) {
    return {
      ok: false,
      errors: [{
        field: "recommendationRef",
        code: "INVALID_RECOMMENDATION_REF",
        message: `"${recommendationRef}" no es una referencia a registro/versión canónico "<recordKey>@<revisionId>" (§26.2).`,
      }],
    };
  }
  const recommendationRecord = resolveBackendRecord(backendIndex, parsed.recordKey, parsed.revisionId);
  if (recommendationRecord === null) {
    return {
      ok: false,
      errors: [{
        field: "recommendationRef",
        code: "RECOMMENDATION_REF_NOT_IN_BACKEND",
        message: `"${recommendationRef}" no existe en el manifest backend verificado; la intervención no remite a una recomendación canónica (§26.5/§25.2).`,
      }],
    };
  }
  if (recommendationRecord.viewScope !== "decision") {
    return {
      ok: false,
      errors: [{
        field: "recommendationRef",
        code: "RECOMMENDATION_REF_NOT_IN_DECISION_SCOPE",
        message: `"${recommendationRef}" no es una versión del decision view; la intervención se vincula a la recomendación conocida al decidir (§26.2/§26.3).`,
      }],
    };
  }
  // OI29-07: la procedencia también debe resolver a un registro canónico
  // existente en el backend (§25.1/§26.5).
  const provenanceRecord = resolveBackendRecord(backendIndex, provenance.recordKey, provenance.revisionId);
  if (provenanceRecord === null) {
    return {
      ok: false,
      errors: [{
        field: "provenance",
        code: "PROVENANCE_NOT_IN_BACKEND",
        message: `La procedencia "${provenance.recordKey}"/"${provenance.revisionId}" no existe en el manifest backend verificado; la intervención no remite a un registro canónico (§26.5/§25.2).`,
      }],
    };
  }
  return {
    ok: true,
    intervention: deepFreeze({
      class: "HUMAN_INTERVENTION",
      recommendationRef,
      command,
      effectiveAction,
      occurredAtUtc: occurred.utc,
      attribution: "HUMAN",
      // §26.3: no se atribuye en silencio a la recomendación original.
      policyAttribution: null,
      provenance: {
        recordKey: provenance.recordKey,
        revisionId: provenance.revisionId,
        resolved: { recordKey: provenanceRecord.key, revisionId: provenanceRecord.revisionId },
        evidenceRef: provenance.evidenceRef ?? null,
      },
    }),
  };
}

// El estado de governance mostrado procede del backend (§26.5). Sin esa
// procedencia, la UI estaría sosteniendo una verdad operativa paralela: se
// rechaza en vez de exponer un estado propio.
//
// OI29-06 (review 2026-09-23): la procedencia no vale por su forma; se
// contrasta contra el manifest backend verificado y el estado mostrado debe
// ser el valor registrado por esa versión canónica (mismo hash), no un estado
// arbitrario del llamador con registro de acompañamiento. Fail-closed sin
// manifest verificado o con registro ausente.
export function projectGovernanceState({ backendState, provenance, backendManifest } = {}) {
  if (backendState === undefined || backendState === null) {
    return fail("backendState", "MISSING_BACKEND_STATE", "El estado de governance procede del backend, no de la UI (§26.5).");
  }
  const backendIndex = backendManifest === undefined || backendManifest === null
    ? null
    : backendIndexFromManifest(backendManifest);
  if (backendIndex === null) {
    return fail(
      "backendManifest",
      "GOVERNANCE_STATE_BACKEND_UNVERIFIED",
      "El estado de governance mostrado exige un manifest backend verificado (buildPitManifest) que respalde su procedencia; sin él la UI sostendría una verdad paralela (§26.5).",
    );
  }
  if (provenance === undefined || provenance === null || !isNonEmptyString(provenance.recordKey) || !isNonEmptyString(provenance.revisionId)) {
    return fail(
      "provenance",
      "GOVERNANCE_STATE_FROM_UI",
      "El estado de governance mostrado exige procedencia a un registro/versión canónico; no se mantiene una verdad paralela en la interfaz (§26.5).",
    );
  }
  const governanceRecord = resolveBackendRecord(backendIndex, provenance.recordKey, provenance.revisionId);
  if (governanceRecord === null) {
    return fail(
      "provenance",
      "GOVERNANCE_RECORD_NOT_IN_BACKEND",
      `La procedencia "${provenance.recordKey}"/"${provenance.revisionId}" no existe en el manifest backend verificado; el estado mostrado no remite a un registro canónico (§26.5).`,
    );
  }
  // OI29-06: el estado mostrado deberá ser el valor registrado por esa versión
  // canónica; un estado distinto no es truth de este backend (§26.5).
  const stateHash = canonicalValueSha256(backendState);
  if (!stateHash.ok || stateHash.sha256 !== governanceRecord.valueSha256) {
    return fail(
      "backendState",
      "GOVERNANCE_STATE_VALUE_MISMATCH",
      "El estado mostrado no coincide con el valor registrado por el backend para esa versión canónica; la UI no calcula ni sostiene un estado propio (§26.5).",
    );
  }
  return {
    ok: true,
    governanceState: deepFreeze({
      state: backendState,
      provenance: {
        recordKey: provenance.recordKey,
        revisionId: provenance.revisionId,
        resolved: { recordKey: governanceRecord.key, revisionId: governanceRecord.revisionId },
        evidenceRef: provenance.evidenceRef ?? null,
      },
      authorityGranted: false,
    }),
  };
}
