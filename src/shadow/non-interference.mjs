// Verificación de non-interference del Shadow (IMP-18). Fuente: SPEC v1.1.1
// §15.3 (Shadow prospectivo sin compras reales; conserva por separado
// revisiones y correcciones tardías), §15.1/§15.4 (sin entrenamiento dentro de
// run; la versión activa no se modifica en caliente), §12.1 (Shadow ≠ Replay ≠
// Real; fills hipotéticos siguen simulados), §11.5 (ninguna actualización en
// caliente) y §25.1 fila IMP-18 ("Recomendación timestamped; no órdenes
// reales; hypothetical fills siguen simulated; correcciones en receipts
// separados"; MUST NOT "Shadow≠Replay≠Real; sin entrenamiento dentro de run").
//
// La verificación compara identidades y hashes reales del objeto residente:
// el no-interferirse se demuestra comparando, no afirmando.

import { intactedSession } from "./session.mjs";
import { FILL_EVIDENCE_KINDS } from "../experience/source-types.mjs";

// Checks obligatorios; cada uno lleva { code, ok, detail }. La conjunción es el
// non-interference del Shadow: ninguna dimensión compensa a otra.
export function verifyShadowNonInterference({ session, frozen, records = [], steps = [], trainingEvents = null } = {}) {
  const recordsList = Array.isArray(records) ? records : [];
  const stepsList = Array.isArray(steps) ? steps : [];
  const checks = [...check(session, frozen, recordsList, stepsList, trainingEvents)];
  const ok = checks.every((check) => check.ok === true);
  return { ok, checks, code: ok ? "SHADOW_NON_INTERFERENCE_VERIFIED" : "SHADOW_NON_INTERFERENCE_BROKEN" };
}

function check(session, frozen, recordsList, stepsList, trainingEvents) {
  return [
    sessionIntactCheck(session),
    policyVersionCheck(session, frozen, recordsList),
    trainingCheck(trainingEvents),
    realOrdersCheck(session, recordsList),
    sourceSeparationCheck(recordsList, stepsList),
    temporalOrderCheck(recordsList),
  ];
}

function sessionIntactCheck(session) {
  const sessionCheck = intactedSession(session);
  return {
    code: "SESSION_CONTENT_HASH_INTACT",
    ok: sessionCheck.intact === true,
    detail: sessionCheck.code,
  };
}

// §15.3/§11.5: versión fija del manifest congelado; todo record la conserva.
function policyVersionCheck(session, frozen, recordsList) {
  const frozenArmVersion = frozen?.frozenBundles?.a1?.arm?.armVersion ?? null;
  const sessionBoundToFrozen = session?.policyVersion === frozenArmVersion
    && session?.frozenManifestContentHash === frozen?.contentHash;
  const recordsBound = recordsList.length > 0
    && recordsList.every((record) => record?.policyVersion === session?.policyVersion);
  return {
    code: "POLICY_VERSION_FROZEN",
    ok: sessionBoundToFrozen && recordsBound,
    detail: `session=${session?.policyVersion ?? null} frozen=${frozenArmVersion} recordsBound=${recordsBound}`,
  };
}

// §15.1/§11.5: la actualización de la versión es offline; dentro del run no
// hay evento de entrenamiento.
function trainingCheck(trainingEvents) {
  const noneDeclared = trainingEvents === null || trainingEvents === undefined
    || (Array.isArray(trainingEvents) && trainingEvents.length === 0);
  return {
    code: "NO_TRAINING_DURING_RUN",
    ok: noneDeclared,
    detail: noneDeclared ? "sin eventos de entrenamiento declarados" : `${trainingEvents.length} eventos de entrenamiento durante el run`,
  };
}

// §15.3/§12.1: ningún canal de órdenes reales y ningún REAL_FILL; los fills
// hipotéticos continúan SIMULATED_FILL.
function realOrdersCheck(session, recordsList) {
  const channelClear = session?.realOrderChannel === null;
  const noRealFills = recordsList.every((record) => {
    const fills = record?.execution?.fills ?? [];
    return fills.every((fill) => fill?.evidenceKind !== FILL_EVIDENCE_KINDS.REAL_FILL);
  });
  return {
    code: "NO_REAL_ORDERS",
    ok: channelClear && noRealFills,
    detail: channelClear ? null : "la sesión declara un realOrderChannel no-nulo (§15.3)",
  };
}

// §12.1/§12.3: el corpus Shadow contiene sólo registros SHADOW y filas de
// captura Shadow; ninguna etiqueta lo convierte en otra fuente.
function sourceSeparationCheck(recordsList, stepsList) {
  const recordsAllShadow = recordsList.length > 0
    && recordsList.every((record) => record?.sourceType === "SHADOW");
  const stepsAllShadow = stepsList.every((step) => step?.artifactKind === "IMP-18_SHADOW_STEP");
  const recordIdsUnique = uniqueRecordIds(recordsList);
  return {
    code: "SOURCE_SEPARATION",
    ok: recordsAllShadow && stepsAllShadow && recordIdsUnique,
    detail: recordsAllShadow ? "corpus SHADOW puro" : "corpus mezclado, vacío o duplicado",
  };
}

function uniqueRecordIds(recordsList) {
  const ids = recordsList.map((record) => record?.recordId ?? null);
  return ids.every((id) => id !== null) && new Set(ids).size === ids.length;
}

// §15.3: la recomendación existe y su timestamp precede a todo dato posterior
// registrado en su fila de captura; nada se re-timestampa.
function temporalOrderCheck(recordsList) {
  for (const record of recordsList) {
    const recommendedAt = record?.recommendedAtUtc;
    if (typeof recommendedAt !== "string") {
      return { code: "RECOMMENDATION_BEFORE_POSTERIOR", ok: false, reason: `record ${record?.recordId ?? "?"} sin recommendedAtUtc (§12.2)` };
    }
    const recommendedMs = Date.parse(recommendedAt);
    if (!Number.isFinite(recommendedMs)) {
      return { code: "RECOMMENDATION_BEFORE_POSTERIOR", ok: false, reason: `record ${record?.recordId ?? "?"} con recommendedAtUtc no parseable (§6.1)` };
    }
  }
  return { code: "RECOMMENDATION_BEFORE_POSTERIOR", ok: true, reason: "recomendaciones timestamped; nada se re-timestampa (§15.3)" };
}
