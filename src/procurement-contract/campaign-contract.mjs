// Ficha de campaña y contrato de obligación. Fuente: SPEC v1.1.1 §4.1
// (inputs del contrato de campaña, tabla de cantidades confirmadas 10/10/60/20
// MW y su alcance), §4.2 (BUY/WAIT separado del sizing) y §4.3 (identidad de
// reconciliación y conducta ante ausencia de terminal rule). Regla del trabajo:
// incorporar los datos confirmados por el owner y dejar todo lo demás como
// faltante explícito; nunca inventar producto, delivery, calendario ni unidad.

import { isDeepStrictEqual } from "node:util";

import { STATE_NAMESPACES } from "../contracts/states.mjs";
import {
  COVERAGE_OWNERSHIP_MAP_STATES,
  computeRemainingVolume,
  reconcileOwnershipWithExecutedVolume,
  validateDocumentedAmendments,
  validateOwnershipAssignments,
  validateRelationDeclaration,
  validateResidualAmendment,
} from "./coverage-ownership.mjs";

const AVAILABILITY = STATE_NAMESPACES.data_availability.values;

// §4.1 tabla: "Confirmación de Bru, 2026-09-22". Estas cuatro cantidades son
// datos confirmados por el owner; no deben volver a pedirse como desconocidas.
const OWNER_CONFIRMATION = {
  authority: "Bru (owner)",
  locator: "§4.1 tabla de cantidades confirmadas, 2026-09-22",
  quote: "Confirmación de Bru, 2026-09-22",
};

export const CONFIRMED_OBLIGATIONS = [
  { product: "Gas", mission: "Monthly", quantity: 10, unit: "MW", source: OWNER_CONFIRMATION },
  { product: "Power", mission: "Monthly", quantity: 10, unit: "MW", source: OWNER_CONFIRMATION },
  { product: "Gas", mission: "Quarterly", quantity: 60, unit: "MW", source: OWNER_CONFIRMATION },
  { product: "Power", mission: "Quarterly", quantity: 20, unit: "MW", source: OWNER_CONFIRMATION },
];

// §25.1/§25.2 IMP-02: reconciliar la ficha con el material auditado. El
// paquete completo del cliente (ENERGY_MARKETS_CLIENT_INPUTS_2026-09-23, 15
// archivos verificados, manifest en OFICINA_INTAKE_VERIFICATION.json) registra
// a nivel del caso Fundamental los parámetros del Gas Quarterly. Son
// parámetros del mandato vigente, no el registro de una campaña concreta:
// no sostienen Campaign ID, maturity ni ownership.
const CLIENT_PACKAGE_CONFIRMATION = {
  authority: "Fundamental (cliente); paquete ENERGY_MARKETS_CLIENT_INPUTS_2026-09-23 verificado (OFICINA_INTAKE_VERIFICATION.json, 2026-09-23)",
};

// Aclaración de owner del 23-sep-2026 (P-006): el objeto de Gas Quarterly es
// un mandato rolling de procurement orientado a reducir coste, no una campaña
// comercial con Campaign ID suministrado por el cliente. Cada maturity
// histórica elegible es un episodio de VALIDACIÓN independiente bajo el
// mandato vigente; la identidad de campaña de research es determinista por
// producto + periodo/maturity (GAS-Q-YYYYQn). No afirma mandatos históricos
// ni aporta fills/ownership live.
export const OWNER_P006_CONFIRMATION = {
  authority: "Bru (owner); aclaración P-006, 23-sep-2026",
  locator: "Decision del owner 23-sep-2026 sobre semántica rolling/validación de IMP-02 (puntos 1-6)",
  quote: "La identidad de una campaña de research puede ser determinista por producto + período/maturity (por ejemplo GAS-Q-YYYYQn)",
};

export const CLIENT_PACKAGE_SOURCES = {
  hubMarket: {
    ...CLIENT_PACKAGE_CONFIRMATION,
    locator: "ESTADO_INPUTS.csv fila \"Product mapping — Gas Quarterly\"; 01_campaigns/gas_quarterly.md \"Relevant EEX product class\"",
    quote: "NATGAS / THE Quarterly EEX futures",
  },
  mission: {
    ...CLIENT_PACKAGE_CONFIRMATION,
    locator: "01_campaigns/campaign_rules.csv fila \"Fundamental,Gas Quarterly\"; 00_LEEME.md tabla de Missions; §4.1 tabla de cantidades confirmadas",
    quote: "Fundamental,Gas Quarterly,NATGAS / THE Quarterly,60,3-1-3,0,11:00 Europe/Berlin,1,12,Q1 2021,Exact target by final effective trading day,Any trigger hard-rejects candidate",
  },
  productContract: {
    ...CLIENT_PACKAGE_CONFIRMATION,
    locator: "ESTADO_INPUTS.csv filas \"Product mapping — Gas Quarterly\" y \"Physical/financial procurement relationship\"; 01_campaigns/gas_quarterly.md \"Relevant EEX product class\"",
    quote: "NATGAS / THE Quarterly EEX futures",
  },
  deliveryPeriod: {
    ...CLIENT_PACKAGE_CONFIRMATION,
    locator: "ESTADO_INPUTS.csv filas \"Delivery profile / MWh conversion\" y \"Quarterly calendar rule\"; 01_campaigns/01_shared_campaign_rules.md §1",
    quote: "3-1-3: three calendar months trading, one calendar month gap, three calendar months delivery",
  },
  settlement: {
    ...CLIENT_PACKAGE_CONFIRMATION,
    locator: "ESTADO_INPUTS.csv fila \"Physical/financial procurement relationship\" (estado AUSENCIA CONFIRMADA); 00_LEEME.md \"Immediate scope\"",
    quote: "Out of scope. Mandate is limited to procuring the specified EEX futures positions; downstream physical need does not alter validator mechanics.",
  },
  validity: {
    ...CLIENT_PACKAGE_CONFIRMATION,
    locator: "00_LEEME.md \"Source basis and validity\"",
    quote: "Current Fundamental procurement case as of 2026-09-23, unless a narrower validity statement is given.",
  },
  openClose: {
    ...CLIENT_PACKAGE_CONFIRMATION,
    locator: "ESTADO_INPUTS.csv fila \"Quarterly calendar rule\"; 01_campaigns/gas_quarterly.md \"Trading-window convention\"; 01_campaigns/01_shared_campaign_rules.md §1",
    quote: "For Quarterly, the strategy may trade during the fourth, third, and second calendar months before the quarter begins. The calendar month immediately before quarterly delivery is the gap month.",
  },
  decisionOpportunities: {
    ...CLIENT_PACKAGE_CONFIRMATION,
    locator: "ESTADO_INPUTS.csv filas \"Decision frequency\" y \"Decision time\"; 01_campaigns/01_shared_campaign_rules.md §4",
    quote: "The strategy is invoked once per eligible trading day at 11:00 Europe/Berlin.",
  },
  deadline: {
    ...CLIENT_PACKAGE_CONFIRMATION,
    locator: "01_campaigns/gas_quarterly.md \"Completion requirement\"; ESTADO_INPUTS.csv fila \"Terminal requirement\"",
    quote: "Exact target position by the end of the final effective trading day",
  },
  terminalRequirement: {
    ...CLIENT_PACKAGE_CONFIRMATION,
    locator: "ESTADO_INPUTS.csv fila \"Terminal requirement\"; 01_campaigns/01_shared_campaign_rules.md §3",
    quote: "Final effective position must equal target exactly by end of final effective trading day.",
  },
  amendmentsAbsence: {
    ...CLIENT_PACKAGE_CONFIRMATION,
    locator: "ESTADO_INPUTS.csv fila \"Target changes during campaign\"; 01_campaigns/01_shared_campaign_rules.md §7",
    quote: "Target is fixed once campaign starts; portfolio/mandate change triggers new strategy development + verification under new mandate.",
  },
  initialPosition: {
    ...CLIENT_PACKAGE_CONFIRMATION,
    locator: "ESTADO_INPUTS.csv fila \"Initial position\"; 01_campaigns/01_shared_campaign_rules.md §3",
    quote: "0 MW at start of each episode/campaign.",
  },
  lots: {
    ...CLIENT_PACKAGE_CONFIRMATION,
    locator: "ESTADO_INPUTS.csv fila \"Lot / quantity increment\"; 01_campaigns/01_shared_campaign_rules.md §5",
    quote: "1 MW minimum and 1 MW increments.",
  },
  positionUnits: {
    ...CLIENT_PACKAGE_CONFIRMATION,
    locator: "ESTADO_INPUTS.csv fila \"Position vs price units\"",
    quote: "Trade/target quantity in MW; minimum increment 1 MW",
  },
  executionContract: {
    ...CLIENT_PACKAGE_CONFIRMATION,
    locator: "ESTADO_INPUTS.csv filas \"TOB reference timestamp\", \"Simulated execution side\", \"Virtual slippage\", \"Backtest fill quantity\", \"Normal daily quantity cap\", \"Other execution fees\"",
    quote: "Assume full requested quantity fills at simulated execution price; no partial-fill model.",
  },
  relationSeparateMissions: {
    authority: "Bru (owner); aclaración P-006, 23-sep-2026",
    locator: "Decision del owner 23-sep-2026 (punto 5); §4.1 \"Monthly y Quarterly son Mission de primera clase, con contratos y poblaciones de evaluación separados\"; 00_LEEME.md \"Immediate scope\"",
    quote: "Monthly y Quarterly son campañas/mandatos separados y no comparten coverage: compras/fills de Quarterly no reducen Monthly y viceversa.",
  },
  pauseExclusion: {
    ...CLIENT_PACKAGE_CONFIRMATION,
    locator: "ESTADO_INPUTS.csv fila \"Quarterly calendar rule\"; 01_campaigns/gas_quarterly.md \"Trading-window convention\"; 01_campaigns/01_shared_campaign_rules.md §1",
    quote: "3-1-3: three calendar months trading, one calendar month gap, three calendar months delivery",
  },
};

export function confirmedQuantityFor(product, mission) {
  const match = CONFIRMED_OBLIGATIONS.find((entry) => entry.product === product && entry.mission === mission);
  return match ? { quantity: match.quantity, unit: match.unit, source: match.source } : null;
}

// Aclaración P-006 (punto 6): identidad determinista de campaña de research
// por producto + Mission + maturity. Prefijos sin signos ambiguos; la maturity
// de Quarterly es YYYYQn (Q1–Q4) y la de Monthly YYYY-MM (01–12). No es
// formato de la SPEC: es el formato del ejemplo del owner, marcado PROVISIONAL
// hasta el registro real del mandato.
const FAMILY_PREFIX = { Gas: "GAS", Power: "POW" };
const MISSION_PREFIX = { Monthly: "M", Quarterly: "Q" };
const QUARTER_PATTERN = /^\d{4}Q[1-4]$/;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

// Horizonte histórico de validación Gas Quarterly documentado por el paquete
// del cliente (campaign_rules.csv fila "Fundamental,Gas Quarterly", columna
// de horizonte histórico: Q1 2021; P-006 puntos 2, 4, 7). Los episodios de
// validación no preceden a esta maturity.
const VALIDATION_EPISODE_FIRST_MATURITY = "2021Q1";

export function isCanonicalMaturity(mission, maturity) {
  if (!isNonEmptyString(maturity)) return false;
  if (mission === "Monthly") return MONTH_PATTERN.test(maturity);
  if (mission === "Quarterly") return QUARTER_PATTERN.test(maturity);
  return false;
}

// IDENTIDAD determinista por episodio; maturities distintas → campañas
// distintas, y el mismo maturity da siempre el mismo Campaign ID.
export function researchCampaignIdFor(product, mission, maturity) {
  if (!isNonEmptyString(product) || !isNonEmptyString(mission)) return null;
  if (!FAMILY_PREFIX[product] || !MISSION_PREFIX[mission]) return null;
  if (!isCanonicalMaturity(mission, maturity)) return null;
  return `${FAMILY_PREFIX[product]}-${MISSION_PREFIX[mission]}-${maturity}`;
}

// La obligación del episodio usa el mismo alcance de identidad; así el mapa
// fill→obligación no puede atribuir volumen a una campaña que no existe.
export function episodeObligationIdFor(campaignId) {
  if (!isNonEmptyString(campaignId)) return null;
  return `OBL-${campaignId}`;
}

// Aclaración P-006 (punto 4): los episodios elegibles se evalúan todos en
// orden cronológico, sin seleccionar sólo períodos favorecidos. La cobertura
// del invariante la guarda el validador de secuencia, no cada ficha.
function quarterIndex(maturity) {
  // YYYYQn → índice contable de quarters: orden y huecos sin depender de
  // comparación lexicográfica de textos.
  const year = Number(maturity.slice(0, 4));
  const quarter = Number(maturity.slice(5));
  return year * 4 + quarter;
}

// Valida una secuencia de maturities de Gas Quarterly: cada maturity canónica,
// orden estrictamente cronológico sin repetición y, si se exige continuidad,
// sin huecos de quarters dentro del alcance declarado. Devuelve los errores;
// lista vacía es secuencia válida.
export function validateQuarterlyEpisodeSequence(maturities, { requireContiguity = false } = {}) {
  const errors = [];
  if (!Array.isArray(maturities)) {
    return [{ code: "EPISODES_NOT_ARRAY", message: "La secuencia de episodios no es una lista." }];
  }
  let previousIndex = null;
  const seen = new Set();
  for (const maturity of maturities) {
    if (!isCanonicalMaturity("Quarterly", maturity)) {
      errors.push({ code: "INVALID_EPISODE_MATURITY", message: `La maturity "${maturity}" no es YYYYQn (Q1–Q4); no es un episodio de Quarterly.` });
      continue;
    }
    const index = quarterIndex(maturity);
    if (seen.has(maturity)) {
      errors.push({ code: "DUPLICATE_EPISODE", message: `Maturity repetida en la secuencia: ${maturity}.` });
      continue;
    }
    seen.add(maturity);
    if (previousIndex !== null && index <= previousIndex) {
      errors.push({ code: "EPISODES_NOT_CHRONOLOGICAL", message: `La maturity ${maturity} no es posterior a la anterior de la secuencia; los episodios se evalúan en orden cronológico (P-006 punto 4).` });
      continue;
    }
    if (previousIndex !== null && requireContiguity && index > previousIndex + 1) {
      errors.push({ code: "EPISODE_SEQUENCE_GAP", message: `Hay huecos de quarters entre ${quarterIndexDescription(previousIndex)} y ${maturity}; el horizon evalúa los episodios completos en orden (01_shared_campaign_rules.csv \"Historical Quarterly backtest horizon\").` });
    }
    previousIndex = index;
  }
  return errors;
}

function quarterIndexDescription(index) {
  const year = Math.floor((index - 1) / 4);
  const quarter = ((index - 1) % 4) + 1;
  return `${year}Q${quarter}`;
}

// §4.1 inputs del contrato de campaña. `kind: "quantity"` exige unidad; el
// resto sólo exige contenido no vacío. Ningún campo tiene default. `dep` es la
// dependencia de §24 que materializa cada fact: §25.2 fila IMP-02 exige
// resolver DEP-01–04 "para la campaña y relaciones examinadas"; DEP-05
// (lotes, redondeo, execution contract) lo resuelve IMP-07 (§25.2 fila
// IMP-07), no es parte del acceptance de IMP-02. `absenceAllowed` marca las
// facts cuya "constatación documentada de ausencia" (§25.2 fila IMP-02) las
// resuelve: sólo enmiendas y terminal rule, que DEP-04 califica "si existen".
// La pausa no: §13.4 exige "la estructura documentada de pausa/mes excluido".
export const CAMPAIGN_CONTRACT_FACTS = [
  { factId: "campaign.identity.campaignId", section: "Identidad", kind: "text", dep: "DEP-01" },
  { factId: "campaign.identity.productContract", section: "Identidad", kind: "text", dep: "DEP-01" },
  { factId: "campaign.identity.productFamily", section: "Identidad", kind: "text", dep: "DEP-01" },
  { factId: "campaign.identity.mission", section: "Identidad", kind: "text", dep: "DEP-01" },
  { factId: "campaign.identity.hubMarket", section: "Identidad", kind: "text", dep: "DEP-01" },
  { factId: "campaign.obligation.totalVolumeKnown", section: "Obligación", kind: "quantity", dep: "DEP-01" },
  { factId: "campaign.obligation.unit", section: "Obligación", kind: "text", dep: "DEP-01" },
  { factId: "campaign.obligation.deliveryPeriod", section: "Obligación", kind: "text", dep: "DEP-01" },
  // §24 DEP-01: "liquidación física/financiera"; §4.1 "Alcance" la lista entre
  // los vínculos pendientes.
  { factId: "campaign.obligation.settlement", section: "Obligación", kind: "text", dep: "DEP-01" },
  { factId: "campaign.obligation.validity", section: "Obligación", kind: "text", dep: "DEP-01" },
  { factId: "campaign.obligation.campaignLink", section: "Obligación", kind: "text", dep: "DEP-01" },
  { factId: "campaign.obligation.amendments", section: "Obligación", kind: "text", dep: "DEP-04", absenceAllowed: true },
  { factId: "campaign.calendar.openClose", section: "Calendario", kind: "text", dep: "DEP-03" },
  { factId: "campaign.calendar.decisionOpportunities", section: "Calendario", kind: "text", dep: "DEP-03" },
  { factId: "campaign.calendar.deadline", section: "Calendario", kind: "text", dep: "DEP-03" },
  { factId: "campaign.calendar.pauseExclusion", section: "Calendario", kind: "text", dep: "DEP-03" },
  { factId: "campaign.feasibility.lots", section: "Factibilidad", kind: "text", dep: "DEP-05" },
  { factId: "campaign.feasibility.rounding", section: "Factibilidad", kind: "text", dep: "DEP-05" },
  { factId: "campaign.feasibility.terminalCoverageRule", section: "Factibilidad", kind: "text", dep: "DEP-04", absenceAllowed: true },
  { factId: "campaign.execution.contract", section: "Ejecución", kind: "text", dep: "DEP-05" },
  { factId: "campaign.coverage.executedVolume", section: "Estado de cobertura", kind: "quantity", dep: "DEP-02" },
  { factId: "campaign.coverage.remainingVolume", section: "Estado de cobertura", kind: "quantity", dep: "DEP-02" },
  { factId: "campaign.coverage.fillToObligationAssignment", section: "Estado de cobertura", kind: "assignments", dep: "DEP-02" },
];

// §25.2 fila IMP-02: RESOLVES_AUDIT "DEP-01,02,03,04 para la campaña y
// relaciones examinadas".
const IMP02_RESOLVED_DEPS = ["DEP-01", "DEP-02", "DEP-03", "DEP-04"];
export const IMP02_REQUIRED_FACT_IDS = CAMPAIGN_CONTRACT_FACTS
  .filter((fact) => IMP02_RESOLVED_DEPS.includes(fact.dep))
  .map((fact) => fact.factId);

const FACT_BY_ID = new Map(CAMPAIGN_CONTRACT_FACTS.map((fact) => [fact.factId, fact]));
const IDENTITY_FACT_IDS = CAMPAIGN_CONTRACT_FACTS
  .filter((fact) => fact.section === "Identidad")
  .map((fact) => fact.factId);

// §4.1: "MW y MWh son magnitudes distintas. Horas y perfil de entrega deben
// justificar cualquier conversión" y "no se convierten a MWh sin evidencia
// aplicable". Horas y perfil llegan juntos en un perfil con evidencia
// (autoridad + locator), no como parámetros sueltos. La SPEC no enumera
// perfiles: sólo se acepta la forma FLAT porque es la única en que
// MW × horas es la energía entregada. FLAT es aritmética, no una taxonomía de
// mercado de la SPEC; un perfil con forma exige su curva horaria, que este
// contrato no modela.
export const MW_TO_MWH_CONVERTIBLE_SHAPES = ["FLAT"];

export function convertMwToMwh({ quantityMw, deliveryProfile } = {}) {
  if (typeof quantityMw !== "number" || !Number.isFinite(quantityMw) || quantityMw < 0) {
    return { ok: false, code: "MISSING_QUANTITY", mwh: null, reason: "La cantidad en MW no es un número finito no negativo." };
  }
  if (isMissingValue(deliveryProfile)) {
    return {
      ok: false,
      code: "UNIT_INFERENCE_WITHOUT_HOURS_PROFILE",
      mwh: null,
      reason: "MW no se convierte a MWh sin horas y perfil de entrega justificados (§4.1).",
    };
  }
  const profileIsObject = typeof deliveryProfile === "object" && !Array.isArray(deliveryProfile);
  if (!profileIsObject || !hasProvenance(deliveryProfile)) {
    return {
      ok: false,
      code: "DELIVERY_PROFILE_NOT_JUSTIFIED",
      mwh: null,
      reason: "El perfil de entrega debe venir con evidencia (autoridad y locator); un texto libre no justifica la conversión (§4.1).",
    };
  }
  const hours = deliveryProfile.hours;
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0) {
    return {
      ok: false,
      code: "UNIT_INFERENCE_WITHOUT_HOURS_PROFILE",
      mwh: null,
      reason: "El perfil de entrega justificado no declara sus horas de entrega (§4.1).",
    };
  }
  if (!MW_TO_MWH_CONVERTIBLE_SHAPES.includes(deliveryProfile.shape)) {
    return {
      ok: false,
      code: "DELIVERY_PROFILE_NOT_CONVERTIBLE",
      mwh: null,
      reason: `Perfil "${deliveryProfile.shape}": sólo un perfil FLAT permite MW × horas; otro perfil exige su curva horaria (§4.1).`,
    };
  }
  return { ok: true, code: null, mwh: quantityMw * hours, reason: null };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isMissingValue(value) {
  return value === null || value === undefined || (typeof value === "string" && value.trim().length === 0);
}

function isFiniteNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function hasProvenance(fact) {
  const source = fact?.source;
  return source !== null
    && typeof source === "object"
    && isNonEmptyString(source.authority)
    && isNonEmptyString(source.locator);
}

// Una cantidad atribuida al owner es la de la tabla §4.1: es la única cantidad
// que Bru ha confirmado. Se reconoce por la autoridad o por citar la
// confirmación, no por el texto exacto del locator; si no, variar un espacio
// del locator permitiría atribuirle a Bru otro total. Una campaña con total
// propio lo cita con la autoridad de su mandato.
function citesOwnerConfirmation(fact) {
  const source = fact?.source ?? {};
  const citations = [source.authority, source.locator, source.quote].filter((text) => typeof text === "string");
  return citations.some((text) => text.includes("Bru") || text.includes(OWNER_CONFIRMATION.quote));
}

// Una fact AVAILABLE_NOW exige valor, escala y provenance. El valor debe ser
// del tipo declarado: un `text` es texto, un `quantity` es número finito no
// negativo (el volumen de cobertura nunca es negativo, §4.3) con unidad
// explícita; sin ella la cantidad no es ejecutable.
function validateAvailableFact(fact, definition, errors) {
  if (isMissingValue(fact.value)) {
    errors.push({ factId: fact.factId, code: "AVAILABLE_WITHOUT_VALUE", message: `"${fact.factId}" está AVAILABLE_NOW pero no aporta valor.` });
  } else if (definition.kind === "text" && !isNonEmptyString(fact.value)) {
    errors.push({ factId: fact.factId, code: "VALUE_TYPE_MISMATCH", message: `"${fact.factId}" es una fact de texto y su valor no es texto.` });
  } else if (definition.kind === "quantity" && (!isFiniteNonNegativeNumber(fact.value))) {
    errors.push({ factId: fact.factId, code: "VALUE_TYPE_MISMATCH", message: `"${fact.factId}" es una cantidad y su valor debe ser un número finito no negativo (§4.3).` });
  } else if (definition.kind === "assignments" && !Array.isArray(fact.value)) {
    errors.push({ factId: fact.factId, code: "VALUE_TYPE_MISMATCH", message: `"${fact.factId}" es una fact de asignaciones y su valor debe ser la lista fill→obligación (§4.3/DEP-02).` });
  }
  // §4.3: la fact de asignación materializa el mapa fill→obligación con el
  // mismo contrato que el bloque coverageOwnership (una sola verdad).
  // PROVISIONAL (la SPEC no fija el formato): el valor es la lista de
  // asignaciones, no un texto libre que no podría reconciliarse con el mapa.
  if (definition.kind === "assignments" && Array.isArray(fact.value)) {
    errors.push(...validateOwnershipAssignments(fact.value).map((error) => ({ factId: fact.factId, ...error })));
  }
  // §4.3/§14.5: las enmiendas documentadas de la obligación alimentan la
  // reconciliación del residual; su lista debe ser auditable y no puede
  // coexistir con una ausencia documentada.
  if (definition.factId === "campaign.obligation.amendments") {
    if (fact.amendments !== undefined) {
      errors.push(...validateDocumentedAmendments(fact.amendments).map((error) => ({ factId: fact.factId, ...error })));
    }
    if (fact.documentedAbsence === true && Array.isArray(fact.amendments) && fact.amendments.length > 0) {
      errors.push({ factId: fact.factId, code: "AMENDMENTS_WITH_DOCUMENTED_ABSENCE", message: `"${fact.factId}" declara ausencia documentada y a la vez enmiendas; son estados excluyentes.` });
    }
  }
  if (definition.kind === "quantity" && !isNonEmptyString(fact.unit)) {
    errors.push({ factId: fact.factId, code: "QUANTITY_WITHOUT_UNIT", message: `"${fact.factId}" es una cantidad sin unidad; no se asume MW ni MWh.` });
  }
  if (!hasProvenance(fact)) {
    errors.push({ factId: fact.factId, code: "NO_PROVENANCE", message: `"${fact.factId}" está AVAILABLE_NOW sin autoridad y locator.` });
  }
  // §25.2 fila IMP-02: "constatación documentada de ausencia cuando
  // corresponda". Sólo corresponde donde la SPEC dice "si existe(n)"; un
  // deadline o un Campaign ID ausentes no se resuelven declarándolos ausentes.
  if (fact.documentedAbsence === true && !definition.absenceAllowed) {
    errors.push({ factId: fact.factId, code: "ABSENCE_NOT_ALLOWED", message: `"${fact.factId}" no admite constatación de ausencia como valor (§25.2 IMP-02).` });
  }
}

// El flag de ausencia es booleano o no existe; un "sí" o un null no dicen si
// la ausencia está constatada.
function validateAbsenceFlagShape(fact, errors) {
  if ("documentedAbsence" in fact && typeof fact.documentedAbsence !== "boolean") {
    errors.push({ factId: fact.factId, code: "ABSENCE_NOT_ALLOWED", message: `"${fact.factId}".documentedAbsence debe ser booleano.` });
  }
}

// Una fact UNAVAILABLE conserva la razón y nunca lleva un valor fabricado.
function validateUnavailableFact(fact, errors) {
  if (!isMissingValue(fact.value)) {
    errors.push({ factId: fact.factId, code: "INVENTED_VALUE", message: `"${fact.factId}" está UNAVAILABLE pero trae un valor.` });
  }
  if (fact.documentedAbsence !== undefined && fact.documentedAbsence !== false) {
    errors.push({ factId: fact.factId, code: "ABSENCE_NOT_ALLOWED", message: `"${fact.factId}" está UNAVAILABLE: una ausencia constatada es un hecho auditado (AVAILABLE_NOW con provenance), no un faltante.` });
  }
  if (!isNonEmptyString(fact.reason)) {
    errors.push({ factId: fact.factId, code: "MISSING_NOT_DOCUMENTED", message: `"${fact.factId}" está UNAVAILABLE sin razón documentada.` });
  }
}

function validateGuards(guards, errors) {
  const declared = guards && typeof guards === "object" ? guards : {};
  // §4.2: conocer la obligación total no fija cuánto comprar en cada BUY.
  if (declared.totalObligationIsPerBuySizing === true) {
    errors.push({ factId: "guards.totalObligationIsPerBuySizing", code: "TOTAL_SIZING_CONFLATION", message: "El total conocido no puede usarse como sizing por BUY (§4.2)." });
  }
  // §4.1/§5.3: las ventanas del Benchmark B no son permiso de ejecución.
  if (declared.benchmarkWindowIsExecutionPermission === true) {
    errors.push({ factId: "guards.benchmarkWindowIsExecutionPermission", code: "BENCHMARK_WINDOW_AS_PERMISSION", message: "La ventana del benchmark no determina permisos de ejecución de campaña (§4.1)." });
  }
  // §4.3: sin terminal rule válida no se fabrica un fill de cierre.
  if (declared.unknownTerminalRuleFabricatesCloseOutFill === true) {
    errors.push({ factId: "guards.unknownTerminalRuleFabricatesCloseOutFill", code: "CLOSEOUT_WITH_UNKNOWN_TERMINAL_RULE", message: "Una terminal rule ausente no autoriza un fill de cierre (COVERAGE_INCOMPLETE) (§4.3)." });
  }
  // §4.1: MW no se convierte a MWh por suposición.
  if (declared.assumedMwToMwhConversion === true) {
    errors.push({ factId: "guards.assumedMwToMwhConversion", code: "UNIT_INFERENCE_WITHOUT_HOURS_PROFILE", message: "No se asume una conversión MW→MWh sin horas/perfil (§4.1)." });
  }
  // Aclaración P-006 (punto 5): Monthly y Quarterly son mandatos separados sin
  // coverage compartido (§4.1/D5: Missions separadas; §4.3 sin doble conteo).
  if (declared.missionsShareCoverage === true) {
    errors.push({ factId: "guards.missionsShareCoverage", code: "MISSIONS_SHARE_COVERAGE", message: "Los fills de Quarterly no reducen Monthly ni viceversa; la cobertura de una Mission no se contabiliza en la otra (P-006 punto 5; §4.1/§4.3)." });
  }
  // Aclaración P-006 (punto 4): los episodios elegibles se evalúan todos en
  // orden cronológico; no se seleccionan sólo períodos favorecidos.
  if (declared.selectiveEpisodeEvaluation === true) {
    errors.push({ factId: "guards.selectiveEpisodeEvaluation", code: "SELECTIVE_EPISODE_EVALUATION", message: "Los episodios elegibles se evalúan todos en orden cronológico; no se seleccionan sólo períodos favorecidos (P-006 punto 4; campaign_rules.csv \"Historical Quarterly backtest horizon\")." });
  }
}

// §24 DEP-02: la ficha materializa el estado de la relación Monthly/Quarterly
// y del mapa de asignación fill→obligación. El mapa sin materializar exige
// razón documentada; materializado exige assignments y provenance (su
// reconciliación con el volumen ejecutado va en validateCrossFieldCoherence,
// que tiene las facts). La
// relación se declara con la misma taxonomía del mapa (fuente única), así la
// ficha y mapCoverageOwnership no pueden divergir.
function validateCoverageOwnership(coverageOwnership, errors) {
  const declared = coverageOwnership && typeof coverageOwnership === "object" && !Array.isArray(coverageOwnership)
    ? coverageOwnership
    : {};
  if (!isNonEmptyString(declared.mapState) || !COVERAGE_OWNERSHIP_MAP_STATES.includes(declared.mapState)) {
    errors.push({
      factId: "coverageOwnership",
      code: "COVERAGE_OWNERSHIP_MAP_STATE_MISSING",
      message: `La ficha debe declarar el estado del mapa de ownership: ${COVERAGE_OWNERSHIP_MAP_STATES.join(", ")} (§4.3/DEP-02).`,
    });
    return;
  }
  if (declared.mapState === "MATERIALIZED") {
    if (!Array.isArray(declared.assignments)) {
      errors.push({ factId: "coverageOwnership", code: "COVERAGE_OWNERSHIP_MAP_NOT_MATERIALIZED", message: "El mapa MATERIALIZED exige la lista de asignaciones fill→obligación." });
    } else {
      // §4.3/§25.1 IMP-02: "una cobertura no pertenece dos veces a
      // obligaciones" se aplica en la ficha con la misma función que usa el
      // mapa derivado; no hay dos verdades del invariante.
      errors.push(...validateOwnershipAssignments(declared.assignments).map((error) => ({ factId: "coverageOwnership", ...error })));
    }
    if (!isNonEmptyString(declared.authority) || !isNonEmptyString(declared.locator)) {
      errors.push({ factId: "coverageOwnership", code: "NO_PROVENANCE", message: "El mapa MATERIALIZED exige autoridad y locator." });
    }
  } else if (!isNonEmptyString(declared.reason)) {
    errors.push({ factId: "coverageOwnership", code: "MISSING_NOT_DOCUMENTED", message: "El mapa de ownership sin materializar exige la razón documentada de su faltante (DEP-02)." });
  }
  errors.push(...validateRelationDeclaration(declared.relationMonthlyQuarterly).map((error) => ({ factId: "coverageOwnership.relationMonthlyQuarterly", ...error })));
}

// Una fact cuenta como disponible para derivar sólo si trae provenance; sin
// ella validateAvailableFact ya la rechaza y aquí no sostiene nada.
function availableFact(factsById, factId) {
  const fact = factsById.get(factId);
  return fact?.availability === "AVAILABLE_NOW" && hasProvenance(fact) ? fact : null;
}

const QUANTITY_FACT_IDS = CAMPAIGN_CONTRACT_FACTS
  .filter((fact) => fact.kind === "quantity")
  .map((fact) => fact.factId);

const CAMPAIGN_SCOPED_FACT_IDS = [
  "campaign.obligation.campaignLink",
  "campaign.calendar.deadline",
  "campaign.coverage.executedVolume",
  "campaign.coverage.remainingVolume",
  "campaign.coverage.fillToObligationAssignment",
];

// Cada fact puede ser válida sola y la ficha contradecirse entre campos. Estas
// comprobaciones impiden dos verdades dentro de la misma ficha.
function validateCrossFieldCoherence(ficha, factsById, errors) {
  // §4.1: la unidad de la obligación es una sola; toda cantidad publicada va en
  // esa unidad. MW y MWh no se mezclan ni se convierten aquí.
  const obligationUnit = availableFact(factsById, "campaign.obligation.unit");
  for (const factId of QUANTITY_FACT_IDS) {
    const quantity = availableFact(factsById, factId);
    if (!quantity) {
      continue;
    }
    if (!obligationUnit) {
      errors.push({ factId, code: "OBLIGATION_UNIT_MISSING", message: `"${factId}" publica una cantidad pero campaign.obligation.unit no está AVAILABLE_NOW; la unidad no se infiere (§4.1).` });
      continue;
    }
    if (quantity.unit !== obligationUnit.value) {
      errors.push({ factId, code: "UNIT_INCOHERENT", message: `"${factId}" está en ${quantity.unit} y campaign.obligation.unit es ${obligationUnit.value}; MW y MWh son magnitudes distintas (§4.1).` });
    }
  }

  // §4.1 "Alcance": "No se extrapolan estas cantidades a todas las campañas
  // históricas". La tabla sólo gobierna un total que la cita como fuente; otra
  // campaña con su propio mandato publica su propio total. Si la cita, el
  // valor es exactamente el confirmado para el producto/Mission de la ficha.
  const total = availableFact(factsById, "campaign.obligation.totalVolumeKnown");
  if (total && citesOwnerConfirmation(total)) {
    const confirmed = confirmedQuantityFor(ficha.product, ficha.mission);
    if (!confirmed || total.value !== confirmed.quantity || total.unit !== confirmed.unit) {
      const expected = confirmed ? `${confirmed.quantity} ${confirmed.unit}` : "ninguna";
      errors.push({ factId: "campaign.obligation.totalVolumeKnown", code: "CONFIRMED_QUANTITY_MISMATCH", message: `El total ${total.value} ${total.unit} cita la confirmación de Bru, que para ${ficha.product} ${ficha.mission} es ${expected} (§4.1).` });
    }
  }

  // La identidad publicada coincide con el producto/Mission que la ficha dice
  // reconstruir.
  const identityChecks = [
    ["campaign.identity.productFamily", ficha.product],
    ["campaign.identity.mission", ficha.mission],
  ];
  for (const [factId, expected] of identityChecks) {
    const identity = availableFact(factsById, factId);
    if (identity && identity.value !== expected) {
      errors.push({ factId, code: "IDENTITY_INCOHERENT", message: `"${factId}" = ${identity.value} contradice la ficha (${expected}).` });
    }
  }

  // §4.1 "Alcance": el vínculo a campaña materializa a qué campaña pertenece
  // la obligación. Coincidir producto y Mission no identifica la campaña: otra
  // Gas Quarterly con otro Campaign ID superaría esa comprobación y la ficha
  // atribuiría el volumen a dos campañas a la vez.
  // PROVISIONAL (no es formato de la SPEC, que no define el valor del vínculo
  // a campaña): se compara por igualdad con la Campaign ID. Un mandato real
  // que exprese el vínculo en otro formato sólo se resolverá con el registro
  // de la campaña real (DEP-01, P-006).
  const campaignLink = availableFact(factsById, "campaign.obligation.campaignLink");
  const campaignId = availableFact(factsById, "campaign.identity.campaignId");
  if (campaignLink && campaignId && campaignLink.value !== campaignId.value) {
    errors.push({
      factId: "campaign.obligation.campaignLink",
      code: "CAMPAIGN_LINK_INCOHERENT",
      message: `campaign.obligation.campaignLink = ${campaignLink.value} no coincide con campaign.identity.campaignId = ${campaignId.value}; el vínculo a campaña declara la Campaign ID (§4.1).`,
    });
  }

  // §4.3: Opening Obligation = Executed Volume + Remaining Volume. Un restante
  // publicado debe derivarse de apertura y ejecutado, no afirmarse solo.
  const remaining = availableFact(factsById, "campaign.coverage.remainingVolume");
  if (remaining) {
    const executed = availableFact(factsById, "campaign.coverage.executedVolume");
    const derived = computeRemainingVolume({
      openingObligation: total?.value,
      executedVolume: executed?.value,
      openingUnit: total?.unit,
      executedUnit: executed?.unit,
    });
    if (!derived.computed) {
      errors.push({ factId: "campaign.coverage.remainingVolume", code: "REMAINING_NOT_DERIVABLE", message: `El restante publicado no se deriva de apertura y ejecutado: ${derived.reason}` });
    } else if (derived.remainingVolume !== remaining.value || derived.unit !== remaining.unit) {
      errors.push({ factId: "campaign.coverage.remainingVolume", code: "CONSERVATION_VIOLATION", message: `Restante publicado ${remaining.value} ${remaining.unit} != apertura − ejecutado = ${derived.remainingVolume} ${derived.unit} (§4.3).` });
    }
  }

  // §4.1 "Alcance": sin campaña identificada no hay a qué campaña atribuir
  // volumen ejecutado/restante, deadline ni asignaciones.
  const campaignIdentified = IDENTITY_FACT_IDS.every((factId) => availableFact(factsById, factId));
  if (!campaignIdentified) {
    for (const factId of CAMPAIGN_SCOPED_FACT_IDS) {
      if (availableFact(factsById, factId)) {
        errors.push({ factId, code: "CAMPAIGN_NOT_IDENTIFIED", message: `"${factId}" se publica sin campaña identificada; no se atribuye a una campaña que la ficha no identifica (§4.1).` });
      }
    }
  }

  // DEP-02: la fact de asignación y el bloque coverageOwnership describen el
  // mismo mapa; no pueden tener estados distintos ni contenido distinto. Una
  // fact con FILL-A→OBL-1 y un mapa FILL-B→OBL-1 serían dos verdades del mismo
  // ownership y escaparían a la reconciliación con el volumen ejecutado.
  const assignmentFact = availableFact(factsById, "campaign.coverage.fillToObligationAssignment");
  const mapMaterialized = ficha.coverageOwnership?.mapState === "MATERIALIZED";
  if (Boolean(assignmentFact) !== mapMaterialized) {
    errors.push({ factId: "campaign.coverage.fillToObligationAssignment", code: "OWNERSHIP_STATE_INCOHERENT", message: "La fact de asignación fill→obligación y coverageOwnership.mapState no coinciden (DEP-02)." });
  }
  if (assignmentFact && mapMaterialized && !isDeepStrictEqual(canonicalAssignments(assignmentFact.value), canonicalAssignments(ficha.coverageOwnership.assignments))) {
    errors.push({ factId: "campaign.coverage.fillToObligationAssignment", code: "OWNERSHIP_ASSIGNMENT_MISMATCH", message: "La fact de asignación fill→obligación contradice el mapa materializado; un fill no puede pertenecer a dos obligaciones distintas según la fuente (§4.3/DEP-02)." });
  }

  // §4.3/§14.5: un mapa MATERIALIZED debe poseer exactamente el volumen
  // ejecutado publicado; no basta con declararse materializado.
  if (mapMaterialized) {
    const reconciliationErrors = reconcileOwnershipWithExecutedVolume(ownershipReconciliationInput(ficha, factsById));
    errors.push(...reconciliationErrors.map((error) => ({ factId: "coverageOwnership", ...error })));
  }

  // §4.3/§14.5: si la ficha cierra el residual con una enmienda, ésta debe
  // pertenecer a la obligación y figurar entre las enmiendas documentadas
  // (campaign.obligation.amendments). Una enmienda ajena o contradictoria no
  // cierra el residual.
  const residualAmendment = ficha.coverageOwnership?.residualAmendment;
  if (residualAmendment) {
    const amendmentsFact = availableFact(factsById, "campaign.obligation.amendments");
    const documentedAmendments = Array.isArray(amendmentsFact?.amendments) ? amendmentsFact.amendments : [];
    const residualErrors = validateResidualAmendment({
      residualAmendment,
      obligationId: ficha.coverageOwnership?.obligationId,
      documentedAmendments,
      remainingVolume: remaining?.value,
      unit: obligationUnit?.value,
    });
    errors.push(...residualErrors.map((error) => ({ factId: "coverageOwnership.residualAmendment", ...error })));
  }

  // P-006 (puntos 2, 6, 7): la identidad de un episodio de VALIDACIÓN es
  // determinista por producto + Mission + maturity, y los episodios elegibles
  // se evalúan dentro del horizonte histórico documentado (Q1 2021,
  // campaign_rules.csv fila "Fundamental,Gas Quarterly"). Una ficha editada a
  // mano no puede renombrar la campaña ni atribuir volumen a otra obligación.
  if (ficha.episode?.kind === "VALIDATION_EPISODE") {
    const canonicalEpisodeId = researchCampaignIdFor(ficha.product, ficha.mission, ficha.episode?.maturity);
    if (canonicalEpisodeId === null) {
      errors.push({ factId: "campaign.identity.campaignId", code: "EPISODE_IDENTITY_NOT_DETERMINISTIC", message: `La identidad del episodio (maturity "${ficha.episode?.maturity}") no es determinista: la maturity de Quarterly debe ser YYYYQn (Q1–Q4) (P-006 punto 6).` });
    } else if (quarterIndex(ficha.episode.maturity) < quarterIndex(VALIDATION_EPISODE_FIRST_MATURITY)) {
      errors.push({ factId: "campaign.identity.campaignId", code: "EPISODE_MATURITY_OUTSIDE_HORIZON", message: `La maturity ${ficha.episode.maturity} precede al horizonte histórico de validación (${VALIDATION_EPISODE_FIRST_MATURITY}); no es un episodio documentado del paquete del cliente.` });
    } else if (campaignId && campaignId.value !== canonicalEpisodeId) {
      errors.push({ factId: "campaign.identity.campaignId", code: "CAMPAIGN_ID_NOT_CANONICAL", message: `campaign.identity.campaignId = ${campaignId.value} no es la identidad determinista del episodio (${canonicalEpisodeId}); una ficha editada no renombra la campaña (P-006 punto 6).` });
    }
    if (ficha.coverageOwnership?.mapState === "MATERIALIZED" && canonicalEpisodeId !== null && ficha.coverageOwnership.obligationId !== episodeObligationIdFor(canonicalEpisodeId)) {
      errors.push({ factId: "coverageOwnership", code: "OBLIGATION_ID_NOT_CANONICAL", message: `coverageOwnership.obligationId = ${ficha.coverageOwnership.obligationId} no deriva de la identidad del episodio (${episodeObligationIdFor(canonicalEpisodeId)}) (P-006 punto 6; DEP-02).` });
    }
  }
}

function ownershipReconciliationInput(ficha, factsById) {
  const executed = availableFact(factsById, "campaign.coverage.executedVolume");
  const obligationUnit = availableFact(factsById, "campaign.obligation.unit");
  const executedUnitMatches = executed && obligationUnit && executed.unit === obligationUnit.value;
  return {
    assignments: ficha.coverageOwnership?.assignments,
    obligationId: ficha.coverageOwnership?.obligationId,
    executedVolume: executedUnitMatches ? executed.value : null,
    unit: executedUnitMatches ? obligationUnit.value : null,
  };
}

// Compara dos listas de asignaciones por su contenido, no por su orden de
// declaración: la fact y el bloque describen el mismo mapa fill→obligación.
function canonicalAssignments(assignments) {
  if (!Array.isArray(assignments)) {
    return assignments;
  }
  return [...assignments]
    .map((assignment) => (assignment && typeof assignment === "object" && !Array.isArray(assignment)
      ? { fillId: assignment.fillId, obligationId: assignment.obligationId, quantity: assignment.quantity, unit: assignment.unit }
      : assignment))
    .sort((left, right) => `${left?.fillId}|${left?.obligationId}`.localeCompare(`${right?.fillId}|${right?.obligationId}`));
}

// §25.1 IMP-02, acceptance test: "Se determina remaining volume/deadline sin
// inferir unidades; una cobertura no pertenece dos veces a obligaciones."
// El estado de cada parte se deriva de las facts; la ficha no puede afirmarlo
// por su cuenta. Lo no determinable queda nombrado con lo que lo bloquea.
export const IMP02_ACCEPTANCE_TEST = "Se determina remaining volume/deadline sin inferir unidades; una cobertura no pertenece dos veces a obligaciones.";

function unavailableFactIds(factsById, factIds) {
  return factIds.filter((factId) => !availableFact(factsById, factId));
}

// Con una fact repetida (ya rechazada como DUPLICATE_FACT) vale la primera
// copia, igual que en collectContractErrors: una sola verdad por factId.
function firstFactsById(facts) {
  const factsById = new Map();
  for (const fact of Array.isArray(facts) ? facts : []) {
    if (!factsById.has(fact?.factId)) {
      factsById.set(fact?.factId, fact);
    }
  }
  return factsById;
}

export function evaluateImp02Acceptance(ficha) {
  const factsById = firstFactsById(ficha?.facts);

  const campaignIdentified = IDENTITY_FACT_IDS.every((factId) => availableFact(factsById, factId));

  const remainingInputs = ["campaign.obligation.totalVolumeKnown", "campaign.obligation.unit", "campaign.coverage.executedVolume", "campaign.coverage.remainingVolume"];
  const identityBlockedBy = campaignIdentified ? [] : ["campaign.identity"];
  const remainingBlockedBy = [...identityBlockedBy, ...unavailableFactIds(factsById, remainingInputs)];
  const remainingFact = availableFact(factsById, "campaign.coverage.remainingVolume");
  // §4.3: el restante sólo cuenta como determinado si reconcilia con apertura y
  // ejecutado en la unidad de la obligación; publicarlo no basta.
  const totalFact = availableFact(factsById, "campaign.obligation.totalVolumeKnown");
  const executedFact = availableFact(factsById, "campaign.coverage.executedVolume");
  const unitFact = availableFact(factsById, "campaign.obligation.unit");
  const derivedRemaining = computeRemainingVolume({
    openingObligation: totalFact?.value,
    executedVolume: executedFact?.value,
    openingUnit: totalFact?.unit,
    executedUnit: executedFact?.unit,
  });
  const remainingReconciles = Boolean(remainingFact)
    && derivedRemaining.computed
    && derivedRemaining.remainingVolume === remainingFact.value
    && derivedRemaining.unit === remainingFact.unit
    && derivedRemaining.unit === unitFact?.value;
  if (remainingBlockedBy.length === 0 && !remainingReconciles) {
    remainingBlockedBy.push("campaign.coverage.reconciliation");
  }
  const remainingDetermined = campaignIdentified && remainingBlockedBy.length === 0;
  const remainingVolume = remainingDetermined
    ? { determined: true, value: remainingFact.value, unit: remainingFact.unit, blockedBy: [], reason: null }
    : {
      determined: false,
      value: null,
      unit: null,
      blockedBy: remainingBlockedBy,
      reason: "No determinable: Remaining = Opening − Executed (§4.3) exige el volumen ejecutado de una campaña identificada; AUDIT_INPUTS §5 lo registra como no encontrado en el alcance inspeccionado.",
    };

  const deadlineOutcome = resolveObligationDeadline(ficha);
  // El texto-regla del paquete (ruleText) se declara como lo que es: la regla
  // de cierre documentada, no la fecha del episodio (§13.4, revisión 193314).
  const deadline = campaignIdentified && deadlineOutcome.determined
    ? { determined: true, value: deadlineOutcome.deadline, blockedBy: [], reason: null }
    : {
      determined: false,
      value: null,
      blockedBy: [...identityBlockedBy, "campaign.calendar.deadline"],
      reason: deadlineOutcome.ruleText !== undefined
        ? "No determinable: el calendario publica la regla de cierre del episodio, no la fecha instanciada; §13.4 exige instanciar las fechas reales desde el Procurement Contract y no se infieren."
        : "No determinable: AUDIT_INPUTS §5 registra el deadline como no encontrado en el alcance inspeccionado; no se infiere (§4.1/§4.2).",
    };

  // El estado declarado no basta: la relación debe ser una declaración válida
  // y el mapa debe no tener doble conteo y poseer exactamente el volumen
  // ejecutado (§4.3/§14.5/DEP-02).
  const relation = ficha?.coverageOwnership?.relationMonthlyQuarterly;
  const relationAvailable = relation?.availability === "AVAILABLE_NOW" && validateRelationDeclaration(relation).length === 0;
  const mapMaterialized = ficha?.coverageOwnership?.mapState === "MATERIALIZED";
  const assignmentsReconciled = mapMaterialized
    && validateOwnershipAssignments(ficha.coverageOwnership.assignments).length === 0
    && reconcileOwnershipWithExecutedVolume(ownershipReconciliationInput(ficha, factsById)).length === 0;
  const ownershipBlockedBy = [
    ...identityBlockedBy,
    ...(mapMaterialized ? [] : ["coverageOwnership.mapState"]),
    ...(mapMaterialized && !assignmentsReconciled ? ["coverageOwnership.assignments"] : []),
    ...(relationAvailable ? [] : ["coverageOwnership.relationMonthlyQuarterly"]),
  ];
  const coverageOwnership = campaignIdentified && ownershipBlockedBy.length === 0
    ? { determined: true, blockedBy: [], reason: null }
    : {
      determined: false,
      blockedBy: ownershipBlockedBy,
      reason: "No determinable: sin fills asignados ni relación Monthly/Quarterly auditada no se puede comprobar el no doble conteo (§4.3/DEP-02); AUDIT_INPUTS §5 registra ambos como no encontrados.",
    };

  // §25.2 fila IMP-02: el acceptance es la ficha de campaña reconciliada, no
  // sólo tres números. Contrato/unidades, delivery, liquidación, vínculo a
  // campaña, calendario, terminal rule y enmiendas (DEP-01–04) deben estar
  // auditados o con su ausencia documentada donde corresponde.
  const auditedBlockedBy = [...identityBlockedBy, ...unavailableFactIds(factsById, IMP02_REQUIRED_FACT_IDS)];
  // §25.2 IMP-02: "La ausencia de terminal rule no equivale a cobertura
  // completa". Las ausencias constatadas se publican para que el downstream
  // (§4.3/§14.5: COVERAGE_INCOMPLETE ante residual) no las lea como reglas.
  const documentedAbsences = IMP02_REQUIRED_FACT_IDS.filter((factId) => availableFact(factsById, factId)?.documentedAbsence === true);
  const auditedContract = campaignIdentified && auditedBlockedBy.length === 0
    ? { determined: true, blockedBy: [], documentedAbsences, reason: null }
    : {
      determined: false,
      blockedBy: auditedBlockedBy,
      documentedAbsences,
      reason: "No determinable: §25.2 IMP-02 exige resolver DEP-01–04 para la campaña examinada; AUDIT_INPUTS §8 punto 4 y §9 paquete 1 registran que el mandato/campaña no está en el material inspeccionado.",
    };

  // Cada parte puede derivarse determinada y la ficha contradecirse en otro
  // campo (identidad, provenance, cantidad confirmada): el criterio sólo se
  // cumple sobre una ficha que además satisface el contrato completo.
  const contractValid = collectContractErrors(ficha).length === 0;
  const criterionMet = contractValid
    && campaignIdentified
    && auditedContract.determined
    && remainingVolume.determined
    && deadline.determined
    && coverageOwnership.determined;
  return {
    acceptanceTest: IMP02_ACCEPTANCE_TEST,
    source: "SPEC v1.1.1 §25.1 IMP-02",
    contractValid,
    campaignIdentified,
    auditedContract,
    remainingVolume,
    deadline,
    coverageOwnership,
    criterionMet,
  };
}

// La ficha declara el estado del criterio y debe coincidir con el derivado de
// sus facts: así una ficha no puede afirmar que determinó lo que no determinó.
function validateAcceptanceDeclaration(ficha, errors) {
  if (!ficha.acceptanceCriterion || typeof ficha.acceptanceCriterion !== "object") {
    errors.push({ factId: "acceptanceCriterion", code: "ACCEPTANCE_CRITERION_MISSING", message: "La ficha debe declarar explícitamente el estado del criterio de aceptación de IMP-02 (§25.1)." });
    return;
  }
  if (!isDeepStrictEqual(ficha.acceptanceCriterion, evaluateImp02Acceptance(ficha))) {
    errors.push({ factId: "acceptanceCriterion", code: "ACCEPTANCE_CRITERION_INCOHERENT", message: "El criterio de aceptación declarado no coincide con lo que las facts permiten determinar." });
  }
}

// Valida una ficha de campaña completa. Preserva la razón de cada faltante en
// lugar de poblarla; rechaza defaults inventados, unidades asumidas y
// confluencias prohibidas.
export function validateCampaignContract(ficha) {
  const errors = collectContractErrors(ficha);
  if (!ficha || typeof ficha !== "object" || Array.isArray(ficha) || !Array.isArray(ficha.facts)) {
    return { ok: false, campaignIdentified: false, errors };
  }
  validateAcceptanceDeclaration(ficha, errors);

  const factsById = firstFactsById(ficha.facts);
  const campaignIdentified = IDENTITY_FACT_IDS.every((factId) => availableFact(factsById, factId));
  return { ok: errors.length === 0, campaignIdentified, errors };
}

// Todo el contrato salvo la declaración del criterio de aceptación, que se
// deriva de estas mismas facts (evaluateImp02Acceptance) y no puede validarse
// a sí misma.
function collectContractErrors(ficha) {
  const errors = [];

  if (!ficha || typeof ficha !== "object" || Array.isArray(ficha)) {
    return [{ factId: "(ficha)", code: "MISSING_FICHA", message: "Ficha de campaña ausente." }];
  }

  const facts = Array.isArray(ficha.facts) ? ficha.facts : null;
  if (facts === null) {
    return [{ factId: "(ficha)", code: "FACTS_NOT_ARRAY", message: "La ficha no declara una lista de facts." }];
  }

  const seen = new Map();
  for (const fact of facts) {
    if (!fact || typeof fact !== "object") {
      errors.push({ factId: "(fact)", code: "INVALID_FACT", message: "Fact no es un objeto." });
      continue;
    }
    const definition = FACT_BY_ID.get(fact.factId);
    if (!definition) {
      errors.push({ factId: fact.factId, code: "UNKNOWN_FACT", message: `Fact no declarada en el contrato de campaña: "${fact.factId}".` });
      continue;
    }
    if (seen.has(fact.factId)) {
      errors.push({ factId: fact.factId, code: "DUPLICATE_FACT", message: `Fact repetida: "${fact.factId}".` });
      continue;
    }
    seen.set(fact.factId, fact);

    const outcome = resolveFactAvailability(fact);
    if (!outcome.ok) {
      errors.push({ factId: fact.factId, code: outcome.code, message: outcome.message });
      continue;
    }
    validateAbsenceFlagShape(fact, errors);
    if (fact.availability === "AVAILABLE_NOW") {
      validateAvailableFact(fact, definition, errors);
    } else if (fact.availability === "UNAVAILABLE") {
      validateUnavailableFact(fact, errors);
    } else {
      errors.push({ factId: fact.factId, code: "UNSUPPORTED_AVAILABILITY", message: `"${fact.factId}" usa availability "${fact.availability}", no soportada para materializar la ficha.` });
    }
  }

  for (const definition of CAMPAIGN_CONTRACT_FACTS) {
    if (!seen.has(definition.factId)) {
      errors.push({ factId: definition.factId, code: "MISSING_FACT", message: `Falta la fact obligatoria "${definition.factId}".` });
    }
  }

  validateGuards(ficha.guards, errors);
  validateCoverageOwnership(ficha.coverageOwnership, errors);
  validateCrossFieldCoherence(ficha, seen, errors);
  return errors;
}

function resolveFactAvailability(fact) {
  const declared = AVAILABILITY;
  if (typeof fact.availability !== "string" || !declared.includes(fact.availability)) {
    return { ok: false, code: "UNKNOWN_AVAILABILITY", message: `"${fact.factId}" usa availability no declarada.` };
  }
  return { ok: true };
}

// §4.1/§4.2: la ficha no fija el deadline salvo que el calendario lo aporte.
// §13.4: "Las fechas reales se instancian desde el Procurement Contract".
// Un deadline determinado es una fecha REAL del calendario: la forma ISO 8601
// no basta (§13.4 exige instanciar fechas reales; el texto de la regla de
// cierre del paquete cliente no lo es y no se reporta como fecha).
const ISO_8601_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})?)?$/;
const ISO_8601_TIME_PART = /^T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/;

// La forma ISO 8601 sin calendario real deja pasar imposibles ("2026-13-45").
// La fecha es real sólo si el calendario la round-trippea exactamente (meses
// 01–12 y días presentes en ese mes, incluido el 29 de febrero bisiesto).
function isRealIsoCalendarDate(datePart) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  return roundTrip.getUTCFullYear() === year && roundTrip.getUTCMonth() === month - 1 && roundTrip.getUTCDate() === day;
}

function isRealIsoTimeOfDay(timePart) {
  const match = ISO_8601_TIME_PART.exec(timePart);
  if (!match) {
    return false;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] === undefined ? 0 : Number(match[3]);
  return hours <= 23 && minutes <= 59 && seconds <= 59;
}

// §13.4: el deadline del episodio es una fecha real instanciable del calendario
// (fecha con horas/minutos/segundos reales si trae hora). La forma ISO sola no
// instancia una fecha; los imposibles de calendario quedan sin determinar.
function resolvesToRealCalendarDate(value) {
  if (!ISO_8601_DATE_PATTERN.test(value)) {
    return false;
  }
  if (!isRealIsoCalendarDate(value.slice(0, 10))) {
    return false;
  }
  const timePart = value.length > 10 ? value.slice(10) : null;
  return timePart === null || isRealIsoTimeOfDay(timePart);
}

// Ventana de trading del episodio (convención documentada 3-1-3; §25.1/§25.2 y
// paquete cliente: campaign calendar rule de 01_shared_campaign_rules.md §1 /
// gas_quarterly.md "Trading-window convention", openClose.quote): el strategy
// sólo puede tradear en los meses cuarto, tercero y segundo previos al inicio
// del quarter de la maturity; el mes inmediatamente anterior a la entrega es el
// gap. El deadline ("Exact target position by the end of the final effective
// trading day", deadline.quote) sólo puede caer dentro de esa ventana de
// trading; un deadline en el gap, en la entrega o ajeno al episodio no
// instancia el cierre real del episodio.
function episodeDeadlineWindow(maturity) {
  if (!isCanonicalMaturity("Quarterly", maturity)) {
    return null;
  }
  const year = Number(maturity.slice(0, 4));
  const quarter = Number(maturity.slice(5));
  // Índice absoluto de mes desde el año 0; se convierte a año/mes con
  // división y módulo (no con anclas de Date.UTC, que duplicarían la base).
  const monthIndexOf = (month) => {
    const normalized = Math.floor(month / 12);
    return { year: normalized, month: month - normalized * 12 };
  };
  const firstTradingMonthIndex = year * 12 + (quarter - 1) * 3 - 4;
  const gapMonthIndex = year * 12 + (quarter - 1) * 3 - 1;
  const firstTrading = monthIndexOf(firstTradingMonthIndex);
  const gap = monthIndexOf(gapMonthIndex);
  return {
    startsAt: Date.UTC(firstTrading.year, firstTrading.month, 1),
    endsExclusive: Date.UTC(gap.year, gap.month, 1),
  };
}

export function resolveObligationDeadline(ficha) {
  const deadline = (ficha?.facts ?? []).find((fact) => fact.factId === "campaign.calendar.deadline");
  if (deadline?.availability === "AVAILABLE_NOW" && isNonEmptyString(deadline.value) && hasProvenance(deadline)) {
    if (!ISO_8601_DATE_PATTERN.test(deadline.value)) {
      return {
        determined: false,
        deadline: null,
        ruleText: deadline.value,
        reason: `El calendario publica la regla de cierre ("${deadline.value}"), no la fecha instanciada del episodio; §13.4: las fechas reales se instancian desde el Procurement Contract y no se infieren.`,
      };
    }
    if (!resolvesToRealCalendarDate(deadline.value)) {
      return {
        determined: false,
        deadline: null,
        reason: `El valor "${deadline.value}" tiene forma de fecha ISO 8601 pero no instancia una fecha real del calendario; §13.4: las fechas reales se instancian desde el Procurement Contract y no se reportan fechas imposibles.`,
      };
    }
    // P-006 (punto 3) y convención 3-1-3 documentada (§4.1/§13.4; openClose):
    // el deadline del episodio es el fin del último día efectivo de trading en
    // su ventana; una ficha editada a mano no puede atribuir al episodio un
    // deadline ajeno a esa ventana.
    const episode = ficha?.episode;
    if (episode?.kind === "VALIDATION_EPISODE") {
      const window = episodeDeadlineWindow(episode.maturity);
      if (window === null) {
        return {
          determined: false,
          deadline: null,
          reason: `La maturity del episodio ("${episode.maturity}") no es YYYYQn (Q1–Q4); sin episodio determinista el deadline no atribuye un cierre real (P-006 puntos 2, 6).`,
        };
      }
      const calendarDay = Date.UTC(Number(deadline.value.slice(0, 4)), Number(deadline.value.slice(5, 7)) - 1, Number(deadline.value.slice(8, 10)));
      if (calendarDay < window.startsAt || calendarDay >= window.endsExclusive) {
        return {
          determined: false,
          deadline: null,
          reason: `El deadline "${deadline.value}" cae fuera de la ventana de trading del episodio ${episode.maturity}; la convención 3-1-3 deja el último día efectivo de trading en los meses cuarto a segundo previos al quarter (01_shared_campaign_rules.md §1; gas_quarterly.md "Trading-window convention"); no se renombra la fecha del cierre.`,
        };
      }
    }
    return { determined: true, deadline: deadline.value, reason: null };
  }
  return { determined: false, deadline: null, reason: "El calendario de campaña no aporta un deadline real; no se infiere." };
}

function missingFact(factId, reason, nextRetrievalAction) {
  const definition = FACT_BY_ID.get(factId);
  return {
    factId,
    section: definition.section,
    availability: "UNAVAILABLE",
    value: null,
    unit: null,
    source: null,
    reason,
    nextRetrievalAction,
  };
}

// Materializa la ficha Gas Quarterly de la campaña examinada: incorpora la
// cantidad confirmada por el owner (60 MW) y deja explícitos los campos que
// siguen sin mandato real (§4.1 "Alcance"; §25.3 IMP-02).
export function createGasQuarterlyFicha() {
  const confirmed = confirmedQuantityFor("Gas", "Quarterly");
  const facts = [
    missingFact("campaign.identity.campaignId", "No se encontró un Campaign ID real en el alcance inspeccionado (AUDIT_INPUTS §5); su existencia no se afirma ni se niega. §4.1 declara la identidad AUDIT-DEPENDENT.", "Obtener el registro de campaña firmado que contenga el Campaign ID."),
    missingFact("campaign.identity.productContract", "El contrato exacto de la campaña identificada (su maturity) sigue sin registro auditado (§4.1); el paquete del cliente confirma a nivel del mandato vigente la clase de producto NATGAS / THE Quarterly EEX futures, que es lo que documenta el hub/market de esta ficha, no el contrato de la campaña.", "Obtener el registro de campaña firmado con su contrato/maturity exacto."),
    // §4.1 línea 280: la fila Identidad (incluidos Power/Gas y
    // Monthly/Quarterly) es AUDIT-DEPENDENT; conocer la cantidad no confirma
    // producto ni Mission de una campaña real. Coincide con el artefacto
    // IMP-02 v1.1 (operations/audit/IMP-02/campaign-contract.json), que
    // declara estas mismas facts MISSING: no se infieren del objetivo de
    // población P5.
    missingFact(
      "campaign.identity.productFamily",
      "La identidad de campaña es AUDIT-DEPENDENT (§4.1): no se encontró en el alcance inspeccionado (AUDIT_INPUTS §5) una campaña real que confirme Power/Gas; Gas Quarterly es sólo la población canónica del primer experimento. El artefacto IMP-02 v1.1 (operations/audit/IMP-02/campaign-contract.json) declara esta fact MISSING con la misma razón: no se infiere del objetivo de población P5 (§4.1 línea 280).",
      "Confirmar la familia de producto de la campaña real desde el mandato firmado; no inferirla de la población objetivo P5.",
    ),
    missingFact(
      "campaign.identity.mission",
      "La identidad de campaña es AUDIT-DEPENDENT (§4.1): la tabla §4.1 confirma cantidades por combinación producto/Mission, no la Mission de una campaña real. El artefacto IMP-02 v1.1 (operations/audit/IMP-02/campaign-contract.json) declara esta fact MISSING (§4.1 línea 280).",
      "Confirmar la Mission de la campaña real desde el mandato firmado.",
    ),
    // §25.1/§25.2: el paquete verificado del cliente documenta el hub/market
    // del caso Fundamental (NATGAS / THE Quarterly) y la estructura trimestral
    // 3-1-3; la ficha ya no los declara ausentes. Son parámetros del mandato
    // vigente, no el registro de una campaña concreta: no identifican
    // Campaign ID, maturity, calendario real ni ownership.
    {
      factId: "campaign.identity.hubMarket",
      section: "Identidad",
      availability: "AVAILABLE_NOW",
      // §4.1/§25: el valor no puede exceder su provenance. El paquete del
      // cliente (ESTADO_INPUTS.csv fila "Product mapping — Gas Quarterly";
      // gas_quarterly.md "Relevant EEX product class") documenta la clase de
      // producto exactamente como "NATGAS / THE Quarterly EEX futures"; toda
      // expansión ausente de la fuente (p. ej. "Trading Hub Europe") sería
      // dato inventado. El valor replica la clase documentada.
      value: "NATGAS / THE Quarterly EEX futures",
      unit: null,
      source: CLIENT_PACKAGE_SOURCES.hubMarket,
      reason: null,
    },
    {
      factId: "campaign.obligation.totalVolumeKnown",
      section: "Obligación",
      availability: "AVAILABLE_NOW",
      value: confirmed.quantity,
      unit: confirmed.unit,
      source: confirmed.source,
      reason: null,
    },
    // §4.1 línea 281: "Cantidad y unidad confirmadas en la tabla anterior".
    // La unidad MW es un dato confirmado por el owner; declararla faltante
    // mientras totalVolumeKnown la publica es registrarla dos veces con
    // veredictos opuestos. La conversión a MWh sigue bloqueada por
    // deliveryPeriod ausente y el guard §4.1 de conversión.
    {
      factId: "campaign.obligation.unit",
      section: "Obligación",
      availability: "AVAILABLE_NOW",
      value: confirmed.unit,
      unit: null,
      source: confirmed.source,
      reason: null,
    },
    missingFact("campaign.obligation.deliveryPeriod", "Falta el periodo/horas/perfil de entrega (§4.1).", "Recuperar periodo, horas y perfil de entrega del mandato."),
    missingFact("campaign.obligation.settlement", "Falta la liquidación física/financiera de la obligación (§4.1 \"Alcance\"; DEP-01).", "Recuperar la liquidación del contrato/mandato."),
    missingFact("campaign.obligation.validity", "Falta la vigencia de la obligación (§4.1).", "Recuperar vigencia y enmiendas/cancelaciones del contrato."),
    missingFact("campaign.obligation.campaignLink", "La cantidad confirmada no identifica la campaña a la que pertenece (§4.1).", "Vincular la cantidad a una campaña real."),
    missingFact("campaign.obligation.amendments", "No hay enmiendas/cancelaciones reales verificadas; su ausencia no se afirma como 'ninguna' (§4.3).", "Recuperar enmiendas/cancelaciones versionadas."),
    missingFact("campaign.calendar.openClose", "Faltan apertura/cierre de campaña (§4.1).", "Recuperar el calendario de procurement real."),
    missingFact("campaign.calendar.decisionOpportunities", "No hay oportunidades de decisión válidas auditadas (§13.4).", "Instanciar oportunidades desde el Procurement Contract auditado."),
    missingFact("campaign.calendar.deadline", "No se encontró el deadline en el alcance inspeccionado (AUDIT_INPUTS §5); no se infiere (§4.1/§4.2).", "Recuperar el deadline contractual."),
    {
      factId: "campaign.calendar.pauseExclusion",
      section: "Calendario",
      availability: "AVAILABLE_NOW",
      value: "3-1-3: tres meses de trading, un mes de pausa (gap), tres meses de delivery (§13.4)",
      unit: null,
      source: CLIENT_PACKAGE_SOURCES.pauseExclusion,
      reason: null,
    },
    missingFact("campaign.feasibility.lots", "Faltan lotes reales; no se asumen (§4.1/§5.6).", "Auditar lotes y redondeos reales."),
    missingFact("campaign.feasibility.rounding", "Falta el redondeo real; no se asume (§4.1/§5.6).", "Auditar redondeo real."),
    missingFact("campaign.feasibility.terminalCoverageRule", "No se ha verificado una terminal rule: AUDIT_INPUTS §5 la registra como no encontrada en el alcance inspeccionado; su existencia no se afirma ni se niega (§14.5: auditar la regla real sigue pendiente). Mientras no esté verificada, un residual al deadline queda COVERAGE_INCOMPLETE y no se fabrica fill de cierre (§4.3/§14.5).", "Recuperar la terminal rule versionada del contrato."),
    missingFact("campaign.execution.contract", "Falta el contrato de ejecución (fills, latencia, fees, slippage) real (§4.1/§5.6).", "Auditar el execution contract aplicable."),
    missingFact("campaign.coverage.executedVolume", "No se encontró un execution ledger de la campaña en el alcance inspeccionado (AUDIT_INPUTS §5: historial de coberturas/compras y volumen ejecutado); no se afirma que no exista (§4.3).", "Producir el ledger de ejecución cuando existan fills."),
    missingFact("campaign.coverage.remainingVolume", "El volumen restante no es computable sin obligación de apertura y volumen ejecutado (§4.3).", "Derivar el restante sólo tras materializar apertura y ejecutado."),
    missingFact("campaign.coverage.fillToObligationAssignment", "No se encontraron fills de la campaña ni su asignación a obligaciones en el alcance inspeccionado (AUDIT_INPUTS §5); la cantidad confirmada de 60 MW no está vinculada a una campaña. No se afirma que no existan (§4.3/DEP-02).", "Asignar cada fill/cobertura a lo sumo a una obligación."),
  ];

  const ficha = {
    artifactKind: "IMP-02_GAS_QUARTERLY_CAMPAIGN_FICHA",
    // Alineada con la SPEC v1.1.1 bajo la que se materializa la ficha
    // (v1_1_1/; revisión energy-markets-IMP-02-20260923-193314).
    schemaVersion: "1.1.1",
    spec: {
      id: "PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md",
      version: "1.1.1",
      sha256: "666a9735d9daf62764582f017056171acae52070d18499b26c5c6e426cff3ef3",
    },
    product: "Gas",
    mission: "Quarterly",
    guards: {
      totalObligationIsPerBuySizing: false,
      benchmarkWindowIsExecutionPermission: false,
      unknownTerminalRuleFabricatesCloseOutFill: false,
      assumedMwToMwhConversion: false,
    },
    facts,
    // §24 DEP-02: estado materializado de la relación y del mapa de ownership
    // para la campaña examinada. Sin mandato auditado ambos quedan como
    // faltante documentado; la taxonomía vive en coverage-ownership.mjs.
    coverageOwnership: {
      mapState: "UNAVAILABLE",
      reason: "No se encontraron fills de la campaña ni su asignación a obligaciones en el alcance inspeccionado (AUDIT_INPUTS §5); la cantidad confirmada de 60 MW no está vinculada a una campaña. No se afirma que no existan (§4.3/DEP-02).",
      relationMonthlyQuarterly: {
        availability: "UNAVAILABLE",
        reason: "No se sabe si las obligaciones Monthly y Quarterly son adicionales, solapadas o alternativas según mandato (DEP-02; D08 p.4; D15 p.2).",
      },
    },
  };
  // §25.1 IMP-02: la ficha declara qué parte del acceptance test puede
  // determinar con sus facts y qué no, sin afirmar lo no determinado.
  ficha.acceptanceCriterion = evaluateImp02Acceptance(ficha);
  return ficha;
}

// Materializa la ficha de un episodio de VALIDACIÓN Gas Quarterly bajo el
// mandato vigente (aclaración P-006 del owner, 23-sep-2026; paquete del
// cliente verificado). La identidad es determinista por producto + Mission +
// maturity (P-006 punto 6): no se pide ni se inventa un Campaign ID comercial.
// Cada episodio abre en 0 MW (posición inicial documentada) y debe completar
// exactamente 60 MW en su ventana; Monthly y Quarterly no comparten coverage.
// No fabrica fills, campaña live ni ownership inexistente (P-006 punto 8): el
// volumen ejecutado del episodio parte de la apertura documentada.
export function createGasQuarterlyValidationFicha(maturity) {
  const campaignId = researchCampaignIdFor("Gas", "Quarterly", maturity);
  if (campaignId === null) {
    throw new TypeError("La maturity del episodio debe ser YYYYQn (Q1–Q4); sin ella no hay identidad determinista (P-006 punto 6).");
  }
  if (quarterIndex(maturity) < quarterIndex(VALIDATION_EPISODE_FIRST_MATURITY)) {
    throw new TypeError(`La maturity ${maturity} precede al horizonte histórico de validación (${VALIDATION_EPISODE_FIRST_MATURITY}); no se fabrica un episodio fuera del horizonte documentado (P-006 puntos 2, 7).`);
  }
  const confirmed = confirmedQuantityFor("Gas", "Quarterly");
  const campaignSource = {
    ...OWNER_P006_CONFIRMATION,
    locator: `${OWNER_P006_CONFIRMATION.locator}; 01_campaigns/campaign_rules.csv fila "Fundamental,Gas Quarterly" (episodio ${maturity})`,
  };
  const obligationId = episodeObligationIdFor(campaignId);
  const facts = [
    {
      factId: "campaign.identity.campaignId",
      section: "Identidad",
      availability: "AVAILABLE_NOW",
      value: campaignId,
      unit: null,
      source: campaignSource,
      reason: null,
    },
    {
      factId: "campaign.identity.productContract",
      section: "Identidad",
      availability: "AVAILABLE_NOW",
      value: CLIENT_PACKAGE_SOURCES.productContract.quote,
      unit: null,
      source: CLIENT_PACKAGE_SOURCES.productContract,
      reason: null,
    },
    {
      factId: "campaign.identity.productFamily",
      section: "Identidad",
      availability: "AVAILABLE_NOW",
      value: "Gas",
      unit: null,
      source: CLIENT_PACKAGE_SOURCES.mission,
      reason: null,
    },
    {
      factId: "campaign.identity.mission",
      section: "Identidad",
      availability: "AVAILABLE_NOW",
      value: "Quarterly",
      unit: null,
      source: CLIENT_PACKAGE_SOURCES.mission,
      reason: null,
    },
    {
      factId: "campaign.identity.hubMarket",
      section: "Identidad",
      availability: "AVAILABLE_NOW",
      value: CLIENT_PACKAGE_SOURCES.hubMarket.quote,
      unit: null,
      source: CLIENT_PACKAGE_SOURCES.hubMarket,
      reason: null,
    },
    {
      factId: "campaign.obligation.totalVolumeKnown",
      section: "Obligación",
      availability: "AVAILABLE_NOW",
      value: confirmed.quantity,
      unit: confirmed.unit,
      source: confirmed.source,
      reason: null,
    },
    {
      factId: "campaign.obligation.unit",
      section: "Obligación",
      availability: "AVAILABLE_NOW",
      value: confirmed.unit,
      unit: null,
      source: {
        ...confirmed.source,
        locator: `${confirmed.source.locator} (columna Unidad: MW); 01_campaigns/campaign_rules.csv fila "Fundamental,Gas Quarterly" (Target MW)`,
        quote: "MW",
      },
      reason: null,
    },
    // El periodo de entrega del episodio es el documentado por el paquete:
    // tres meses calendario de delivery (3-1-3); el perfil horario exacto
    // corresponde al contrato/maturity EEX, sin asunción adicional (ESTADO
    // "Delivery profile / MWh conversion").
    {
      factId: "campaign.obligation.deliveryPeriod",
      section: "Obligación",
      availability: "AVAILABLE_NOW",
      value: CLIENT_PACKAGE_SOURCES.deliveryPeriod.quote,
      unit: null,
      source: CLIENT_PACKAGE_SOURCES.deliveryPeriod,
      reason: null,
    },
    // La liquidación física/financiera posterior está documentada fuera del
    // alcance del mandato (AUSENCIA CONFIRMADA): el valor replica esa
    // constatación sin inventar una forma de liquidación.
    {
      factId: "campaign.obligation.settlement",
      section: "Obligación",
      availability: "AVAILABLE_NOW",
      value: CLIENT_PACKAGE_SOURCES.settlement.quote,
      unit: null,
      source: CLIENT_PACKAGE_SOURCES.settlement,
      reason: null,
    },
    {
      factId: "campaign.obligation.validity",
      section: "Obligación",
      availability: "AVAILABLE_NOW",
      value: CLIENT_PACKAGE_SOURCES.validity.quote,
      unit: null,
      source: CLIENT_PACKAGE_SOURCES.validity,
      reason: null,
    },
    {
      factId: "campaign.obligation.campaignLink",
      section: "Obligación",
      availability: "AVAILABLE_NOW",
      value: campaignId,
      unit: null,
      source: campaignSource,
      reason: null,
    },
    // §7 Mandate changes: el target queda fijo dentro de la campaña; un cambio
    // de mandato abre un ciclo nuevo, no se aplica retroactivamente a un
    // episodio en curso. Para los episodios de validation esto es la
    // constatación documentada de ausencia de enmiendas (§25.2 "cuando
    // corresponda"); se publica como tal, no como cobertura completa.
    {
      factId: "campaign.obligation.amendments",
      section: "Obligación",
      availability: "AVAILABLE_NOW",
      value: CLIENT_PACKAGE_SOURCES.amendmentsAbsence.quote,
      unit: null,
      source: CLIENT_PACKAGE_SOURCES.amendmentsAbsence,
      documentedAbsence: true,
      reason: null,
    },
    {
      factId: "campaign.calendar.openClose",
      section: "Calendario",
      availability: "AVAILABLE_NOW",
      value: CLIENT_PACKAGE_SOURCES.openClose.quote,
      unit: null,
      source: CLIENT_PACKAGE_SOURCES.openClose,
      reason: null,
    },
    {
      factId: "campaign.calendar.decisionOpportunities",
      section: "Calendario",
      availability: "AVAILABLE_NOW",
      value: CLIENT_PACKAGE_SOURCES.decisionOpportunities.quote,
      unit: null,
      source: CLIENT_PACKAGE_SOURCES.decisionOpportunities,
      reason: null,
    },
    {
      factId: "campaign.calendar.deadline",
      section: "Calendario",
      availability: "AVAILABLE_NOW",
      value: CLIENT_PACKAGE_SOURCES.deadline.quote,
      unit: null,
      source: CLIENT_PACKAGE_SOURCES.deadline,
      reason: null,
    },
    {
      factId: "campaign.calendar.pauseExclusion",
      section: "Calendario",
      availability: "AVAILABLE_NOW",
      value: CLIENT_PACKAGE_SOURCES.pauseExclusion.quote,
      unit: null,
      source: CLIENT_PACKAGE_SOURCES.pauseExclusion,
      reason: null,
    },
    {
      factId: "campaign.feasibility.lots",
      section: "Factibilidad",
      availability: "AVAILABLE_NOW",
      value: CLIENT_PACKAGE_SOURCES.lots.quote,
      unit: null,
      source: CLIENT_PACKAGE_SOURCES.lots,
      reason: null,
    },
    {
      factId: "campaign.feasibility.rounding",
      section: "Factibilidad",
      availability: "AVAILABLE_NOW",
      value: CLIENT_PACKAGE_SOURCES.positionUnits.quote,
      unit: null,
      source: CLIENT_PACKAGE_SOURCES.positionUnits,
      reason: null,
    },
    // La terminal rule del episodio está documentada y es válida: posición
    // final igual al objetivo exacto al cierre del último día efectivo; un
    // residual al deadline no es cobertura (§4.3) y dispara el hard-reject de
    // validación, no un fill de cierre.
    {
      factId: "campaign.feasibility.terminalCoverageRule",
      section: "Factibilidad",
      availability: "AVAILABLE_NOW",
      value: CLIENT_PACKAGE_SOURCES.terminalRequirement.quote,
      unit: null,
      source: CLIENT_PACKAGE_SOURCES.terminalRequirement,
      reason: null,
    },
    {
      factId: "campaign.execution.contract",
      section: "Ejecución",
      availability: "AVAILABLE_NOW",
      value: CLIENT_PACKAGE_SOURCES.executionContract.quote,
      unit: null,
      source: CLIENT_PACKAGE_SOURCES.executionContract,
      reason: null,
    },
    // Posición inicial documentada del episodio: 0 MW ejecutados al abrir.
    {
      factId: "campaign.coverage.executedVolume",
      section: "Estado de cobertura",
      availability: "AVAILABLE_NOW",
      value: 0,
      unit: confirmed.unit,
      source: CLIENT_PACKAGE_SOURCES.initialPosition,
      reason: null,
    },
    {
      factId: "campaign.coverage.remainingVolume",
      section: "Estado de cobertura",
      availability: "AVAILABLE_NOW",
      value: confirmed.quantity,
      unit: confirmed.unit,
      source: { authority: CLIENT_PACKAGE_SOURCES.initialPosition.authority, locator: "Derivada: apertura 60 MW − ejecutado 0 MW (§4.3); posición inicial 0 MW documentada." },
      reason: null,
    },
    {
      factId: "campaign.coverage.fillToObligationAssignment",
      section: "Estado de cobertura",
      availability: "AVAILABLE_NOW",
      value: [],
      unit: null,
      source: CLIENT_PACKAGE_SOURCES.initialPosition,
      reason: null,
    },
  ];

  const ficha = {
    artifactKind: "IMP-02_GAS_QUARTERLY_VALIDATION_EPISODE_FICHA",
    // Alineada con la SPEC v1.1.1 bajo la que se materializa la ficha
    // (v1_1_1/; revisión energy-markets-IMP-02-20260923-193314).
    schemaVersion: "1.1.1",
    spec: {
      id: "PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md",
      version: "1.1.1",
      sha256: "666a9735d9daf62764582f017056171acae52070d18499b26c5c6e426cff3ef3",
    },
    product: "Gas",
    mission: "Quarterly",
    episode: {
      kind: "VALIDATION_EPISODE",
      maturity,
      method: "Each historical contract maturity forms a validation episode under the current mandate (01_campaigns/gas_quarterly.md \"Validation interpretation\"; P-006 puntos 2-4, 7)",
    },
    guards: {
      totalObligationIsPerBuySizing: false,
      benchmarkWindowIsExecutionPermission: false,
      unknownTerminalRuleFabricatesCloseOutFill: false,
      assumedMwToMwhConversion: false,
      missionsShareCoverage: false,
      selectiveEpisodeEvaluation: false,
    },
    facts,
    // §24 DEP-02: elepisode abre en 0 MW con mapa materializado vacío; la
    // asignación se materializa con cada fill del ledger del episodio. Los
    // llenados de la Mission Monthly no entra aquí (P-006 punto 5).
    coverageOwnership: {
      mapState: "MATERIALIZED",
      obligationId,
      assignments: [],
      authority: `${CLIENT_PACKAGE_CONFIRMATION.authority}; ${OWNER_P006_CONFIRMATION.authority}`,
      locator: `ESTADO_INPUTS.csv fila "Initial position" (episodio ${maturity}); decision del owner 23-sep-2026 (puntos 5-6)`,
      relationMonthlyQuarterly: {
        availability: "AVAILABLE_NOW",
        relationType: "ADDITIONAL",
        value: CLIENT_PACKAGE_SOURCES.relationSeparateMissions.quote,
        authority: CLIENT_PACKAGE_SOURCES.relationSeparateMissions.authority,
        locator: CLIENT_PACKAGE_SOURCES.relationSeparateMissions.locator,
      },
    },
  };
  // §25.1 IMP-02: la ficha declara qué parte del acceptance test puede
  // determinar con sus facts y qué no, sin afirmar lo no determinado.
  ficha.acceptanceCriterion = evaluateImp02Acceptance(ficha);
  return ficha;
}
