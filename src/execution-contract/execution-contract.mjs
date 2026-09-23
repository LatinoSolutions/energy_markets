// Execution contract P5.6 (IMP-07). Fuente: SPEC v1.1.1 §13.6 (cinco reglas
// frozen de execution and cost parity), §14.2 (required input "Execution:
// P5.6 execution-contract version"), §14.4 (campos del execution ledger) y
// §4.1 (lotes/redondeo AUDIT-DEPENDENT). El objetivo de IMP-07 es poblar y
// versionar el contrato aplicable a ambos brazos: cada coste entra una vez,
// ningún fill usa un precio no disponible o futuro elegido a conveniencia, y
// la paridad A0/A1 se mantiene.
//
// Los valores reales provienen del paquete verificado del cliente
// ENERGY_MARKETS_CLIENT_INPUTS_2026-09-23 (02_execution_costs/* y
// 01_campaigns/01_shared_campaign_rules.md). Lo que el paquete no entrega
// queda UNKNOWN con su razón; nunca se sustituye por cero (§13.6 regla 4;
// OFICINA.md: "Fees adicionales siguen unknown/excluded, nunca cero").
//
// REGLA 2 (simplificación marcada al instante): el contentHash usa una
// serialización JSON canónica propia. La SPEC v1.1.1 no fija serialización
// canónica; es PLACEHOLDER hasta que un audit la fije, igual que en IMP-06.

import { createHash } from "node:crypto";

import { isVersionLike } from "../contracts/identities.mjs";

export const IMP07_ACCEPTANCE_TEST = "Cada coste entra una vez; ningún fill requiere precio anterior no disponible o futuro seleccionado a conveniencia.";

// §13.6: las cinco reglas frozen. Son la parte conceptual ya cerrada; el
// contrato las declara todas y el validador rechaza un contrato que omita una.
export const P56_FROZEN_RULES = [
  {
    id: "CAUSAL_EXECUTION",
    section: "§13.6 regla 1",
    text: "fills únicamente con precios elegibles después de conocerse BUY; no future minimum, selección retrospectiva ni precio no disponible en la frontera correspondiente.",
  },
  {
    id: "SINGLE_COST_ACCOUNTING",
    section: "§13.6 regla 2",
    text: "cada economic execution cost se incorpora exactamente una vez a H.",
  },
  {
    id: "OPERATIONAL_PARITY",
    section: "§13.6 regla 3",
    text: "latency, fill rules, partials, lots, rounding y tratamiento del residual son idénticos entre brazos.",
  },
  {
    id: "NO_INVENTED_DEFAULTS",
    section: "§13.6 regla 4",
    text: "costes o restricciones desconocidos no se sustituyen por cero o valores arbitrarios para producir resultados.",
  },
  {
    id: "VALIDITY_GATE",
    section: "§13.6 regla 5",
    text: "los parámetros deben estar auditados y versionados antes de interpretar económicamente el experimento; hasta entonces la interpretación permanece en HOLD.",
  },
];

// §13.6: "Requieren valores reales auditados: latency; spread/slippage; fees;
// fill/partial-fill rules; lot size/rounding y restricciones específicas del
// producto". Cada definición fija la forma mínima del valor; ninguna tiene
// default.
export const EXECUTION_PARAMETER_DEFINITIONS = [
  { key: "decisionTime", kind: "text", unit: null, section: "§13.2/§13.6" },
  { key: "referenceRule", kind: "text", unit: null, section: "§13.6 regla 1" },
  { key: "slippage", kind: "quantity", unit: "EUR/MWh", section: "§13.6" },
  { key: "fillRule", kind: "text", unit: null, section: "§13.6 regla 3" },
  { key: "partialFillModel", kind: "text", unit: null, section: "§14.4" },
  { key: "latency", kind: "text", unit: null, section: "§13.6" },
  { key: "lotSize", kind: "quantity", unit: "MW", section: "§4.1/§13.6" },
  { key: "rounding", kind: "text", unit: null, section: "§4.1/§13.6" },
  { key: "dailyQuantityCap", kind: "quantity", unit: "MW/day", section: "§4.1/§13.6" },
  { key: "fees", kind: "quantity", unit: "EUR/MWh", section: "§13.6 regla 4" },
];

export const PARAMETER_STATUSES = ["AUDITED", "PROVISIONAL", "UNKNOWN"];

// Provenance del paquete del cliente: la autoridad es Fundamental (cliente) y
// la verificación de la Oficina está registrada en OFICINA_INTAKE_VERIFICATION.json.
// El locator es el conjunto de archivos que respaldan las citas de los
// parámetros; cada cita debe salir de uno de esos archivos (HT-IMP-07-01).
export const CLIENT_PACKAGE_PROVENANCE = {
  authority: "Fundamental (cliente); paquete ENERGY_MARKETS_CLIENT_INPUTS_2026-09-23 verificado (OFICINA_INTAKE_VERIFICATION.json, 2026-09-23)",
  locator: "02_execution_costs/execution_parameters.csv; 02_execution_costs/execution_and_costs.md; 01_campaigns/01_shared_campaign_rules.md",
};

// La cita de `rounding` es verbatim de ESTADO_INPUTS.csv, que no está en el
// locator por defecto; se declara su locator exacto para no citar un archivo
// ausente (HT-IMP-07-01).
const ESTADO_INPUTS_LOCATOR = "ESTADO_INPUTS.csv";

function clientSource(quote, locator = CLIENT_PACKAGE_PROVENANCE.locator) {
  return { ...CLIENT_PACKAGE_PROVENANCE, locator, quote };
}

// Valores del caso actual Gas Quarterly. AUDITED = valor real con fuente
// inspeccionada; PROVISIONAL = valor presente pero explícitamente provisional
// (pendiente de evidencia empírica); UNKNOWN = sin valor (nunca cero).
export const GAS_QUARTERLY_EXECUTION_PARAMETERS = [
  {
    key: "decisionTime",
    status: "AUDITED",
    value: "11:00 Europe/Berlin",
    unit: null,
    source: clientSource("decision_time,11:00 Europe/Berlin,,Operational rule"),
  },
  {
    key: "referenceRule",
    status: "AUDITED",
    value: "latest top-of-book best ask for the exact contract maturity with timestamp at or before 11:00",
    unit: null,
    source: clientSource("simulated_reference,latest TOB best ask at or before 11:00,,Execution assumption"),
  },
  {
    key: "slippage",
    status: "PROVISIONAL",
    value: 0.15,
    unit: "EUR/MWh",
    source: clientSource("virtual_slippage,0.15,EUR/MWh,Execution assumption,Revisit from actual live fills beginning 2026-11-01"),
  },
  {
    key: "fillRule",
    status: "AUDITED",
    value: "full strategy-requested quantity fills at the simulated execution price, subject to the normal daily quantity constraints",
    unit: null,
    source: clientSource("Assume the full strategy-requested quantity fills at that virtual execution price, subject to the normal daily quantity constraints."),
  },
  {
    key: "partialFillModel",
    status: "AUDITED",
    value: "none; full requested quantity assumed filled (backtest only)",
    unit: null,
    source: clientSource("partial_fill_model,none; full requested quantity assumed filled,,Execution assumption,Backtest only"),
  },
  {
    key: "latency",
    status: "UNKNOWN",
    value: null,
    unit: null,
    reason: "El paquete del cliente no entrega un valor de latencia auditado; §13.6 exige un valor real y prohíbe inventarlo (regla 4). El backtest simulado usa la referencia at-or-before 11:00 y no modela latencia, lo que no es un valor auditado.",
    source: clientSource("No latency value in execution_parameters.csv"),
  },
  {
    key: "lotSize",
    status: "AUDITED",
    value: 1,
    unit: "MW",
    source: clientSource("trade_increment,1,MW,Operational rule"),
  },
  {
    key: "rounding",
    status: "AUDITED",
    value: "1 MW minimum and 1 MW increments",
    unit: null,
    source: clientSource("Lot / quantity increment: 1 MW minimum and 1 MW increments.", ESTADO_INPUTS_LOCATOR),
  },
  {
    key: "dailyQuantityCap",
    status: "PROVISIONAL",
    value: 12,
    unit: "MW/day",
    source: clientSource("normal_max_mw_per_day,12,MW/day,Provisional research/execution parameter,Pending empirical slippage/liquidity evidence"),
  },
  {
    key: "fees",
    status: "UNKNOWN",
    value: null,
    unit: null,
    excluded: true,
    reason: "Brokerage, exchange, clearing or other fees are unknown / excluded pending evidence. No se representan como coste cero (02_execution_costs/execution_and_costs.md §4).",
    source: clientSource("other_fees,unknown / excluded pending evidence,,Unknown,Do not represent as zero"),
  },
];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function hasProvenance(entry) {
  const source = entry?.source;
  return source !== null
    && typeof source === "object"
    && isNonEmptyString(source.authority)
    && isNonEmptyString(source.locator);
}

function pushError(errors, field, code, message) {
  errors.push({ field, code, message });
}

// PLACEHOLDER (REGLA 2): serialización canónica propia; la SPEC no la fija.
function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const members = Object.keys(value).sort().map((name) => `${JSON.stringify(name)}:${canonicalJson(value[name])}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function contentHashOf(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

// Clave canónica de una versión (string o content-hash) para comparar paridad.
export function versionKeyOf(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && typeof value.contentHash === "string") {
    return `hash:${value.contentHash}`;
  }
  return null;
}

// Contrato P5.6 del caso Gas Quarterly, poblado con el paquete del cliente y
// versionado. No es P5.6 válido: slippage y daily cap son provisionales y
// latency/fees siguen UNKNOWN, así que la interpretación económica es HOLD.
export function createGasQuarterlyExecutionContract() {
  const frozenRules = P56_FROZEN_RULES.map((rule) => rule.id);
  const parameters = GAS_QUARTERLY_EXECUTION_PARAMETERS.map((entry) => ({ ...entry }));
  return {
    contractId: "EXEC-GAS-Q-P5.6",
    product: "Gas",
    mission: "Quarterly",
    contractVersion: "v1.0",
    versionStatus: "PROVISIONAL",
    frozenRules,
    parameters,
    contentHash: contentHashOf({ frozenRules, parameters }),
  };
}

export function executionParameterOf(contract, key) {
  return (contract?.parameters ?? []).find((entry) => entry?.key === key) ?? null;
}

function validateParameter(parameter, definition, errors) {
  if (!parameter || typeof parameter !== "object" || Array.isArray(parameter)) {
    pushError(errors, definition.key, "INVALID_PARAMETER", `"${definition.key}" no es un objeto de parámetro.`);
    return;
  }
  if (!PARAMETER_STATUSES.includes(parameter.status)) {
    pushError(errors, definition.key, "UNKNOWN_PARAMETER_STATUS", `"${definition.key}" usa un status no declarado: ${parameter.status}.`);
    return;
  }
  if (Object.prototype.hasOwnProperty.call(parameter, "default")) {
    pushError(errors, definition.key, "INVENTED_DEFAULT", `"${definition.key}" no puede declarar un default inventado (§13.6 regla 4).`);
  }

  if (parameter.status === "UNKNOWN") {
    if (parameter.value === 0) {
      pushError(errors, definition.key, "INVENTED_ZERO_COST", `"${definition.key}" desconocido no puede valer cero (§13.6 regla 4).`);
    } else if (parameter.value !== null && parameter.value !== undefined) {
      pushError(errors, definition.key, "INVENTED_VALUE", `"${definition.key}" está UNKNOWN pero trae un valor.`);
    }
    if (!isNonEmptyString(parameter.reason)) {
      pushError(errors, definition.key, "MISSING_REASON", `"${definition.key}" está UNKNOWN sin razón documentada.`);
    }
    return;
  }

  if (definition.kind === "text") {
    if (!isNonEmptyString(parameter.value)) {
      pushError(errors, definition.key, "VALUE_TYPE_MISMATCH", `"${definition.key}" es texto y su valor no es texto.`);
    }
  } else {
    if (!isFiniteNonNegativeNumber(parameter.value)) {
      pushError(errors, definition.key, "VALUE_TYPE_MISMATCH", `"${definition.key}" es una cantidad y su valor debe ser un número finito no negativo.`);
    }
    if (!isNonEmptyString(parameter.unit)) {
      pushError(errors, definition.key, "QUANTITY_WITHOUT_UNIT", `"${definition.key}" es una cantidad sin unidad.`);
    } else if (definition.unit && parameter.unit !== definition.unit) {
      pushError(errors, definition.key, "UNIT_INCOHERENT", `"${definition.key}" está en ${parameter.unit} y su definición exige ${definition.unit}.`);
    }
  }

  if (!hasProvenance(parameter)) {
    pushError(errors, definition.key, "NO_PROVENANCE", `"${definition.key}" no tiene autoridad y locator.`);
  }
}

// Valida el contrato completo: reglas frozen presentes, parámetros con forma y
// provenance, y ninguna sustitución de un desconocido por cero/default.
export function validateExecutionContract(contract) {
  const errors = [];
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    return { ok: false, errors: [{ field: "contract", code: "MISSING_CONTRACT", message: "Contrato de ejecución ausente." }] };
  }
  if (!isNonEmptyString(contract.contractId)) {
    pushError(errors, "contractId", "MISSING_CONTRACT_ID", "El contrato no declara su identidad.");
  }
  if (!isVersionLike(contract.contractVersion)) {
    pushError(errors, "contractVersion", "MISSING_VERSION", "El contrato no declara versión congelable (§14.2).");
  }
  if (Object.prototype.hasOwnProperty.call(contract, "default")) {
    pushError(errors, "default", "INVENTED_DEFAULT", "El contrato no puede declarar un default inventado (§13.6 regla 4).");
  }

  const ruleIds = Array.isArray(contract.frozenRules) ? contract.frozenRules : [];
  for (const rule of P56_FROZEN_RULES) {
    if (!ruleIds.includes(rule.id)) {
      pushError(errors, "frozenRules", "MISSING_FROZEN_RULE", `Falta la regla frozen "${rule.id}" (${rule.section}).`);
    }
  }

  const seenKeys = new Set();
  for (const parameter of Array.isArray(contract.parameters) ? contract.parameters : []) {
    if (parameter && typeof parameter === "object" && typeof parameter.key === "string") {
      if (seenKeys.has(parameter.key)) {
        pushError(errors, parameter.key, "DUPLICATE_PARAMETER", `"${parameter.key}" está declarado más de una vez; una sola verdad por parámetro.`);
      }
      seenKeys.add(parameter.key);
    }
  }

  for (const definition of EXECUTION_PARAMETER_DEFINITIONS) {
    const parameter = executionParameterOf(contract, definition.key);
    if (!parameter) {
      pushError(errors, definition.key, "MISSING_PARAMETER", `Falta el parámetro "${definition.key}" exigido por §13.6 (${definition.section}).`);
      continue;
    }
    validateParameter(parameter, definition, errors);
  }

  return { ok: errors.length === 0, errors };
}

// §13.6 regla 5: la interpretación económica es HOLD hasta que todos los
// parámetros estén auditados y versionados. Un valor provisional o desconocido
// bloquea; no se eleva el contrato a válido por tener un valor numérico.
export function evaluateP56Validity(contract) {
  const outcome = validateExecutionContract(contract);
  if (!outcome.ok) {
    return {
      valid: false,
      status: "HOLD",
      blockers: [{ parameter: null, status: "INVALID_CONTRACT", reason: "El contrato no satisface su propio schema." }],
      errors: outcome.errors,
      reason: "§13.6 regla 5: un contrato inválido no habilita interpretación económica.",
    };
  }
  const blockers = [];
  for (const parameter of contract.parameters) {
    if (parameter.status === "AUDITED") {
      continue;
    }
    blockers.push({
      parameter: parameter.key,
      status: parameter.status,
      reason: parameter.status === "PROVISIONAL"
        ? `Valor provisional pendiente de evidencia real; no se reclama P5.6 válido (§13.6 regla 5).`
        : `Parámetro sin valor auditado; no se sustituye por cero ni por un supuesto (§13.6 regla 4).`,
    });
  }
  const valid = blockers.length === 0;
  return {
    valid,
    status: valid ? "READY" : "HOLD",
    blockers,
    errors: [],
    reason: valid
      ? null
      : "§13.6 regla 5: hasta que los parámetros estén auditados y versionados, la interpretación económica permanece en HOLD.",
  };
}

// §13.6 regla 3: ambos brazos comparten el mismo execution contract y el mismo
// cost ledger. Un brazo que apunte a otra versión rompe la paridad.
export function assertArmParity({ a0, a1 } = {}) {
  const errors = [];
  const checks = [
    ["executionContractVersion", a0?.executionContractVersion, a1?.executionContractVersion],
    ["costLedgerVersion", a0?.costLedgerVersion, a1?.costLedgerVersion],
  ];
  for (const [field, left, right] of checks) {
    const leftKey = versionKeyOf(left);
    const rightKey = versionKeyOf(right);
    if (leftKey === null || rightKey === null) {
      pushError(errors, field, "MISSING_VERSION", `Ambos brazos deben declarar ${field} con forma de versión.`);
    } else if (leftKey !== rightKey) {
      pushError(errors, field, "PARITY_VIOLATION", `A0 usa ${leftKey} y A1 usa ${rightKey}; la paridad operacional exige la misma versión (§13.6 regla 3).`);
    }
  }
  return { ok: errors.length === 0, errors };
}
