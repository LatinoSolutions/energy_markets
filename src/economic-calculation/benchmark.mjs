// Benchmark B, cobertura, ventanas documentales, fallback y consumibilidad.
// Fuente: SPEC v1.1 §5.3 (B_t=(1/|D_t|)sum R_d, peso diario igual, ventanas
// 1-0-1 / 3-1-3, missing y cobertura), §5.2 (fallback ±60 min y consumo
// posterior a 17:15), §5.4 (guard 0.01 como caso de audit) y §6.1
// (publicado ≠ consumible). Cálculo genérico; sin resultados hardcodeados.

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function parseBoundary(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowMatchesDate(row, windowStart, windowEnd) {
  if (windowStart === null && windowEnd === null) {
    return true;
  }
  const timestamp = parseBoundary(row?.date);
  const start = parseBoundary(windowStart);
  const end = parseBoundary(windowEnd);
  if (timestamp === null || (windowStart !== null && start === null) || (windowEnd !== null && end === null)) {
    return false;
  }
  return (start === null || timestamp >= start) && (end === null || timestamp < end);
}

function rowIsAccessible(row) {
  return row?.accessible === true || row?.accessibility === "accessible" || row?.availability === "accessible";
}

function sameFiniteSelection(rows) {
  const selected = rows.filter((row) => isFiniteNumber(row?.selected));
  if (selected.length < 2) {
    return { selected: selected[0] ?? null, conflict: false };
  }
  const first = selected[0].selected;
  const conflict = selected.some((row) => row.selected !== first);
  return { selected: conflict ? null : selected[0], conflict };
}

// Capture-row selection used by the public benchmark path. Filters are
// explicit: exact product, [start,end) dates and a caller-declared accessible
// row. Equal duplicate observations on one trading date collapse to one row;
// conflicting duplicates reject the input instead of double weighting it.
export function selectBenchmarkReferences({
  rows = [],
  product = null,
  windowStart = null,
  windowEnd = null,
  requireAccessible = false,
} = {}) {
  if (!Array.isArray(rows)) {
    return { references: [], excludedRows: [], rejected: true, reason: "Las filas de referencia deben ser una lista explícita." };
  }

  const excludedRows = [];
  const eligible = [];
  for (const row of rows) {
    if (product !== null && row?.product !== product) {
      excludedRows.push({ row, reason: "Producto fuera del filtro exacto." });
      continue;
    }
    if (!rowMatchesDate(row, windowStart, windowEnd)) {
      excludedRows.push({ row, reason: "Fecha fuera del filtro [inicio,fin) o inválida." });
      continue;
    }
    if (requireAccessible && !rowIsAccessible(row)) {
      excludedRows.push({ row, reason: "Fila no marcada como accesible." });
      continue;
    }
    eligible.push(row);
  }

  const groups = new Map();
  const withoutDate = [];
  for (const row of eligible) {
    if (typeof row?.date !== "string" || row.date.length === 0) {
      withoutDate.push(row);
      continue;
    }
    const group = groups.get(row.date) ?? [];
    group.push(row);
    groups.set(row.date, group);
  }

  const references = [...withoutDate];
  const deduplicatedDates = [];
  const conflictingDates = [];
  for (const [date, group] of groups) {
    const result = sameFiniteSelection(group);
    if (result.conflict) {
      conflictingDates.push(date);
      continue;
    }
    if (result.selected) {
      references.push(result.selected);
      if (group.length > 1) {
        deduplicatedDates.push(date);
      }
    }
  }

  if (conflictingDates.length > 0) {
    return {
      references: [],
      excludedRows,
      rejected: true,
      conflictingDates,
      deduplicatedDates,
      reason: `Duplicados diarios conflictivos rechazados: ${conflictingDates.join(", ")}.`,
    };
  }

  references.sort((left, right) => String(left?.date ?? "").localeCompare(String(right?.date ?? "")));
  return { references, excludedRows, rejected: false, conflictingDates: [], deduplicatedDates, reason: null };
}

// §5.3: B_t = media con peso diario igual de las referencias seleccionadas de
// la ventana. Las fechas missing no entran en el denominador, no se rellenan
// con cero y la cobertura se informa por separado.
export function benchmarkB({
  references = [],
  expectedDates = null,
  product = null,
  windowStart = null,
  windowEnd = null,
  requireAccessible = false,
} = {}) {
  const filtered = selectBenchmarkReferences({
    rows: references,
    product,
    windowStart,
    windowEnd,
    requireAccessible,
  });
  if (filtered.rejected) {
    return {
      B: null,
      count: 0,
      sum: null,
      coverage: expectedDates === null ? null : `0/${expectedDates}`,
      defined: false,
      rejected: true,
      reason: filtered.reason,
      excludedRows: filtered.excludedRows,
      conflictingDates: filtered.conflictingDates,
    };
  }

  const included = filtered.references.filter((reference) => isFiniteNumber(reference?.selected));
  const count = included.length;
  const sum = included.reduce((total, reference) => total + reference.selected, 0);
  const defined = count > 0;

  return {
    B: defined ? sum / count : null,
    count,
    sum: defined ? sum : null,
    coverage: expectedDates === null ? null : `${count}/${expectedDates}`,
    defined,
    rejected: false,
    reason: defined ? null : "D_t vacío: B no está definido; no se rellena con cero.",
    excludedRows: filtered.excludedRows,
    deduplicatedDates: filtered.deduplicatedDates,
  };
}

export function benchmarkBFromRows({ rows = [], expectedDates = null, product = null, windowStart = null, windowEnd = null, requireAccessible = true } = {}) {
  return benchmarkB({ references: rows, expectedDates, product, windowStart, windowEnd, requireAccessible });
}

// §5.3: extremo inicial incluido, final excluido. start <= t < end.
export function isWithinWindow(timestamp, windowStart, windowEnd) {
  const t = Date.parse(timestamp);
  const start = Date.parse(windowStart);
  const end = Date.parse(windowEnd);
  if (!Number.isFinite(t) || !Number.isFinite(start) || !Number.isFinite(end)) {
    return false;
  }
  return start <= t && t < end;
}

function localTimeToSeconds(value) {
  if (typeof value !== "string") {
    return null;
  }
  const parts = value.split(":");
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }
  const [hours, minutes, seconds = 0] = parts.map((part) => Number(part));
  if (![hours, minutes, seconds].every(Number.isFinite)) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

// §5.2: W_fallback = {x : |t_x - 17:15| <= 60 min}, extremos incluidos.
export function isWithinFallbackWindow(localTime, { center = "17:15", radiusMinutes = 60 } = {}) {
  const t = localTimeToSeconds(localTime);
  const c = localTimeToSeconds(center);
  if (t === null || c === null || !isFiniteNumber(radiusMinutes)) {
    return false;
  }
  return Math.abs(t - c) <= radiusMinutes * 60;
}

// §5.2/§6.1: una observación posterior a 17:15 sólo entra en una decisión si
// se demuestra su disponibilidad efectiva para la policy. Estar en la
// evaluation view no la vuelve decision-consumible.
export function isDecisionConsumable({ evaluationViewAvailable = false, effectiveAvailabilityDemonstrated = false } = {}) {
  return {
    evaluationViewAvailable: evaluationViewAvailable === true,
    decisionConsumable: effectiveAvailabilityDemonstrated === true,
  };
}

// §5.4: el guard reportado que rechaza 0.01 se registra como limitación de
// implementación/caso de audit, nunca como regla canónica de rechazo. Una
// validez declarada desconocida se excluye del conjunto válido sin ponerla a
// cero; no se afirma validez de mercado real.
export function classifyOfficialValidity({ declaredValidity } = {}) {
  if (declaredValidity === "valid-under-explicit-fixture-assumption") {
    return {
      reportedGuardBehavior: "reject-as-placeholder",
      canonicalRejectionRule: "none",
      fixtureTreatment: "included",
      silentlyZeroed: false,
      marketValidityAsserted: false,
    };
  }
  if (declaredValidity === "unknown-under-explicit-fixture-assumption") {
    return {
      reportedGuardBehavior: "reject-as-placeholder",
      canonicalRejectionRule: "none",
      fixtureTreatment: "flag-and-exclude-until-validity-declared",
      silentlyZeroed: false,
      marketValidityAsserted: false,
    };
  }
  return {
    reportedGuardBehavior: "reject-as-placeholder",
    canonicalRejectionRule: "none",
    fixtureTreatment: "flag-and-exclude-until-validity-declared",
    silentlyZeroed: false,
    marketValidityAsserted: false,
  };
}
