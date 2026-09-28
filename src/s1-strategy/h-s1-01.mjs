// HYP-1, phase A. This definition extends S1 without changing the frozen
// Gas Quarterly P5 replay or the exploratory DIP10 artifacts.
import { contentHashOf } from "../sizing-controller/versioning.mjs";

export const H_S1_01_MISSIONS = Object.freeze([
  "Gas Monthly", "Gas Quarterly", "Power Monthly", "Power Quarterly",
]);
export const H_S1_01_N_GRID = Object.freeze([3, 5, 10, 20]);

const definition = {
  artifactKind: "HYPOTHESIS_DEFINITION",
  hypothesisId: "H-S1-01",
  version: "H-S1-01/phase-A/v1",
  parentStrategy: "S1 — Relative Price Location",
  name: "Session-Anchored Rolling Reference",
  question: "¿Una señal causal de ubicación relativa del precio, calculada contra una referencia móvil anclada al mismo momento de sesión, mejora el timing y el resultado económico de procurement frente a CONTROL, manteniendo constantes sizing y execution?",
  refutation: "Se refuta o simplifica si una comparación OOS válida y congelada no muestra mejora estable frente a CONTROL, o si el efecto depende de una zona extremadamente estrecha o inestable de tau o N. Development no es evidencia final.",
  missions: H_S1_01_MISSIONS,
  comparator: "CONTROL",
  referenceMethod: "ARITHMETIC_ROLLING_MEAN_OF_N_PRIOR_SAME_ANCHOR_OBSERVATIONS",
  favorability: "decisionPrice < priorRollingMean (strict); equality means WAIT",
  sizing: "CONTROL controller requests the same quantity on a BUY; the hypothesis only changes BUY/WAIT timing",
  execution: "Same contract and costs as CONTROL within each mission",
  phase: "A_DEFINITION_ONLY",
  economicResult: null,
  legacy: { policyId: "DIP10", tau: "11:00 Europe/Berlin", N: 10, status: "EXPLORATORY_PROVENANCE_ONLY", sizingParityClaim: false },
  provenance: {
    authority: "Bru, 2026-09-28",
    locator: "/srv/hot-data/oficina-data/intake/energy-markets/D-20260928T141820-ff6a/task.md",
    semantics: "docs/product/SEM-1_BACKTESTING_SEMANTICS.md",
  },
};
function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
export const H_S1_01 = deepFreeze({ ...definition, contentHash: contentHashOf(definition) });

const own = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).every((key) => keys.includes(key));
const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const utc = (value) => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const date = (value) => typeof value === "string" && /^\d{4}-\d\d-\d\d$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const time = (value) => typeof value === "string" && /^\d\d:\d\d$/.test(value)
  && Number(value.slice(0, 2)) < 24 && Number(value.slice(3)) < 60;

function localSlot(atUtc, zone) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(atUtc));
    const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return { day: `${p.year}-${p.month}-${p.day}`, tau: `${p.hour}:${p.minute}` };
  } catch { return null; }
}

function error(code) { return { ok: false, code }; }

// Availability rows contain metadata only. Slot candidates come from the
// declared market session; N candidates survive only with N prior days plus
// one decision day in Development. No prices, fills or outcomes enter this API.
export function predeclareHS1SearchSpace({ mission, developmentEndUtc, session, availability, provenance } = {}) {
  if (!H_S1_01_MISSIONS.includes(mission)) return error("INVALID_MISSION");
  if (!utc(developmentEndUtc)) return error("INVALID_DEVELOPMENT_BOUNDARY");
  if (!own(session, ["mission", "zone", "anchors", "sourceHash"]) || session.mission !== mission || !hash(session.sourceHash)
    || !Array.isArray(session.anchors) || session.anchors.length < 1 || session.anchors.length > 8
    || new Set(session.anchors).size !== session.anchors.length || session.anchors.some((anchor) => !time(anchor))) {
    return error("INVALID_SESSION_SCHEDULE");
  }
  if (!localSlot(developmentEndUtc, session.zone)) return error("INVALID_SESSION_ZONE");
  if (!Array.isArray(availability) || !own(provenance, ["authority", "locator", "sourceHash"])
    || !hash(provenance.sourceHash) || !provenance.authority || !provenance.locator) return error("MISSING_DEVELOPMENT_METADATA");
  const days = new Map(session.anchors.map((anchor) => [anchor, new Set()]));
  const timestamps = new Set();
  const slotDays = new Set();
  for (const row of availability) {
    if (!own(row, ["mission", "atUtc", "sessionDate", "anchor", "available", "pitAvailableAtUtc", "sourceHash"])
      || !utc(row.atUtc) || !utc(row.pitAvailableAtUtc) || !date(row.sessionDate)
      || row.mission !== mission || !hash(row.sourceHash) || typeof row.available !== "boolean"
      || !days.has(row.anchor) || !time(row.anchor)) return error("INVALID_AVAILABILITY_ROW");
    const slot = localSlot(row.atUtc, session.zone);
    const slotDay = `${row.anchor}/${row.sessionDate}`;
    if (slot.day !== row.sessionDate || slot.tau !== row.anchor
      || timestamps.has(row.atUtc) || slotDays.has(slotDay)) return error("INVALID_ANCHOR_ALIGNMENT");
    timestamps.add(row.atUtc);
    slotDays.add(slotDay);
    if (Date.parse(row.atUtc) >= Date.parse(developmentEndUtc)
      || Date.parse(row.pitAvailableAtUtc) >= Date.parse(developmentEndUtc)) return error("NON_DEVELOPMENT_OR_FUTURE_METADATA");
    if (row.available && Date.parse(row.pitAvailableAtUtc) <= Date.parse(row.atUtc)) days.get(row.anchor).add(row.sessionDate);
  }
  const candidates = session.anchors.flatMap((anchor) => H_S1_01_N_GRID
    .filter((N) => days.get(anchor).size >= N + 1)
    .map((N) => ({ tau: { zone: session.zone, localTime: anchor }, N, supportedDays: days.get(anchor).size })));
  const core = {
    artifactKind: "HYPOTHESIS_SEARCH_SPACE", hypothesisId: H_S1_01.hypothesisId,
    hypothesisHash: H_S1_01.contentHash, version: "H-S1-01/search-space/v1",
    mission, developmentEndUtc, session: { mission, zone: session.zone, anchors: [...session.anchors], sourceHash: session.sourceHash },
    availabilityHash: contentHashOf(availability), provenance, nGrid: [...H_S1_01_N_GRID],
    candidates, outcomeInputsUsed: false, status: candidates.length ? "PREDECLARED_UNCALIBRATED" : "DATA_BLOCKED",
  };
  return { ok: true, searchSpace: { ...core, contentHash: contentHashOf(core) } };
}

export function createHS1Candidate({ searchSpace, tau, N } = {}) {
  if (!searchSpace || searchSpace.artifactKind !== "HYPOTHESIS_SEARCH_SPACE"
    || !H_S1_01_MISSIONS.includes(searchSpace.mission)
    || !Array.isArray(searchSpace.candidates) || searchSpace.candidates.length > 8 * H_S1_01_N_GRID.length
    || searchSpace.hypothesisHash !== H_S1_01.contentHash
    || searchSpace.contentHash !== contentHashOf(Object.fromEntries(Object.entries(searchSpace).filter(([key]) => key !== "contentHash")))
    || searchSpace.status !== "PREDECLARED_UNCALIBRATED") return error("INVALID_SEARCH_SPACE");
  if (!searchSpace.candidates.some((point) => point.tau.zone === tau?.zone
    && point.tau.localTime === tau?.localTime && point.N === N)) return error("OUTSIDE_PREDECLARED_SPACE");
  const core = {
    artifactKind: "HYPOTHESIS_CANDIDATE", hypothesisId: H_S1_01.hypothesisId,
    hypothesisHash: H_S1_01.contentHash, version: "H-S1-01/candidate/v1",
    mission: searchSpace.mission, tau: { zone: tau.zone, localTime: tau.localTime }, N,
    referenceMethod: H_S1_01.referenceMethod, favorability: H_S1_01.favorability,
    searchSpaceHash: searchSpace.contentHash, calibrationStatus: "UNSELECTED",
    economicResult: null,
  };
  return { ok: true, candidate: { ...core, contentHash: contentHashOf(core) } };
}

// The reference excludes the current decision price. Every prior observation
// must be PIT-consumable at its own anchor, at the same local time and on an
// earlier session day. Invalid provenance blocks the signal rather than BUY.
export function evaluateHS1Location({ candidate, asOfUtc, decisionPrice, decisionPriceAvailableAtUtc,
  decisionPriceMission, decisionPriceSourceHash, history } = {}) {
  if (!candidate || candidate.artifactKind !== "HYPOTHESIS_CANDIDATE"
    || candidate.hypothesisHash !== H_S1_01.contentHash
    || candidate.contentHash !== contentHashOf(Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== "contentHash")))
    || !H_S1_01_MISSIONS.includes(candidate.mission) || !H_S1_01_N_GRID.includes(candidate.N)
    || !hash(candidate.searchSpaceHash) || candidate.calibrationStatus !== "UNSELECTED"
    || candidate.referenceMethod !== H_S1_01.referenceMethod || candidate.favorability !== H_S1_01.favorability
    || !time(candidate.tau?.localTime)) return error("INVALID_CANDIDATE");
  if (!utc(asOfUtc) || !utc(decisionPriceAvailableAtUtc) || !Number.isFinite(decisionPrice)
    || decisionPriceMission !== candidate.mission || !hash(decisionPriceSourceHash)) return error("INVALID_DECISION_PRICE");
  const decisionSlot = localSlot(asOfUtc, candidate.tau.zone);
  if (!decisionSlot || decisionSlot.tau !== candidate.tau.localTime) return error("WRONG_SESSION_ANCHOR");
  if (Date.parse(decisionPriceAvailableAtUtc) > Date.parse(asOfUtc)) return error("DECISION_PRICE_NOT_PIT");
  if (!Array.isArray(history)) return error("INVALID_HISTORY");
  const seen = new Set();
  const prior = [];
  for (const row of history) {
    if (!own(row, ["mission", "atUtc", "pitAvailableAtUtc", "price", "sourceHash"])
      || !utc(row.atUtc) || !utc(row.pitAvailableAtUtc) || !Number.isFinite(row.price)
      || row.mission !== candidate.mission || !hash(row.sourceHash)) return error("INVALID_HISTORY_ROW");
    const slot = localSlot(row.atUtc, candidate.tau.zone);
    if (!slot || slot.tau !== candidate.tau.localTime || slot.day >= decisionSlot.day || seen.has(slot.day)) return error("HISTORY_ANCHOR_OR_DUPLICATE_DAY");
    if (Date.parse(row.pitAvailableAtUtc) > Date.parse(row.atUtc)
      || Date.parse(row.atUtc) >= Date.parse(asOfUtc)) return error("HISTORY_NOT_CAUSAL");
    seen.add(slot.day);
    prior.push(row);
  }
  prior.sort((a, b) => a.atUtc.localeCompare(b.atUtc));
  if (prior.length < candidate.N) return {
    ok: true, status: "UNIDENTIFIABLE", action: "ABSTAIN", asOfUtc,
    reason: "INSUFFICIENT_PRIOR_SAME_ANCHOR_OBSERVATIONS",
    candidateHash: candidate.contentHash, required: candidate.N, observed: prior.length, reference: null, features: null,
  };
  const window = prior.slice(-candidate.N);
  const reference = window.reduce((sum, row) => sum + row.price, 0) / candidate.N;
  const signedDistance = decisionPrice - reference;
  const variance = window.reduce((sum, row) => sum + (row.price - reference) ** 2, 0) / candidate.N;
  const scale = Math.sqrt(variance);
  return {
    ok: true, status: "AVAILABLE", action: signedDistance < 0 ? "BUY" : "WAIT", asOfUtc,
    candidateHash: candidate.contentHash,
    reference, features: {
      signedDistanceToReference: signedDistance,
      normalizedDistance: scale > 0 ? signedDistance / scale : null,
      percentile: window.filter((row) => row.price <= decisionPrice).length / candidate.N,
    },
    uncertainty: scale > 0 ? null : "ZERO_REFERENCE_VARIANCE",
    windowHash: contentHashOf(window), windowCount: window.length,
  };
}

// CONTROL owns sizing and execution. No quantity, cap, fee or fill rule exists
// in H-S1-01. The caller retains the same live Procurement State on WAIT.
export function decideHS1AgainstControl({ mission, candidate, control, controlDecision, location, asOfUtc } = {}) {
  if (!H_S1_01_MISSIONS.includes(mission) || candidate?.mission !== mission
    || candidate.hypothesisHash !== H_S1_01.contentHash
    || candidate.contentHash !== contentHashOf(Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== "contentHash")))
    || candidate.artifactKind !== "HYPOTHESIS_CANDIDATE" || !hash(candidate.searchSpaceHash)
    || control?.mission !== mission || control.identity !== "CONTROL"
    || control.timing !== "CALENDAR_ONLY_PRICE_BLIND" || !hash(control?.controllerHash)
    || !hash(control?.calendarHash) || !hash(control?.executionContractHash)
    || controlDecision?.ok !== true || !["BUY", "WAIT", "NO_OPPORTUNITY"].includes(controlDecision.action)
    || !Number.isFinite(controlDecision.requestedQuantityMw) || controlDecision.requestedQuantityMw < 0
    || (controlDecision.action === "BUY" && controlDecision.controllerVersion !== control.controllerHash)
    || !utc(asOfUtc) || location?.ok !== true || location.asOfUtc !== asOfUtc
    || location.candidateHash !== candidate.contentHash
    || !((location.status === "AVAILABLE" && ["BUY", "WAIT"].includes(location.action))
      || (location.status === "UNIDENTIFIABLE" && location.action === "ABSTAIN"))) return error("INVALID_ABLATION_CONTEXT");
  if (controlDecision.action !== "BUY" || controlDecision.requestedQuantityMw === 0) return {
    ok: true, action: controlDecision.action, requestedQuantityMw: controlDecision.requestedQuantityMw,
    controllerHash: control.controllerHash, executionContractHash: control.executionContractHash,
    reason: "CONTROL_NOT_BUYING",
  };
  if (location.action === "BUY" && location.status === "AVAILABLE") return {
    ...controlDecision, controllerHash: control.controllerHash,
    executionContractHash: control.executionContractHash, hypothesisId: H_S1_01.hypothesisId,
    candidateHash: candidate.contentHash, reason: "FAVORABLE_STATIC_LOCATION",
  };
  return {
    ok: true, action: location.status === "UNIDENTIFIABLE" ? "ABSTAIN" : "WAIT",
    requestedQuantityMw: 0, controllerHash: control.controllerHash,
    executionContractHash: control.executionContractHash, hypothesisId: H_S1_01.hypothesisId,
    candidateHash: candidate.contentHash, reason: location.reason ?? "UNFAVORABLE_STATIC_LOCATION",
  };
}

export function materializeHS1MissionRegistry(spaces = {}) {
  if (!own(spaces, H_S1_01_MISSIONS)) return error("INVALID_MISSION_REGISTRY");
  return { ok: true, hypothesisHash: H_S1_01.contentHash,
    missions: Object.fromEntries(H_S1_01_MISSIONS.map((mission) => {
      const space = spaces[mission];
      if (space === undefined) {
        return [mission, { status: "DATA_BLOCKED", searchSpaceHash: null, calibration: null, backtest: null, evidence: null, economicResult: null }];
      }
      if (!space || space.artifactKind !== "HYPOTHESIS_SEARCH_SPACE"
        || space.mission !== mission || space.hypothesisHash !== H_S1_01.contentHash
        || !["DATA_BLOCKED", "PREDECLARED_UNCALIBRATED"].includes(space.status)
        || space.contentHash !== contentHashOf(Object.fromEntries(Object.entries(space).filter(([key]) => key !== "contentHash")))) {
        return [mission, { status: "INTEGRITY_BLOCKED", searchSpaceHash: null, calibration: null, backtest: null, evidence: null, economicResult: null }];
      }
      return [mission, { status: space.status, searchSpaceHash: space.contentHash,
        calibration: null, backtest: null, evidence: null, economicResult: null }];
    })) };
}
