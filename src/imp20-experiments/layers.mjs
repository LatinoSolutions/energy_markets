// Catálogo de capas candidatas para los experimentos de IMP-20. Fuente: SPEC
// v1.1.1 §25.1 fila IMP-20, §25.2 fila IMP-20 y DEP-15/16 (§24). Las
// identidades semánticas de S2–S5 (§8.2–8.5) y de Z/drivers (§7.1/§7.2) están
// CANONICAL / FROZEN: este módulo NO las redefine, sólo registra qué capa se
// ensaya, con qué cita normativa, qué DEP produce y qué roles puede desempeñar.

export const LAYER_IDS = Object.freeze(["S2", "S3", "S4", "S5", "Z", "DRIVERS"]);

export const DEP15_LANE = "DEP-15";
export const DEP16_LANE = "DEP-16";

export const CANDIDATE_LAYERS = Object.freeze({
  S2: {
    layerId: "S2",
    depLane: DEP15_LANE,
    frozenSemantics: "§8.2 S2 — Anomaly Detection (CANONICAL / FROZEN)",
    frozenQuestion: "¿La magnitud actual obliga a dejar de tratar el mercado como un régimen local normal?",
    defaultRole: "Evidence Generator (detecta y dimensiona el shock; no emite BUY/WAIT)",
    whatMustBeInstantiated: "horizontes/normalizadores de shock, ventana de volatilidad/escala, thresholds de severity opcionales, velocidad/expansión (vs baseline causal)",
    refutationProfile: "§8.2 Refutation: una detección precisa no basta; refutar si no aporta valor decisional incremental estable; simplificar severidad si un score simple empataría; invalidar definiciones que exijan observar normalización futura",
    relationNotes: "S1 puede correr en paralelo; S2 puede alimentar S3/S4 y condicionar la lectura de pullback en S5 (§8.2 Relations).",
  },
  S3: {
    layerId: "S3",
    depLane: DEP15_LANE,
    frozenSemantics: "§8.3 S3 — Trajectory / Repricing (CANONICAL / FROZEN)",
    frozenQuestion: "¿Existe una trayectoria sostenida que puede encarecer WAIT frente a BUY earlier?",
    defaultRole: "Evidence Generator de persistencia/repricing",
    whatMustBeInstantiated: "horizontes de trayectoria, estimadores de dirección/magnitud, rhythm/slope, criterio causal de persistencia",
    refutationProfile: "§8.3 Refutation: refutar si no identifica establemente OOS cuándo WAIT empeora; refutar si Dynamic Mode de Z_t absorbe todo su valor; invalidar labels identificables sólo a posteriori",
    relationNotes: "Composición S2→S3 es opcional; S1 permanece paralelo; S4 confirma/rechaza; S5 puede consumir la premisa (§8.3 Relations).",
  },
  S4: {
    layerId: "S4",
    depLane: DEP15_LANE,
    frozenSemantics: "§8.4 S4 — Structure / Range Transition (CANONICAL / FROZEN)",
    frozenQuestion: "¿La estructura conocida permanece, rechaza una frontera o transiciona hacia una estructura nueva aceptada?",
    defaultRole: "Evidence / gate por defecto (gate opcional sobre la premisa de otra Strategy)",
    whatMustBeInstantiated: "definición causal de rango, tolerancia de frontera, criterio de acceptance (tiempo/closes/actividad), criterio rejection/reclaim, timeout/estado unresolved",
    refutationProfile: "§8.4 Refutation: refutar si los estados no son reproducibles point-in-time o no mejoran procurement OOS; simplificar subestructuras sin contribución; invalidar rangos/pivots con confirmación futura",
    relationNotes: "S3+S4 distingue trayectoria con aceptación de trayectoria con rechazo; S5 usa S4 para integridad de premisa; probar redundancia con Dynamic Mode (§8.4).",
  },
  S5: {
    layerId: "S5",
    depLane: DEP15_LANE,
    frozenSemantics: "§8.5 S5 — Conditional Pullback Timing (CANONICAL / FROZEN)",
    frozenQuestion: "¿Esperar un pullback favorable mejora el coste sin elevar demasiado el riesgo de perder la compra y pagar más después?",
    defaultRole: "Preferencia de timing condicionada a una premisa válida; sin autoridad independiente",
    whatMustBeInstantiated: "premisa declarada y su provenance, threshold de pullback, regla de invalidación de premisa, wait budget máximo, threshold de coste de oportunidad",
    refutationProfile: "§8.5 Refutation: refutar si esperar no mejora OOS frente a comprar al activarse la premisa, o si no-fill/missed-purchase domina el ahorro; puede conservarse como regla de ejecución subordinada",
    relationNotes: "Consume S1/S3/S4 como premisa; S2 puede cambiar la interpretación del retroceso; no usa mínimos locales futuros ni ignora el deadline (§8.5).",
  },
  Z: {
    layerId: "Z",
    depLane: DEP16_LANE,
    frozenSemantics: "§7.1 Z_t = (m_t, e_t, c_t, q_t, u_t) — Market Dynamics & Sentiment State (rol/semántica CANONICAL / FROZEN)",
    frozenQuestion: "¿Aporta valor incremental frente a representaciones más simples usando el resultado económico procurement (§7.1)?",
    defaultRole: "Representación de contexto; no es Policy ni señal de compra",
    whatMustBeInstantiated: "representaciones candidatas por componente (m/e/c/q/u); cálculos concretos NO congelados por la fórmula (§7.1); rangos numéricos de Alexandria NO importados",
    refutationProfile: "§7.1: la conveniencia de cada representación se evalúa mediante ablations frente a representaciones más simples, con el resultado económico de procurement como criterio; refutación adicional por absorción de Dynamic Mode (§8.3).",
    relationNotes: "Z_t no es Decision Engine; Procurement State sigue siendo necesario; puede conservarse como evidencia separada (§7.1).",
  },
  DRIVERS: {
    layerId: "DRIVERS",
    depLane: DEP16_LANE,
    frozenSemantics: "§7.2 Fundamental Price Drivers: Power Base State 9 (E1–E9), Gas Base State 10 (G1–G10), Extraordinary State 4 (X1–X4) — taxonomía CANONICAL / FROZEN y cerrada (§7.2.5)",
    frozenQuestion: "¿Qué categorías aportan valor incremental o son redundantes cuando se mapean a fuentes reales y se miden por ablation?",
    defaultRole: "Audit/mapping + ablation; los 23 bloques son categorías conceptuales, NO una lista de 23 features obligatorias (§7.2)",
    whatMustBeInstantiated: "mapping de bloques a fuentes disponibles (audit DEP-06/07) con STATE/CHANGE/SURPRISE/Uncertainty; poda/completitud por evidencia (§7.2.5 invariante 5)",
    refutationProfile: "§7.2.5: poda por ablation; reabrir taxonomía sólo con evidencia material de categoría faltante o duplicada mediante versión explícita.",
    relationNotes: "No reemplaza Z_t; SURPRISE exige expectativa documentada previa, si no queda UNAVAILABLE (§7.2.1).",
  },
});

export function getLayer(layerId) {
  return CANDIDATE_LAYERS[layerId] ?? null;
}

export function isLayerId(value) {
  return LAYER_IDS.includes(value);
}
