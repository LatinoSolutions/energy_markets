// Zonas de evidencia y OOS histórico del modo TRADES para las 4 misiones, con
// función de reserva NUEVA y versionada. Fuente:
// docs/canonical/v1_1_1/OWNER_PATCH_TRADES_MODE_2026-09-25.md §4 (una sola
// frontera temporal: Development, OOS histórico, Embargo, Puente, Post-puente,
// Forward; purge de las campaigns que cruzan fronteras; IDs canónicos) y
// TRADES_MODE_PLAN.md TR-02.
//
// NO modifica `reserveSealedOos` (IMP-09, fijo en 8 campaigns y sólo
// Quarterly): la reserva IMP-09 y su HOLD quedan intactas. Esta reserva cubre
// las 4 misiones por separado y reutiliza `recordOosAccess` (reservation.mjs)
// con los propósitos de acceso de TRADES.
//
// Price-blind: consume ventanas de calendario y cobertura de TR-01; no lee
// precios ni campos de resultado.

import { CANONICAL_SPEC_IDENTITY } from "../office/spec-binding.mjs";
import { compareIsoDates, parseIsoDate } from "./campaign-register.mjs";
import {
  TRADES_ACCESS_PURPOSES,
  contentHashOf,
  recordOosAccess,
  reservationBindingFor,
} from "./reservation.mjs";
import {
  TRADES_MISSIONS,
  canonicalCampaignIdFromLegacy,
  materializeTradesWindows,
} from "./trades-windows.mjs";

// Identidad de la norma que gobierna las zonas: owner patch 03. El sha256 es el
// de sus bytes reales (docs/canonical/v1_1_1/OWNER_PATCH_TRADES_MODE_2026-09-25.md);
// test/oos-reservation/trades-zones.test.mjs lo recomputa para que no quede stale.
export const TRADES_PATCH_IDENTITY = Object.freeze({
  id: "OWNER_PATCH_TRADES_MODE_2026-09-25.md",
  version: "EM-SPEC-OWNER-PATCH-2026-09-25-03",
  path: "docs/canonical/v1_1_1/OWNER_PATCH_TRADES_MODE_2026-09-25.md",
  sha256: "3e68171cec3f2eb86e48341b3046ba81f3ef925d12fb1cfa835863c9c8b9a494",
});

export const TRADES_ZONES_VERSION = "TRADES_ZONES_V1";

export const TRADES_ZONES_ACCEPTANCE_TEST = "Productor price-blind; campaigns por zona y misión con IDs canónicos; cobertura TR-01 anexada sin sustituir campaigns; purge de las campaigns que cruzan fronteras.";

// Patch 03 §4: una sola frontera temporal para todas las misiones.
export const ZONE_BOUNDARIES = Object.freeze({
  DEVELOPMENT_END: "2024-05-31",
  OOS_START: "2024-06-01",
  OOS_END: "2025-05-31",
  EMBARGO_START: "2025-06-01",
  EMBARGO_END: "2025-08-11",
  BRIDGE_START: "2025-08-12",
  BRIDGE_END: "2026-07-28",
  POST_BRIDGE_START: "2026-07-29",
});

export const ZONES = Object.freeze({
  DEVELOPMENT: "DEVELOPMENT",
  OOS_HISTORICO: "OOS_HISTORICO",
  EMBARGO: "EMBARGO",
  PUENTE: "PUENTE",
  POST_PUENTE: "POST_PUENTE",
  FORWARD: "FORWARD",
  PURGE: "PURGE",
});

// Patch 03 §4: el archivo del cliente llega hasta 2026-09-11 (fuente de
// post-puente). El forward arranca en el freeze de TRADES-v1, que no está
// fijado: no se materializan campaigns forward (fail-closed).
export const EVIDENCE_HORIZON_END = "2026-09-11";
export const FORWARD_STATUS = Object.freeze({
  zone: ZONES.FORWARD,
  status: "OPEN_PENDING_FREEZE",
  fromIso: null,
  reason: "El forward arranca en el freeze de TRADES-v1 (patch 03 §4); la fecha no está fijada, así que no se materializa ninguna campaign forward.",
});

function pushError(errors, code, message, context = {}) {
  errors.push({ code, message, ...context });
}

// Intervalo cerrado [windowStart, deadline] contra [zoneStart, zoneEnd].
function overlapsWindow(windowStart, deadline, zoneStart, zoneEnd) {
  return compareIsoDates(windowStart, zoneEnd) <= 0 && compareIsoDates(deadline, zoneStart) >= 0;
}

// Asigna zona a una campaign por su ventana. Las campaigns que cruzan el
// embargo se purgan (patch 03 §4); las que cruzan el inicio del post-puente
// pertenecen al post-puente (GAS-Q-2026Q4, Monthly 2026-08). Ventana que no cae
// en ninguna regla → null (fail-closed, no se inventa zona).
export function assignZone({ windowStart, deadline }) {
  const boundaries = ZONE_BOUNDARIES;
  if (overlapsWindow(windowStart, deadline, boundaries.EMBARGO_START, boundaries.EMBARGO_END)) {
    return ZONES.PURGE;
  }
  if (compareIsoDates(deadline, boundaries.DEVELOPMENT_END) <= 0) {
    return ZONES.DEVELOPMENT;
  }
  if (compareIsoDates(windowStart, boundaries.OOS_START) >= 0 && compareIsoDates(deadline, boundaries.OOS_END) <= 0) {
    return ZONES.OOS_HISTORICO;
  }
  if (compareIsoDates(windowStart, boundaries.BRIDGE_START) >= 0 && compareIsoDates(deadline, boundaries.BRIDGE_END) <= 0) {
    return ZONES.PUENTE;
  }
  if (compareIsoDates(windowStart, boundaries.POST_BRIDGE_START) >= 0) {
    return ZONES.POST_PUENTE;
  }
  if (compareIsoDates(deadline, boundaries.POST_BRIDGE_START) >= 0) {
    return ZONES.POST_PUENTE;
  }
  return null;
}

// Traduce las campaigns del backtest TOB exploratorio (producto base G0B*/DEB*,
// maturity legada `YYYYMM`) a sus IDs canónicos. Sólo se lee identidad: los
// artefactos del backtest contienen precios y NO se abren aquí.
export function registerTobSeenEpisodes({ tobCampaigns = [] } = {}) {
  const seenCampaignIds = [];
  const unmapped = [];
  for (const campaign of tobCampaigns) {
    const campaignId = canonicalCampaignIdFromLegacy({ shortCode: campaign?.product, maturity: campaign?.maturity });
    if (campaignId === null) {
      unmapped.push({ product: campaign?.product ?? null, maturity: campaign?.maturity ?? null });
      continue;
    }
    seenCampaignIds.push(campaignId);
  }
  return { seenCampaignIds: [...new Set(seenCampaignIds)].sort(), unmapped };
}

function validateSpecIdentity(spec, errors) {
  if (!spec || typeof spec !== "object") {
    pushError(errors, "MISSING_SPEC_IDENTITY", "La reserva TRADES no declara la identidad del owner patch 03.");
    return;
  }
  for (const field of ["id", "version"]) {
    if (spec[field] !== TRADES_PATCH_IDENTITY[field]) {
      pushError(errors, "SPEC_IDENTITY_MISMATCH", `La reserva TRADES declara ${field} = ${spec[field]}; sólo puede sellarse bajo el owner patch vigente (${TRADES_PATCH_IDENTITY.id}, ${TRADES_PATCH_IDENTITY.version}).`);
    }
  }
}

function basePlan(overrides) {
  return {
    artifactKind: "TR-02_TRADES_ZONE_PLAN",
    schemaVersion: TRADES_ZONES_VERSION,
    spec: TRADES_PATCH_IDENTITY,
    canonicalSpec: CANONICAL_SPEC_IDENTITY,
    reservationId: null,
    decision: "HOLD",
    missions: {},
    purge: [],
    bridge: { seenCampaignIds: [], notSeenCampaignIds: [] },
    forward: { ...FORWARD_STATUS },
    reservationBinding: null,
    accessRegistry: { oosStatus: "HOLD", entries: [] },
    errors: [],
    blockedBy: [],
    reason: null,
    contentHash: null,
    ...overrides,
  };
}

// Reserva NUEVA y versionada: materializa las ventanas de las 4 misiones desde
// el calendario, las asigna a zonas, purga las que cruzan fronteras y anexa la
// cobertura de TR-01. No toca la reserva IMP-09.
export function reserveTradesZones(input = {}) {
  const errors = [];
  const spec = input.spec ?? TRADES_PATCH_IDENTITY;
  validateSpecIdentity(spec, errors);

  const bindingErrors = [];
  const binding = reservationBindingFor(input, bindingErrors);
  errors.push(...bindingErrors);

  const horizonEndIso = input.horizonEndIso ?? EVIDENCE_HORIZON_END;
  if (!parseIsoDate(horizonEndIso).ok) {
    pushError(errors, "MISSING_HORIZON_END", "La reserva TRADES no declara un horizonEndIso ISO-8601; sin horizonte no se acota la evidencia.");
  }

  const windows = materializeTradesWindows({
    gasExchangeDays: input.gasExchangeDays,
    powerExchangeDays: input.powerExchangeDays,
    coverageRecords: input.coverageRecords ?? [],
    horizonEndIso,
    startMaturities: input.startMaturities ?? {},
  });
  errors.push(...windows.errors);

  const seen = new Set(input.tobSeenCampaignIds ?? []);
  const missions = {};
  const purge = [];
  const bridgeSeen = [];
  const bridgeNotSeen = [];
  let totalCampaigns = 0;

  for (const missionKey of Object.keys(TRADES_MISSIONS)) {
    const result = windows.missions[missionKey];
    const zones = {
      [ZONES.DEVELOPMENT]: [],
      [ZONES.OOS_HISTORICO]: [],
      [ZONES.EMBARGO]: [],
      [ZONES.PUENTE]: [],
      [ZONES.POST_PUENTE]: [],
      [ZONES.FORWARD]: [],
    };
    for (const campaign of result.campaigns) {
      const zone = assignZone(campaign);
      if (zone === null) {
        pushError(errors, "UNCLASSIFIED_CAMPAIGN", `La campaign "${campaign.campaignId}" no cae en ninguna zona de §4; no se le asigna una zona inventada.`, { campaignId: campaign.campaignId });
        continue;
      }
      campaign.zone = zone;
      totalCampaigns += 1;
      if (zone === ZONES.PURGE) {
        purge.push({
          campaignId: campaign.campaignId,
          product: campaign.product,
          mission: campaign.mission,
          maturity: campaign.maturity,
          windowStart: campaign.windowStart,
          deadline: campaign.deadline,
          reason: "cruza el embargo 2025-06-01..2025-08-11 (patch 03 §4: campaigns que cruzan fronteras → purge)",
        });
        continue;
      }
      zones[zone].push(campaign);
      if (zone === ZONES.PUENTE) {
        if (seen.has(campaign.campaignId)) {
          campaign.tobSeen = true;
          bridgeSeen.push(campaign.campaignId);
        } else {
          campaign.tobSeen = false;
          bridgeNotSeen.push(campaign.campaignId);
        }
      }
    }
    missions[missionKey] = {
      product: result.definition.product,
      mission: result.definition.mission,
      market: result.definition.market,
      shortCode: result.definition.shortCode,
      zones,
    };
  }

  if (totalCampaigns === 0 && errors.length === 0) {
    pushError(errors, "NO_CAMPAIGNS", "Ninguna misión materializó campaigns; la reserva no tiene población.");
  }

  const manifestCore = {
    reservationId: input.reservationId ?? null,
    horizonEndIso,
    spec: { id: spec.id, version: spec.version, sha256: spec.sha256 ?? null },
    reservationBinding: binding,
    missions: Object.fromEntries(Object.entries(missions).map(([key, value]) => [
      key,
      {
        zones: Object.fromEntries(Object.entries(value.zones).map(([zone, campaigns]) => [zone, campaigns.map((campaign) => campaign.campaignId)])),
      },
    ])),
    purge: purge.map((entry) => entry.campaignId),
    bridgeSeen: [...bridgeSeen].sort(),
  };

  if (errors.length > 0) {
    return basePlan({
      reservationId: input.reservationId ?? null,
      spec,
      missions,
      purge,
      bridge: { seenCampaignIds: [...bridgeSeen].sort(), notSeenCampaignIds: [...bridgeNotSeen].sort() },
      reservationBinding: binding,
      errors,
      blockedBy: [...new Set(errors.map((error) => error.code))],
      reason: "HOLD: la reserva TRADES no satisface su forma, su binding o la clasificación de zonas; no se sella ninguna zona.",
    });
  }

  return basePlan({
    reservationId: input.reservationId ?? null,
    spec,
    decision: "RESERVED",
    missions,
    purge,
    bridge: { seenCampaignIds: [...bridgeSeen].sort(), notSeenCampaignIds: [...bridgeNotSeen].sort() },
    reservationBinding: binding,
    accessRegistry: { oosStatus: "SEALED", entries: [] },
    reason: null,
    contentHash: contentHashOf(manifestCore),
  });
}

// Registro de acceso al OOS reutilizando `recordOosAccess` con los propósitos
// de TRADES. Un run_id nuevo sobre el OOS cuenta como una nueva apertura.
export function recordTradesOosAccess(plan, entry = {}) {
  if (!TRADES_ACCESS_PURPOSES[entry?.purpose]) {
    return { ok: false, code: "NOT_A_TRADES_ACCESS_PURPOSE", message: `El propósito "${entry?.purpose}" no es un acceso TRADES declarado.`, reservation: plan ?? null, oosOpenings: null };
  }
  const outcome = recordOosAccess(plan, entry);
  if (!outcome.ok) {
    return { ...outcome, oosOpenings: null };
  }
  const openings = new Set(
    outcome.reservation.accessRegistry.entries
      .filter((item) => item.consumesOos && typeof item.runId === "string" && item.runId.length > 0)
      .map((item) => item.runId),
  );
  return { ...outcome, oosOpenings: openings.size };
}

// Acceptance de TR-02. Sólo acredita que la reserva TRADES se materializó; no
// acredita data del cliente ni research PASS.
export function evaluateTradesZonesAcceptance(plan) {
  const criterionMet = plan?.decision === "RESERVED"
    && (plan.errors?.length ?? 0) === 0
    && plan.spec?.version === TRADES_PATCH_IDENTITY.version;
  return {
    acceptanceTest: TRADES_ZONES_ACCEPTANCE_TEST,
    source: "OWNER_PATCH_TRADES_MODE_2026-09-25.md §4 / TRADES_MODE_PLAN.md TR-02",
    decision: plan?.decision ?? null,
    criterionMet,
    blockedBy: [...new Set(plan?.blockedBy ?? [])],
    reason: plan?.reason ?? null,
  };
}
