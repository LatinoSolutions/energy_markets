// Reserva del sealed final OOS de IMP-09. Fuente: SPEC v1.1.1 §25.1 (objetivo,
// output y acceptance: manifest de las últimas 8 Gas Quarterly elegibles,
// frontera protegida y registro de acceso/consumo; ≥2 años; historia
// insuficiente → HOLD) y §25.2 fila IMP-09 (RESOLVES_AUDIT DEP-12:
// disponibilidad, solapamientos y reserva; registro de frontera/acceso).
//
// La reserva se identifica y sella ANTES de seleccionar features, referencias o
// parámetros de S1 (§13.8, §15.2, B07). El cierre P6 no es prerequisite para
// reservar. Este módulo no decide elegibilidad ni lee resultados económicos: sin
// 8 campañas completas y elegibles auditadas permanece en HOLD, sin reserva
// ficticia.

import { createHash } from "node:crypto";

import { toUtcTimestamp } from "../pit-views/time.mjs";
import {
  IMP09_SPEC_IDENTITY,
  calendarYearOf,
  chronologicalEligibleComplete,
  compareIsoDates,
  parseIsoDate,
  quarterIndex,
  resolveEligibilityBasis,
  validateEligibilityRegister,
  validateSpecIdentity,
} from "./campaign-register.mjs";
import { detectOverlaps, resolveOverlaps } from "./overlap.mjs";

export const IMP09_ACCEPTANCE_TEST = "≥2 años; chronological split y overlaps resueltos por estructura real; historia insuficiente → HOLD. La reserva precede a features/references/parameters; cierre P6 no es prerequisite para reservar.";

// §13.8/§5.7: la evidencia mínima Quarterly son 8 trimestres OOS completos
// abarcando al menos 2 años calendario.
export const SEALED_OOS_CAMPAIGN_COUNT = 8;
export const SEALED_OOS_MIN_CALENDAR_YEARS = 2;

// §25.1 MUST NOT y §15.2: la reserva es cronológica sobre la población
// elegible; seleccionar por resultado consume y contamina el OOS.
export const CHRONOLOGICAL_RESERVATION_BASIS = "CHRONOLOGICAL_ELIGIBLE";

// §13.8: la reserva precede a las decisiones que el OOS debe validar. Si el
// input ya trae alguno de estos artefactos, la reserva llega tarde.
const CALIBRATION_ARTIFACT_KEYS = [
  "features",
  "references",
  "parameters",
  "s1Configuration",
  "calibration",
  "baselineVariants",
  "executionSettings",
];

const ACCESS_PURPOSES = {
  OOS_EVALUATION_INSPECTION: { consumesOos: false, section: "§15.2 (evaluación de versión frozen)" },
  CALIBRATION: { consumesOos: true, section: "§15.2" },
  FEATURE_SELECTION: { consumesOos: true, section: "§13.8" },
  REFERENCE_SELECTION: { consumesOos: true, section: "§13.8" },
  PARAMETER_SELECTION: { consumesOos: true, section: "§13.8" },
  BASELINE_VARIANT_SELECTION: { consumesOos: true, section: "§13.8" },
  EXECUTION_SETTING_SELECTION: { consumesOos: true, section: "§13.8" },
};

// Registro de elegibilidad real del caso Gas Quarterly. El paquete verificado
// del cliente permite DERIVAR el registro (regla 3-1-3 delineada en
// 01_shared_campaign_rules.md §1) y el builder determinista ya lo materializa
// sobre la evidencia EEX fijada y el calendario oficial de Exchange Days
// (operations/audit/IMP-09/evaluate-quarterly-register.mjs). Esta constante NO
// materializa ese registro derivado: conserva la ausencia registrada en el corte
// original de la matriz IMP-03 (R-01/R-17 UNAVAILABLE) para el camino estático
// reserveGasQuarterlySealedOos. La elegibilidad derivada sigue siendo PROXY y,
// con la evidencia local, aporta 3 campañas completas y elegibles (< 8), por lo
// que el resultado correcto es HOLD sin reserva ficticia. No se inventa una
// lista ni se presentan fixtures sintéticos como evidencia.
export const GAS_QUARTERLY_ELIGIBILITY_AUDIT = {
  scope: "P5 Gas Quarterly",
  campaigns: [],
  documentedAbsence: {
    reason: "El registro derivado del caso Gas Quarterly ya existe (src/oos-reservation/register-builder.mjs sobre operations/audit/IMP-09/eex-quarterly-episode-evidence.json + eex-exchange-calendar.json + reglas de campaña del paquete del cliente + P-006), pero esta constante no lo materializa: conserva la ausencia registrada en el corte original de la matriz IMP-03 (R-01/R-17 UNAVAILABLE). La reconciliación append-only posterior (operations/audit/IMP-09/R01-R17-reconciliation.json) acredita R-01 como derivable y R-17 como elegibilidad calculada (PROXY); con la evidencia local el registro derivado aporta 3 campañas completas y elegibles (< 8) → HOLD sin reserva ficticia.",
    sources: [
      "operations/audit/IMP-09/R01-R17-reconciliation.json (contribución posterior al paquete, sin editar la matriz)",
      "operations/audit/IMP-09/eex-quarterly-episode-evidence.json + SHA256SUMS (presencias, nunca precios)",
      "operations/audit/IMP-09/eex-exchange-calendar.json (calendario oficial EEX; si no hay calendario el deadline queda sin determinar → HOLD)",
      "src/oos-reservation/register-builder.mjs (builder determinista del registro 2021Q1..asOf)",
      "operations/audit/IMP-03/data-sufficiency-matrix.json (R-01, R-17: UNAVAILABLE en el corte original, intacta)",
      "docs/canonical/v1_1_1/sources/AUDIT_INPUTS_ENERGY_MARKETS.md §9.1, §10, §11",
      "SPEC v1.1.1 §13.3/§13.8",
    ],
    retrievalAction: "Ejecutar el audit script del lago (operations/audit/IMP-09/audit-eex-quarterly-evidence.py) y, con el calendario oficial disponible, derivar el registro determinísticamente con register-builder.mjs; bajo el mínimo de §13.8 el resultado correcto es HOLD INSUFFICIENT_ELIGIBLE_COMPLETE_CAMPAIGNS.",
  },
};

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// PLACEHOLDER (REGLA 2): serialización canónica propia para identificar la
// versión del manifest; la SPEC v1.1.1 no fija la serialización.
function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const members = Object.keys(value).sort().map((name) => `${JSON.stringify(name)}:${canonicalJson(value[name])}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function contentHashOf(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function pushError(errors, code, message) {
  errors.push({ code, message });
}

// §25.1/DEP-12: binding de fuentes del manifest. La reserva reproduce la fecha
// de corte (cutoff) de la evidencia y los hashes de identidad de cada fuente
// (registro de campañas, evidencia EEX, calendario oficial, paquete del
// cliente). Cambia cualquier hash cambia el contentHash del manifest.
const SOURCE_HASH_PATTERN = /^[0-9a-f]{64}$/;

export function reservationBindingFor(input, errors = []) {
  const binding = input?.reservationBinding;
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    pushError(errors, "MISSING_RESERVATION_BINDING", "La reserva no declara reservationBinding (cutoff y hashes de fuentes); sin ligazón no es un historial auditado.");
    return { cutoffIso: null, sourceHashes: {} };
  }
  let cutoffIso = null;
  if (binding.cutoffIso === undefined || binding.cutoffIso === null) {
    pushError(errors, "MISSING_CUTOFF_DATE", "El binding de la reserva no declara la fecha de corte (cutoffIso); sin corte no hay frontera verificable.");
  } else if (!parseIsoDate(binding.cutoffIso).ok) {
    pushError(errors, "INVALID_CUTOFF_DATE", "El cutoffIso del binding no es una fecha ISO-8601 (YYYY-MM-DD).");
  } else {
    cutoffIso = binding.cutoffIso;
  }

  const sourceHashes = {};
  if (!binding.sourceHashes || typeof binding.sourceHashes !== "object" || Array.isArray(binding.sourceHashes) || Object.keys(binding.sourceHashes).length === 0) {
    pushError(errors, "MISSING_SOURCE_HASHES", "El binding de la reserva no declara ningún hash de fuente (registro, evidencia, calendario, paquete del cliente).");
  } else {
    for (const [name, value] of Object.entries(binding.sourceHashes)) {
      if (typeof name !== "string" || name.trim().length === 0) {
        pushError(errors, "INVALID_SOURCE_HASH", `El hash de fuente usa un nombre vacío o no declarado.`);
        continue;
      }
      if (typeof value !== "string" || !SOURCE_HASH_PATTERN.test(value)) {
        pushError(errors, "INVALID_SOURCE_HASH", `El hash de la fuente "${name}" no es un SHA-256 hex de 64 caracteres.`);
        continue;
      }
      sourceHashes[name] = value;
    }
  }

  return { cutoffIso, sourceHashes };
}

function declaredCalibrationArtifacts(input) {
  return CALIBRATION_ARTIFACT_KEYS.filter((key) => {
    const value = input?.[key];
    if (value === undefined || value === null) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return true;
  });
}

// §13.8/§5.7: extensión calendario del OOS reservado. Con 8 maturities distintas
// el mínimo de 2 años se cumple por construcción; el cálculo queda explícito
// para verificar la evidencia y no confiar en la etiqueta.
export function computeOosSpan(sealed) {
  if (!Array.isArray(sealed) || sealed.length === 0) {
    return null;
  }
  const years = new Set();
  for (const episode of sealed) {
    const year = calendarYearOf(episode.deadline);
    if (year !== null) {
      years.add(year);
    }
  }
  const first = sealed[0];
  const last = sealed[sealed.length - 1];
  const calendarYears = [...years].sort((left, right) => left - right);
  return {
    firstMaturity: first.maturity,
    lastMaturity: last.maturity,
    firstWindowStart: first.windowStart,
    firstDeadline: first.deadline,
    lastWindowStart: last.windowStart,
    lastDeadline: last.deadline,
    calendarYears,
    calendarYearsCount: calendarYears.length,
    minCalendarYears: SEALED_OOS_MIN_CALENDAR_YEARS,
    coversMinYears: calendarYears.length >= SEALED_OOS_MIN_CALENDAR_YEARS,
  };
}

function baseResult(overrides) {
  return {
    artifactKind: "IMP-09_SEALED_OOS_RESERVATION",
    schemaVersion: "1.0",
    spec: IMP09_SPEC_IDENTITY,
    reservationId: null,
    product: "Gas",
    mission: "Quarterly",
    reservationBasis: null,
    eligibilityBasis: null,
    decision: "HOLD",
    sealedOosCount: 0,
    sealedOosCampaignIds: [],
    developmentCampaignIds: [],
    excludedCampaigns: [],
    span: null,
    chronologicalSplit: null,
    overlapResolutions: [],
    accessRegistry: { oosStatus: "HOLD", entries: [] },
    precedesCalibration: true,
    registerAbsence: null,
    errors: [],
    blockedBy: [],
    reason: null,
    contentHash: null,
    ...overrides,
  };
}

// Reserva las últimas 8 campañas Gas Quarterly completas y elegibles, sella la
// frontera y registra el split. Devuelve HOLD, sin reserva ficticia, si la
// historia es insuficiente o si un solapamiento queda sin resolución real.
export function reserveSealedOos(input = {}) {
  const errors = [];
  // §25.1 input "Eligibility auditada": la base se propaga a todo resultado
  // (manifest y acceptance) para que un registro derivado (PROXY) no se
  // confunda con el auditado.
  const eligibilityBasis = resolveEligibilityBasis(input.campaigns);
  const result = (overrides) => baseResult({ eligibilityBasis, ...overrides });

  const calibrationArtifacts = declaredCalibrationArtifacts(input);
  if (calibrationArtifacts.length > 0) {
    pushError(errors, "RESERVATION_AFTER_CALIBRATION", `La reserva llega después de declarar ${calibrationArtifacts.join(", ")}; §13.8 exige reservar el OOS antes de elegir features, referencias, parámetros, variantes de baseline o execution settings.`);
  }

  if (input.reservationBasis !== CHRONOLOGICAL_RESERVATION_BASIS) {
    if (input.reservationBasis === "OUTCOME" || input.reservationBasis === "OUTCOME_BASED") {
      pushError(errors, "OUTCOME_BASED_SELECTION", "La reserva declara un basis de selección por resultado; la población OOS no se elige por outcome (IMP-09 MUST NOT, §15.2).");
    } else {
      pushError(errors, "INVALID_RESERVATION_BASIS", `La reserva debe declarar reservationBasis = ${CHRONOLOGICAL_RESERVATION_BASIS}; no se elige una base en silencio.`);
    }
  }

  const specOutcome = validateSpecIdentity(input.spec ?? IMP09_SPEC_IDENTITY);
  if (!specOutcome.ok) {
    errors.push(...specOutcome.errors);
  }

  const registerOutcome = validateEligibilityRegister(input.campaigns);
  errors.push(...registerOutcome.errors);

  if (errors.length > 0) {
    return result({
      reservationId: isNonEmptyString(input.reservationId) ? input.reservationId : null,
      reservationBasis: input.reservationBasis,
      spec: input.spec ?? IMP09_SPEC_IDENTITY,
      registerAbsence: input.registerAbsence ?? null,
      errors,
      blockedBy: [...new Set(errors.map((error) => error.code))],
      precedesCalibration: calibrationArtifacts.length === 0,
      reason: "HOLD: el registro auditado no satisface su forma o su secuencia; no se materializa ninguna reserva.",
    });
  }

  const ordered = chronologicalEligibleComplete(input.campaigns);

  // §13.3/§13.8: la población Gas Quarterly es una secuencia contigua de
  // trimestre a trimestre; un quarter ausente en el registro desplazaría el
  // corte de las "últimas 8" y contaminaría la frontera. Un hueco invalida la
  // secuencia elegible (fail-closed), no se rellena ni se salta.
  for (let index = 1; index < ordered.length; index += 1) {
    const gap = quarterIndex(ordered[index].maturity) - quarterIndex(ordered[index - 1].maturity);
    if (gap !== 1) {
      pushError(errors, "NON_CONTIGUOUS_ELIGIBLE_SEQUENCE", `La secuencia elegible tiene un hueco entre ${ordered[index - 1].maturity} y ${ordered[index].maturity}; un quarter omitido desplaza el corte de las últimas ${SEALED_OOS_CAMPAIGN_COUNT} campañas (§13.3/§13.8).`);
      break;
    }
  }

  if (errors.length > 0) {
    const blockedBy = [...new Set(errors.map((error) => error.code))];
    if (ordered.length < SEALED_OOS_CAMPAIGN_COUNT) {
      // La historia insuficiente se reporta junto al defecto: ambos HOLD son
      // reales y ninguno se esconde (§13.8).
      blockedBy.push("INSUFFICIENT_ELIGIBLE_COMPLETE_CAMPAIGNS");
    }
    return result({
      reservationId: isNonEmptyString(input.reservationId) ? input.reservationId : null,
      reservationBasis: input.reservationBasis,
      spec: input.spec ?? IMP09_SPEC_IDENTITY,
      registerAbsence: input.registerAbsence ?? null,
      errors,
      blockedBy: [...new Set(blockedBy)],
      precedesCalibration: calibrationArtifacts.length === 0,
      reason: "HOLD: el registro auditado no satisface su forma o su secuencia; no se materializa ninguna reserva.",
    });
  }

  const excludedCampaigns = input.campaigns
    .filter((episode) => episode.eligibility !== "ELIGIBLE" || episode.completeness !== "COMPLETE")
    .map((episode) => ({
      campaignId: episode.campaignId,
      reason: episode.eligibility !== "ELIGIBLE" ? "INELIGIBLE" : "INCOMPLETE",
    }));

  if (ordered.length < SEALED_OOS_CAMPAIGN_COUNT) {
    return result({
      reservationId: isNonEmptyString(input.reservationId) ? input.reservationId : null,
      reservationBasis: input.reservationBasis,
      spec: input.spec ?? IMP09_SPEC_IDENTITY,
      excludedCampaigns,
      registerAbsence: input.registerAbsence ?? null,
      errors: [],
      blockedBy: ["INSUFFICIENT_ELIGIBLE_COMPLETE_CAMPAIGNS"],
      reason: `HOLD: §13.8 exige las últimas ${SEALED_OOS_CAMPAIGN_COUNT} campañas Gas Quarterly completas y elegibles; el registro auditado aporta ${ordered.length}. Bajo el mínimo no se acorta el estándar ni se sustituye la población.`,
    });
  }

  const sealed = ordered.slice(ordered.length - SEALED_OOS_CAMPAIGN_COUNT);
  const development = ordered.slice(0, ordered.length - SEALED_OOS_CAMPAIGN_COUNT);
  const span = computeOosSpan(sealed);

  if (!span.coversMinYears) {
    return result({
      reservationId: isNonEmptyString(input.reservationId) ? input.reservationId : null,
      reservationBasis: input.reservationBasis,
      spec: input.spec ?? IMP09_SPEC_IDENTITY,
      excludedCampaigns,
      registerAbsence: input.registerAbsence ?? null,
      span,
      errors: [],
      blockedBy: ["INSUFFICIENT_HISTORY_SPAN"],
      reason: `HOLD: la evidencia reservada no abarca ${SEALED_OOS_MIN_CALENDAR_YEARS} años calendario (§5.7/§13.8).`,
    });
  }

  // Validación del binding del manifest (§25.1 output "manifest… registro" y
  // DEP-12 "historial auditado"): la reserva sellada liga la fecha de corte y
  // los hashes de identidad de sus fuentes (registro de campañas, evidencia del
  // lago, calendario oficial, paquete del cliente). Sin ligazón no hay
  // historial auditado reproducible → HOLD.
  const bindingErrors = [];
  const binding = reservationBindingFor(input, bindingErrors);

  // §13.8 "últimas 8 … calendario": un quarter cuya ventana de procurement va
  // más allá de la fecha de corte declarada (p. ej., 2026Q4 fuera de la foto
  // del lago) no es elegible con esta evidencia; fail-closed.
  if (binding.cutoffIso !== null) {
    for (const episode of ordered) {
      if (compareIsoDates(episode.deadline, binding.cutoffIso) > 0) {
        pushError(errors, "ELIGIBLE_EPISODE_AFTER_CUTOFF", `La campaña "${episode.campaignId}" tiene deadline ${episode.deadline} posterior a la fecha de corte ${binding.cutoffIso}; el quarter declarado va más allá de la evidencia ligada (corte/foto del lago).`);
      }
    }
  }
  if (bindingErrors.length > 0 || errors.length > 0) {
    return result({
      reservationId: isNonEmptyString(input.reservationId) ? input.reservationId : null,
      reservationBasis: input.reservationBasis,
      spec: input.spec ?? IMP09_SPEC_IDENTITY,
      excludedCampaigns,
      registerAbsence: input.registerAbsence ?? null,
      span,
      errors: [...bindingErrors, ...errors.filter((error) => error.code === "ELIGIBLE_EPISODE_AFTER_CUTOFF")],
      blockedBy: [...new Set([...bindingErrors.map((error) => error.code), ...errors.filter((error) => error.code === "ELIGIBLE_EPISODE_AFTER_CUTOFF").map((error) => error.code)])],
      reason: bindingErrors.length > 0
        ? "HOLD: el manifest no liga la fecha de corte y los hashes de sus fuentes; sin ligazón no es un historial auditado (§25.1/DEP-12)."
        : "HOLD: hay campañas elegibles cuya ventana supera la fecha de corte; el quarter declarado va más allá de la evidencia ligada (corte/foto del lago).",
    });
  }

  const overlaps = detectOverlaps({ sealedOos: sealed, development });
  const resolution = resolveOverlaps(overlaps, input.overlapResolutions, { boundaryIso: sealed[0].windowStart });

  if (!resolution.ok) {
    return result({
      reservationId: isNonEmptyString(input.reservationId) ? input.reservationId : null,
      reservationBasis: input.reservationBasis,
      spec: input.spec ?? IMP09_SPEC_IDENTITY,
      excludedCampaigns,
      registerAbsence: input.registerAbsence ?? null,
      span,
      errors: resolution.errors,
      blockedBy: [...new Set([...resolution.errors.map((error) => error.code), ...(resolution.unresolved.length > 0 ? ["UNRESOLVED_OVERLAP"] : [])])],
      reason: "HOLD: hay solapamientos cuya estructura real no está resuelta por purge, embargo o cambio de frontera (§13.8/§15.2).",
    });
  }

  // §13.8 "cambio de frontera": la frontera protegida del manifest es la
  // frontera revisada declarada por la intervención auditada; sólo si no hay
  // cambio de frontera resuelto queda la primera ventana sellada original.
  const boundaryRevisions = resolution.resolved.filter((item) => item.action === "BOUNDARY_CHANGE");
  let protectedFromIso = sealed[0].windowStart;
  for (const revision of boundaryRevisions) {
    if (compareIsoDates(revision.revisedBoundary, protectedFromIso) > 0) {
      protectedFromIso = revision.revisedBoundary;
    }
  }

  // §25.1 input "Eligibility auditada" + §13.3 (lista del dataset auditado): la
  // reserva sella sobre la determinación del mandato. Un registro derivado
  // (PROXY) es evidencia, no la determinación: aunque tenga 8 campañas
  // completas, no puede producir RESERVED ni criterionMet. Fail-closed.
  if (eligibilityBasis !== "AUDITED") {
    pushError(errors, "ELIGIBILITY_BASIS_NOT_AUDITED", `La reserva declara una base de elegibilidad ${eligibilityBasis}; §25.1 exige "Eligibility auditada". Un registro derivado (PROXY) no sella el OOS.`);
    return result({
      reservationId: isNonEmptyString(input.reservationId) ? input.reservationId : null,
      reservationBasis: input.reservationBasis,
      spec: input.spec ?? IMP09_SPEC_IDENTITY,
      excludedCampaigns,
      registerAbsence: input.registerAbsence ?? null,
      span,
      errors,
      blockedBy: [...new Set(errors.map((error) => error.code))],
      reason: "HOLD: la elegibilidad no proviene del registro auditado del mandato (base PROXY); no se sella una reserva sobre elegibilidad derivada (§25.1/§13.3).",
    });
  }

  const manifestCore = {
    reservationId: isNonEmptyString(input.reservationId) ? input.reservationId : null,
    eligibilityBasis,
    sealedOosCampaignIds: sealed.map((episode) => episode.campaignId),
    developmentCampaignIds: development.map((episode) => episode.campaignId),
    span,
    protectedFromIso,
    reservationBinding: { cutoffIso: binding.cutoffIso, sourceHashes: binding.sourceHashes },
  };

  return result({
    reservationId: manifestCore.reservationId,
    reservationBasis: input.reservationBasis,
    spec: input.spec ?? IMP09_SPEC_IDENTITY,
    decision: "RESERVED",
    sealedOosCount: sealed.length,
    sealedOosCampaignIds: manifestCore.sealedOosCampaignIds,
    developmentCampaignIds: manifestCore.developmentCampaignIds,
    excludedCampaigns,
    span,
    chronologicalSplit: {
      sealedOosCampaignIds: manifestCore.sealedOosCampaignIds,
      developmentCampaignIds: manifestCore.developmentCampaignIds,
      protectedFromIso,
      protectedBoundary: "SEALED",
    },
    reservationBinding: manifestCore.reservationBinding,
    overlapResolutions: resolution.resolved,
    accessRegistry: { oosStatus: "SEALED", entries: [] },
    precedesCalibration: true,
    reason: null,
    contentHash: contentHashOf(manifestCore),
  });
}

// Reserva del caso real. Sin campaign register auditado, produce HOLD con la
// ausencia citada; no fabrica la lista de campañas.
export function reserveGasQuarterlySealedOos(overrides = {}) {
  return reserveSealedOos({
    campaigns: GAS_QUARTERLY_ELIGIBILITY_AUDIT.campaigns,
    reservationBasis: CHRONOLOGICAL_RESERVATION_BASIS,
    spec: IMP09_SPEC_IDENTITY,
    registerAbsence: GAS_QUARTERLY_ELIGIBILITY_AUDIT.documentedAbsence,
    ...overrides,
  });
}

// §25.1 output: registro de acceso/consumo. Registrar un acceso sobre una
// reserva que no está sellada no es posible; y un acceso que modifica el diseño
// consume el OOS (§13.8/§15.2), que ya no puede reutilizarse como intacto.
export function recordOosAccess(reservation, entry = {}) {
  if (!reservation || reservation.decision !== "RESERVED") {
    return { ok: false, code: "RESERVATION_NOT_SEALED", message: "No se registra acceso al OOS sin una reserva sellada.", reservation: reservation ?? null };
  }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { ok: false, code: "INVALID_ACCESS_ENTRY", message: "El acceso no es un registro válido.", reservation };
  }
  const purpose = ACCESS_PURPOSES[entry.purpose];
  if (!purpose) {
    return { ok: false, code: "UNKNOWN_ACCESS_PURPOSE", message: `El acceso usa un propósito no declarado: ${entry.purpose}.`, reservation };
  }
  const anchored = toUtcTimestamp(entry.atUtc);
  if (!anchored.ok) {
    return { ok: false, code: "INVALID_ACCESS_TIME", message: "El acceso exige un timestamp UTC anclado a zona explícita (§6.1).", reservation };
  }

  const consumesOos = entry.modifiesDesign === true || purpose.consumesOos;
  const record = {
    atUtc: anchored.utc,
    purpose: entry.purpose,
    actor: isNonEmptyString(entry.actor) ? entry.actor : null,
    modifiesDesign: entry.modifiesDesign === true,
    consumesOos,
    section: purpose.section,
  };
  const entries = [...reservation.accessRegistry.entries, record];
  const oosStatus = entries.some((item) => item.consumesOos) ? "CONSUMED" : "SEALED";
  return {
    ok: true,
    code: null,
    record,
    reservation: {
      ...reservation,
      accessRegistry: { oosStatus, entries },
    },
  };
}

// Frontera protegida comprobable por IMP-11/IMP-16: una reserva intacta está
// sellada y no consumida.
export function isReservationIntact(reservation) {
  const reasons = [];
  if (!reservation || reservation.decision !== "RESERVED") {
    reasons.push("RESERVATION_NOT_SEALED");
    return { intact: false, reasons };
  }
  if (reservation.chronologicalSplit?.protectedBoundary !== "SEALED") {
    reasons.push("BOUNDARY_NOT_PROTECTED");
  }
  if (reservation.accessRegistry?.oosStatus !== "SEALED") {
    reasons.push("OOS_CONSUMED");
  }
  return { intact: reasons.length === 0, reasons };
}

// Acceptance de §25.1 IMP-09. Sólo acredita que la reserva se materializó; no
// acredita edge ni cierra DEP-12 por encima de lo reservado.
export function evaluateImp09Acceptance(reservation) {
  const blockedBy = [...new Set(reservation?.blockedBy ?? [])];
  // §25.1 input "Eligibility auditada": sin base AUDITED no hay acceptance,
  // aunque la reserva declare RESERVED por otra vía.
  const criterionMet = reservation?.decision === "RESERVED"
    && reservation.eligibilityBasis === "AUDITED"
    && reservation.sealedOosCount === SEALED_OOS_CAMPAIGN_COUNT
    && reservation.span?.coversMinYears === true
    && reservation.chronologicalSplit?.protectedBoundary === "SEALED"
    && (reservation.errors?.length ?? 0) === 0;
  return {
    acceptanceTest: IMP09_ACCEPTANCE_TEST,
    source: "SPEC v1.1.1 §25.1 IMP-09",
    decision: reservation?.decision ?? null,
    eligibilityBasis: reservation?.eligibilityBasis ?? null,
    criterionMet,
    sealedOosCount: reservation?.sealedOosCount ?? 0,
    blockedBy,
    reason: reservation?.reason ?? null,
  };
}
