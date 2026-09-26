// Comparación del motor TRADES (TR-05). Fuente:
// docs/canonical/v1_1_1/OWNER_PATCH_TRADES_MODE_2026-09-25.md
// (EM-SPEC-OWNER-PATCH-2026-09-25-03) §3.3 y TRADES_MODE_PLAN.md TR-05
// ("ΔV entre brazos solo con los dos brazos completos (el benchmark se
// cancela); V absoluto entre modos no se compara sin referencia común").
//
// El benchmark proxy del modo TRADES consume explícitamente el campo `price`
// de la observación (no `ask`): si el motor escribiera la observación en `ask`,
// aquí se vería el error en vez de un B* = null silencioso. La comparación NO
// produce V absoluto contra el benchmark: sólo ΔV entre brazos del mismo modo,
// donde el benchmark se cancela.

import { deliveryHoursForMission } from "./hours.mjs";

export const TRADES_BENCHMARK_RULE = "MEAN_OF_OBSERVATION_PRICE";
export const ABSOLUTE_V_ACROSS_MODES = "NOT_COMPARABLE_WITHOUT_COMMON_REFERENCE";

export function tradesBenchmarkProxy(ledger) {
  const prices = (ledger ?? [])
    .filter((entry) => typeof entry?.price === "number" && Number.isFinite(entry.price))
    .map((entry) => entry.price);
  if (prices.length === 0) return null;
  return prices.reduce((sum, value) => sum + value, 0) / prices.length;
}

// ΔV de un brazo respecto de Baseline, sólo con los dos brazos COMPLETOS (mismo
// target). Con ambos completos el volumen comprado coincide y el benchmark se
// cancela: ΔV = (H_baseline - H_arm) x MWh. Si falta cualquiera, null.
export function pairwiseDeltaV({ baseline, arm, hours } = {}) {
  const baselineSummary = baseline?.summary ?? null;
  const armSummary = arm?.summary ?? null;
  if (!baselineSummary?.complete || !armSummary?.complete) return null;
  if (baselineSummary.targetMw !== armSummary.targetMw) return null;
  const hBaseline = baselineSummary.avgPriceEurMwh;
  const hArm = armSummary.avgPriceEurMwh;
  if (hBaseline === null || hArm === null) return null;
  if (!Number.isFinite(hours)) return null;
  return (hBaseline - hArm) * baselineSummary.targetMw * hours;
}

// `episodes`: [{ maturity, arms: { BASELINE: {summary, ledger}, ARM_A: ..., ARM_B: ... } }]
export function buildTradesComparison({ product, episodes = [], armLabels = {} } = {}) {
  const perEpisode = episodes.map((episode) => ({
    maturity: episode.maturity,
    hours: deliveryHoursForMission({ mission: episode.mission, maturity: episode.maturity }),
    benchmark: tradesBenchmarkProxy(episode.arms?.BASELINE?.ledger),
    arms: episode.arms ?? {},
  }));

  const armIds = Object.keys(armLabels);
  const table = armIds.map((armId) => {
    const closed = perEpisode.filter((episode) => (
      episode.arms?.[armId]?.summary?.complete && episode.arms?.BASELINE?.summary?.complete
    ));
    const deltas = closed.map((episode) => pairwiseDeltaV({
      baseline: episode.arms.BASELINE,
      arm: episode.arms[armId],
      hours: episode.hours,
    }));
    const total = deltas.reduce((sum, value) => sum + value, 0);
    return {
      armId,
      label: armLabels[armId] ?? armId,
      closed: closed.length,
      total: perEpisode.length,
      deltaVKeur: armId === "BASELINE" || closed.length === 0 ? null : total / 1000,
      deltaRangeKeur: deltas.length === 0 || armId === "BASELINE"
        ? null
        : [Math.min(...deltas) / 1000, Math.max(...deltas) / 1000],
      status: closed.length === perEpisode.length ? "COMPLETE" : closed.length === 0 ? "NOT_COMPARABLE" : "PARTIAL",
    };
  });

  return {
    product,
    benchmarkRule: TRADES_BENCHMARK_RULE,
    absoluteVAcrossModes: ABSOLUTE_V_ACROSS_MODES,
    perEpisode: perEpisode.map(({ arms, ...rest }) => ({
      ...rest,
      arms: Object.fromEntries(Object.entries(arms).map(([armId, arm]) => [
        armId,
        arm ? { status: arm.summary?.status ?? null, complete: arm.summary?.complete ?? false, boughtMw: arm.summary?.boughtMw ?? null, h: arm.summary?.avgPriceEurMwh ?? null, slot: arm.summary?.slotLabel ?? null } : null,
      ])),
    })),
    table,
  };
}
