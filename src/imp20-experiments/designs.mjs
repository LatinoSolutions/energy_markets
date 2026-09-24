// Diseños predeclarados de los experimentos "después" de IMP-20. Fuente:
// SPEC v1.1.1 §25.1 fila IMP-20 y §25.2 (DEP-15/16, REQUIRES_AUDIT,
// comparator = evidencia previa del núcleo IMP-16). ESTA ENTREGA DISEÑA: no
// ejecuta runs económicos, no cierra DEP-15/16, no admite capas y no cambia
// P5. Cada diseño es un objeto pasable a validateExperimentDesign().

import { COMPARATOR_RULE } from "./accounting.mjs";
import { CANDIDATE_LAYERS } from "./layers.mjs";
// La identidad de instancia (§25.2.1) se liga a la identidad canónica de la
// SPEC vigente ya registrada en el repo, para que el SPEC ID no pueda divergir
// por un literal escrito de memoria (review IMP20-H2).
import { IMP09_SPEC_IDENTITY as CANONICAL_SPEC_IDENTITY } from "../oos-reservation/campaign-register.mjs";

export const SPEC_SHA256 = CANONICAL_SPEC_IDENTITY.sha256;

const CORE_COMPARATOR = Object.freeze({
  coreEvidenceReference:
    "Evidencia previa conservada del núcleo: versión P5 ensayada de IMP-16 aceptado (DEP-13/14: resultado A0/A1, Delta V, métricas, verdict y límites). Referencia read-only por identidad; sin números redeclarados.",
  consumedReadOnly: true,
  complianceNote: COMPARATOR_RULE.specCitation,
});

const MARGINAL_VALUE = Object.freeze({
  specCitation: "§10.2 / §25.1 fila IMP-20",
  method:
    "Contribution_i = R_full − R_without_i y Delta V entre arms declaradas ex-ante, sobre el reward global y la contabilidad compartida; refutation P5.7/§5.8; FAIL conservado sin capas de rescate (§13.9).",
  sameAccounting: true,
});

const REDUNDANCY = Object.freeze({
  specCitation: "§25.1 fila IMP-20 (redundancia con misma contabilidad); §8.4/§8.6",
  method:
    "Redundancia/overlap de la capa frente al núcleo admitido y frente a las demás capas del experimento, medida por ablation con la contabilidad compartida; sin atribuir todo resultado positivo a las señales activas (§10.2).",
  sameAccounting: true,
});

const ADMISSION_PATH = Object.freeze({
  viaContract: "§8.7",
  automatic: false,
  noAutomaticP5AuthorityChange: true,
  description: "La evaluación/admisión posterior de la capa sigue §8.7 (lifecycle, evidence, autoridad de la admisión) y §9.2; un outcome favorable no cambia P5 ni concede autoridad (UNLOCKS IMP-20).",
});

const NON_AMPLIATION = Object.freeze({
  population: true,
  baselineA0: true,
  oosFrontier: true,
  s1Identity: true,
  conservedVerdict: true,
});

const UNKNOWN_EEX_AUDIT = Object.freeze({
  unknownId: "UNK-EEX-AUDIT",
  subject: "Inputs causales DEP-06/07 de la(s) capa(s) ensayada(s) sobre el lago EEX (disponibilidad por instrumento/episodio, PIT, revisiones, cobertura)",
  kind: "AUDIT_MISSING",
  reason:
    "El lago EEX permanece AUDIT-DEPENDENT (§6.5; CCR-13) y el benchmark B está UNRECONCILED (§25.3); sin audit del scope concreto del experimento el run económico no es interpretable. Es trabajo de ingeniería/auditoría interno (IMP-03/05/06), no un hecho externo.",
  blockedAct:
    "Ejecutar el run económico del experimento (calibración OOS y Delta V); el diseño y su predeclaración no quedan bloqueados.",
});

const UNKNOWN_SURPRISE = Object.freeze({
  unknownId: "UNK-SURPRISE-REFERENCE",
  subject: "Expectativas documentadas previas para declarar SURPRISE en drivers/Z (publicaciones, storage, forecasts)",
  kind: "DATA_NOT_OBSERVABLE",
  reason:
    "SURPRISE exige una expectativa demostrable disponible antes del dato (§7.2.1); si no existe, queda UNAVAILABLE y esa ausencia no equivale a sorpresa nula. No se inventan expectativas.",
  blockedAct:
    "Declarar SURPRISE para los bloques sin expectativa documentada; la capa opera como STATE/CHANGE/Uncertainty mientras tanto.",
});

const UNKNOWN_Z_CALCULUS = Object.freeze({
  unknownId: "UNK-Z-CALCULUS",
  subject: "Cálculos concretos de los componentes m/e/c/q/u de Z_t (candidatos de representación a elegir por ablation)",
  kind: "SPEC_UNDETERMINED",
  reason:
    "§7.1 congela el rol/semántica, no la representación: no se importan rangos numéricos ni fórmulas de Alexandria; las representaciones se instancian por experimento y se podan por ablation (EVIDENCE-DEPENDENT, §24 DEP-16).",
  blockedAct: "Fijar una representación de Z como definitiva; queda abierta como ablation de esta entrega.",
});

const UNKNOWN_SERIAL_READINESS = Object.freeze({
  unknownId: "UNK-SERIAL-ADMITTED-LAYERS",
  subject: "Capas realmente admitidas disponibles como premisa del calculo serial (S2/S3/S4/S5 y sus outcomes de admisión §8.7)",
  kind: "SPEC_UNDETERMINED",
  reason:
    "El experimento serial se DECLARA antes de que existan las capas admitidas; su ejecución depende de la lifecycle y evidencia de admisión de cada premisa (§8.6; §8.7.3 EVIDENCE-DEPENDENT). El diseño no presume admisiones.",
  blockedAct: "Ejecutar la composición serial; el diseño queda predeclarado y la ejecución depende de las capas que se admitan.",
});

const GATES = Object.freeze([
  { block: "Data / PIT", note: "§19.2: occurred/publication/policy-consumable times y versiones por input de la capa; audit scope declarado en requiredAuditScopes." },
  { block: "Evaluator", note: "§19.1: suite manual y closure gate P6 de §14.8/§14.10 con la contabilidad compartida del experimento." },
  { block: "Execution parity", note: "§19.1: contrato P5.6 auditado/versionado e igual en todas las arms (§13.6)." },
  { block: "Hypothesis", note: "§19.1: paired Delta V y refutation sobre evidencia válida con criteria predeclarados." },
  { block: "Research acceptance", note: "§19.1: métricas, muestra, OOS y casos límite cumplen P3 de §5; HOLD cuando la muestra no permita interpretación estable (§5.8)." },
  { block: "Forward / governance", note: "§19.1: la evidencia técnica no autoriza compras; promoción/admisión por sus gates (§§15–18; §8.7)." },
]);

// §8.6 (protocolo compartido): "congelar semántica y refutación; predeclarar
// espacio de búsqueda; usar development/calibration cronológicos; ... congelar
// parámetros; validar OOS/walk-forward". El espacio de búsqueda se declara
// como FAMILIAS de parámetros a calibrar —nunca valores numéricos inventados
// (§0.2)—. La porción que la SPEC deja indeterminada se registra como
// desconocido visible con razón (§25.1), no se disimula.
function makeSearchSpace(dimensions, unknownScope = null) {
  return Object.freeze({
    predeclared: true,
    frozenBeforeOOS: true,
    calibrationRegime: "DEVELOPMENT_CHRONOLOGICAL",
    dimensions: Object.freeze([...dimensions]),
    unknownScope,
  });
}

const SEARCH_SPACE_S2 = makeSearchSpace([
  "Thresholds de magnitud/normalización de la evidencia S2",
  "Ventanas causales (lookbacks) de volatilidad y escala",
  "Velocidad y expansión de la señal",
  "Mapeo de severity a evidencia continua (no a BUY/WAIT)",
]);

const SEARCH_SPACE_S3 = makeSearchSpace([
  "Horizontes de trayectoria predeclarados",
  "Parámetros de direction y magnitud de S3",
  "Rhythm: periodicidad/fase de persistencia",
  "Umbrales de estabilidad de labels",
]);

const SEARCH_SPACE_S4 = makeSearchSpace([
  "Definición de rango (fronteras y tolerancias versionadas)",
  "Criterios point-in-time intact/testing/transition/newly accepted",
  "Parámetros de confirmación causal (sin confirmación futura)",
]);

const SEARCH_SPACE_S5 = makeSearchSpace(
  [
    "Threshold de pullback frente a referencia causal",
    "Regla de invalidación de la premisa",
    "Wait budget y tiempo máximo de espera",
    "Coste de oportunidad declarado ex-ante",
  ],
  Object.freeze({
    unknownId: "UNK-SERIAL-ADMITTED-LAYERS",
    reason:
      "La premisa serial depende de qué capas se admitan realmente (§8.7); esa porción del espacio de búsqueda no puede cerrarse antes de las admisiones.",
  })
);

const SEARCH_SPACE_Z = makeSearchSpace(
  [
    "Representación candidata por componente m/e/c/q/u",
    "Subsets de componentes para poda por ablation",
  ],
  Object.freeze({
    unknownId: "UNK-Z-CALCULUS",
    reason:
      "§7.1 congela el rol/semántica de Z, no los cálculos concretos; cada cálculo se instancia por experimento y se poda por ablation.",
  })
);

const SEARCH_SPACE_DRIVERS = makeSearchSpace(
  [
    "Bloques de la taxonomía cerrada incluidos por muestra mapeada/a auditada",
    "Variantes de mapping por bloque a fuentes EEX/operativas disponibles",
    "Tratamiento de Uncertainty por bloque (STATE/CHANGE/SURPRISE)",
  ],
  Object.freeze({
    unknownId: "UNK-SURPRISE-REFERENCE",
    reason:
      "SURPRISE exige expectativa documentada previa (§7.2.1); sin ella esa dimensión queda UNAVAILABLE y no se inventan expectativas.",
  })
);

function makeIdentity(experimentId, scope) {
  return {
    experimentId,
    specId: CANONICAL_SPEC_IDENTITY.id,
    specVersion: CANONICAL_SPEC_IDENTITY.version,
    specSha256: CANONICAL_SPEC_IDENTITY.sha256,
    parentImp: "IMP-20",
    scope,
    objectVersion: "1.0.0",
    protocolVersion: "1.0.0",
  };
}

function makeAccounting(benchmarkIdentity, evaluatorIdentity) {
  return {
    benchmarkIdentity,
    controllerAndSizing: "Controller A0 calendar-only price-blind + sizing compartido del núcleo P5 (§13.4/P5.2), consumido read-only desde la versión IMP-16",
    executionContract: "Execution contract P5.6 versionado del bundle congelado IMP-16, igual en las arms (§13.6)",
    evaluatorIdentity,
    oosFrontier: "Manifest de reserva OOS de IMP-09, intacta y re-verificada antes del run (§15; §13.8 sealed OOS)",
    rewardIdentity: "ONE GLOBAL PROCUREMENT REWARD (§10.1); R_T = V_campaign como ancla terminal (§10.3)",
  };
}

const COMMON_UNKNOWN_LIST = [UNKNOWN_EEX_AUDIT];
const Z_LANE_UNKNOWN_LIST = [UNKNOWN_EEX_AUDIT, UNKNOWN_SURPRISE, UNKNOWN_Z_CALCULUS];
const DRIVERS_LANE_UNKNOWN_LIST = [UNKNOWN_EEX_AUDIT, UNKNOWN_SURPRISE];
const SERIAL_LANE_UNKNOWN_LIST = [UNKNOWN_EEX_AUDIT, UNKNOWN_SERIAL_READINESS];

function s2Layer() {
  const L = CANDIDATE_LAYERS.S2;
  return {
    layerId: L.layerId,
    frozenSemantics: L.frozenSemantics,
    noEconomicParameters: true,
  };
}

function s3Layer() {
  const L = CANDIDATE_LAYERS.S3;
  return {
    layerId: L.layerId,
    frozenSemantics: L.frozenSemantics,
    noEconomicParameters: true,
  };
}

function s4Layer() {
  const L = CANDIDATE_LAYERS.S4;
  return {
    layerId: L.layerId,
    frozenSemantics: L.frozenSemantics,
    noEconomicParameters: true,
  };
}

function s5Layer(premiseProvenance) {
  const L = CANDIDATE_LAYERS.S5;
  return {
    layerId: L.layerId,
    frozenSemantics: L.frozenSemantics,
    noEconomicParameters: true,
    premiseProvenance,
  };
}

function zLayer() {
  const L = CANDIDATE_LAYERS.Z;
  return {
    layerId: L.layerId,
    frozenSemantics: L.frozenSemantics,
    noEconomicParameters: true,
  };
}

function driversLayer() {
  const L = CANDIDATE_LAYERS.DRIVERS;
  return {
    layerId: L.layerId,
    frozenSemantics: L.frozenSemantics,
    noEconomicParameters: true,
    taxonomyClosed: true,
    mandatoryFeatures: false,
    auditMappingScope: [
      "Mapping STATE/CHANGE/SURPRISE/Uncertainty de bloques E1–E9/G1–G10/X1–X4 a fuentes disponibles del lago EEX y fuentes operativas (DEP-06/07)",
      "Muestra declarada de bloques por experimento: se ensayan los admitidos por mapping/evidencia, no los 23",
    ],
  };
}

export const EXPERIMENT_DESIGNS = Object.freeze([
  {
    identity: makeIdentity("IMP20-EX-S02-01", "Ablation independiente: S2 Anomaly Detection como evidence generator sobre el núcleo aceptado A0/A1"),
    searchSpace: SEARCH_SPACE_S2,
    objective:
      "Medir el valor marginal de S2 como capa aislada (A0/A1 core vs A2 = A1 + S2) con la misma contabilidad del núcleo, y su redundancia frente a S1; simetría de detección up/down sin convertir severity en BUY/WAIT.",
    layers: [s2Layer()],
    topology: "INDEPENDENT_ABLATION",
    comparator: CORE_COMPARATOR,
    arms: [
      { armId: "A1_CORE", ablationDesign: ["Brazo comparador: la evidencia del núcleo corre igual que la arm experimental salvo la capa nueva (paridad ex-ante, §13.9)."] },
      { armId: "A2_S2", ablationDesign: ["A1 + features continuas S2 (magnitud/normalizada/velocidad/expansión con thresholds calibrados en development cronológico y congelados antes de OOS)."] },
    ],
    accountingIdentity: makeAccounting(
      "Benchmark B compartido del bundle congelado IMP-16 (misma identidad/version para las dos arms)",
      "Evaluator P6 (§14) versionado del núcleo, sin entrenar ni reparar diseño"
    ),
    marginalValueMethod: MARGINAL_VALUE,
    redundancyMethod: REDUNDANCY,
    refutationCriteria:
      "§8.2 Refutation: descartar/simplificar S2 si no aporta valor decisional incremental estable OOS (mean(Delta V) <= 0 → FAIL, §5.8/§13.7); simplificar severity si un score simple empataría; invalidar definiciones que requieran observar normalización futura; simetría de detección sin definiciones distintas arriba/abajo sin evidencia.",
    dataMapping: {
      policySummary:
        "Features S2 sobre precios/referencias causales del horizonte declarado (decision view PIT §6); volatilidad/escala de ventanas causales; magnitud disponible en boundary; sin outcomes futuros.",
      noInventedData: true,
    },
    requiredAuditScopes: [
      { depId: "DEP-06/07", scope: "precios/serie del instrumento y territorio/from what referencias de volatilidad usa S2", resolvesAudit: false },
    ],
    unknowns: COMMON_UNKNOWN_LIST,
    admissionPath: ADMISSION_PATH,
    gatesChecklist: GATES,
    nonAmpliation: NON_AMPLIATION,
    predeclared: true,
    freezingOrder: "SEMANTICS_AND_REFUTATION_FIRST",
  },
  {
    identity: makeIdentity("IMP20-EX-S03-01", "Ablation independiente: S3 Trajectory / Repricing sobre el núcleo aceptado, con chequeo de absorción por Dynamic Mode"),
    searchSpace: SEARCH_SPACE_S3,
    objective:
      "Medir si la evidencia de trayectoria/persistencia de S3 identifica establemente OOS cuándo WAIT empeora el procurement; probar si su valor queda absorbido por Dynamic Mode de Z_t (refutation §8.3).",
    layers: [s3Layer()],
    topology: "INDEPENDENT_ABLATION",
    comparator: CORE_COMPARATOR,
    arms: [
      { armId: "A1_CORE", ablationDesign: ["Brazo comparador del núcleo (paridad §13.9)."] },
      { armId: "A2_S3", ablationDesign: ["A1 + evidencia S3: direction/magnitud/rhythm/persistence en horizontes predeclarados; labels sólo si son estables."] },
      { armId: "A2_S3_SIMPLE", ablationDesign: ["A1 + representación simple equivalente (Dynamic Mode de Z_t) para decidir simplificación por igual resultado (§8.3 refutation)."] },
    ],
    accountingIdentity: makeAccounting(
      "Benchmark B compartido del bundle congelado IMP-16 (misma identidad/version para las tres arms)",
      "Evaluator P6 (§14) versionado del núcleo"
    ),
    marginalValueMethod: MARGINAL_VALUE,
    redundancyMethod: REDUNDANCY,
    refutationCriteria:
      "§8.3 Refutation: refutar si no identifica establemente OOS cuándo WAIT empeora; refutar si una representación más simple (Dynamic Mode) absorbe todo su valor; invalidar labels de tendencia identificables sólo a movimiento completado.",
    dataMapping: {
      policySummary: "Serie de precios decision-view PIT; horizontes de trayectoria declarados ex-ante; rhythm/persistence con datos causales únicamente.",
      noInventedData: true,
    },
    requiredAuditScopes: [{ depId: "DEP-06/07", scope: "serie de precios y horizontes causales consumidos por S3", resolvesAudit: false }],
    unknowns: COMMON_UNKNOWN_LIST,
    admissionPath: ADMISSION_PATH,
    gatesChecklist: GATES,
    nonAmpliation: NON_AMPLIATION,
    predeclared: true,
    freezingOrder: "SEMANTICS_AND_REFUTATION_FIRST",
  },
  {
    identity: makeIdentity("IMP20-EX-S04-01", "Productor paralelo: S4 Structure / Range Transition como evidencia/gate en paralelo con el núcleo, con ablation de redundancia"),
    searchSpace: SEARCH_SPACE_S4,
    objective:
      "Determinar point-in-time reproducible structure intact/testing/transition/newly accepted y su valor como gate sobre premisas, sin absorber todo Dynamic Mode y sin acción automática.",
    layers: [s4Layer()],
    topology: "PARALLEL_EVIDENCE_PRODUCERS",
    comparator: CORE_COMPARATOR,
    arms: [
      { armId: "A1_CORE", ablationDesign: ["Brazo comparador del núcleo (paridad §13.9)."] },
      { armId: "A2_S4_PARALLEL", ablationDesign: ["A1 + evidencia/gate S4 en paralelo con la evidencia S1 del núcleo; estado unresolved/unknown preservado ante toda interacción ambigua (§8.4)."] },
    ],
    accountingIdentity: makeAccounting(
      "Benchmark B compartido del bundle congelado IMP-16",
      "Evaluator P6 (§14) versionado del núcleo"
    ),
    marginalValueMethod: MARGINAL_VALUE,
    redundancyMethod: REDUNDANCY,
    refutationCriteria:
      "§8.4 Refutation: refutar si los estados no son reproducibles point-in-time o no mejoran procurement OOS; simplificar subestructuras sin contribución distinta; invalidar rangos/pivots dependientes de confirmación futura.",
    dataMapping: {
      policySummary: "Rangos/estructura definidos con datos causales disponibles en la decision boundary; fronteras y tolerancias versionadas; sin pivots retrospectivos.",
      noInventedData: true,
    },
    requiredAuditScopes: [{ depId: "DEP-06/07", scope: "serie de precios y metadata temporal para definir rango/estructura causal", resolvesAudit: false }],
    unknowns: COMMON_UNKNOWN_LIST,
    admissionPath: ADMISSION_PATH,
    gatesChecklist: GATES,
    nonAmpliation: NON_AMPLIATION,
    predeclared: true,
    freezingOrder: "SEMANTICS_AND_REFUTATION_FIRST",
  },
  {
    identity: makeIdentity("IMP20-EX-S05-01", "Composición serial seleccionada S1→S5: pullback conditional sobre premisa de ubicación del núcleo, con regla de invalidación y wait budget"),
    searchSpace: SEARCH_SPACE_S5,
    objective:
      "Probar la hipótesis de composición serial S1→S5 (única capa serial S5 consumiendo la premisa de ubicación ya admitida del núcleo): ¿esperar un pullback favorable mejora el coste sin elevar demasiado el riesgo de perder la compra y pagar más después (§8.5)?",
    layers: [s5Layer("Premisa: features de ubicación S1 del bundle frozen del núcleo (referencia causal frozen, §8.1); provenance registrada; invalidación de premisa con S4 como futuro gate cuando S4 se admita.")],
    topology: "SELECTED_SERIAL_COMPOSITIONS",
    comparator: CORE_COMPARATOR,
    arms: [
      { armId: "A1_CORE", ablationDesign: ["Brazo comparador del núcleo: BUY al activarse la premisa (baseline de refutation §8.5)."] },
      { armId: "A2_S5_PULLBACK", ablationDesign: ["A1 + regla pullback-wait bajo premisa S1 activa, con threshold de pullback, invalidación, wait budget y coste de oportunidad declarados ex-ante."] },
    ],
    accountingIdentity: makeAccounting(
      "Benchmark B compartido del bundle congelado IMP-16",
      "Evaluator P6 (§14) versionado del núcleo; coverage/remaining volume intactos (WAIT no genera compra ni reduce el volumen pendiente, §13.4/P5.2)"
    ),
    marginalValueMethod: MARGINAL_VALUE,
    redundancyMethod: REDUNDANCY,
    refutationCriteria:
      "§8.5 Refutation: refutar si esperar no mejora OOS frente a comprar inmediatamente al activarse la premisa; si no-fill/missed-purchase domina el ahorro; si conviene conservarla como regla de ejecución subordinada en lugar de policy independiente.",
    dataMapping: {
      policySummary:
        "Premisa desde S1 (admitida por el núcleo) + Profundidad de pullback frente a referencia causal + tiempo desde activación + Procurement State (volumen/tiempo restantes); cantidad S5 se deriva del diseño y el sizing queda en su contrato separado (§8.5; §10).",
      noInventedData: true,
    },
    requiredAuditScopes: [
      { depId: "DEP-06/07", scope: "precios decision-time y manifest de reserva usados por la premisa S1 y por la regla de pullback", resolvesAudit: false },
    ],
    unknowns: SERIAL_LANE_UNKNOWN_LIST,
    admissionPath: ADMISSION_PATH,
    gatesChecklist: GATES,
    nonAmpliation: NON_AMPLIATION,
    predeclared: true,
    freezingOrder: "SEMANTICS_AND_REFUTATION_FIRST",
  },
  {
    identity: makeIdentity("IMP20-EX-Z01-01", "Ablation de representaciones: componentes de Z_t (m/e/c/q/u) frente al núcleo y a representaciones más simples; póda por ablation"),
    searchSpace: SEARCH_SPACE_Z,
    objective:
      "Evaluar con la misma contabilidad si alguna representación candidata de los componentes de Z_t añade valor incremental procured sobre el núcleo, o si representaciones más simples (y las evidencias S1–S5) absorben su valor; utilidad por demostrar, no por diseño (§7.1).",
    layers: [zLayer()],
    topology: "INDEPENDENT_ABLATION",
    comparator: CORE_COMPARATOR,
    arms: [
      { armId: "A1_CORE", ablationDesign: ["Brazo comparador del núcleo (paridad §13.9)."] },
      { armId: "A2_Z_FULL", ablationDesign: ["A1 + Z_t completa (representaciones candidatas m/e/c/q/u instanciadas por este experimento, calibradas en development y congeladas antes de OOS)."] },
      { armId: "A2_Z_PARTIAL", ablationDesign: ["Ablation parcial: subsets de componentes de Z_t para localizar qué componente aporta; poda por ablation obligatoria (§7.1: la conveniencia de cada representación se evalúa mediante ablations)."] },
    ],
    accountingIdentity: makeAccounting(
      "Benchmark B compartido del bundle congelado IMP-16",
      "Evaluator P6 (§14) versionado del núcleo"
    ),
    marginalValueMethod: MARGINAL_VALUE,
    redundancyMethod: REDUNDANCY,
    refutationCriteria:
      "§7.1: refutar la representación si no demuestra valor incremental frente a representaciones más simples usando el resultado económico (no accuracy predictiva aislada); retener uncertainty/unavailable como tal, sin certeza artificial.",
    dataMapping: {
      policySummary:
        "Observaciones causales de precio/estructura/contexto admitidas por el contrato de datos §6; disponibilidad, incertidumbre, versión y trazabilidad preservadas; NO se comprime toda la información fundamental dentro de Z_t (§7.1).",
      noInventedData: true,
    },
    requiredAuditScopes: [
      { depId: "DEP-06/07", scope: "observaciones causales de precio, estructura y contexto que alimentan cada componente m/e/c/q/u", resolvesAudit: false },
      { depId: "DEP-16", scope: "part audit de representaciones Z: observables disponibles y metadata antes del experimento", resolvesAudit: false },
    ],
    unknowns: Z_LANE_UNKNOWN_LIST,
    admissionPath: ADMISSION_PATH,
    gatesChecklist: GATES,
    nonAmpliation: NON_AMPLIATION,
    predeclared: true,
    freezingOrder: "SEMANTICS_AND_REFUTATION_FIRST",
  },
  {
    identity: makeIdentity("IMP20-EX-D01-01", "Audit/mapping y póda de Fundamental Price Drivers (E1–E9/G1–G10/X1–X4): mapping a fuentes reales, redundancia y valor marginal por muestra, sin 23 features obligatorias"),
    searchSpace: SEARCH_SPACE_DRIVERS,
    objective:
      "Auditar/mapar bloques de la taxonomía cerrada a fuentes disponibles, medir redundancia y valor marginal de los bloques mapeados con la misma contabilidad, y podar/asegurar completitud por evidencia (§7.2.5 invariante 5); no se añaden categorías por intuición, ni 23 features obligatorias.",
    layers: [driversLayer()],
    topology: "INDEPENDENT_ABLATION",
    comparator: CORE_COMPARATOR,
    arms: [
      { armId: "A1_CORE", ablationDesign: ["Brazo comparador del núcleo (paridad §13.9)."] },
      { armId: "A2_DRIVERS_SAMPLE", ablationDesign: ["A1 + Drivers por muestra mapeada/a auditada en esta entrega; bloques añadidos sólo cuando su mapping fuente exista; STATE/CHANGE/SURPRISE/Uncertainty conservados por bloque (§7.2.1)."] },
    ],
    accountingIdentity: makeAccounting(
      "Benchmark B compartido del bundle congelado IMP-16",
      "Evaluator P6 (§14) versionado del núcleo"
    ),
    marginalValueMethod: MARGINAL_VALUE,
    redundancyMethod: REDUNDANCY,
    refutationCriteria:
      "§7.2.5/Poda: refutar bloques sin contribución distinta ni valor incremental; reabrir la taxonomía sólo con evidencia material de categoría faltante o duplicada mediante versión explícita; SURPRISE UNAVAILABLE sin expectativa documentada y sin tratarla como sorpresa nula.",
    dataMapping: {
      policySummary:
        "Mapping por bloque a fuentes del lago EEX y fuentes operativas disponibles; los bloques sin fuente quedan como faltantes explícitos con Uncertainty; un flujo, capacidad y calendario no se duplican (§7.2.5 invariantes 1–4); shocks una vez en X3/X4.",
      noInventedData: true,
    },
    requiredAuditScopes: [
      { depId: "DEP-06/07", scope: "fuentes reales por bloque muestreado (metadata, disponibilidad, PIT, derechos), sin presumir suficiencia", resolvesAudit: false },
      { depId: "DEP-16", scope: "completitud adversarial de taxonomía basada en evidencia, redundancia y valor incremental de la representación de drivers", resolvesAudit: false },
    ],
    unknowns: DRIVERS_LANE_UNKNOWN_LIST,
    admissionPath: ADMISSION_PATH,
    gatesChecklist: GATES,
    nonAmpliation: NON_AMPLIATION,
    predeclared: true,
    freezingOrder: "SEMANTICS_AND_REFUTATION_FIRST",
  },
]);

export function getDesign(experimentId) {
  return EXPERIMENT_DESIGNS.find((design) => design.identity.experimentId === experimentId) ?? null;
}

export const DESIGN_IDS = Object.freeze(EXPERIMENT_DESIGNS.map((design) => design.identity.experimentId));
