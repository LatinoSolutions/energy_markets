// Builder determinista del registro de elegibilidad Gas Quarterly (IMP-09.
// Prescripción audit IMP-09, paso 3): recibe las reglas de campaña del paquete
// del cliente (01_campaigns, convención 3-1-3 documentada en
// 01_shared_campaign_rules.md §1), la fuente de identidad P-006 (punto 6,
// campaignId determinista), el calendario OFICIAL de Exchange Days de EEX, la
// evidencia de episodios del lago EEX (presencias y conteos, nunca precios) y
// la fecha de corte, y deriva el registro contiguo 2021Q1..asOf.
//
// REGLA 2 (marcado): este builder NO decide la elegibilidad por cuenta propia
// y NO re-deriva los deadlines con la evidencia fijada de IMP-02
// (deriveQuarterlyEpisodeDeadline); consume la(s) evidencia(s) ya verificada(s)
// y ligadas por su SHA-256 — el binding del hash es lo que hace auditable la
// derivación. Sin calendario oficial el deadline queda SIN DETERMINAR y el
// resultado es HOLD (§13.8; la partición del lago ni una heurística de fines de
// semana NO son calendario). Nunca emite precios ni inventa datos de cliente.

import { parseIsoDate, compareIsoDates } from "./campaign-register.mjs";
import { contentHashOf } from "./reservation.mjs";
import { isCanonicalMaturity, researchCampaignIdFor } from "../procurement-contract/campaign-contract.mjs";

export const REGISTER_START_QUARTER = { year: 2021, quarter: 1 };
export const OOS_PRODUCT = "Gas";
export const OOS_MISSION = "Quarterly";

// La elegibilidad que produce este builder se deriva de presencias del lago
// (trades en ventana, TOB <= 11:00 Berlin), no de la determinación del mandato:
// su base es PROXY. Sólo un registro auditado (AUDITED) puede sellar el OOS.
export const DERIVED_ELIGIBILITY_BASIS = "PROXY";

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

function isSha256Hex(value) {
  return typeof value === "string" && SHA256_HEX_PATTERN.test(value);
}

function isIsoDate(value) {
  return parseIsoDate(value).ok === true;
}

function isoDateOf(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Ventana fiscal 3-1-3 del episodio (regla del cliente: los tres meses
// anteriores al gap que termina dos meses antes del inicio del delivery).
// Mismos meses que quarterlyWindow de los fixtures y que la evidencia del audit.
function fiscalWindow(maturity) {
  const year = Number(maturity.slice(0, 4));
  const quarter = Number(maturity.slice(5));
  const deliveryStartMonth = (quarter - 1) * 3 + 1;
  const startTotal = year * 12 + (deliveryStartMonth - 1) - 4;
  const endTotal = year * 12 + (deliveryStartMonth - 1) - 2;
  const startIso = isoDateOf(Math.floor(startTotal / 12), (startTotal % 12) + 1, 1);
  const endYear = Math.floor(endTotal / 12);
  const endMonth = (endTotal % 12) + 1;
  const endDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  return { startIso, endIso: isoDateOf(endYear, endMonth, endDay) };
}

// Deadline del episodio sobre estructura REAL: el último Exchange Day oficial
// dentro de la ventana fiscal. Sin calendario oficial no deadline: la
// partición del lago ni la heurística de fines de semana no son calendario
// (prescripción audit IMP-09, paso 2).
function deadlineFromCalendar(window, exchangeDays) {
  const days = exchangeDays.filter((day) => compareIsoDates(day, window.startIso) >= 0 && compareIsoDates(day, window.endIso) <= 0);
  return days.length > 0 ? days[days.length - 1] : null;
}

function quarterIndexOf(maturity) {
  return Number(maturity.slice(0, 4)) * 4 + (Number(maturity.slice(5)) - 1);
}

function maturityOfIndex(index) {
  const year = Math.floor(index / 4);
  const quarter = (index % 4) + 1;
  return `${year}Q${quarter}`;
}

function pushError(errors, code, message) {
  errors.push({ code, message });
}

function validateSourceSha256(sources, errors) {
  let ok = true;
  for (const [name, value] of Object.entries(sources)) {
    if (!isSha256Hex(value)) {
      pushError(errors, "INVALID_SOURCE_HASH", `El hash de la fuente "${name}" no es un SHA-256 hex de 64 caracteres.`);
      ok = false;
    }
  }
  return ok;
}

// Evidencia de episodios del audit (paso 1 de la prescripción):
// operations/audit/IMP-09/eex-quarterly-episode-evidence.json — presencias y
// conteos, nunca precios.
export function buildEligibilityRegister(input = {}) {
  const errors = [];
  const sources = input.sourceHashes ?? null;
  if (!sources || typeof sources !== "object" || !isSha256Hex(sources.clientPackageCampaignRules) || !isSha256Hex(sources.eexEvidence)) {
    pushError(errors, "MISSING_SOURCE_HASHES", "El builder exige los hashes de las reglas de campaña del cliente y de la evidencia EEX fijada; sin ligazón no deriva el registro.");
  }
  if (!input.p006 || !isSha256Hex(input.p006.sha256)) {
    pushError(errors, "MISSING_P006_SOURCE", "El builder exige la fuente P-006 con su SHA-256: la identidad del episodio es derivable, no una etiqueta (P-006 punto 6).");
  }
  if (!input.asOfIso || !isIsoDate(input.asOfIso)) {
    pushError(errors, "MISSING_CUTOFF_DATE", "El builder exige la fecha de corte (asOfIso) de la evidencia; sin corte no hay registro determinista.");
  }
  if (!isSha256Hex(input.evidenceSha256)) {
    pushError(errors, "MISSING_EEX_EVIDENCE", "El builder exige la evidencia EEX con su SHA-256; sin evidencia no se acepta ninguna etiqueta ELIGIBLE.");
  }

  // Calendario oficial: fail-closed. Sin calendario el deadline queda sin
  // determinar y el resultado correcto es HOLD.
  const calendar = input.exchangeCalendar;
  if (!calendar || typeof calendar !== "object") {
    pushError(errors, "MISSING_EXCHANGE_CALENDAR", "Sin el calendario oficial de Exchange Days el deadline queda sin determinar; el registro no se deriva (prescripción paso 2).");
  } else {
    if (!isSha256Hex(calendar.sha256)) {
      pushError(errors, "INVALID_SOURCE_HASH", "El calendario oficial no declara su SHA-256; una fuente sin hash no es auditable.");
    }
    if (!Array.isArray(calendar.exchangeDays) || calendar.exchangeDays.length === 0 || calendar.exchangeDays.some((day) => !isIsoDate(day))) {
      pushError(errors, "INVALID_EXCHANGE_CALENDAR", "El calendario oficial no declara días de intercambio ISO válidos.");
    }
  }

  // 2026Q4 u otro quarter posterior al corte no se construye: la evidencia
  // ligada no lo cubre.
  const cutoff = input.asOfIso || "9999-12-31";
  const cutoffIndex = quarterIndexOf(`${Number(cutoff.slice(0, 4))}Q${Math.max(1, Math.ceil(Number(cutoff.slice(5, 7)) / 3))}`);
  const startIndex = quarterIndexOf(`${REGISTER_START_QUARTER.year}Q${REGISTER_START_QUARTER.quarter}`);
  const episodeEvidence = (input.evidence && typeof input.evidence === "object" && !Array.isArray(input.evidence)) ? (input.evidence.episodes ?? {}) : {};
  const evidenceSnapshot = input.evidence?.snapshot ?? null;
  if (!evidenceSnapshot || !isSha256Hex(evidenceSnapshot.sha256) || typeof evidenceSnapshot.identity !== "string" || evidenceSnapshot.identity.trim().length === 0) {
    pushError(errors, "EEX_EVIDENCE_WITHOUT_SNAPSHOT", "La evidencia EEX no declara la identidad de la foto del lago (snapshot) con su SHA-256; sin foto no hay historial auditado.");
  }

  if (errors.length > 0) {
    return { ok: false, register: [], eligibilityBasis: null, errors, blockedBy: [...new Set(errors.map((error) => error.code))], registerHash: null };
  }

  const exchangeDays = calendar.exchangeDays.slice().sort(compareIsoDates);
  const exchangeDaySet = new Set(exchangeDays);
  const register = [];
  for (let index = startIndex; index <= cutoffIndex; index += 1) {
    const maturity = maturityOfIndex(index);
    const campaignId = researchCampaignIdFor(OOS_PRODUCT, OOS_MISSION, maturity);
    const window = fiscalWindow(maturity);
    const episode = episodeEvidence[maturity] ?? null;
    const deadline = deadlineFromCalendar(window, exchangeDays);

    // Elegibilidad derivada de la evidencia: presencia de trades del episodio
    // en la ventana. Sin evidencia no hay etiqueta ELIGIBLE (H2). Completitud:
    // cada Exchange Day OFICIAL de la ventana con TOB <= 11:00 Berlin; sin
    // calendario no hay deadline ni completitud (fail-closed, prescripción 2).
    const tradedInWindow = Boolean(episode && (episode.tradedInWindow === true || (Array.isArray(episode.windowTradedDays) && episode.windowTradedDays.length > 0) || Number(episode.tradeCount) > 0));
    const tobDays = episode && Array.isArray(episode.windowTobBefore11BerlinDays) ? episode.windowTobBefore11BerlinDays : [];
    const tobCoveredDays = new Set(tobDays.filter((day) => isIsoDate(day)));
    const exchangeDaysInWindow = exchangeDays.filter((day) => compareIsoDates(day, window.startIso) >= 0 && compareIsoDates(day, window.endIso) <= 0);
    const incompleteToB = exchangeDaysInWindow.filter((day) => !tobCoveredDays.has(day));
    const exchangeDaysCovered = exchangeDays.length > 0 && exchangeDaysInWindow.every((day) => tobCoveredDays.has(day));
    // La evidencia del audit puede declarar la cobertura TOB verificada por
    // episodio (tobCovered, con su locator por maturity en la evidencia
    // hashada); el builder la acepta como evidencia ligada, no como etiqueta
    // sin fuente. Si no la declara, se calcula contra los Exchange Days
    // oficiales de la ventana.
    const declaredCoverage = episode?.tobCovered === true;
    const covered = declaredCoverage || (exchangeDaysInWindow.length > 0 && exchangeDaysCovered);
    const complete = tradedInWindow && deadline !== null && exchangeDaysInWindow.length > 0 && covered;

    register.push({
      campaignId,
      product: OOS_PRODUCT,
      mission: OOS_MISSION,
      maturity,
      eligibility: tradedInWindow && deadline !== null ? "ELIGIBLE" : "INELIGIBLE",
      completeness: complete ? "COMPLETE" : "INCOMPLETE",
      // REGLA 2/3: la elegibilidad derivada de presencias del lago NO es la
      // determinación del mandato; la reconciliación R-17 la registra como PROXY
      // (operations/audit/IMP-09/R01-R17-reconciliation.json). El registro
      // derivado se marca PROXY para que la reserva no lo confunda con el
      // auditado (§25.1 input "Eligibility auditada"; §13.3 dataset auditado).
      eligibilityBasis: DERIVED_ELIGIBILITY_BASIS,
      windowStart: window.startIso,
      deadline,
      provenance: {
        authority: "Evidencia EEX fijada + calendario oficial EEX + reglas de campaña del paquete del cliente",
        locator: "operations/audit/IMP-09/eex-quarterly-episode-evidence.json + eex-exchange-calendar.json (01_campaigns/*)",
        sha256: { clientRules: input.sourceHashes.clientPackageCampaignRules, evidence: input.sourceHashes.eexEvidence, calendar: calendar.sha256 },
      },
      eligibilityEvidence: tradedInWindow
        ? { authority: "operations/audit/IMP-09/eex-quarterly-episode-evidence.json", locator: `episodes.${maturity}.tradedInWindow`, sha256: input.sourceHashes.eexEvidence }
        : null,
      completenessEvidence: complete
        ? { authority: "operations/audit/IMP-09/eex-exchange-calendar.json + eex-quarterly-episode-evidence.json", locator: `episodes.${maturity}.tobCovered`, sha256: calendar.sha256 }
        : null,
      fiscalWindow: window,
      missingTobDays: incompleteToB,
    });
  }

  const ineligible = register.filter((episode) => episode.eligibility !== "ELIGIBLE").map((episode) => episode.maturity);
  const blockedBy = [];
  if (ineligible.length > 0) {
    blockedBy.push("COMPUTED_ELIGIBILITY_GAPS");
  }
  return { ok: true, register, eligibilityBasis: DERIVED_ELIGIBILITY_BASIS, errors, blockedBy, registerHash: contentHashOf(register) };
}
