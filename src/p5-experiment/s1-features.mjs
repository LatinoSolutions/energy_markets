// Derivación de features S1 por frontera de decisión, desde la decision view
// PIT del manifest congelado. Fuente: SPEC v1.1.1 §8.1 (features continuas
// causales sobre la referencia congelada), §6.1/§6.2 (semántica PIT: sólo lo
// consumible en el boundary) y §14.3 paso 2 (la policy observa exclusivamente
// el historical decision view de IMP-06).
//
// IMP-16 no decide features: las resuelve DEL MANIFEST MATERIALIZADO. Cada
// entrada del plan declara la key PIT del precio de decisión y las keys del
// historial causal; el valor se lee de la decision view real en cada frontera.
// Una key sin valor consumible en la frontera deja la feature UNAVAILABLE para
// ese día (visible, con su razón) y el brazo A1 cae al timing A0 (§8.1
// uncertainty/unavailable): no se inventa elicidad.

import { readDecisionView } from "../pit-views/views.mjs";
import { computeS1Features } from "../s1-strategy/causal-reference.mjs";

function frontierByDate(decisionCalendar) {
  const map = new Map();
  for (const opportunity of decisionCalendar?.opportunities ?? []) {
    map.set(opportunity.date, opportunity);
  }
  return map;
}

function valueInView(view, pitKey) {
  if (!view.ok) {
    return { ok: false, reason: `view unavailable: ${view.reason ?? view.code ?? "vista no legible (§6.1)"}` };
  }
  const visible = view.visible.filter((entry) => entry.key === pitKey);
  if (visible.length === 0) {
    return { ok: false, reason: `pit key "${pitKey}" sin valor consumible en esta frontera (§6.1/§14.3)` };
  }
  if (typeof visible[0].value !== "number" || !Number.isFinite(visible[0].value)) {
    return { ok: false, reason: `pit key "${pitKey}" sin valor numérico finito` };
  }
  return { ok: true, value: visible[0].value, revisionId: visible[0].revisionId };
}

// Resuelve UNA entrada del plan: el precio de decisión y todo el historial
// causal se leen de la decision view real en la frontera exacta; con material
// de lectura roto la feature queda UNAVAILABLE (visible) para esa frontera y
// A1 cae al baseline.
function resolveFeatureEntry({ declaration, frontier, dataManifest, reference }) {
  const decisionTimeUtc = frontier.decisionTimeUtc;
  const view = readDecisionView(dataManifest, decisionTimeUtc);

  const decisionPriceOutcome = valueInView(view, declaration.decisionPricePitKey);
  if (!decisionPriceOutcome.ok) {
    return {
      ok: false, frontierDate: declaration.frontierDate,
      status: "UNAVAILABLE_FEATURES", features: null,
      reason: `${decisionPriceOutcome.reason} (§8.1 uncertainty/unavailable; §14.3)`,
    };
  }

  const history = [];
  for (const [index, entry] of (declaration.history ?? []).entries()) {
    const resolved = valueInView(readDecisionView(dataManifest, entry.atUtc), entry.pitKey);
    if (!resolved.ok) {
      return {
        ok: false, frontierDate: declaration.frontierDate,
        status: "UNAVAILABLE_FEATURES", features: null,
        reason: `history[${index}] (${entry.pitKey}): ${resolved.reason}`,
      };
    }
    history.push({ atUtc: entry.atUtc, price: resolved.value });
  }

  const features = computeS1Features({
    asOfUtc: decisionTimeUtc,
    decisionPrice: decisionPriceOutcome.value,
    history,
    reference,
  });
  if (!features.ok) {
    return { ok: false, frontierDate: declaration.frontierDate, status: "BLOCKED_FEATURES", features: null, reason: features.code };
  }
  if (!features.available) {
    return {
      ok: false, frontierDate: declaration.frontierDate,
      status: "UNAVAILABLE_FEATURES", features: null,
      reason: features.code ?? features.reason ?? "features no disponibles (§8.1)",
    };
  }
  return {
    ok: true,
    frontierDate: declaration.frontierDate,
    decisionTimeUtc,
    pitKey: declaration.decisionPricePitKey,
    decisionPriceRevisionId: decisionPriceOutcome.revisionId ?? null,
    status: "AVAILABLE_FEATURES",
    features: features.features,
  };
}

// §8.1/§14.3: el plan completo de features S1 del experimento, derivado del
// manifest PIT congelado en la frontera exacta de cada opportunity del
// calendario. Determinista; cualquier día sin resolución queda visible con
// su razón (fail-closed ante silencio) SIN bloquear el experimento: esos días
// A1 no tendrá feature y caerá al timing A0 (UNKNOWN, no inventado).
export function deriveS1FeaturePlan({ decisionCalendar, dataManifest, configuration, featureInputDeclarations = [] } = {}) {
  if (!configuration || typeof configuration.thresholds !== "object" || !configuration.reference) {
    return { ok: false, code: "INVALID_S1_CONFIGURATION", entries: [] };
  }
  if (!Array.isArray(featureInputDeclarations)) {
    return { ok: false, code: "INVALID_FEATURE_INPUT_DECLARATIONS", entries: [] };
  }
  const frontiers = frontierByDate(decisionCalendar);
  const entries = [];
  for (const declaration of featureInputDeclarations) {
    if (!declaration || typeof declaration !== "object" || typeof declaration.frontierDate !== "string") {
      return { ok: false, code: "INVALID_FEATURE_ENTRY", entries: [] };
    }
    if (!frontiers.has(declaration.frontierDate)) {
      return { ok: false, code: "FEATURE_ENTRY_NOT_IN_CALENDAR", entries: [], offendingDate: declaration.frontierDate };
    }
    if (!declaration.decisionPricePitKey || typeof declaration.decisionPricePitKey !== "string") {
      return { ok: false, code: "MISSING_DECISION_PRICE_PIT_KEY", entries: [], offendingDate: declaration.frontierDate };
    }
    const resolved = resolveFeatureEntry({
      declaration,
      frontier: frontiers.get(declaration.frontierDate),
      dataManifest,
      reference: configuration.reference,
    });
    if (!resolved.ok) {
      entries.push(resolved);
      continue;
    }
    entries.push(resolved);
  }
  return {
    ok: true,
    code: entries.length === 0 ? "EMPTY_FEATURE_PLAN" : "OK",
    entries,
  };
}
