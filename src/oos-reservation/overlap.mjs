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
// fundamento auditado Y que esa intervención cubra de verdad el solapamiento
// detectado (§25.1 IMP-09: "overlaps resueltos por estructura real"). Una
// intervención con la forma correcta cuyo intervalo/días/frontera no alcanzan a
// cubrir el solapamiento no resuelve: HOLD, sin excepción. Sin fundamento, o con
// un embargo sin duración real, el solapamiento queda abierto y la reserva no se
// materializa.

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

// Días entre dos fechas ISO inclusivas: se cuentan ambos extremos.
function inclusiveLengthDays(startIso, endIso) {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  if (!start.ok || !end.ok) {
    return null;
  }
  const startUtc = Date.UTC(start.year, start.month - 1, start.day);
  const endUtc = Date.UTC(end.year, end.month - 1, end.day);
  return Math.round((endUtc - startUtc) / (24 * 60 * 60 * 1000)) + 1;
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

// §25.1 IMP-09/§13.8/§15.2: la forma correcta no basta; la intervención debe
// cubrir el solapamiento detectado por la estructura real:
// - PURGE: el intervalo purgado debe CONTENER el intervalo del solapamiento.
// - EMBARGO: los días de embargo deben cubrir desde el inicio del solapamiento
//   a través de todo el solapamiento y, si la frontera reservada queda después,
//   hasta la frontera (material embargado hasta que deja de contaminar).
// - BOUNDARY_CHANGE: la frontera revisada debe quedar DESPUÉS del fin del
//   solapamiento; todo el material solapado debe quedar en development.
function resolutionCoversOverlap(resolution, detected, boundaryIso, errors) {
  const interval = detected.interval;
  if (resolution.action === "PURGE") {
    const purged = resolution.purgedInterval;
    const contains = compareIsoDates(purged.start, interval.start) <= 0
      && compareIsoDates(purged.end, interval.end) >= 0;
    if (!contains) {
      errors.push({
        code: "RESOLUTION_DOES_NOT_COVER_OVERLAP",
        message: `El purge "${resolution.basis.locator}" purga ${purged.start}..${purged.end} pero el solapamiento detectado alcanza ${interval.start}..${interval.end}; la intervención no cubre el solapamiento (§25.1: overlaps resueltos por estructura real).`,
      });
      return false;
    }
    return true;
  }
  if (resolution.action === "EMBARGO") {
    const embargoStart = parseIsoDate(interval.start);
    if (!embargoStart.ok || parseIsoDate(interval.end).ok === false) {
      errors.push({ code: "RESOLUTION_DOES_NOT_COVER_OVERLAP", message: "El solapamiento detectado no declara un intervalo ISO válido; no se puede verificar la cobertura del embargo." });
      return false;
    }
    let required = inclusiveLengthDays(interval.start, interval.end);
    let embargoEndIso = interval.end;
    if (boundaryIso && parseIsoDate(boundaryIso).ok && compareIsoDates(boundaryIso, interval.end) > 0) {
      required = Math.max(required, inclusiveLengthDays(interval.start, boundaryIso) ?? required);
      embargoEndIso = boundaryIso;
    }
    if (resolution.embargoDays < required) {
      errors.push({
        code: "RESOLUTION_DOES_NOT_COVER_OVERLAP",
        message: `El embargo de ${resolution.embargoDays} días no cubre el solapamiento ${interval.start}..${embargoEndIso} (exige ${required} días desde el inicio del solapamiento, hasta la frontera cuando queda después); §13.8/§15.2 no permiten una intervención menor.`,
      });
      return false;
    }
    return true;
  }
  if (resolution.action === "BOUNDARY_CHANGE") {
    if (boundaryIso && !parseIsoDate(boundaryIso).ok) {
      errors.push({ code: "RESOLUTION_DOES_NOT_COVER_OVERLAP", message: "La frontera reservada no declara una fecha ISO válida; no se puede verificar la cobertura del cambio de frontera." });
      return false;
    }
    if (compareIsoDates(resolution.revisedBoundary, interval.end) <= 0) {
      errors.push({
        code: "RESOLUTION_DOES_NOT_COVER_OVERLAP",
        message: `La frontera revisada (${resolution.revisedBoundary}) no queda después del fin del solapamiento (${interval.end}); el cambio de frontera no cubre el solapamiento (§13.8).`,
      });
      return false;
    }
    return true;
  }
  return true;
}

// Empareja cada solapamiento detectado con su intervención auditada. Devuelve
// los resueltos, los abiertos y los errores de forma y de COBERTURA de las
// intervenciones. boundaryIso es la frontera protegida de la reserva (la
// primera ventana sellada); es la referencia contra la que el embargo debe
// cubrir y la frontera revisada debe superar. Sin frontera, la cobertura de
// embargo se exige sólo sobre el propio intervalo del solapamiento.
export function resolveOverlaps(overlaps, resolutions = [], options = {}) {
  const declared = Array.isArray(resolutions) ? resolutions : [];
  const boundaryIso = options?.boundaryIso ?? null;
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
    if (!resolutionCoversOverlap(match, detected, boundaryIso, errors)) {
      unresolved.push(detected);
      continue;
    }
    resolved.push({ ...detected, action: match.action, basis: match.basis, ...(match.action === "BOUNDARY_CHANGE" ? { revisedBoundary: match.revisedBoundary } : {}) });
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
