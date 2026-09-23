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
  validateOwnershipAssignments,
  validateRelationDeclaration,
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

// §24 DEP-02: la ficha materializa el estado de la relación Monthly/Quarterly
// y del mapa de asignación fill→obligación. El mapa sin materializar exige
// razón documentada; materializado exige assignments y provenance. La
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

  // §4.1 tabla (Confirmación de Bru, 2026-09-22): el total conocido de la
  // ficha no contradice la cantidad confirmada para su producto/Mission.
  const total = availableFact(factsById, "campaign.obligation.totalVolumeKnown");
  const confirmed = confirmedQuantityFor(ficha.product, ficha.mission);
  if (total && confirmed && (total.value !== confirmed.quantity || total.unit !== confirmed.unit)) {
    errors.push({ factId: "campaign.obligation.totalVolumeKnown", code: "CONFIRMED_QUANTITY_MISMATCH", message: `El total ${total.value} ${total.unit} contradice la cantidad confirmada ${confirmed.quantity} ${confirmed.unit} para ${ficha.product} ${ficha.mission} (§4.1).` });
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
  // mismo mapa; no pueden tener estados distintos.
  const assignmentAvailable = Boolean(availableFact(factsById, "campaign.coverage.fillToObligationAssignment"));
  const mapMaterialized = ficha.coverageOwnership?.mapState === "MATERIALIZED";
  if (assignmentAvailable !== mapMaterialized) {
    errors.push({ factId: "campaign.coverage.fillToObligationAssignment", code: "OWNERSHIP_STATE_INCOHERENT", message: "La fact de asignación fill→obligación y coverageOwnership.mapState no coinciden (DEP-02)." });
  }
}

// §25.1 IMP-02, acceptance test: "Se determina remaining volume/deadline sin
// inferir unidades; una cobertura no pertenece dos veces a obligaciones."
// El estado de cada parte se deriva de las facts; la ficha no puede afirmarlo
// por su cuenta. Lo no determinable queda nombrado con lo que lo bloquea.
export const IMP02_ACCEPTANCE_TEST = "Se determina remaining volume/deadline sin inferir unidades; una cobertura no pertenece dos veces a obligaciones.";

function unavailableFactIds(factsById, factIds) {
  return factIds.filter((factId) => !availableFact(factsById, factId));
}

export function evaluateImp02Acceptance(ficha) {
  const factsById = new Map((Array.isArray(ficha?.facts) ? ficha.facts : []).map((fact) => [fact?.factId, fact]));

  const campaignIdentified = IDENTITY_FACT_IDS.every((factId) => availableFact(factsById, factId));

  const remainingInputs = ["campaign.obligation.totalVolumeKnown", "campaign.obligation.unit", "campaign.coverage.executedVolume", "campaign.coverage.remainingVolume"];
  const identityBlockedBy = campaignIdentified ? [] : ["campaign.identity"];
  const remainingBlockedBy = [...identityBlockedBy, ...unavailableFactIds(factsById, remainingInputs)];
  const remainingFact = availableFact(factsById, "campaign.coverage.remainingVolume");
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
  const deadline = campaignIdentified && deadlineOutcome.determined
    ? { determined: true, value: deadlineOutcome.deadline, blockedBy: [], reason: null }
    : {
      determined: false,
      value: null,
      blockedBy: [...identityBlockedBy, ...(deadlineOutcome.determined ? [] : ["campaign.calendar.deadline"])],
      reason: "No determinable: AUDIT_INPUTS §5 registra el deadline como no encontrado en el alcance inspeccionado; no se infiere (§4.1/§4.2).",
    };

  const relationAvailable = ficha?.coverageOwnership?.relationMonthlyQuarterly?.availability === "AVAILABLE_NOW";
  const mapMaterialized = ficha?.coverageOwnership?.mapState === "MATERIALIZED";
  const ownershipBlockedBy = [
    ...identityBlockedBy,
    ...(mapMaterialized ? [] : ["coverageOwnership.mapState"]),
    ...(relationAvailable ? [] : ["coverageOwnership.relationMonthlyQuarterly"]),
  ];
  const coverageOwnership = campaignIdentified && ownershipBlockedBy.length === 0
    ? { determined: true, blockedBy: [], reason: null }
    : {
      determined: false,
      blockedBy: ownershipBlockedBy,
      reason: "No determinable: sin fills asignados ni relación Monthly/Quarterly auditada no se puede comprobar el no doble conteo (§4.3/DEP-02); AUDIT_INPUTS §5 registra ambos como no encontrados.",
    };

  const criterionMet = campaignIdentified && remainingVolume.determined && deadline.determined && coverageOwnership.determined;
  return {
    acceptanceTest: IMP02_ACCEPTANCE_TEST,
    source: "SPEC v1.1.1 §25.1 IMP-02",
    campaignIdentified,
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
  validateCoverageOwnership(ficha.coverageOwnership, errors);
  validateCrossFieldCoherence(ficha, seen, errors);
  validateAcceptanceDeclaration(ficha, errors);

  const campaignIdentified = IDENTITY_FACT_IDS.every((factId) => availableFact(seen, factId));
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
  if (deadline?.availability === "AVAILABLE_NOW" && isNonEmptyString(deadline.value) && hasProvenance(deadline)) {
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
    missingFact("campaign.identity.productContract", "El producto/contrato exacto no está confirmado; la residencia del cliente no identifica el producto de Gas (§4.1).", "Solicitar el contrato/producto exacto al responsable del mandato."),
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
    missingFact("campaign.obligation.validity", "Falta la vigencia de la obligación (§4.1).", "Recuperar vigencia y enmiendas/cancelaciones del contrato."),
    missingFact("campaign.obligation.campaignLink", "La cantidad confirmada no identifica la campaña a la que pertenece (§4.1).", "Vincular la cantidad a una campaña real."),
    missingFact("campaign.obligation.amendments", "No hay enmiendas/cancelaciones reales verificadas; su ausencia no se afirma como 'ninguna' (§4.3).", "Recuperar enmiendas/cancelaciones versionadas."),
    missingFact("campaign.calendar.openClose", "Faltan apertura/cierre de campaña (§4.1).", "Recuperar el calendario de procurement real."),
    missingFact("campaign.calendar.decisionOpportunities", "No hay oportunidades de decisión válidas auditadas (§13.4).", "Instanciar oportunidades desde el Procurement Contract auditado."),
    missingFact("campaign.calendar.deadline", "No se encontró el deadline en el alcance inspeccionado (AUDIT_INPUTS §5); no se infiere (§4.1/§4.2).", "Recuperar el deadline contractual."),
    missingFact("campaign.calendar.pauseExclusion", "Falta la estructura de pausa/mes excluido (§13.4).", "Recuperar pausa/exclusión documentada."),
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
