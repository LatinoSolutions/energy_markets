// Calibración en development y protección del OOS de S1 (IMP-11). Fuente:
// SPEC v1.1.1 §8.6 (development/calibration cronológicos; congelar parámetros;
// abrir recalibración sólo como ciclo versionado nuevo), §13.8 (el OOS final no
// sirve para escoger lógica, parámetros, referencias ni thresholds; modificarlos
// tras examinarlo consume el OOS) y §25.2 fila IMP-11 (REQUIRES_AUDIT DEP-06/07
// precios/referencias development; DEP-12 reserva OOS válida/intacta).
//
// Este módulo NO elige parámetros por su cuenta ni inventa una metodología: la
// configuración llega ya congelada y aquí se valida contra material de
// development, se confirma que la reserva está sellada y que los thresholds se
// congelaron antes de la frontera OOS. Si falta material o reserva, HOLD.

import { contentHashOf } from "../sizing-controller/versioning.mjs";
import { isReservationIntact } from "../oos-reservation/index.mjs";
import { computeS1Features } from "./causal-reference.mjs";
import { assertConfigurationFrozen } from "./configuration.mjs";

function windowHasOosCampaign(windowCampaignId, sealedOosCampaignIds) {
  return sealedOosCampaignIds.includes(windowCampaignId);
}

// §13.8/§15.2: la frontera protegida del manifest es la fecha desde la que el
// OOS está sellado. La config debe haberse congelado ANTES de esa frontera.
export function assertThresholdsFrozenBeforeOos(configuration, reservation) {
  if (!reservation || reservation.decision !== "RESERVED") {
    return {
      ok: false,
      code: "OOS_RESERVATION_NOT_SEALED",
      message: "No hay reserva OOS sellada: no puede demostrarse que los thresholds quedaron congelados fuera del OOS (§13.8/§25.2 DEP-12).",
    };
  }
  const protectedFromIso = reservation.chronologicalSplit?.protectedFromIso ?? null;
  if (typeof protectedFromIso !== "string") {
    return { ok: false, code: "MISSING_PROTECTED_BOUNDARY", message: "La reserva no declara frontera protegida; el congelado no es verificable." };
  }
  const frozen = configuration?.frozenAtUtc ?? null;
  if (typeof frozen !== "string") {
    return { ok: false, code: "THRESHOLDS_NOT_FROZEN", message: "La configuración no declara frozenAtUtc." };
  }
  const frozenDate = frozen.slice(0, 10);
  if (!(frozenDate < protectedFromIso)) {
    return {
      ok: false,
      code: "THRESHOLDS_FROZEN_AFTER_OOS",
      message: `La configuración se congeló en ${frozenDate} y la frontera OOS empieza en ${protectedFromIso}: los thresholds quedaron dentro del OOS (§13.8).`,
    };
  }
  return { ok: true, protectedFromIso, frozenAtUtc: frozen };
}

// §8.6/§25.2 IMP-11: la calibración se hace sobre development cronológico. Se
// computan las features de cada ventana de development con la referencia
// congelada; una ventana OOS en la lista, o una referencia inválida, bloquea.
export function calibrateDevelopment({ configuration, searchSpace, developmentWindows, reservation, provenance } = {}) {
  const configGuard = assertConfigurationFrozen(configuration);
  if (!configGuard.ok) {
    return { ok: false, status: "BLOCKED", code: configGuard.code, blockedBy: [configGuard.code], message: configGuard.message };
  }
  const intact = isReservationIntact(reservation);
  if (!intact.intact) {
    return {
      ok: false,
      status: "HOLD",
      code: "DEP-12_OOS_NOT_INTACT",
      blockedBy: ["DEP-12_OOS_NOT_INTACT", ...intact.reasons],
      message: "La reserva OOS no está sellada/intacta: no se calibra S1 sin frontera protegida (§25.2 DEP-12).",
    };
  }
  const oosGuard = assertThresholdsFrozenBeforeOos(configuration, reservation);
  if (!oosGuard.ok) {
    return { ok: false, status: "HOLD", code: oosGuard.code, blockedBy: [oosGuard.code], message: oosGuard.message };
  }
  if (!Array.isArray(developmentWindows) || developmentWindows.length === 0) {
    return {
      ok: false,
      status: "HOLD",
      code: "DEP-06/07_MISSING_DEVELOPMENT_REFERENCES",
      blockedBy: ["DEP-06/07_MISSING_DEVELOPMENT_REFERENCES"],
      message: "Sin ventanas de development con precios/referencias causales no hay calibración de S1 (§25.2 DEP-06/07).",
    };
  }
  const sealedOosCampaignIds = reservation.sealedOosCampaignIds ?? [];
  const diagnostics = [];
  for (const [index, window] of developmentWindows.entries()) {
    if (window === null || typeof window !== "object") {
      return { ok: false, status: "BLOCKED", code: "INVALID_DEVELOPMENT_WINDOW", blockedBy: ["INVALID_DEVELOPMENT_WINDOW"], message: `developmentWindows[${index}] no es válido.` };
    }
    if (windowHasOosCampaign(window.campaignId, sealedOosCampaignIds)) {
      return {
        ok: false,
        status: "BLOCKED",
        code: "OOS_WINDOW_IN_DEVELOPMENT",
        blockedBy: ["OOS_WINDOW_IN_DEVELOPMENT"],
        message: `La campaña sellada "${window.campaignId}" aparece en development: seleccionar o calibrar sobre el OOS lo consume (§13.8).`,
      };
    }
    const features = computeS1Features({
      asOfUtc: window.asOfUtc,
      decisionPrice: window.decisionPrice,
      history: window.history ?? [],
      reference: configuration.reference,
    });
    if (!features.ok) {
      return { ok: false, status: "BLOCKED", code: features.code, blockedBy: [features.code], message: `Ventana ${window.campaignId}: ${features.code}.` };
    }
    diagnostics.push({
      campaignId: window.campaignId,
      status: features.status,
      uncertainty: features.uncertainty,
      percentile: features.features?.percentile ?? null,
      signedDistanceToReference: features.features?.signedDistanceToReference ?? null,
    });
  }
  if (diagnostics.some((item) => item.status !== "AVAILABLE")) {
    return {
      ok: false,
      status: "HOLD",
      code: "DEP-06/07_INSUFFICIENT_DEVELOPMENT_HISTORY",
      blockedBy: ["DEP-06/07_INSUFFICIENT_DEVELOPMENT_HISTORY"],
      diagnostics,
      message: "Alguna ventana de development no produce una referencia S1 válida; se registra el faltante, no se inventa historia (§6.2/§8.1).",
    };
  }
  const receiptCore = {
    configurationHash: configuration.contentHash,
    searchSpaceHash: searchSpace?.contentHash ?? null,
    developmentCampaignIds: developmentWindows.map((window) => window.campaignId),
    protectedFromIso: oosGuard.protectedFromIso,
    frozenAtUtc: oosGuard.frozenAtUtc,
    provenance: provenance ?? configuration.provenance,
  };
  return {
    ok: true,
    status: "CALIBRATED_DEVELOPMENT",
    configuration,
    diagnostics,
    calibrationReceipt: {
      artifactKind: "IMP-11_S1_CALIBRATION_RECEIPT",
      ...receiptCore,
      contentHash: contentHashOf(receiptCore),
    },
  };
}
