// Apertura de una sesión Shadow prospectiva (IMP-18). Fuente: SPEC v1.1.1
// §15.3 (Forward/Shadow: prospectiva, versión fija, sin compras reales;
// registra qué datos podía consumir la policy, qué recomendó, cuándo y qué
// habría ejecutado bajo el contrato hipotético), §15.1 (Shadow: candidate
// frozen consume información prospectiva; recommendation y path posterior son
// factuales; fills hipotéticos simulados), §16.2 (A0 Research: Shadow sin
// autoridad real), §12.1 (Shadow factual: no equivale a Real Execution) y
// §25.2 fila IMP-18 (versión elegible de §15; fuentes prospectivas y
// permisos/PIT aplicables).
//
// La sesión es content-addressed e inmutable: la identidad de la versión fija
// (Policy Version) la aporta el manifest congelado ex-ante de IMP-16; la
// captura no la re-wirea. Fail-closed: sin manifest congelado, sin permisos
// prospectivos declarados o con canal de órdenes reales presente no hay
// sesión.

import { contentHashOf, versionKeyOf } from "../execution-contract/execution-contract.mjs";
import { toUtcTimestamp } from "../pit-views/time.mjs";
import { verifyFrozenIntegrity } from "../p5-experiment/run.mjs";

export const SHADOW_SESSION_KIND = "IMP-18_SHADOW_SESSION";
export const SHADOW_SCHEMA_VERSION = "1.0";
// §15.1/§16.2: el Shadow corre como Research (A0); ninguna autoridad real.
export const SHADOW_DECLARED_AUTHORITY = "A0_RESEARCH_NO_REAL_ORDERS";

function fail(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}

// §15.3: sin canal de órdenes reales. Un canal presente no se configura:
// aborta la sesión (fail-closed).
function rejectRealOrderChannel(input) {
  if (input.realOrderChannel !== undefined && input.realOrderChannel !== null) {
    return fail("REAL_ORDERS_FORBIDDEN", "El Shadow no envía compras reales: un realOrderChannel provisto aborta la apertura de sesión (§15.3).");
  }
  return null;
}

// §25.2 DEP-06/07: las fuentes prospectivas y los permisos/PIT aplicables se
// declaran en la apertura; sin declaración no hay captura que llame "datos
// disponibles".
function validateProspectivePermissions(permissions) {
  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) {
    return fail("MISSING_PROSPECTIVE_PERMISSIONS", "La sesión Shadow exige una declaración de permisos/PIT de las fuentes prospectivas (§25.2 DEP-06/07).");
  }
  if (!Array.isArray(permissions.permissionRefs) || permissions.permissionRefs.length === 0
    || permissions.permissionRefs.some((ref) => typeof ref !== "string" || ref.trim().length === 0)) {
    return fail("INVALID_PROSPECTIVE_PERMISSION_REFS", "La declaración de permisos exige permissionRefs no vacías (§25.2 DEP-06/07).");
  }
  if (typeof permissions.declaredBy !== "string" || permissions.declaredBy.trim().length === 0) {
    return fail("INVALID_PROSPECTIVE_PERMISSION_DECLARER", "La declaración de permisos debe declarar quién la emite (§25.2 DEP-06/07).");
  }
  return null;
}

// Identidad del manifest congelado de IMP-16 que la captura Shadow necesita
// (versión fija de policy, controller, dataset). { ok: false } si falta.
function frozenIdentityOf(frozen) {
  const bundle = frozen.frozenBundles.a1;
  const armVersion = bundle?.arm?.armVersion ?? null;
  if (typeof armVersion !== "string" || armVersion.trim().length === 0) {
    return { ok: false, code: "SHADOW_POLICY_VERSION_UNAVAILABLE", message: "El brazo A1 del manifest congelado no declara una versión de policy utilizable (§15.3: versión fija)." };
  }
  return {
    ok: true,
    identity: {
      armVersion,
      campaignId: bundle?.campaign?.campaignId ?? null,
      controllerHash: bundle?.sizingConfiguration?.contentHash ?? null,
    },
  };
}

export function openShadowSession(input = {}) {
  const frozenResult = verifyFrozenIntegrity(input.frozen ?? null);
  if (!frozenResult.ok) {
    return fail(frozenResult.code ?? "MISSING_FROZEN_EXPERIMENT", "El Shadow requiere un manifest P5 congelado ex-ante, sin mutación (§15.3/§14.9).");
  }
  const frozen = input.frozen;

  const ordersGuard = rejectRealOrderChannel(input);
  if (ordersGuard) return ordersGuard;

  const permissionsGuard = validateProspectivePermissions(input.prospectivePermissions ?? null);
  if (permissionsGuard) return permissionsGuard;

  const startedAt = toUtcTimestamp(input.startedAtUtc);
  if (!startedAt.ok) {
    return fail(startedAt.code ?? "MISSING_STARTED_AT_UTC", "La sesión exige un startedAtUtc anclado a zona explícita (§6.1).");
  }
  // Prospectivo: la captura arranca después de la congelación ex-ante.
  if (new Date(startedAt.utc).getTime() < new Date(frozen.frozenAtUtc).getTime()) {
    return fail("SESSION_NOT_PROSPECTIVE", "La sesión Shadow arranca después de congelar la versión; un startedAtUtc anterior al frozenAtUtc no es prospectivo (§15.3).");
  }

  const identityOutcome = frozenIdentityOf(frozen);
  if (!identityOutcome.ok) {
    return identityOutcome;
  }
  const identity = identityOutcome.identity;

  const prospectivePermissions = {
    ...input.prospectivePermissions,
    permissionRefs: [...input.prospectivePermissions.permissionRefs],
  };
  const synthetic = input.synthetic === true;

  // §25.2.1/§15.3: la identidad de la sesión liga la APERTURA concreta, no sólo
  // el experimento. Dos aperturas del mismo experimento (distinto instante,
  // permisos o sello congelado) son instancias distintas y no pueden compartir
  // sessionId; el binding de progreso posterior usa esa identidad.
  const openingSeed = contentHashOf({
    experiment: {
      experimentId: frozen.experiment.experimentId,
      experimentVersion: frozen.experiment.experimentVersion,
    },
    campaignId: identity.campaignId,
    policyVersion: identity.armVersion,
    sizingControllerVersion: versionKeyOf({ contentHash: identity.controllerHash }),
    datasetManifestId: frozen.datasetManifest?.manifestId ?? null,
    datasetManifestVersion: frozen.datasetManifest?.manifestVersion ?? null,
    frozenManifestContentHash: frozen.contentHash,
    frozenAtUtc: frozen.frozenAtUtc,
    startedAtUtc: startedAt.utc,
    prospectivePermissions,
    synthetic,
    declaredAuthority: SHADOW_DECLARED_AUTHORITY,
    realOrderChannel: null,
  });

  const core = {
    artifactKind: SHADOW_SESSION_KIND,
    schemaVersion: SHADOW_SCHEMA_VERSION,
    sessionId: `SHADOW-${frozen.experiment.experimentId}-${openingSeed.slice(0, 16)}`,
    forwardKind: "PROSPECTIVE_CAPTURE",
    experiment: {
      experimentId: frozen.experiment.experimentId,
      experimentVersion: frozen.experiment.experimentVersion,
    },
    campaignId: identity.campaignId,
    policyVersion: identity.armVersion,
    sizingControllerVersion: versionKeyOf({ contentHash: identity.controllerHash }),
    datasetManifestId: frozen.datasetManifest?.manifestId ?? null,
    datasetManifestVersion: frozen.datasetManifest?.manifestVersion ?? null,
    declaredAuthority: SHADOW_DECLARED_AUTHORITY,
    realOrderChannel: null,
    frozenManifestContentHash: frozen.contentHash,
    frozenAtUtc: frozen.frozenAtUtc,
    startedAtUtc: startedAt.utc,
    prospectivePermissions,
    synthetic,
    status: "OPEN",
  };
  const contentHash = contentHashOf(core);
  return { ok: true, session: Object.freeze({ ...core, contentHash }) };
}

// Verifica que el objeto sesión residente sigue siendo el sellado en la
// apertura (§15.4: la versión activa no se modifica en caliente; el sesgo de
// una sesión mutada se detecta por identidad, no por confianza).
export function intactedSession(session) {
  if (!session || typeof session !== "object" || session.artifactKind !== SHADOW_SESSION_KIND) {
    return { intact: false, code: "SESSION_NOT_A_SHADOW_SESSION" };
  }
  const { contentHash, ...core } = session;
  if (typeof contentHash !== "string" || contentHashOf(core) !== contentHash) {
    return { intact: false, code: "SESSION_CONTENT_HASH_MISMATCH" };
  }
  return { intact: true, code: "SESSION_CONTENT_HASH_INTACT" };
}
