// Cost ledger P5.6 (IMP-07). Fuente: SPEC v1.1.1 §13.6 regla 2 ("cada economic
// execution cost se incorpora exactamente una vez a H"), §14.4 (campos del
// execution ledger: execution price, spread/slippage/fees u otros approved
// execution costs, lot/rounding, execution-contract version) y §5.5 ("cada
// coste económico atribuible entra exactamente una vez"; coste desconocido
// nunca cero).
//
// El ledger es la configuración de costes del contrato: qué costes aplican a
// cada fill. La doble contabilidad se rechaza por identidad de coste
// (kind + appliedTo), no por el valor. Un coste UNKNOWN se conserva como
// UNKNOWN con su razón; representarlo como 0 se rechaza.

import { isVersionLike } from "../contracts/identities.mjs";
import { CLIENT_PACKAGE_PROVENANCE, contentHashOf } from "./execution-contract.mjs";

export const COST_KINDS = [
  "VIRTUAL_SLIPPAGE",
  "BROKERAGE_FEE",
  "EXCHANGE_FEE",
  "CLEARING_FEE",
  "OTHER_FEE",
];

export const COST_STATUSES = ["KNOWN", "UNKNOWN"];

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

function clientSource(quote) {
  return { ...CLIENT_PACKAGE_PROVENANCE, quote };
}

// Configuración de costes del caso Gas Quarterly: el único coste conocido es
// el slippage virtual provisional; los fees restantes quedan UNKNOWN/excluded
// (nunca cero).
export function createGasQuarterlyCostLedger() {
  const entries = [
    {
      costId: "cost.slippage.virtual",
      kind: "VIRTUAL_SLIPPAGE",
      status: "KNOWN",
      amount: 0.15,
      unit: "EUR/MWh",
      appliedTo: "all-fills",
      source: clientSource("virtual_slippage,0.15,EUR/MWh,Execution assumption,Revisit from actual live fills beginning 2026-11-01"),
    },
    {
      costId: "cost.fees.other",
      kind: "OTHER_FEE",
      status: "UNKNOWN",
      amount: null,
      unit: null,
      appliedTo: "all-fills",
      excluded: true,
      reason: "Brokerage, exchange, clearing or other fees are unknown / excluded pending evidence. Do not represent as zero.",
      source: clientSource("other_fees,unknown / excluded pending evidence,,Unknown,Do not represent as zero"),
    },
  ];
  return {
    ledgerId: "COST-GAS-Q-P5.6",
    ledgerVersion: "v1.0",
    contractVersion: "v1.0",
    entries,
    contentHash: contentHashOf(entries),
  };
}

// §13.6 regla 2: cada coste económico entra exactamente una vez. La identidad
// del coste es kind + appliedTo; dos filas con la misma identidad serían doble
// contabilidad aunque una fuera cero.
export function validateCostLedger(ledger) {
  const errors = [];
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) {
    return { ok: false, errors: [{ field: "ledger", code: "MISSING_LEDGER", message: "Cost ledger ausente." }] };
  }
  if (!isNonEmptyString(ledger.ledgerId)) {
    pushError(errors, "ledgerId", "MISSING_LEDGER_ID", "El ledger no declara su identidad.");
  }
  if (!isVersionLike(ledger.ledgerVersion)) {
    pushError(errors, "ledgerVersion", "MISSING_VERSION", "El ledger no declara versión congelable (§14.2).");
  }
  if (!isVersionLike(ledger.contractVersion)) {
    pushError(errors, "contractVersion", "MISSING_VERSION", "El ledger no declara la versión del execution contract que aplica (§14.4).");
  }
  if (Object.prototype.hasOwnProperty.call(ledger, "default")) {
    pushError(errors, "default", "INVENTED_DEFAULT", "El ledger no puede declarar un default inventado (§13.6 regla 4).");
  }

  const entries = Array.isArray(ledger.entries) ? ledger.entries : null;
  if (!entries || entries.length === 0) {
    pushError(errors, "entries", "MISSING_ENTRIES", "El ledger no declara ningún coste.");
    return { ok: errors.length === 0, errors };
  }

  const seenCostIds = new Set();
  const seenAccountingKeys = new Set();
  for (const entry of entries) {
    validateCostEntry(entry, seenCostIds, seenAccountingKeys, errors);
  }

  return { ok: errors.length === 0, errors };
}

function validateCostEntry(entry, seenCostIds, seenAccountingKeys, errors) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    pushError(errors, "entries", "INVALID_COST_ENTRY", "Una fila de coste no es un objeto.");
    return;
  }
  const field = isNonEmptyString(entry.costId) ? entry.costId : "entries";

  if (!isNonEmptyString(entry.costId)) {
    pushError(errors, field, "MISSING_COST_ID", "Una fila de coste no declara costId.");
  } else if (seenCostIds.has(entry.costId)) {
    pushError(errors, field, "DUPLICATE_COST_ID", `costId "${entry.costId}" repetido.`);
  } else {
    seenCostIds.add(entry.costId);
  }

  if (!COST_KINDS.includes(entry.kind)) {
    pushError(errors, field, "UNKNOWN_COST_KIND", `Tipo de coste no declarado: ${entry.kind}.`);
    return;
  }
  if (!isNonEmptyString(entry.appliedTo)) {
    pushError(errors, field, "MISSING_APPLIED_TO", `"${entry.costId}" no declara a qué fills aplica.`);
  }
  if (!COST_STATUSES.includes(entry.status)) {
    pushError(errors, field, "UNKNOWN_COST_STATUS", `"${entry.costId}" usa un status no declarado: ${entry.status}.`);
    return;
  }

  // §13.6 regla 2: identidad contable del coste; misma kind+appliedTo = doble conteo.
  if (isNonEmptyString(entry.kind) && isNonEmptyString(entry.appliedTo)) {
    const accountingKey = `${entry.kind}|${entry.appliedTo}`;
    if (seenAccountingKeys.has(accountingKey)) {
      pushError(errors, field, "DUPLICATE_COST_ACCOUNTING", `El coste ${accountingKey} ya está contabilizado; cada coste entra exactamente una vez (§13.6 regla 2).`);
    } else {
      seenAccountingKeys.add(accountingKey);
    }
  }

  if (entry.status === "UNKNOWN") {
    if (entry.amount === 0) {
      pushError(errors, field, "INVENTED_ZERO_COST", `"${entry.costId}" desconocido no puede valer cero (§13.6 regla 4).`);
    } else if (entry.amount !== null && entry.amount !== undefined) {
      pushError(errors, field, "INVENTED_VALUE", `"${entry.costId}" está UNKNOWN pero trae importe.`);
    }
    if (!isNonEmptyString(entry.reason)) {
      pushError(errors, field, "MISSING_REASON", `"${entry.costId}" está UNKNOWN sin razón documentada.`);
    }
    return;
  }

  if (!isFiniteNonNegativeNumber(entry.amount)) {
    pushError(errors, field, "VALUE_TYPE_MISMATCH", `"${entry.costId}" es un coste KNOWN y su importe debe ser un número finito no negativo.`);
  }
  if (!isNonEmptyString(entry.unit)) {
    pushError(errors, field, "QUANTITY_WITHOUT_UNIT", `"${entry.costId}" es un coste KNOWN sin unidad.`);
  }
  if (!hasProvenance(entry)) {
    pushError(errors, field, "NO_PROVENANCE", `"${entry.costId}" no tiene autoridad y locator.`);
  }
}

// Suma sólo los costes KNOWN con unidad compatible. Un coste UNKNOWN deja el
// total incompleto; no se omite silenciosamente ni se cuenta como cero.
export function sumKnownLedgerCosts(ledger) {
  const entries = Array.isArray(ledger?.entries) ? ledger.entries : [];
  const unknown = entries.filter((entry) => entry?.status !== "KNOWN");
  const known = entries.filter((entry) => entry?.status === "KNOWN");
  if (known.length === 0) {
    return { total: null, unit: null, complete: false, unknownKinds: unknown.map((entry) => entry.kind), reason: "No hay ningún coste KNOWN; el total no es cero, es indeterminado (§13.6 regla 4)." };
  }
  const units = new Set(known.map((entry) => entry.unit));
  if (units.size > 1) {
    return { total: null, unit: null, complete: false, unknownKinds: unknown.map((entry) => entry.kind), reason: "Los costes KNOWN no comparten unidad; el total no es computable sin conversión." };
  }
  const total = known.reduce((sum, entry) => sum + entry.amount, 0);
  return {
    total,
    unit: known[0]?.unit ?? null,
    complete: unknown.length === 0,
    unknownKinds: unknown.map((entry) => entry.kind),
    reason: unknown.length === 0 ? null : `Costes sin valor auditable: ${unknown.map((entry) => entry.kind).join(", ")}.`,
  };
}
