// Immutable ledgers P6.4 (IMP-12). Fuente: SPEC v1.1.1 §14.4 (campos
// conceptuales de decision/execution ledgers; filas append-only dentro de cada
// run; no se cuentan costes dos veces, no se fabrican fills con precios
// favorables y no se eliminan residuos de partial fills) y §14.5 (coverage /
// remaining-volume ledger con reconciliación Opening = Executed + Remaining).

export const DECISION_LEDGER_FIELDS = [
  "sequence", "decisionTimestamp", "frontier", "armVersion", "policyVersion", "action",
  "requestedQuantity", "reason", "statusCodes", "pitReferences",
];

export const EXECUTION_LEDGER_FIELDS = [
  "sequence", "requestId", "decisionTimestamp", "eligibleExecutionTimestamp",
  "requestedQuantity", "filledQuantity", "partialQuantity", "noFill", "executionPrice",
  "executionCosts", "lotRoundingTreatment", "executionContractVersion",
];

export const COVERAGE_LEDGER_FIELDS = [
  "sequence", "asOfDate", "requestedQuantity", "filledQuantity", "noFillQuantity",
  "executedVolume", "remainingVolume", "conservation", "unit",
];

// Un ledger es append-only dentro del run: appendRow añade una copia nueva y
// no existe operación de borrado/reescritura/reorden (§14.4). snapshot()
// entrega filas congeladas y separadas del acumulador interno.
export function createImmutableLedger(ledgerId, fields) {
  const rows = [];
  const ledger = {
    ledgerId,
    fields,
    rowCount() {
      return rows.length;
    },
    appendRow(row) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        return { ok: false, code: "INVALID_LEDGER_ROW" };
      }
      rows.push({ ...row });
      return { ok: true };
    },
    snapshot() {
      return rows.map((row) => Object.freeze({ ...row }));
    },
  };
  return ledger;
}

// §14.5: la cobertura cambia por filled quantity, nunca por requested; cada
// paso nota la regla de conservación que debe reconciliar al cierre.
export function coverageLedgerRow({ sequence, asOfDate, requestedQuantity, filledQuantity, noFillQuantity, executedVolume, remainingVolume, unit }) {
  return {
    sequence, asOfDate, requestedQuantity, filledQuantity, noFillQuantity,
    executedVolume, remainingVolume,
    conservation: {
      declaration: "Opening = Executed + Remaining (§14.5)",
      executedVolume,
      remainingVolume,
    },
    unit,
  };
}
