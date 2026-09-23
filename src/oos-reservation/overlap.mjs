// Detección y resolución de solapamientos del sealed OOS. Fuente: SPEC v1.1.1
// §13.8 ("Los overlaps de procurement windows, feature histories o information
// boundaries se resuelven mediante purge, embargo o cambio de frontera, según
// el audit real; no se inventa un número de días de embargo") y §15.2
// ("Overlap temporal se trata mediante purge, embargo o frontera revisada según
// ventanas y disponibilidad reales. El audit determina la intervención
// necesaria; no hay una duración universal frozen").
//
// La resolución NO la decide este módulo: sólo comprueba que cada solapamiento
// detectado por la estructura real venga acompañado de una intervención con
// fundamento auditado. Sin fundamento, o con un embargo sin duración real, el
// solapamiento queda abierto y la reserva no se materializa.

import { compareIsoDates, parseIsoDate } from "./campaign-register.mjs";

export const OVERLAP_KINDS = [
  "PROCUREMENT_WINDOW",
  "DEVELOPMENT_OOS_BOUNDARY",
  "FEATURE_HISTORY",
  "INFORMATION_BOUNDARY",
];

export const OVERLAP_ACTIONS = ["PURGE", "EMBARGO", "BOUNDARY_CHANGE"];

export const DEVELOPMENT_MATERIAL = "DEVELOPMENT_MATERIAL";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasBasis(resolution) {
  const basis = resolution?.basis;
  return basis !== null
    && typeof basis === "object"
    && isNonEmptyString(basis.authority)
    && isNonEmptyString(basis.locator);
}

// Solapamiento inclusivo de dos intervalos cerrados [start, end].
function intervalsOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  return compareIsoDates(leftStart, rightEnd) <= 0 && compareIsoDates(rightStart, leftEnd) <= 0;
}

function overlap(kind, between, start, end, reason) {
  return { kind, between, interval: { start, end }, reason };
}

// Detecta los solapamientos que la estructura real de las ventanas y las
// fronteras declaradas produce. No declara un solapamiento que no exista.
export function detectOverlaps({ sealedOos, development = [] } = {}) {
  const sealed = Array.isArray(sealedOos) ? sealedOos : [];
  const overlaps = [];
  if (sealed.length === 0) {
    return overlaps;
  }

  // §13.8: cualquier par de ventanas de procurement solapadas debe resolverse,
  // no sólo las adyacentes. Un solapamiento anidado o entre campañas no
  // consecutivas también invade la estructura real y no puede quedar sin
  // intervención mientras la reserva sella igual.
  for (let left = 0; left < sealed.length; left += 1) {
    for (let right = left + 1; right < sealed.length; right += 1) {
      const previous = sealed[left];
      const current = sealed[right];
      if (previous.windowStart && current.windowStart && intervalsOverlap(previous.windowStart, previous.deadline, current.windowStart, current.deadline)) {
        overlaps.push(overlap(
          "PROCUREMENT_WINDOW",
          [previous.campaignId, current.campaignId],
          current.windowStart < previous.windowStart ? current.windowStart : previous.windowStart,
          previous.deadline > current.deadline ? previous.deadline : current.deadline,
          "Dos campañas reservadas tienen ventanas de procurement solapadas.",
        ));
      }
    }
  }

  const firstSealed = sealed[0];
  // §13.8: cualquier ventana de development que invada el sealed OOS rompe la
  // frontera protegida; no basta con comparar la última campaña de development,
  // porque una campaña intermedia con ventana larga también puede invadirla.
  const developmentCampaigns = Array.isArray(development) ? development : [];
  for (const developmentEpisode of developmentCampaigns) {
    for (const sealedEpisode of sealed) {
      if (developmentEpisode.windowStart && sealedEpisode.windowStart && intervalsOverlap(developmentEpisode.windowStart, developmentEpisode.deadline, sealedEpisode.windowStart, sealedEpisode.deadline)) {
        overlaps.push(overlap(
          "DEVELOPMENT_OOS_BOUNDARY",
          [developmentEpisode.campaignId, sealedEpisode.campaignId],
          developmentEpisode.windowStart < sealedEpisode.windowStart ? developmentEpisode.windowStart : sealedEpisode.windowStart,
          developmentEpisode.deadline > sealedEpisode.deadline ? developmentEpisode.deadline : sealedEpisode.deadline,
          "Una campaña de development toca la frontera del sealed OOS.",
        ));
      }
    }
  }

  for (const episode of sealed) {
    if (isNonEmptyString(episode.featureHistoryStart) && compareIsoDates(episode.featureHistoryStart, firstSealed.windowStart) < 0) {
      overlaps.push(overlap(
        "FEATURE_HISTORY",
        [episode.campaignId, DEVELOPMENT_MATERIAL],
        episode.featureHistoryStart,
        firstSealed.windowStart,
        "La feature history de una campaña sellada alcanza material anterior a la frontera reservada.",
      ));
    }
    if (isNonEmptyString(episode.informationBoundaryStart) && compareIsoDates(episode.informationBoundaryStart, firstSealed.windowStart) < 0) {
      overlaps.push(overlap(
        "INFORMATION_BOUNDARY",
        [episode.campaignId, DEVELOPMENT_MATERIAL],
        episode.informationBoundaryStart,
        firstSealed.windowStart,
        "La information boundary de una campaña sellada alcanza material anterior a la frontera reservada.",
      ));
    }
  }

  return overlaps;
}

function sameBetween(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  const leftSet = new Set(left);
  return right.every((item) => leftSet.has(item));
}

function matchesOverlap(resolution, detected) {
  return resolution?.kind === detected.kind && sameBetween(resolution.between, detected.between);
}

// La intervención debe declarar la estructura real que la justifica. Una
// intervención sin fundamento auditado no resuelve; un EMBARGO sin duración
// real sería inventar el número de días que §13.8 prohíbe.
function resolutionIsComplete(resolution, errors) {
  if (!OVERLAP_ACTIONS.includes(resolution?.action)) {
    errors.push({ code: "INVALID_OVERLAP_ACTION", message: `La intervención de solapamiento usa una acción no declarada: ${resolution?.action}.` });
    return false;
  }
  if (!hasBasis(resolution)) {
    errors.push({ code: "OVERLAP_RESOLUTION_WITHOUT_BASIS", message: "La intervención de solapamiento no cita autoridad y locator del audit real (§13.8/§15.2)." });
    return false;
  }
  if (resolution.action === "EMBARGO") {
    if (!Number.isInteger(resolution.embargoDays) || resolution.embargoDays <= 0) {
      errors.push({ code: "EMBARGO_WITHOUT_REAL_DURATION", message: "El embargo exige una duración real en días; §13.8 prohíbe inventarla." });
      return false;
    }
  }
  if (resolution.action === "PURGE") {
    const purged = resolution.purgedInterval;
    if (!purged || !parseIsoDate(purged.start).ok || !parseIsoDate(purged.end).ok) {
      errors.push({ code: "PURGE_WITHOUT_REAL_INTERVAL", message: "El purge exige el intervalo real purgado con fechas ISO válidas." });
      return false;
    }
  }
  if (resolution.action === "BOUNDARY_CHANGE") {
    if (!parseIsoDate(resolution.revisedBoundary).ok) {
      errors.push({ code: "BOUNDARY_CHANGE_WITHOUT_REVISED_BOUNDARY", message: "El cambio de frontera exige la frontera revisada con fecha ISO válida." });
      return false;
    }
  }
  return true;
}

// Empareja cada solapamiento detectado con su intervención auditada. Devuelve
// los resueltos, los abiertos y los errores de forma de las intervenciones.
export function resolveOverlaps(overlaps, resolutions = []) {
  const declared = Array.isArray(resolutions) ? resolutions : [];
  const errors = [];
  const resolved = [];
  const unresolved = [];

  for (const detected of overlaps) {
    const match = declared.find((resolution) => matchesOverlap(resolution, detected));
    if (!match) {
      unresolved.push({ ...detected, reason: `${detected.reason} Sin intervención auditada que lo resuelva.` });
      continue;
    }
    const formErrors = [];
    if (!resolutionIsComplete(match, formErrors)) {
      errors.push(...formErrors);
      unresolved.push(detected);
      continue;
    }
    resolved.push({ ...detected, action: match.action, basis: match.basis });
  }

  for (const resolution of declared) {
    const matched = overlaps.some((detected) => matchesOverlap(resolution, detected));
    if (!matched) {
      errors.push({
        code: "UNMATCHED_OVERLAP_RESOLUTION",
        message: `La intervención "${resolution?.action}" no corresponde a ningún solapamiento detectado; un artefacto stale no puede sellar la reserva.`,
      });
    }
  }

  return { ok: errors.length === 0 && unresolved.length === 0, resolved, unresolved, errors };
}
