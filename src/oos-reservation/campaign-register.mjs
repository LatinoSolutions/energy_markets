// Registro de elegibilidad de campañas Gas Quarterly para la reserva OOS de
// IMP-09. Fuente: SPEC v1.1.1 §13.3 (la lista exacta de campañas y fechas
// proviene del dataset auditado), §13.8 (últimas 8 campañas completas y
// elegibles) y §15.2 (split cronológico). El registro es un INPUT auditado:
// este módulo no lo inventa ni decide elegibilidad; valida su forma y rechaza
// que la reserva se contamine con outcomes o con artefactos de calibración.
//
// REGLA 2 (simplificación marcada): el modelo de fechas es ISO-8601
// `YYYY-MM-DD` de calendario. La SPEC no fija serialización; exportarlo distinto
// no cambia la semántica de ventana/plazo.

import { isVersionLike } from "../contracts/identities.mjs";
import { isCanonicalMaturity, researchCampaignIdFor } from "../procurement-contract/campaign-contract.mjs";

export const ELIGIBILITY_STATUSES = ["ELIGIBLE", "INELIGIBLE"];
export const COMPLETENESS_STATUSES = ["COMPLETE", "INCOMPLETE"];

// §13.3/§15.2: la población del primer experimento es exclusivamente Gas
// Quarterly. Otra Mission o producto no completa la muestra ni se mezcla.
export const OOS_PRODUCT = "Gas";
export const OOS_MISSION = "Quarterly";

// §25.1 IMP-09 MUST NOT: "no seleccionar campañas por resultado". Estos campos
// son la huella de un outcome económico; su presencia en el registro habilita
// una selección por resultado y se rechaza antes de reservar.
const OUTCOME_LIKE_FIELDS = [
  "outcome",
  "pnl",
  "profit",
  "value",
  "V",
  "H",
  "deltaV",
  "return",
  "performance",
  "score",
  "sortino",
  "meanV",
];

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year, month) {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1];
}

// Fecha ISO de calendario estricta. Un valor imposible (2020-02-30) no se
// normaliza a otro día: normalizarlo movería la ventana de procurement.
export function parseIsoDate(value) {
  if (typeof value !== "string") {
    return { ok: false, code: "INVALID_ISO_DATE" };
  }
  const match = ISO_DATE_PATTERN.exec(value);
  if (match === null) {
    return { ok: false, code: "INVALID_ISO_DATE" };
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return { ok: false, code: "INVALID_ISO_DATE" };
  }
  return { ok: true, year, month, day };
}

// Comparación lexicográfica válida sólo tras comprobar la forma ISO.
export function compareIsoDates(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function calendarYearOf(isoDate) {
  const parsed = parseIsoDate(isoDate);
  return parsed.ok ? parsed.year : null;
}

function hasProvenance(entry) {
  const source = entry?.provenance ?? entry?.source;
  return source !== null
    && typeof source === "object"
    && isNonEmptyString(source.authority)
    && isNonEmptyString(source.locator);
}

// Instancia H2 (audit IMP-09): la etiqueta ELIGIBLE/COMPLETE no se acepta a
// secas. Cada afirmación debe venir acompañada de la evidencia declarada del
// audit (authority + locator); sin ella la etiqueta es un placeholder.
// Fuente: SPEC v1.1.1 §13.3 (la lista proviene del dataset auditado) y §15.2
// (conserva evidencia propia).
function hasEvidenceRef(evidence) {
  return evidence !== null
    && typeof evidence === "object"
    && !Array.isArray(evidence)
    && isNonEmptyString(evidence.authority)
    && isNonEmptyString(evidence.locator);
}

function pushError(errors, code, message, campaignId = null) {
  errors.push({ code, campaignId, message });
}

// Un episodio declara su identidad canónica (producto + Mission + maturity,
// P-006 punto 6) y su ventana real de procurement. `eligibility` y
// `completeness` son resultados del audit, no inferencias de este módulo.
function validateEpisode(episode, errors) {
  if (!episode || typeof episode !== "object" || Array.isArray(episode)) {
    pushError(errors, "INVALID_EPISODE", "El registro contiene una entrada que no es un objeto de campaña.");
    return;
  }
  const campaignId = episode.campaignId ?? null;

  for (const field of OUTCOME_LIKE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(episode, field)) {
      pushError(errors, "OUTCOME_FIELD_PRESENT", `La campaña "${campaignId}" declara el campo "${field}"; la reserva no se selecciona por resultado (IMP-09 MUST NOT).`, campaignId);
    }
  }

  if (episode.product !== OOS_PRODUCT || episode.mission !== OOS_MISSION) {
    pushError(errors, "NOT_GAS_QUARTERLY", `La campaña "${campaignId}" no es Gas Quarterly; el primer experimento no mezcla producto ni Mission (§13.3).`, campaignId);
  }

  if (!isCanonicalMaturity(OOS_MISSION, episode.maturity)) {
    pushError(errors, "INVALID_EPISODE_MATURITY", `La maturity "${episode.maturity}" no es YYYYQn (Q1–Q4); no es un episodio Quarterly válido.`, campaignId);
  } else {
    const canonicalId = researchCampaignIdFor(OOS_PRODUCT, OOS_MISSION, episode.maturity);
    if (canonicalId !== campaignId) {
      pushError(errors, "CAMPAIGN_ID_NOT_CANONICAL", `campaignId = ${campaignId} no es la identidad determinista del episodio (${canonicalId}) (P-006 punto 6).`, campaignId);
    }
  }

  if (!ELIGIBILITY_STATUSES.includes(episode.eligibility)) {
    pushError(errors, "INVALID_ELIGIBILITY_STATUS", `La elegibilidad de "${campaignId}" debe ser ${ELIGIBILITY_STATUSES.join(" | ")}.`, campaignId);
  } else if (episode.eligibility === "ELIGIBLE" && !hasEvidenceRef(episode.eligibilityEvidence)) {
    pushError(errors, "ELIGIBILITY_WITHOUT_EVIDENCE", `La campaña "${campaignId}" declara ELIGIBLE sin evidencia (authority + locator) del audit; una etiqueta sin evidencia no sostiene la población (§13.3).`, campaignId);
  }
  if (!COMPLETENESS_STATUSES.includes(episode.completeness)) {
    pushError(errors, "INVALID_COMPLETENESS_STATUS", `La completitud de "${campaignId}" debe ser ${COMPLETENESS_STATUSES.join(" | ")}.`, campaignId);
  } else if (episode.completeness === "COMPLETE" && !hasEvidenceRef(episode.completenessEvidence)) {
    pushError(errors, "COMPLETENESS_WITHOUT_EVIDENCE", `La campaña "${campaignId}" declara COMPLETE sin evidencia (authority + locator) del audit; una etiqueta sin evidencia no sostiene la población (§13.3).`, campaignId);
  }

  const windowStart = parseIsoDate(episode.windowStart);
  const deadline = parseIsoDate(episode.deadline);
  if (!windowStart.ok) {
    pushError(errors, "INVALID_ISO_DATE", `La ventana de "${campaignId}" no declara windowStart ISO-8601 (YYYY-MM-DD).`, campaignId);
  }
  if (!deadline.ok) {
    pushError(errors, "INVALID_ISO_DATE", `La campaña "${campaignId}" no declara deadline ISO-8601 (YYYY-MM-DD).`, campaignId);
  }
  if (windowStart.ok && deadline.ok && compareIsoDates(episode.windowStart, episode.deadline) > 0) {
    pushError(errors, "INVALID_WINDOW_RANGE", `La ventana de "${campaignId}" termina antes de empezar (windowStart > deadline).`, campaignId);
  }

  // §13.8/§15.2: los overlaps de feature histories e information boundaries se
  // resuelven con la estructura real. Si el audit los declara, su forma debe
  // ser una fecha ISO válida; no se inventa longitud de embargo ni de lookback.
  for (const field of ["featureHistoryStart", "informationBoundaryStart"]) {
    if (Object.prototype.hasOwnProperty.call(episode, field) && episode[field] !== null && !parseIsoDate(episode[field]).ok) {
      pushError(errors, "INVALID_ISO_DATE", `La campaña "${campaignId}" declara ${field} sin forma ISO-8601 (YYYY-MM-DD).`, campaignId);
    }
  }

  if (!hasProvenance(episode)) {
    pushError(errors, "MISSING_PROVENANCE", `La campaña "${campaignId}" no trae autoridad y locator de la elegibilidad/calendario auditados.`, campaignId);
  }
}

// Índice contable de quarters: orden y huecos sin comparar textos.
export function quarterIndex(maturity) {
  return Number(maturity.slice(0, 4)) * 4 + Number(maturity.slice(5));
}

export function validateEligibilityRegister(campaigns) {
  const errors = [];
  if (!Array.isArray(campaigns)) {
    return { ok: false, errors: [{ code: "REGISTER_NOT_ARRAY", campaignId: null, message: "El registro de campañas debe ser una lista." }] };
  }
  const seenCampaignIds = new Set();
  const seenMaturities = new Set();
  for (const episode of campaigns) {
    validateEpisode(episode, errors);
    if (episode && typeof episode === "object") {
      if (seenCampaignIds.has(episode.campaignId)) {
        pushError(errors, "DUPLICATE_CAMPAIGN_ID", `Campaign ID repetido en el registro: ${episode.campaignId}.`, episode.campaignId);
      }
      seenCampaignIds.add(episode.campaignId);
      if (seenMaturities.has(episode.maturity)) {
        pushError(errors, "DUPLICATE_EPISODE", `Maturity repetida en el registro: ${episode.maturity}.`, episode.campaignId);
      }
      seenMaturities.add(episode.maturity);
    }
  }
  return { ok: errors.length === 0, errors };
}

// Orden cronológico por maturity; el split de §13.8 es cronológico, nunca por
// resultado ni por shuffle aleatorio.
export function chronologicalEligibleComplete(campaigns) {
  return campaigns
    .filter((episode) => episode?.eligibility === "ELIGIBLE" && episode?.completeness === "COMPLETE")
    .slice()
    .sort((left, right) => quarterIndex(left.maturity) - quarterIndex(right.maturity));
}

// Identidad de la SPEC que gobierna la reserva. Debe coincidir con la SPEC
// vigente declarada en el repositorio.
export const IMP09_SPEC_IDENTITY = {
  id: "PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md",
  version: "1.1.1",
  sha256: "666a9735d9daf62764582f017056171acae52070d18499b26c5c6e426cff3ef3",
};

export function validateSpecIdentity(spec) {
  const errors = [];
  if (!spec || typeof spec !== "object") {
    return { ok: false, errors: [{ code: "MISSING_SPEC_IDENTITY", message: "La reserva no declara la identidad de la SPEC." }] };
  }
  if (!isNonEmptyString(spec.id)) {
    errors.push({ code: "MISSING_SPEC_ID", message: "Falta spec.id." });
  }
  if (!isVersionLike(spec.version)) {
    errors.push({ code: "MISSING_SPEC_VERSION", message: "Falta spec.version con forma de versión." });
  }
  if (typeof spec.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(spec.sha256)) {
    errors.push({ code: "INVALID_SPEC_SHA256", message: "spec.sha256 debe ser SHA-256 hex de 64 caracteres." });
  }
  return { ok: errors.length === 0, errors };
}
