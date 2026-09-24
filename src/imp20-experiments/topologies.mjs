// Topologías candidatas de composición para los experimentos de IMP-20.
// Fuente: SPEC v1.1.1 §8.6 (cuatro topologías candidatas), §9.1 (una sola
// Candidate Policy global; S1–S5 son Evidence Generators), §9.2 (composición
// completa no obliga a incorporar S1–S5 simultáneamente; local policies y
// meta-policy fuera de la primera arquitectura) y el MUST NOT CHANGE de
// §25.1 fila IMP-20 ("no meta-policy automática").

export const TOPOLOGY_IDS = Object.freeze([
  "INDEPENDENT_ABLATION",
  "PARALLEL_EVIDENCE_PRODUCERS",
  "SELECTED_SERIAL_COMPOSITIONS",
  "HYBRID_GLOBAL_META_POLICY",
]);

export const TOPOLOGIES = Object.freeze({
  INDEPENDENT_ABLATION: {
    topologyId: "INDEPENDENT_ABLATION",
    specCitation: "§8.6 topología 1; §10.2 Contribution_i = R_full − R_without_i",
    semantics: "Se ensaya una capa aislada frente al núcleo aceptado; ablation de contribución aislada.",
    authoritySemantics: "Sin autoridad propia; el resultado alimenta la evaluación/admisión posterior bajo los contratos vigentes (UNLOCKS IMP-20).",
    predeclaredRequirement: "arm de contribución y arm sin la capa, declarados ex-ante.",
  },
  PARALLEL_EVIDENCE_PRODUCERS: {
    topologyId: "PARALLEL_EVIDENCE_PRODUCERS",
    specCitation: "§8.6 topología 2; §9.1 flujo evidence → Candidate Policy",
    semantics: "Varias capas publican evidencia continua e incertidumbre en paralelo, sin serialidad obligatoria.",
    authoritySemantics: "Ningún productor paralelo obtiene autoridad distribuida (§9.2).",
    predeclaredRequirement: "ablation adicional que mida redundancia entre productores.",
  },
  SELECTED_SERIAL_COMPOSITIONS: {
    topologyId: "SELECTED_SERIAL_COMPOSITIONS",
    specCitation: "§8.6 topología 3 (la secuencia S2→S3→S4→S5 con S1 paralelo es una hipótesis de composición, no un orden obligatorio)",
    semantics: "Composición serial elegida de capas, declarada ex-ante; cada consumo serial debe declarar premisa y provenance (p. ej. S1→S5).",
    authoritySemantics: "La etapa serial sigue siendo evidencia/preferencia subordinada a la Candidate Policy global (§9.1).",
    predeclaredRequirement: "orden, premisa consumida y regla de invalidación de premisa declarados antes del run.",
  },
  HYBRID_GLOBAL_META_POLICY: {
    topologyId: "HYBRID_GLOBAL_META_POLICY",
    specCitation: "§8.6 topología 4; §9.2 (local policies y meta-policy fuera de la primera arquitectura; objeto de investigación posterior si la evidencia demuestra que la arquitectura más simple es insuficiente)",
    semantics: "Hipótesis de composición híbrida con una interpolación/elección global sobre evidencias.",
    authoritySemantics: "AUTOMATIZACIÓN PROHIBIDA: un diseño IMP-20 sólo puede declarar esta topología como candidata de research; no puede activar meta-policy, conceder autoridad ni alterar P7 o P5 (MUST NOT CHANGE §25.1).",
    predeclaredRequirement: "declaración explícita researchOnly=true y de que ninguna outcome automática cambia P5 o autoridad.",
  },
});

export function getTopology(topologyId) {
  return TOPOLOGIES[topologyId] ?? null;
}

export function isTopologyId(value) {
  return TOPOLOGY_IDS.includes(value);
}
