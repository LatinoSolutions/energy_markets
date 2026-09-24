// Comparación económica de brazos para la vista Backtests (fase exploratoria, owner
// patch EM-SPEC-OWNER-PATCH-2026-09-24-02 §4). Todo se calcula aquí, en backend; la UI
// solo dibuja lo que sale de este módulo.
//
// B* es un PROXY exploratorio, no el benchmark canónico B de la SPEC (0,75 trades +
// 0,25 mid, IMP-05 sin reconciliar): media equiponderada de los asks de las 11:00 de
// los días de la ventana con quote fresco. H = precio medio pagado (ask + slippage).
// V = (B* - H) x MWh; MWh = MW comprados x horas de entrega del contrato (gas day
// 06:00-06:00 Berlin, ajustado por cambio de hora), paquete del cliente 2026-09-23:
// "Use contract delivery hours when total MWh/notional is needed".

function lastSunday(year, monthIndex) {
  const date = new Date(Date.UTC(year, monthIndex + 1, 0));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

export function deliveryHours(product, maturity) {
  const year = Number(maturity.slice(0, 4));
  const month = Number(maturity.slice(4, 6)) - 1;
  const months = product === "G0BQ" ? 3 : 1;
  const start = Date.UTC(year, month, 1);
  const end = Date.UTC(year, month + months, 1);
  let hours = (end - start) / 3600000;
  // El gas day que empieza el sábado 06:00 contiene el cambio de hora del domingo.
  for (let y = year; y <= year + 1; y += 1) {
    const spring = Date.parse(`${lastSunday(y, 2)}T00:00:00Z`) - 86400000;
    const autumn = Date.parse(`${lastSunday(y, 9)}T00:00:00Z`) - 86400000;
    if (spring >= start && spring < end) hours -= 1;
    if (autumn >= start && autumn < end) hours += 1;
  }
  return hours;
}

export function benchmarkProxy(ledger) {
  const asks = ledger.filter((entry) => typeof entry.ask === "number").map((entry) => entry.ask);
  return asks.length === 0 ? null : asks.reduce((sum, value) => sum + value, 0) / asks.length;
}

// Decisiones de un brazo en un episodio, con su V por decisión.
export function decisionsOf({ ledger, benchmark, hours }) {
  return ledger.map((entry) => {
    const filled = entry.filledMw ?? 0;
    const priceGap = filled > 0 ? entry.priceEurMwh - benchmark : null;
    return {
      day: entry.day,
      status: entry.status,
      filledMw: filled,
      priceEurMwh: entry.priceEurMwh ?? null,
      hMinusBEurMwh: priceGap,
      vEur: filled > 0 ? (benchmark - entry.priceEurMwh) * filled * hours : 0,
    };
  });
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function histogram(values, { min = -8, max = 8, bins = 16 } = {}) {
  const width = (max - min) / bins;
  const counts = Array.from({ length: bins }, () => 0);
  let outside = 0;
  for (const value of values) {
    const index = Math.floor((value - min) / width);
    if (index < 0 || index >= bins) {
      outside += 1;
      continue;
    }
    counts[index] += 1;
  }
  return { min, max, bins, counts, outside };
}

// `episodes`: [{ product, maturity, arms: { BASELINE: {ledger, summary}, ARM_A: ..., ARM_B: ... } }]
export function buildComparison({ product, episodes, armLabels }) {
  const hoursBy = new Map(episodes.map((episode) => [episode.maturity, deliveryHours(product, episode.maturity)]));
  const perEpisode = episodes.map((episode) => {
    const hours = hoursBy.get(episode.maturity);
    const benchmark = benchmarkProxy(episode.arms.BASELINE.ledger);
    const arms = {};
    for (const [armId, arm] of Object.entries(episode.arms)) {
      if (!arm) {
        arms[armId] = null;
        continue;
      }
      const decisions = decisionsOf({ ledger: arm.ledger, benchmark, hours });
      const mwh = arm.summary.boughtMw * hours;
      arms[armId] = {
        complete: arm.summary.complete,
        boughtMw: arm.summary.boughtMw,
        targetMw: arm.summary.targetMw,
        h: arm.summary.avgPriceEurMwh,
        vEur: arm.summary.avgPriceEurMwh === null ? null : (benchmark - arm.summary.avgPriceEurMwh) * mwh,
        decisions,
        slot: arm.slot,
      };
    }
    return { maturity: episode.maturity, hours, benchmark, arms };
  });

  const armIds = Object.keys(armLabels);
  const table = armIds.map((armId) => {
    const runs = perEpisode.filter((episode) => episode.arms[armId]);
    const closed = runs.filter((episode) => episode.arms[armId].complete && episode.arms.BASELINE.complete);
    const sum = (pick) => closed.reduce((total, episode) => total + pick(episode), 0);
    const mwh = sum((episode) => episode.arms[armId].boughtMw * episode.hours);
    const vEur = sum((episode) => episode.arms[armId].vEur);
    const baseV = sum((episode) => episode.arms.BASELINE.vEur);
    const weighted = (pick) => (mwh === 0 ? null : sum((episode) => pick(episode) * episode.arms[armId].boughtMw * episode.hours) / mwh);
    const deltas = closed.map((episode) => episode.arms[armId].vEur - episode.arms.BASELINE.vEur);
    return {
      armId,
      label: armLabels[armId],
      closed: closed.length,
      total: perEpisode.length,
      notRun: perEpisode.length - runs.length,
      bEurMwh: weighted((episode) => episode.benchmark),
      hEurMwh: weighted((episode) => episode.arms[armId].h),
      vKeur: closed.length === 0 ? null : vEur / 1000,
      deltaVKeur: armId === "BASELINE" || closed.length === 0 ? null : (vEur - baseV) / 1000,
      deltaRangeKeur: deltas.length === 0 || armId === "BASELINE" ? null : [Math.min(...deltas) / 1000, Math.max(...deltas) / 1000],
      status: closed.length === perEpisode.length ? "COMPLETE" : closed.length === 0 ? "NOT_COMPARABLE" : "PARTIAL",
    };
  });

  // ΔV acumulado por decisión, episodio tras episodio, solo sobre episodios cerrados en ambos brazos.
  const paired = {};
  for (const armId of armIds.filter((id) => id !== "BASELINE")) {
    let cumulative = 0;
    const points = [];
    const boundaries = [];
    for (const episode of perEpisode) {
      const arm = episode.arms[armId];
      if (!arm || !arm.complete || !episode.arms.BASELINE.complete) continue;
      boundaries.push({ index: points.length, maturity: episode.maturity });
      arm.decisions.forEach((decision, index) => {
        cumulative += decision.vEur - episode.arms.BASELINE.decisions[index].vEur;
        points.push(cumulative / 1000);
      });
    }
    paired[armId] = { points, boundaries, finalKeur: points.at(-1) ?? null };
  }

  const distributions = {};
  for (const armId of armIds) {
    const gaps = perEpisode.flatMap((episode) => episode.arms[armId]?.decisions ?? []).map((decision) => decision.hMinusBEurMwh).filter((value) => typeof value === "number");
    distributions[armId] = { ...histogram(gaps), mean: gaps.length === 0 ? null : gaps.reduce((sum, value) => sum + value, 0) / gaps.length, n: gaps.length, p95: percentile(gaps, 0.95) };
  }

  const acrossCampaigns = perEpisode.map((episode) => ({
    maturity: episode.maturity,
    arms: Object.fromEntries(armIds.filter((id) => id !== "BASELINE").map((armId) => {
      const arm = episode.arms[armId];
      const comparable = arm?.complete && episode.arms.BASELINE.complete;
      return [armId, comparable ? (arm.vEur - episode.arms.BASELINE.vEur) / 1000 : null];
    })),
  }));

  return { product, perEpisode: perEpisode.map(({ arms, ...rest }) => ({ ...rest, arms: Object.fromEntries(Object.entries(arms).map(([id, arm]) => [id, arm && { complete: arm.complete, boughtMw: arm.boughtMw, h: arm.h, vEur: arm.vEur, slot: arm.slot }])) })), table, paired, distributions, acrossCampaigns };
}
