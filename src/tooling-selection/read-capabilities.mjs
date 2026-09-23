// Contrato de salidas de las capacidades de LECTURA que IMP-05 consume.
// Fuente: SPEC v1.1.1 §5.2 (T̂ es la media de los precios p_i y M̂ la de
// m_j=(bid_j+ask_j)/2, sobre «filas accesibles y deduplicadas del producto y
// fecha exactos» dentro de la ventana 17:05–17:15 (Power) / 17:00–17:15 (Gas)),
// §5.3 (R_d^official: «La fila oficial válida tiene prioridad; entre
// correcciones oficiales prevalece el timestamp de proveedor más reciente») y
// §19.3.1 («Oficial 0.01»: «Probar el guard reportado y contrastar validez
// aplicable»). Un componente no puede declarar una capacidad de lectura sin
// exponer en su interfaz TODAS las salidas que la capacidad exige: si al
// contrato le falta la validez de la fila oficial, no puede acreditar que la
// fila elegida sea válida y la lectura oficial conserva su bloqueo (review
// IMP-04 2026-09-23, revisión 10).

export const REFERENCE_READ_REQUIRED_OUTPUTS = Object.freeze({
  "reference.read.trades": Object.freeze(["trade.price", "trade.eventTime", "trade.instrument", "trade.shortCode", "trade.maturity", "trade.tradeDate", "trade.rowHash"]),
  "reference.read.top_of_book": Object.freeze(["topOfBook.bid", "topOfBook.ask", "topOfBook.eventTime", "topOfBook.instrument", "topOfBook.shortCode", "topOfBook.maturity", "topOfBook.tradeDate", "topOfBook.rowHash"]),
  "reference.read.official": Object.freeze(["official.dailySettlementPrice", "official.providerTimestamp", "official.declaredValidity", "official.tradeDate", "official.instrument"]),
});

// Un assessment que declare una capacidad de lectura debe exponer todas las
// salidas exigidas. Sin esto, un componente podía declararse suficiente para
// `reference.read.official` sin acreditar la validez de la fila, y una fila
// 0.01 sin declaración de validez se seleccionaba como oficial (review IMP-04
// 2026-09-23, revisión 10).
export function readCapabilityContractErrors(assessment) {
  const errors = [];
  const declared = Array.isArray(assessment?.declaredCapabilities) ? assessment.declaredCapabilities : [];
  const outputs = new Set(Array.isArray(assessment?.interfaceContract?.outputs) ? assessment.interfaceContract.outputs : []);
  for (const capability of declared) {
    const required = REFERENCE_READ_REQUIRED_OUTPUTS[capability];
    if (!required) {
      continue;
    }
    const missing = required.filter((outputId) => !outputs.has(outputId));
    if (missing.length > 0) {
      errors.push({
        field: "interfaceContract.outputs",
        code: "READ_CAPABILITY_OUTPUTS_MISSING",
        message: `La capacidad de lectura "${capability}" exige exponer todas sus salidas; faltan en la interfaz.`,
        capability,
        missing,
      });
    }
  }
  return errors;
}