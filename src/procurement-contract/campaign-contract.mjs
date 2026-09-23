// Ficha de campaña y contrato de obligación. Fuente: SPEC v1.1.1 §4.1
// (inputs del contrato de campaña, tabla de cantidades confirmadas 10/10/60/20
// MW y su alcance), §4.2 (BUY/WAIT separado del sizing) y §4.3 (identidad de
// reconciliación y conducta ante ausencia de terminal rule). Regla del trabajo:
// incorporar los datos confirmados por el owner y dejar todo lo demás como
// faltante explícito; nunca inventar producto, delivery, calendario ni unidad.

import { STATE_NAMESPACES } from "../contracts/states.mjs";

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

export function confirmedQuantityFor(product, mission) {
  const match = CONFIRMED_OBLIGATIONS.find((entry) => entry.product === product && entry.mission === mission);
  return match ? { quantity: match.quantity, unit: match.unit, source: match.source } : null;
}

// §4.1 inputs del contrato de campaña. `kind: "quantity"` exige unidad; el
// resto sólo exige contenido no vacío. Ningún campo tiene default.
export const CAMPAIGN_CONTRACT_FACTS = [
  { factId: "campaign.identity.campaignId", section: "Identidad", kind: "text" },
  { factId: "campaign.identity.productContract", section: "Identidad", kind: "text" },
  { factId: "campaign.identity.productFamily", section: "Identidad", kind: "text" },
  { factId: "campaign.identity.mission", section: "Identidad", kind: "text" },
  { factId: "campaign.identity.hubMarket", section: "Identidad", kind: "text" },
  { factId: "campaign.obligation.totalVolumeKnown", section: "Obligación", kind: "quantity" },
  { factId: "campaign.obligation.unit", section: "Obligación", kind: "text" },
  { factId: "campaign.obligation.deliveryPeriod", section: "Obligación", kind: "text" },
  { factId: "campaign.obligation.validity", section: "Obligación", kind: "text" },
  { factId: "campaign.obligation.campaignLink", section: "Obligación", kind: "text" },
  { factId: "campaign.obligation.amendments", section: "Obligación", kind: "text" },
  { factId: "campaign.calendar.openClose", section: "Calendario", kind: "text" },
  { factId: "campaign.calendar.decisionOpportunities", section: "Calendario", kind: "text" },
  { factId: "campaign.calendar.deadline", section: "Calendario", kind: "text" },
  { factId: "campaign.calendar.pauseExclusion", section: "Calendario", kind: "text" },
  { factId: "campaign.feasibility.lots", section: "Factibilidad", kind: "text" },
  { factId: "campaign.feasibility.rounding", section: "Factibilidad", kind: "text" },
  { factId: "campaign.feasibility.terminalCoverageRule", section: "Factibilidad", kind: "text" },
  { factId: "campaign.execution.contract", section: "Ejecución", kind: "text" },
  { factId: "campaign.coverage.executedVolume", section: "Estado de cobertura", kind: "quantity" },
  { factId: "campaign.coverage.remainingVolume", section: "Estado de cobertura", kind: "quantity" },
  { factId: "campaign.coverage.fillToObligationAssignment", section: "Estado de cobertura", kind: "text" },
];

const FACT_BY_ID = new Map(CAMPAIGN_CONTRACT_FACTS.map((fact) => [fact.factId, fact]));
const IDENTITY_FACT_IDS = CAMPAIGN_CONTRACT_FACTS
  .filter((fact) => fact.section === "Identidad")
  .map((fact) => fact.factId);

// §4.1: "MW y MWh son magnitudes distintas. Horas y perfil de entrega deben
// justificar cualquier conversión." Sin horas y perfil no hay conversión.
export function convertMwToMwh({ quantityMw, deliveryHours, deliveryProfile } = {}) {
  if (typeof quantityMw !== "number" || !Number.isFinite(quantityMw)) {
    return { ok: false, code: "MISSING_QUANTITY", mwh: null, reason: "La cantidad en MW no es un número finito." };
  }
  const hasHours = typeof deliveryHours === "number" && Number.isFinite(deliveryHours) && deliveryHours > 0;
  const hasProfile = typeof deliveryProfile === "string" && deliveryProfile.trim().length > 0;
  if (!hasHours || !hasProfile) {
    return {
      ok: false,
      code: "UNIT_INFERENCE_WITHOUT_HOURS_PROFILE",
      mwh: null,
      reason: "MW no se convierte a MWh sin horas y perfil de entrega justificados (§4.1).",
    };
  }
  return { ok: true, code: null, mwh: quantityMw * deliveryHours, reason: null };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isMissingValue(value) {
  return value === null || value === undefined || (typeof value === "string" && value.trim().length === 0);
}

function hasProvenance(fact) {
  const source = fact?.source;
  return source !== null
    && typeof source === "object"
    && isNonEmptyString(source.authority)
    && isNonEmptyString(source.locator);
}

// Una fact AVAILABLE_NOW exige valor, escala y provenance. Un `quantity` exige
// unidad explícita: sin ella la cantidad no es ejecutable.
function validateAvailableFact(fact, definition, errors) {
  if (isMissingValue(fact.value)) {
    errors.push({ factId: fact.factId, code: "AVAILABLE_WITHOUT_VALUE", message: `"${fact.factId}" está AVAILABLE_NOW pero no aporta valor.` });
  }
  if (definition.kind === "quantity" && !isNonEmptyString(fact.unit)) {
    errors.push({ factId: fact.factId, code: "QUANTITY_WITHOUT_UNIT", message: `"${fact.factId}" es una cantidad sin unidad; no se asume MW ni MWh.` });
  }
  if (!hasProvenance(fact)) {
    errors.push({ factId: fact.factId, code: "NO_PROVENANCE", message: `"${fact.factId}" está AVAILABLE_NOW sin autoridad y locator.` });
  }
}

// Una fact UNAVAILABLE conserva la razón y nunca lleva un valor fabricado.
function validateUnavailableFact(fact, errors) {
  if (!isMissingValue(fact.value)) {
    errors.push({ factId: fact.factId, code: "INVENTED_VALUE", message: `"${fact.factId}" está UNAVAILABLE pero trae un valor.` });
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
}

// Valida una ficha de campaña completa. Preserva la razón de cada faltante en
// lugar de poblarla; rechaza defaults inventados, unidades asumidas y
// confluencias prohibidas.
export function validateCampaignContract(ficha) {
  const errors = [];

  if (!ficha || typeof ficha !== "object" || Array.isArray(ficha)) {
    return { ok: false, campaignIdentified: false, errors: [{ factId: "(ficha)", code: "MISSING_FICHA", message: "Ficha de campaña ausente." }] };
  }

  const facts = Array.isArray(ficha.facts) ? ficha.facts : null;
  if (facts === null) {
    return { ok: false, campaignIdentified: false, errors: [{ factId: "(ficha)", code: "FACTS_NOT_ARRAY", message: "La ficha no declara una lista de facts." }] };
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

  const campaignIdentified = IDENTITY_FACT_IDS.every((factId) => seen.get(factId)?.availability === "AVAILABLE_NOW");
  return { ok: errors.length === 0, campaignIdentified, errors };
}

function resolveFactAvailability(fact) {
  const declared = AVAILABILITY;
  if (typeof fact.availability !== "string" || !declared.includes(fact.availability)) {
    return { ok: false, code: "UNKNOWN_AVAILABILITY", message: `"${fact.factId}" usa availability no declarada.` };
  }
  return { ok: true };
}

// §4.1/§4.2: la ficha no fija el deadline salvo que el calendario lo aporte.
export function resolveObligationDeadline(ficha) {
  const deadline = (ficha?.facts ?? []).find((fact) => fact.factId === "campaign.calendar.deadline");
  if (deadline?.availability === "AVAILABLE_NOW" && isNonEmptyString(deadline.value)) {
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
    missingFact("campaign.identity.campaignId", "No existe un Campaign ID real en el material auditado (§4.1 declara la identidad AUDIT-DEPENDENT).", "Obtener el registro de campaña firmado que contenga el Campaign ID."),
    missingFact("campaign.identity.productContract", "El producto/contrato exacto no está confirmado; la residencia del cliente no identifica el producto de Gas (§4.1).", "Solicitar el contrato/producto exacto al responsable del mandato."),
    {
      factId: "campaign.identity.productFamily",
      section: "Identidad",
      availability: "AVAILABLE_NOW",
      value: "Gas",
      unit: null,
      source: confirmed.source,
      reason: null,
    },
    {
      factId: "campaign.identity.mission",
      section: "Identidad",
      availability: "AVAILABLE_NOW",
      value: "Quarterly",
      unit: null,
      source: confirmed.source,
      reason: null,
    },
    missingFact("campaign.identity.hubMarket", "No hay mercado/hub aplicable confirmado (§4.1).", "Recuperar el mercado/hub y la liquidación del mandato firmado."),
    {
      factId: "campaign.obligation.totalVolumeKnown",
      section: "Obligación",
      availability: "AVAILABLE_NOW",
      value: confirmed.quantity,
      unit: confirmed.unit,
      source: confirmed.source,
      reason: null,
    },
    missingFact("campaign.obligation.unit", "MW es la unidad comunicada, no una unidad ejecutable completa; no se convierte a MWh sin horas/perfil (§4.1).", "Obtener la unidad contractual y el perfil de entrega."),
    missingFact("campaign.obligation.deliveryPeriod", "Falta el periodo/horas/perfil de entrega (§4.1).", "Recuperar periodo, horas y perfil de entrega del mandato."),
    missingFact("campaign.obligation.validity", "Falta la vigencia de la obligación (§4.1).", "Recuperar vigencia y enmiendas/cancelaciones del contrato."),
    missingFact("campaign.obligation.campaignLink", "La cantidad confirmada no identifica la campaña a la que pertenece (§4.1).", "Vincular la cantidad a una campaña real."),
    missingFact("campaign.obligation.amendments", "No hay enmiendas/cancelaciones reales verificadas; su ausencia no se afirma como 'ninguna' (§4.3).", "Recuperar enmiendas/cancelaciones versionadas."),
    missingFact("campaign.calendar.openClose", "Faltan apertura/cierre de campaña (§4.1).", "Recuperar el calendario de procurement real."),
    missingFact("campaign.calendar.decisionOpportunities", "No hay oportunidades de decisión válidas auditadas (§13.4).", "Instanciar oportunidades desde el Procurement Contract auditado."),
    missingFact("campaign.calendar.deadline", "No hay deadline real; no se infiere (§4.1/§4.2).", "Recuperar el deadline contractual."),
    missingFact("campaign.calendar.pauseExclusion", "Falta la estructura de pausa/mes excluido (§13.4).", "Recuperar pausa/exclusión documentada."),
    missingFact("campaign.feasibility.lots", "Faltan lotes reales; no se asumen (§4.1/§5.6).", "Auditar lotes y redondeos reales."),
    missingFact("campaign.feasibility.rounding", "Falta el redondeo real; no se asume (§4.1/§5.6).", "Auditar redondeo real."),
    missingFact("campaign.feasibility.terminalCoverageRule", "No existe terminal rule válida; sin ella el residual da COVERAGE_INCOMPLETE y no se fabrica fill de cierre (§4.3).", "Recuperar la terminal rule versionada del contrato."),
    missingFact("campaign.execution.contract", "Falta el contrato de ejecución (fills, latencia, fees, slippage) real (§4.1/§5.6).", "Auditar el execution contract aplicable."),
    missingFact("campaign.coverage.executedVolume", "No hay execution ledger real para la campaña (§4.3).", "Producir el ledger de ejecución cuando existan fills."),
    missingFact("campaign.coverage.remainingVolume", "El volumen restante no es computable sin obligación de apertura y volumen ejecutado (§4.3).", "Derivar el restante sólo tras materializar apertura y ejecutado."),
    missingFact("campaign.coverage.fillToObligationAssignment", "No hay fills ni obligaciones reales que asignar sin doble conteo (§4.3/DEP-02).", "Asignar cada fill/cobertura a lo sumo a una obligación."),
  ];

  return {
    artifactKind: "IMP-02_GAS_QUARTERLY_CAMPAIGN_FICHA",
    schemaVersion: "1.1",
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
  };
}
