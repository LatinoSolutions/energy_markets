// BT-08 · Motor puro del experimento Development de H-S1-01 por misión.
// Fuente: intake D-20260928T161943-70c6 (texto de Bru, 2026-09-28, "Use the
// accepted HYP-1 implementation"; "CONTROL and H-S1-01 share the same mission
// obligation, initial state, opportunity calendar, sizing policy/version,
// execution model, fees policy and evaluation reference"; "Use existing
// canonical economic producers and SEM-1 comparability gates") + SEM-1 +
// H-S1-01_SESSION_ANCHORED_ROLLING_REFERENCE.md.
//
// Este módulo es PURO: no lee archivos ni abre el lago. El runner de jobs le
// pasa el spec de la misión ya cargado. Reutiliza el HYP-1 real
// (evaluateHS1Location/decideHS1AgainstControl), el controller compartido de
// IMP-10 (reconcileControlQuantity vía createA0Baseline) y los productores
// económicos canónicos (computeAllInH/computeV/computeTotalEur) con el gate de
// comparabilidad de SEM-1 (compareAblation). No elige ganador, no promueve, no
// declara research PASS: el veredicto científico queda HOLD aquí siempre.
import { compareAblation, controlFor } from "../backtesting-semantics/contract.mjs";
import { computeAllInH, computeTotalEur, computeV } from "../economic-calculation/index.mjs";
import { buildDecisionCalendar, createA0Baseline, createSizingController } from "../sizing-controller/index.mjs";
import { contentHashOf } from "../sizing-controller/versioning.mjs";
import { decideHS1AgainstControl, evaluateHS1Location, H_S1_01 } from "./h-s1-01.mjs";

export const DEVELOPMENT_PHASE = "DEVELOPMENT";
export const EPISODE_SCHEMA_VERSION = "1";
export const EXECUTION_MODEL = "TOB_ASK_SLIPPAGE_V1";
export const FEE_STATUSES = Object.freeze({ KNOWN: "KNOWN", UNKNOWN: "UNKNOWN" });
export const BENCHMARK_STATUSES = Object.freeze(["BENCHMARK_PROVISIONAL", "RECONCILED_OFFICIAL"]);
export const DELIVERY_HOURS_MODES = Object.freeze({ FIXED: "FIXED", PER_TRADING_DAY: "PER_TRADING_DAY" });

// Estados del episodio por brazo. OPEN_OBLIGATION = la obligación quedó sin
// servir con oportunidades disponibles (resultado legítimo de WAIT), distinto
// de un hueco de datos (DATA_INCOMPLETE).
export const EPISODE_STATUS = Object.freeze({
  COMPLETE: "COMPLETE",
  OPEN_OBLIGATION: "OPEN_OBLIGATION",
  DATA_INCOMPLETE: "DATA_INCOMPLETE",
});

const sha256OfBytes = (bytes) => contentHashOf(String(bytes));
const isHash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isIsoDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const isUtc = (value) => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)
  && !Number.isNaN(Date.parse(value));
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

function blocker(code, message, detail = null) {
  return { ok: false, code, message, ...(detail ? { detail } : {}) };
}

// Instante UTC del ancla tau (hora local de sesión) para un día, con soporte
// DST: se corrige el offset dos veces (borde de cambio de hora).
export function anchoredAtUtc(dayIso, localTime, zone) {
  if (!isIsoDate(dayIso) || !/^\d{2}:\d{2}$/.test(localTime ?? "") || !zone) return null;
  const local = `${dayIso}T${localTime}:00`;
  let guess = Date.parse(`${local}Z`);
  for (let round = 0; round < 3; round += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    const asZone = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    if (!Number.isFinite(asZone)) return null;
    const offset = asZone - guess;
    if (offset === 0) break;
    guess = Date.parse(`${local}Z`) - offset;
  }
  const instant = new Date(guess).toISOString().slice(0, 19) + "Z";
  // El día local del instante debe ser el día pedido (si no, el ancla cae en
  // otro día local: DST extremo; fail-closed).
  const check = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
  return check === dayIso ? instant : null;
}

// Barrido de bloqueos sobre la disponibilidad Development de UNA misión
// (procedencia de session/rows y frescura PIT). Lo usan el child al correr y
// la readiness read-only del runner.
export function assessAvailabilityRows({ session, availability } = {}) {
  const anchorsOk = Array.isArray(session?.anchors) && session.anchors.length > 0
    && session.anchors.every((anchor) => /^\d{2}:\d{2}$/.test(anchor));
  if (!session || typeof session.mission !== "string" || typeof session.zone !== "string"
    || !isHash(session.sourceHash) || !anchorsOk) {
    return blocker("PROVENANCE_INVALID", "the market session schedule is missing or does not declare its source hash");
  }
  if (!Array.isArray(availability) || availability.length === 0) {
    return blocker("SOURCE_MISSING", "no Development availability rows were provided for this mission");
  }
  for (const row of availability) {
    if (!row || row.mission !== session.mission || !isUtc(row.atUtc) || !isUtc(row.pitAvailableAtUtc)
      || !isIsoDate(row.sessionDate) || !isHash(row.sourceHash) || typeof row.available !== "boolean"
      || !session.anchors.includes(row.anchor)) {
      return blocker("PROVENANCE_INVALID", "an availability row is malformed or carries unverified provenance", { atUtc: row?.atUtc ?? null });
    }
    if (Date.parse(row.pitAvailableAtUtc) > Date.parse(row.atUtc)) {
      return blocker("FRESHNESS_BLOCKED", "an availability row was not consumable at its own session instant (PIT violated)", { atUtc: row.atUtc });
    }
  }
  return { ok: true, code: null, message: null };
}

// Barrido de bloqueos sobre los inputs de una misión (BT08-03). Los mismos
// checks usa el child al correr y la readiness read-only del runner.
export function assessDevelopmentInputs({ session, availability, observations, benchmark, deliveryHours, campaign } = {}) {
  const availabilityOutcome = assessAvailabilityRows({ session, availability });
  if (!availabilityOutcome.ok) return availabilityOutcome;
  if (!Array.isArray(observations) || observations.length === 0) {
    return blocker("SOURCE_MISSING", "no decision-price observations were provided for this mission");
  }
  const byDate = new Map();
  for (const row of observations) {
    if (!row || !isIsoDate(row.date) || !isFiniteNumber(row.price) || !isUtc(row.availableAtUtc) || !isHash(row.sourceHash)) {
      return blocker("PROVENANCE_INVALID", "an observation row is malformed or carries unverified provenance", { date: row?.date ?? null });
    }
    if (byDate.has(row.date)) return blocker("PROVENANCE_INVALID", "duplicate observation date", { date: row.date });
    byDate.set(row.date, row);
  }
  if (!benchmark || benchmark.identity !== "BENCHMARK" || typeof benchmark.version !== "string" || benchmark.version.length === 0
    || !BENCHMARK_STATUSES.includes(benchmark.status) || !isFiniteNumber(benchmark.value)
    || benchmark.unit !== "EUR/MWh" || !isHash(benchmark.artifactSha256) || !isHash(benchmark.sourceHash)) {
    return blocker("BINDING_INVALID", "the benchmark evaluation reference is missing, malformed or not hash-bound");
  }
  if (!deliveryHours || !DELIVERY_HOURS_MODES[deliveryHours.mode] || !isHash(deliveryHours.sourceHash)
    || (deliveryHours.mode === "FIXED" && !(isFiniteNumber(deliveryHours.hours) && deliveryHours.hours > 0))
    || (deliveryHours.mode === "PER_TRADING_DAY" && (!deliveryHours.perDay || Object.keys(deliveryHours.perDay).length === 0))) {
    return blocker("BINDING_INVALID", "delivery hours are missing or not evidenced; MW is never converted to MWh without them");
  }
  if (deliveryHours.mode === "PER_TRADING_DAY") {
    for (const date of campaign?.tradingDates ?? []) {
      if (!isFiniteNumber(deliveryHours.perDay[date]) || deliveryHours.perDay[date] <= 0) {
        return blocker("MISSING_DELIVERY_HOURS", `no evidenced delivery hours for trading day ${date}`);
      }
    }
  }
  if (deliveryHours.requiresFreeze === true && !isHash(deliveryHours.freezeArtifactSha256)) {
    return blocker("FREEZE_PENDING", "the availability source declares a required freeze that is not bound");
  }
  if (deliveryHours.oosReservation !== undefined) {
    const reservation = deliveryHours.oosReservation;
    if (!reservation || reservation.reserved !== true || !isHash(reservation.registryArtifactSha256)) {
      return blocker("RESERVATION_INVALID", "the availability source declares an OOS reservation binding that is not valid (metadata-only check)");
    }
  }
  return { ok: true, code: null, message: null };
}

// Economía de un brazo a partir de su ledger. H es el all-in unitario
// (EUR/MWh); los fees unknown dejan H unavailable, nunca cero (SPEC §5.5).
function armEconomics({ ledger, targetVolumeMw, fees, benchmark, deliveryHours, tradingDates }) {
  const boughtMw = ledger.reduce((sum, row) => sum + row.filledMw, 0);
  const costEur = ledger.reduce((sum, row) => sum + row.filledMw * (row.fillPriceEurMwh ?? 0), 0);
  const avgFillPriceEurMwh = boughtMw > 0 ? costEur / boughtMw : null;
  const costs = fees.status === FEE_STATUSES.KNOWN
    ? fees.costs.map((cost) => ({ status: "known", value: cost.valueEurMwh }))
    : null;
  const allIn = costs === null
    ? { H: null, defined: false, rejected: true, reason: "fees are unknown; H stays unavailable, never zero" }
    : boughtMw > 0
      ? computeAllInH({ base: avgFillPriceEurMwh, unit: "EUR/MWh", costs, costsComplete: true })
      : { H: null, unit: "EUR/MWh", defined: false, rejected: true, reason: "no volume was bought; H is undefined" };
  const absolute = computeV({ B: benchmark.value, BUnit: benchmark.unit, H: allIn.H, HUnit: allIn.unit ?? "EUR/MWh" });
  const deliveryHoursValue = deliveryHours.mode === DELIVERY_HOURS_MODES.FIXED
    ? deliveryHours.hours
    : tradingDates.reduce((sum, date) => sum + (deliveryHours.perDay?.[date] ?? 0), 0);
  const boughtMwh = boughtMw * deliveryHoursValue;
  const total = boughtMw > 0
    ? computeTotalEur({ V: absolute.V, VUnit: "EUR/MWh", volume: boughtMwh, volumeUnit: "MWh" })
    : { totalEur: null, defined: false, reason: "no volume was bought" };
  return {
    boughtMw,
    remainingMw: targetVolumeMw - boughtMw,
    avgFillPriceEurMwh,
    H: allIn.H,
    hReason: allIn.reason ?? null,
    B: benchmark.value,
    BStatus: benchmark.status,
    BVersion: benchmark.version,
    unit: "EUR/MWh",
    V: absolute.defined ? absolute.V : null,
    vReason: absolute.reason ?? null,
    boughtMwh,
    deliveryHoursSourceHash: deliveryHours.sourceHash,
    totalEur: total.defined ? total.totalEur : null,
    totalEurReason: total.reason ?? null,
  };
}

// Un episodio CONTROL ↔ H-S1-01 para UNA misión con UN candidato. CONTROL es el
// baseline calendar-only price-blind (A0, IMP-10) con el controller compartido;
// el brazo activo solo cambia el timing BUY/WAIT/ABSTAIN vía el HYP-1 real.
// requestedMw (cantidad que el controller pediría con ese input state) se
// registra separado del fill real; el estado del brazo activo evoluciona solo
// con SUS fills (WAIT conserva la obligación viva, SEM-1).
export function runHS1DevelopmentEpisode(spec) {
  const {
    runId, missionId, missionLabel, candidate, campaign, session, observations,
    sizing, execution, fees, evaluation,
  } = spec;
  if (candidate?.hypothesisId !== H_S1_01.hypothesisId || candidate.mission !== missionLabel) {
    return blocker("BINDING_INVALID", "the candidate does not bind the requested mission and hypothesis");
  }
  const controllerOutcome = createSizingController({ lotSizeMw: sizing.lotSizeMw, dailyCapMw: sizing.dailyCapMw, provenance: sizing.provenance });
  if (!controllerOutcome.ok) {
    return blocker("BINDING_INVALID", "the sizing controller configuration is invalid", { errors: controllerOutcome.errors });
  }
  const controller = controllerOutcome.controller;
  const calendarOutcome = buildDecisionCalendar({ tradingDates: campaign.tradingDates, campaignId: campaign.campaignId });
  if (!calendarOutcome.ok) {
    return blocker("BINDING_INVALID", "the decision calendar is invalid", { errors: calendarOutcome.errors });
  }
  const calendar = calendarOutcome.calendar;
  const a0 = createA0Baseline({ controller, calendar }).arm;
  if (execution.model !== EXECUTION_MODEL || !isFiniteNumber(execution.slippageEurMwh) || execution.slippageEurMwh < 0) {
    return blocker("BINDING_INVALID", `the execution model must be ${EXECUTION_MODEL} with a non-negative slippage`);
  }
  const control = {
    identity: "CONTROL",
    timing: "CALENDAR_ONLY_PRICE_BLIND",
    mission: missionLabel,
    controllerHash: controller.contentHash,
    calendarHash: contentHashOf(calendar),
    executionContractHash: contentHashOf(execution),
  };

  const sortedDates = [...campaign.tradingDates].sort();
  const observationByDate = new Map(observations.map((row) => [row.date, row]));
  const anchoredRows = []; // historia causal acumulada (mismo ancla, días previos)
  const controlLedger = [];
  const activeLedger = [];
  let controlRemaining = campaign.targetVolumeMw;
  let activeRemaining = campaign.targetVolumeMw;
  let controlFilledMw = 0;
  let activeFilledMw = 0;

  for (const day of sortedDates) {
    const atUtc = anchoredAtUtc(day, candidate.tau.localTime, session.zone);
    if (atUtc === null) {
      return blocker("BINDING_INVALID", `the session anchor does not fall on trading day ${day} in zone ${session.zone}`);
    }
    const observation = observationByDate.get(day) ?? null;
    const history = anchoredRows.map((row) => ({ ...row }));
    const controlDecision = a0.decideAtOpportunity({ currentDate: day, remainingVolumeMw: controlRemaining });
    if (!controlDecision.ok) return blocker("BINDING_INVALID", "the CONTROL controller rejected its decision context", { code: controlDecision.code, date: day });
    const activeControllerDecision = a0.decideAtOpportunity({ currentDate: day, remainingVolumeMw: activeRemaining });
    if (!activeControllerDecision.ok) return blocker("BINDING_INVALID", "the shared controller rejected the active arm decision context", { code: activeControllerDecision.code, date: day });

    let location = null;
    let active = null;
    if (observation === null) {
      active = { ok: true, action: "ABSTAIN", requestedQuantityMw: 0, reason: "NO_DECISION_PRICE" };
    } else {
      location = evaluateHS1Location({
        candidate,
        asOfUtc: atUtc,
        decisionPrice: observation.price,
        decisionPriceAvailableAtUtc: observation.availableAtUtc,
        decisionPriceMission: missionLabel,
        decisionPriceSourceHash: observation.sourceHash,
        history,
      });
      if (!location.ok) return blocker("PROVENANCE_INVALID", "the H-S1-01 signal rejected its decision inputs", { code: location.code, date: day });
      active = decideHS1AgainstControl({
        mission: missionLabel, candidate, control,
        controlDecision: { ...activeControllerDecision, controllerVersion: controller.contentHash },
        location, asOfUtc: atUtc,
      });
      if (!active.ok) return blocker("BINDING_INVALID", "the ablation context was rejected", { code: active.code, date: day });
    }

    const fillPriceEurMwh = observation === null ? null : observation.price + execution.slippageEurMwh;
    const controlRequested = controlDecision.action === "BUY" ? controlDecision.requestedQuantityMw : 0;
    const controlFilled = controlDecision.action === "BUY" && observation !== null ? controlRequested : 0;
    controlRemaining -= controlFilled;
    controlFilledMw += controlFilled;
    controlLedger.push({
      date: day,
      action: controlDecision.action === "BUY" && observation === null ? "WAIT" : controlDecision.action,
      requestedMw: controlRequested,
      filledMw: controlFilled,
      fillPriceEurMwh,
      remainingMw: controlRemaining,
      decisionPriceEurMwh: observation?.price ?? null,
      priceSourceHash: observation?.sourceHash ?? null,
      atUtc,
    });

    const activeRequested = activeControllerDecision.requestedQuantityMw;
    const activeFilled = active.action === "BUY" && observation !== null ? activeRequested : 0;
    activeRemaining -= activeFilled;
    activeFilledMw += activeFilled;
    activeLedger.push({
      date: day,
      action: active.action === "BUY" && observation === null ? "ABSTAIN" : active.action,
      requestedMw: activeRequested,
      filledMw: activeFilled,
      fillPriceEurMwh,
      remainingMw: activeRemaining,
      decisionPriceEurMwh: observation?.price ?? null,
      priceSourceHash: observation?.sourceHash ?? null,
      atUtc,
      reference: location?.reference ?? null,
      signedDistanceToReference: location?.features?.signedDistanceToReference ?? null,
      reason: active.reason ?? null,
    });

    if (observation !== null) {
      anchoredRows.push({
        mission: missionLabel, atUtc, pitAvailableAtUtc: observation.availableAtUtc,
        price: observation.price, sourceHash: observation.sourceHash,
      });
      anchoredRows.sort((a, b) => a.atUtc.localeCompare(b.atUtc));
    }
  }

  const episodeStatus = (remaining, gaps) => (remaining === 0 ? EPISODE_STATUS.COMPLETE : gaps ? EPISODE_STATUS.DATA_INCOMPLETE : EPISODE_STATUS.OPEN_OBLIGATION);
  const economics = (ledger) => armEconomics({ ledger, targetVolumeMw: campaign.targetVolumeMw, fees, benchmark: evaluation.benchmark, deliveryHours: evaluation.deliveryHours, tradingDates: sortedDates });
  const controlEconomics = economics(controlLedger);
  const activeEconomics = economics(activeLedger);
  const controlGaps = controlLedger.some((row) => row.decisionPriceEurMwh === null);
  const activeGaps = activeLedger.some((row) => row.decisionPriceEurMwh === null);
  return {
    ok: true,
    episode: {
      runId,
      missionId,
      missionLabel,
      phase: DEVELOPMENT_PHASE,
      candidateHash: candidate.contentHash,
      searchSpaceHash: candidate.searchSpaceHash,
      controller: { ruleId: controller.ruleId, contentHash: controller.contentHash, lotSizeMw: controller.lotSizeMw, dailyCapMw: controller.dailyCapMw },
      calendarHash: control.calendarHash,
      executionContractHash: control.executionContractHash,
      population: {
        campaignId: campaign.campaignId,
        populationId: campaign.populationId ?? null,
        obligationId: campaign.obligationId ?? null,
        targetVolumeMw: campaign.targetVolumeMw,
        tradingDates: sortedDates.length,
      },
      control: {
        armId: "CONTROL", ledger: controlLedger,
        summary: { status: episodeStatus(controlRemaining, controlGaps), boughtMw: controlFilledMw, remainingMw: controlRemaining },
        economics: controlEconomics,
        artifactSha256: contentHashOf({ ledger: controlLedger, economics: controlEconomics }),
      },
      active: {
        armId: "H-S1-01", ledger: activeLedger,
        summary: { status: episodeStatus(activeRemaining, activeGaps), boughtMw: activeFilledMw, remainingMw: activeRemaining },
        economics: activeEconomics,
        artifactSha256: contentHashOf({ ledger: activeLedger, economics: activeEconomics }),
      },
    },
  };
}

// Ablation emparejada bajo el gate SEM-1 (comparability): control y activo
// comparten run/campaign/obligation/calendario/sizing/execution/benchmark; sin
// paridad o sin evidencia económica completa, HOLD explícito (nunca cero).
export function pairedAblation({ runId, campaign, missionId, controllerHash, calendarHash, executionHash, benchmark, controlEpisode, activeEpisode }) {
  const parity = {
    hypothesisId: H_S1_01.hypothesisId,
    runId,
    populationId: campaign.populationId ?? campaign.campaignId,
    campaignId: campaign.campaignId,
    obligationId: campaign.obligationId ?? campaign.campaignId,
    calendarVersion: calendarHash,
    sizingVersion: controllerHash,
    executionVersion: executionHash,
    benchmarkVersion: benchmark.version,
  };
  const controlBinding = controlFor({ ...parity, artifactSha256: controlEpisode.artifactSha256 });
  if (!controlBinding.ok) return { paired: false, code: controlBinding.code };
  const activeBinding = {
    ok: true, kind: "HYPOTHESIS", id: H_S1_01.hypothesisId, ...parity,
    artifactSha256: activeEpisode.artifactSha256,
  };
  const economicsOf = (episode) => ({
    status: "VALID_RUN",
    campaignId: parity.campaignId,
    obligationId: parity.obligationId,
    runId,
    artifactSha256: episode.artifactSha256,
    benchmarkStatus: benchmark.status,
    benchmarkVersion: benchmark.version,
    benchmarkArtifactSha256: benchmark.artifactSha256,
    costCompleteness: "FULL",
    unit: "EUR/MWh",
    B: episode.economics.B,
    H: episode.economics.H,
    V: episode.economics.V,
  });
  const outcome = compareAblation({
    control: controlBinding,
    active: activeBinding,
    controlEconomics: economicsOf(controlEpisode),
    activeEconomics: economicsOf(activeEpisode),
  });
  return { paired: true, code: outcome.code ?? null, ...outcome };
}
