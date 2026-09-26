// BT-06 (PLAN_STATUS, owner request 2026-09-26): une los releases exploratorios
// verificados (v2 gas + v3 Power) en un único artifact para la UI, sin recalcular
// nada. Cada release ya viene atado por sha256 a su manifest; aquí sólo se
// concatenan las listas y se indexan los mapas por producto.
//
// Si dos releases declaran la misma regla con valores distintos (p. ej. otro
// slippage o fees), no se elige una verdad: la unión falla cerrada.

const MERGED_RULE_KEYS = ["clientSlotBerlin", "slippageEurMwh", "dailyCapMw", "lotMw", "feesEurMwh"];

function dedupeById(items) {
  const seen = new Set();
  const result = [];
  for (const item of items ?? []) {
    const id = item?.id ?? item?.label;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(item);
  }
  return result;
}

function dedupeByLabelAndDetail(items) {
  const seen = new Set();
  const result = [];
  for (const item of items ?? []) {
    const key = `${item?.label}|${item?.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function mergeResearch(base, extra) {
  if (base === undefined) return extra;
  if (extra === undefined) return base;
  const byId = new Map();
  for (const candidate of [...(base.candidates ?? []), ...(extra.candidates ?? [])]) {
    const existing = byId.get(candidate.id);
    if (existing === undefined) {
      byId.set(candidate.id, { ...candidate, criteria: [...(candidate.criteria ?? [])] });
      continue;
    }
    byId.set(candidate.id, { ...existing, criteria: [...existing.criteria, ...(candidate.criteria ?? [])] });
  }
  return {
    ...base,
    candidates: [...byId.values()],
    // Se conservan los checks de cada release (p. ej. "Code pinned" apunta a v2 y a
    // v3): deduplicar por etiqueta escondería la procedencia de uno de los mercados.
    integrity: dedupeByLabelAndDetail([...(base.integrity ?? []), ...(extra.integrity ?? [])]),
  };
}

export function mergeExploratoryResults(base, extra) {
  if (base === null || base === undefined) return extra === undefined ? { ok: false, code: "NO_RELEASES" } : { ok: true, results: extra };
  if (extra === null || extra === undefined) return { ok: true, results: base };
  if (base.artifactKind !== extra.artifactKind || base.status !== extra.status) {
    return { ok: false, code: "EXPLORATORY_ARTIFACT_IDENTITY_MISMATCH" };
  }
  for (const key of MERGED_RULE_KEYS) {
    if (base.rules?.[key] !== extra.rules?.[key]) {
      return { ok: false, code: `EXPLORATORY_RULE_CONFLICT_${key}` };
    }
  }
  const merged = {
    ...base,
    market: [...new Set([...(base.market ?? []), ...(extra.market ?? [])])],
    inputs: {
      ...base.inputs,
      dataPeriod: {
        firstDataDay: [base.inputs?.dataPeriod?.firstDataDay, extra.inputs?.dataPeriod?.firstDataDay].filter(Boolean).sort()[0],
        lastDataDay: [base.inputs?.dataPeriod?.lastDataDay, extra.inputs?.dataPeriod?.lastDataDay].filter(Boolean).sort().at(-1),
      },
      calendars: [...(base.inputs?.calendars ?? []), ...(extra.inputs?.calendars ?? [])],
    },
    rules: {
      ...base.rules,
      targetsMw: { ...(base.rules?.targetsMw ?? {}), ...(extra.rules?.targetsMw ?? {}) },
    },
    summary: { ...(base.summary ?? {}), ...(extra.summary ?? {}) },
    comparison: { ...(base.comparison ?? {}), ...(extra.comparison ?? {}) },
    replay: [...(base.replay ?? []), ...(extra.replay ?? [])],
    campaigns: [...(base.campaigns ?? []), ...(extra.campaigns ?? [])],
    campaignUnknowns: dedupeById([...(base.campaignUnknowns ?? []), ...(extra.campaignUnknowns ?? [])]),
    research: mergeResearch(base.research, extra.research),
    benchmarkNote: [...new Set([base.benchmarkNote, extra.benchmarkNote].filter(Boolean))].join(" | "),
    episodesSkippedIncomplete: [...(base.episodesSkippedIncomplete ?? []), ...(extra.episodesSkippedIncomplete ?? [])],
    results: [...(base.results ?? []), ...(extra.results ?? [])],
  };
  return { ok: true, results: merged };
}

// Los productos que cada release declara en su comparación; se usa para atar la
// procedencia por producto en la UI (un valor Power no se atribuye al release gas).
export function productsOfResults(results) {
  const products = new Set();
  for (const key of Object.keys(results?.comparison ?? {})) products.add(key);
  for (const key of Object.keys(results?.summary ?? {})) products.add(key);
  for (const episode of results?.results ?? []) if (typeof episode?.product === "string") products.add(episode.product);
  return [...products];
}
