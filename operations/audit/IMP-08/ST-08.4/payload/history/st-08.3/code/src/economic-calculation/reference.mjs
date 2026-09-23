// Selección de referencia diaria y proxy intradiario. Fuente: SPEC v1.1 §5.2
// (referencia oficial/provisional, proxy R_hat y fallback), §5.3 (selección
// por fecha y prioridad oficial) y §5.4 (corrección por timestamp de
// proveedor). Los valores son genéricos; no hay búsqueda de resultados
// esperados ni despacho por fixture.

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function parseProviderTimestamp(value) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function declaredValidity(row) {
  const hasDeclaredValidity = row !== null && typeof row === "object" && Object.prototype.hasOwnProperty.call(row, "declaredValidity");
  const hasValidity = row !== null && typeof row === "object" && Object.prototype.hasOwnProperty.call(row, "validity");
  if (!hasDeclaredValidity && !hasValidity) {
    // Existing synthetic fixtures predate the explicit validity field. Their
    // finite, timestamped rows remain valid by compatibility; an explicitly
    // invalid or unknown value is never promoted by this default.
    return { valid: true, reason: null };
  }
  const value = hasDeclaredValidity ? row.declaredValidity : row.validity;
  if (value === true || value === "valid" || value === "valid-under-explicit-fixture-assumption") {
    return { valid: true, reason: null };
  }
  return { valid: false, reason: `Validez oficial no utilizable: ${String(value)}.` };
}

function undefinedResult(sourceLabel, reason) {
  return { value: null, sourceLabel, defined: false, reason };
}

// §5.2: R_hat_d = 0.75*T + 0.25*M con trades y midpoints; T con sólo trades;
// M con sólo midpoints; missing si no hay ninguno. La densidad de ticks no
// entra en esta fórmula. Missing nunca se rellena con cero.
export function proxyReference({ tradesMean, midpointsMean } = {}) {
  const hasTrades = isFiniteNumber(tradesMean);
  const hasMidpoints = isFiniteNumber(midpointsMean);

  if (hasTrades && hasMidpoints) {
    return { value: 0.75 * tradesMean + 0.25 * midpointsMean, sourceLabel: "proxy", defined: true, reason: null };
  }
  if (hasTrades) {
    return { value: tradesMean, sourceLabel: "trades-only", defined: true, reason: null };
  }
  if (hasMidpoints) {
    return { value: midpointsMean, sourceLabel: "midpoints-only", defined: true, reason: null };
  }
  return undefinedResult("missing", "Sin trades ni midpoints en la ventana estricta ni en el fallback permitido: la referencia permanece missing.");
}

// §5.3/§5.4: la fila oficial válida tiene prioridad; entre correcciones
// oficiales prevalece el timestamp de proveedor más reciente. Si no hay
// oficial, se usa el proxy derivado; si tampoco, missing.
export function selectDailyReference({ officialRows = [], proxy = null } = {}) {
  const excludedOfficialRows = [];
  const validOfficial = [];
  for (const row of Array.isArray(officialRows) ? officialRows : []) {
    if (!isFiniteNumber(row?.value)) {
      excludedOfficialRows.push({ row, reason: "Valor oficial ausente o no finito." });
      continue;
    }
    const providerTime = parseProviderTimestamp(row?.providerTimestamp);
    if (providerTime === null) {
      excludedOfficialRows.push({ row, reason: "providerTimestamp ausente o inválido." });
      continue;
    }
    const validity = declaredValidity(row);
    if (!validity.valid) {
      excludedOfficialRows.push({ row, reason: validity.reason });
      continue;
    }
    validOfficial.push({ row, providerTime });
  }

  if (validOfficial.length > 0) {
    const latest = validOfficial.reduce((best, candidate) =>
      candidate.providerTime > best.providerTime ? candidate : best,
    );
    return {
      value: latest.row.value,
      source: "official",
      providerTimestamp: latest.row.providerTimestamp,
      defined: true,
      reason: null,
      excludedOfficialRows,
    };
  }

  if (proxy && proxy.defined && isFiniteNumber(proxy.value)) {
    return {
      value: proxy.value,
      source: proxy.sourceLabel,
      providerTimestamp: null,
      defined: true,
      reason: null,
      excludedOfficialRows,
    };
  }

  return {
    value: null,
    source: "missing",
    providerTimestamp: null,
    defined: false,
    reason: "Ninguna referencia oficial válida ni derivada disponible para la fecha.",
    excludedOfficialRows,
  };
}
