// IMP-05: extensión del soporte de cálculo del benchmark (decisión EXTEND de
// DEP-10). Cada función cita su fuente: SPEC v1.1.1 §5.2 (proxy intradiario,
// fallback ±60 min), §5.3 (selección por fecha/instrumento, ventanas 1-0-1 /
// 3-1-3, calendario separado), §5.4 (sustitución oficial sin borrar proxy,
// δ_d, BENCHMARK_PROVISIONAL, B versionado) y §19.3.1 (fixtures documentales).
// Cálculo genérico: sin datos reales, sin búsqueda de resultados esperados ni
// despacho por fixture.

import { createHash } from "node:crypto";

import {
  proxyReference,
} from "./reference.mjs";

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// §5.3 «entre correcciones oficiales prevalece el timestamp de proveedor más
// reciente». La validez declarada utilizable incluye el caso de fixture
// explícito; "unknown" y la ausencia de declaración no son una fila oficial
// válida (revisión 11 del assessment DEP-10; §19.3.1 «Oficial 0.01»).
export function officialRowValidity(row) {
  const value = row?.declaredValidity;
  if (value === true || value === "valid" || value === "valid-under-explicit-fixture-assumption") {
    return { valid: true, reason: null };
  }
  if (value === undefined || value === null || value === "") {
    return { valid: false, reason: "Validez oficial no declarada: sin guard de validez la fila no es una fila oficial válida (§5.3)." };
  }
  return { valid: false, reason: `Validez oficial declarada no utilizable: ${String(value)} (§5.3).` };
}

// §5.3 «Para cada fecha de negociación d se selecciona una referencia»:
// agrupa las filas oficiales por fecha e instrumento exactos y elige, dentro
// del grupo, la fila oficial válida con el timestamp de proveedor más
// reciente. Si no hay oficial válida en el grupo, usa el proxy de esa fecha
// que aporta el llamador; si tampoco, missing. El guard de validez es
// estricto: una fila sin `declaredValidity` nunca se promueve a oficial.
// Este es el camino §5.3/IMP-05; el hermano legacy selectDailyReference()
// conserva el default de compatibilidad de los fixtures sintéticos de IMP-08.
export function selectOfficialReferencesByDate({ officialRows = [], proxiesByDate = [] } = {}) {
  const excludedOfficialRows = [];
  const groups = new Map();

  for (const row of Array.isArray(officialRows) ? officialRows : []) {
    const date = typeof row?.date === "string" && row.date.length > 0 ? row.date : null;
    const instrument = row?.instrument ?? null;
    if (date === null || instrument === null) {
      excludedOfficialRows.push({ row, reason: "Fecha de negociación o instrumento ausentes: la selección §5.3 requiere ambos." });
      continue;
    }
    const key = `${date}|${instrument}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const selections = [];
  for (const [key, group] of groups) {
    const separatorIndex = key.indexOf("|");
    const date = key.slice(0, separatorIndex);
    const instrument = key.slice(separatorIndex + 1);

    const validOfficial = [];
    for (const row of group) {
      if (!isFiniteNumber(row?.value)) {
        excludedOfficialRows.push({ row, reason: "Valor de settlement ausente o no finito." });
        continue;
      }
      const parsed = Date.parse(row?.providerTimestamp);
      if (!Number.isFinite(parsed)) {
        excludedOfficialRows.push({ row, reason: "providerTimestamp ausente o inválido: no es decidible la corrección más reciente (§5.3)." });
        continue;
      }
      const validity = officialRowValidity(row);
      if (!validity.valid) {
        excludedOfficialRows.push({ row, reason: validity.reason });
        continue;
      }
      validOfficial.push({ row, providerTime: parsed });
    }

    if (validOfficial.length > 0) {
      const latest = validOfficial.reduce((best, candidate) =>
        candidate.providerTime > best.providerTime ? candidate : best,
      );
      selections.push({
        date,
        instrument,
        value: latest.row.value,
        source: "official",
        providerTimestamp: latest.row.providerTimestamp,
        declaredValidity: latest.row.declaredValidity,
        defined: true,
      });
      continue;
    }

    const proxy = (Array.isArray(proxiesByDate) ? proxiesByDate : [])
      .find((candidate) => candidate?.date === date && (candidate?.instrument === null || candidate?.instrument === undefined || candidate?.instrument === instrument));
    if (proxy && proxy.defined && isFiniteNumber(proxy.value)) {
      selections.push({
        date,
        instrument,
        value: proxy.value,
        source: proxy.sourceLabel ?? "proxy",
        providerTimestamp: null,
        declaredValidity: null,
        defined: true,
      });
      continue;
    }

    selections.push({
      date,
      instrument,
      value: null,
      source: "missing",
      providerTimestamp: null,
      declaredValidity: null,
      defined: false,
      reason: "Ninguna fila oficial válida ni referencia derivada para esa fecha e instrumento.",
    });
  }

  // §5.3: una fecha sin filas oficiales también se selecciona (proxy o
  // missing); la ausencia de fila oficial no la elimina del conjunto.
  const covered = new Set(selections.map((row) => `${row.date}|${row.instrument ?? "*"}`));
  for (const proxy of Array.isArray(proxiesByDate) ? proxiesByDate : []) {
    if (typeof proxy?.date !== "string" || proxy.date.length === 0) {
      continue;
    }
    const key = `${proxy.date}|${proxy.instrument ?? "*"}`;
    const coveredByOfficial = proxy.instrument === null || proxy.instrument === undefined
      ? [...covered].some((entry) => entry.startsWith(`${proxy.date}|`))
      : covered.has(key);
    if (coveredByOfficial) {
      continue;
    }
    covered.add(key);
    const proxyDefined = proxy.defined === true && isFiniteNumber(proxy.value);
    selections.push({
      date: proxy.date,
      instrument: proxy.instrument ?? null,
      value: proxyDefined ? proxy.value : null,
      source: proxyDefined ? proxy.sourceLabel ?? "proxy" : "missing",
      providerTimestamp: null,
      declaredValidity: null,
      defined: proxyDefined,
      reason: proxyDefined ? null : "Ninguna referencia derivada para esa fecha e instrumento.",
    });
  }

  selections.sort((left, right) => `${left.date}|${left.instrument}`.localeCompare(`${right.date}|${right.instrument}`));
  return { selections, excludedOfficialRows };
}

const BERLIN_LOCAL_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Berlin",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

// EEX Tm trae hasta microsegundos; Date sólo guarda milisegundos, así que la
// fracción se lee del texto. El offset CE(S)T es de minutos enteros y no la altera.
const FRACTIONAL_SECONDS = /T\d{2}:\d{2}:\d{2}\.(\d+)/;

// §5.2/§6: conversión UTC/DST según zona Europe/Berlin; Intl resuelve CE(S)T.
// secondsOfDay conserva la fracción: 17:15:00.4 queda fuera de una ventana que
// termina en 17:15:00 (hallazgo BT04-C1-PROXY-WINDOW-DEDUP, 2026-09-25).
export function berlinLocalTimeSecondsFromUtc({ utcTimestamp }) {
  const parsed = Date.parse(utcTimestamp);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const [hours, minutes, seconds] = BERLIN_LOCAL_TIME_FORMATTER
    .formatToParts(parsed)
    .filter((part) => part.type !== "literal")
    .map((part) => Number(part.value));
  if (![hours, minutes, seconds].every(Number.isFinite)) {
    return null;
  }
  const fractionDigits = FRACTIONAL_SECONDS.exec(String(utcTimestamp))?.[1];
  const fraction = fractionDigits === undefined ? 0 : Number(`0.${fractionDigits}`);
  return { hours, minutes, seconds, fraction, secondsOfDay: hours * 3600 + minutes * 60 + seconds + fraction };
}

// §5.2 «17:05–17:15 CE(S)T para German Power y 17:00–17:15 CE(S)T para Gas,
// incluido THE». Ambas cotas tratadas como incluidas (decisión de ingeniería:
// el corpus fija el rango, no su cierre abierto).
export function strictProxyWindowBounds({ productClass }) {
  if (productClass === "power") {
    return { startSeconds: 17 * 3600 + 5 * 60, endSeconds: 17 * 3600 + 15 * 60, label: "17:05-17:15 CE(S)T" };
  }
  if (productClass === "gas") {
    return { startSeconds: 17 * 3600, endSeconds: 17 * 3600 + 15 * 60, label: "17:00-17:15 CE(S)T" };
  }
  return null;
}

// §5.2 «filas deduplicadas»: sólo es duplicado la misma observación de mercado.
// Con `observationKey` (digest de todas las columnas de mercado, lo emite el
// extractor) dos trades distintos con igual Tm y precio no se funden
// (hallazgo BT04-C1-PROXY-WINDOW-DEDUP). Filas sin esa clave caen a la tupla
// (Tm, price, bid, ask), que sí puede fundir filas distintas; el resultado
// expone qué regla se aplicó en `dedupRule`.
export function observationIdentity(row) {
  if (typeof row?.observationKey === "string" && row.observationKey.length > 0) {
    return `key:${row.observationKey}`;
  }
  return `tuple:${JSON.stringify([row?.tmUtc, row?.price, row?.bid, row?.ask].map((value) => String(value ?? "")))}`;
}

// §5.2 proxy intradiario desde filas crudas (trades y top-of-book): filtro por
// producto y fecha de negociación exactos, exclusión de spreads, deduplicación
// de observaciones idénticas, ventana estricta CE(S)T con fallback ±60 min
// (sólo si la estricta está vacía; etiquetado nearby-60m / eex-derived-
// reference), medias m_j=(bid+ask)/2, T̂ y M̂, y combinación proxyReference.
export function intradayProxyReference({
  rows = [],
  product = null,
  trdDate = null,
  productClass = null,
  requireAccessible = true,
} = {}) {
  if (!Array.isArray(rows) || product === null || typeof trdDate !== "string" || trdDate.length === 0) {
    return {
      value: null, defined: false, sourceLabel: "missing",
      windowUsed: "none", label: null, exclusions: [],
      strictCounts: { trades: 0, midpoints: 0 }, fallbackCounts: { trades: 0, midpoints: 0 }, fallbackUsed: false,
      reason: "Filas, producto o fecha de negociación inválidos.",
    };
  }
  const bounds = strictProxyWindowBounds({ productClass });
  if (bounds === null) {
    return {
      value: null, defined: false, sourceLabel: "missing",
      windowUsed: "none", label: null, exclusions: [],
      strictCounts: { trades: 0, midpoints: 0 }, fallbackCounts: { trades: 0, midpoints: 0 }, fallbackUsed: false,
      reason: `Clase de producto no admisible para la ventana estricta: ${String(productClass)}.`,
    };
  }

  const exclusions = [];
  const accessible = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (product !== null && row?.product !== product) {
      exclusions.push({ row, reason: "Producto fuera del filtro exacto." });
      continue;
    }
    if (row?.trdDate !== trdDate) {
      exclusions.push({ row, reason: "Fecha de negociación fuera del filtro exacto." });
      continue;
    }
    if (row?.instrumentType === "Futures Spread") {
      exclusions.push({ row, reason: "Fila de instrumento spread: no entra en el proxy del producto exacto." });
      continue;
    }
    if (requireAccessible && row?.accessible !== true) {
      exclusions.push({ row, reason: "Fila sin accesibilidad declarada (§5.2 «filas accesibles»)." });
      continue;
    }
    accessible.push(row);
  }

  const deduplicated = [];
  const seenIdentities = new Set();
  for (const row of accessible) {
    const identity = observationIdentity(row);
    if (!seenIdentities.has(identity)) {
      seenIdentities.add(identity);
      deduplicated.push(row);
    }
  }
  const keyedRows = accessible.filter((row) => observationIdentity(row).startsWith("key:")).length;
  const dedupRule = accessible.length === 0 ? "none"
    : keyedRows === accessible.length ? "observationKey"
      : keyedRows === 0 ? "content-tuple" : "mixed";

  const FALLBACK_CENTER_SECONDS = 17 * 3600 + 15 * 60;
  const FALLBACK_RADIUS_SECONDS = 60 * 60;

  const inStrict = [];
  const inFallback = [];
  for (const row of deduplicated) {
    const localTime = berlinLocalTimeSecondsFromUtc({ utcTimestamp: row?.tmUtc });
    if (localTime === null) {
      exclusions.push({ row, reason: "Tm UTC ausente o inválido: la ventana CE(S)T no es decidible." });
      continue;
    }
    const secondsOfDay = localTime.secondsOfDay;
    if (secondsOfDay >= bounds.startSeconds && secondsOfDay <= bounds.endSeconds) {
      inStrict.push(row);
      continue;
    }
    if (Math.abs(secondsOfDay - FALLBACK_CENTER_SECONDS) <= FALLBACK_RADIUS_SECONDS) {
      // §5.2: el fallback sólo cubre si la ventana estricta quedó vacía; la
      // activación es determinista, no se elige por rendimiento.
      inFallback.push(row);
      continue;
    }
    exclusions.push({ row, reason: "Fuera de la ventana estricta y del fallback ±60 min." });
  }

  // §5.2: el fallback se activa si la ventana estricta no tiene *datos
  // utilizables*, no si carece de filas («sólo trades / sólo midpoints» son
  // los usables; una fila sin precio ni bid+ask no aporta observación).
  let windowUsed = "none";
  let candidates = [];
  if (windowHasUsableObservations(inStrict)) {
    windowUsed = "strict";
    candidates = inStrict;
  } else if (windowHasUsableObservations(inFallback)) {
    windowUsed = "nearby-60m";
    candidates = inFallback;
  }

  if (windowUsed === "none") {
    return {
      value: null, defined: false, sourceLabel: "missing",
      windowUsed: "none", label: "eex-derived-reference", exclusions,
      strictCounts: countsByClass(inStrict), fallbackCounts: countsByClass(inFallback), fallbackUsed: false, dedupRule,
      reason: "Sin datos utilizables en la ventana estricta ni en el fallback permitido: la referencia permanece missing.",
    };
  }

  // §5.2: m_j=(bid_j+ask_j)/2; T̂ y M̂ medias aritméticas. Los contadores n y
  // k son intradiarios y locales; la densidad de ticks no entra en la fórmula.
  const tradesList = candidates.filter((row) => isFiniteNumber(row?.price));
  const midpointsList = candidates
    .filter((row) => isFiniteNumber(row?.bid) && isFiniteNumber(row?.ask))
    .map((row) => (row.bid + row.ask) / 2);
  const tradesMean = tradesList.length > 0
    ? tradesList.reduce((total, row) => total + row.price, 0) / tradesList.length
    : null;
  const midpointsMean = midpointsList.length > 0
    ? midpointsList.reduce((total, m) => total + m, 0) / midpointsList.length
    : null;
  const combined = proxyReference({ tradesMean, midpointsMean });

  return {
    value: combined.value,
    defined: combined.defined,
    sourceLabel: combined.sourceLabel,
    windowUsed,
    label: "eex-derived-reference",
    exclusions,
    strictCounts: countsByClass(inStrict),
    fallbackCounts: countsByClass(inFallback),
    fallbackUsed: windowUsed === "nearby-60m",
    dedupRule,
  };
}

function countsByClass(source) {
  return {
    trades: source.filter((row) => isFiniteNumber(row?.price)).length,
    midpoints: source.filter((row) => isFiniteNumber(row?.bid) && isFiniteNumber(row?.ask)).length,
  };
}

// Una fila es utilizable si aporta una observación que entra en T̂ (precio
// finito) o en m_j/M̂ (bid+ask finitos). «Accesible» es la declaración de
// disponibilidad de la fila; «utilizable» es que su contenido alimenta las
// medias de §5.2.
function windowHasUsableObservations(candidates) {
  return candidates.some((row) => isFiniteNumber(row?.price) || (isFiniteNumber(row?.bid) && isFiniteNumber(row?.ask)));
}

// §5.3 tabla de ventanas: Monthly 1-0-1 [S-1 mes, S); Quarterly 3-1-3
// [Q-4 meses, Q-1 mes). Aritmética de meses calendario, extremo inicial
// incluido y final excluido; el día que desborda se recorta al último del mes.
export function deriveBenchmarkWindow({ mission, startDate }) {
  const start = typeof startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : null;
  if (start === null || (mission !== "monthly" && mission !== "quarterly")) {
    return { windowStart: null, windowEnd: null, defined: false, reason: "Missión o fecha de inicio inválidas: se exigen \"monthly\"/\"quarterly\" y YYYY-MM-DD." };
  }
  const [year, month, day] = start.split("-").map(Number);
  const monthsBack = mission === "monthly" ? 1 : 4;
  const windowStart = addMonthsClamped({ year, month, day, monthsBack });
  const windowEnd = mission === "monthly" ? start : addMonthsClamped({ year, month, day, monthsBack: 1 });
  return { windowStart, windowEnd, defined: true, reason: null };
}

function addMonthsClamped({ year, month, day, monthsBack }) {
  const totalMonths = year * 12 + (month - 1) - monthsBack;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonthZero = totalMonths - targetYear * 12;
  const daysInMonth = new Date(Date.UTC(targetYear, targetMonthZero + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, daysInMonth);
  const pad = (value) => String(value).padStart(2, "0");
  return `${String(targetYear).padStart(4, "0")}-${pad(targetMonthZero + 1)}-${pad(targetDay)}`;
}

// §5.3 «El calendario de fechas esperadas se conserva por separado para
// informar cobertura y missing; fechas missing no se rellenan con cero ni
// desaparecen sin trazabilidad».
export function benchmarkCalendarMissingDates({ expectedDates = [], references = [] } = {}) {
  const expected = Array.isArray(expectedDates) ? expectedDates : [];
  const present = new Set(
    (Array.isArray(references) ? references : [])
      .filter((reference) => isFiniteNumber(reference?.selected) || isFiniteNumber(reference?.value))
      .map((reference) => reference?.date),
  );
  return [...expected].filter((date) => !present.has(date)).sort();
}

// §5.4 «Un cálculo reproducible con benchmark provisional conserva
// BENCHMARK_PROVISIONAL; no se eleva silenciosamente a evidencia oficial».
// B es oficial sólo si todas las fechas incluidas provienen de filas oficiales;
// cualquier referencia de otra procedencia mantiene provisional.
export function benchmarkProvisionalStatus({ references = [] } = {}) {
  const included = (Array.isArray(references) ? references : [])
    .filter((reference) => isFiniteNumber(reference?.selected) || isFiniteNumber(reference?.value));
  if (included.length === 0) {
    return {
      status: "B_NOT_DEFINED",
      BENCHMARK_PROVISIONAL: false,
      officialDates: 0,
      nonOfficialDates: 0,
      reason: "D_t vacío: B no está definido.",
    };
  }
  const officialDates = included.filter((reference) => reference?.source === "official").length;
  const nonOfficialDates = included.length - officialDates;
  return {
    status: nonOfficialDates > 0 ? "BENCHMARK_PROVISIONAL" : "BENCHMARK_OFFICIAL",
    BENCHMARK_PROVISIONAL: nonOfficialDates > 0,
    officialDates,
    nonOfficialDates,
    reason: nonOfficialDates > 0
      ? "La cobertura no es exclusivamente oficial: el benchmark permanece provisional y no se eleva a evidencia oficial."
      : "Todas las fechas incluidas provienen de filas oficiales válidas.",
  };
}

// §25.1 output «B versionado»; §5.4 «La sustitución oficial sobre derivado
// cambia la versión de evaluación». La versión es sha256 del JSON canónico
// (claves ordenadas) del cómputo de B; entradas iguales → misma versión,
// cualquier cambio (oficial incluido) → versión nueva, sin efectos sobre el
// receipt previo.
export function benchmarkVersion({ computation, versionTag = null }) {
  if (computation === null || typeof computation !== "object" || Array.isArray(computation)) {
    return { versionId: null, versionTag, algorithm: null, defined: false, reason: "Cómputo exigido: la versión se deriva del contenido computado." };
  }
  const canonical = canonicalJson(computation);
  return {
    versionId: sha256Hex(canonical),
    versionTag,
    algorithm: "sha256(canonicalJson(computation))",
    defined: true,
    reason: null,
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, field]) => field !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, field]) => `${JSON.stringify(key)}:${canonicalJson(field)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}


function sha256Hex(canonicalString) {
  return createHash("sha256").update(canonicalString, "utf8").digest("hex");
}

// §5.4 reconciliación official/proxy: se conservan ambos valores; δ_d =
// R̂_d − R_d^official y B_official − B_proxy = −(1/N)Σδ_d requiere N fechas
// sin cambios (mismo conjunto de fechas en ambas vistas). La sustitución
// oficial no borra el proxy: los valores derivados se devuelven tal cual.
export function reconcileOfficialProxy({ officialReferences = [], proxyReferences = [], expectedDates = null } = {}) {
  const officials = buildDateMap(officialReferences, "official");
  const proxies = buildDateMap(proxyReferences, "proxy");
  if (officials === null || proxies === null) {
    return {
      defined: false,
      dates: [],
      N: 0,
      sumDelta: null,
      meanDelta: null,
      officialMean: null,
      proxyMean: null,
      officialMinusProxy: null,
      setEqual: false,
      equalityComparable: false,
      officialOnlyDates: [],
      proxyOnlyDates: [],
      missingBothDates: [],
      proxyPreserved: false,
      equivalent: false,
      receipt: null,
      reason: "Filas de reconciliación inválidas: cada vista exige fecha de negociación y valor finito (o explícitamente missing).",
    };
  }

  const allDates = new Set([...officials.keys(), ...proxies.keys()]);
  const expected = expectedDates === null ? null : new Set(Array.isArray(expectedDates) ? expectedDates : []);
  if (expected !== null) {
    for (const date of expected) {
      allDates.add(date);
    }
  }

  const dates = [...allDates].sort().map((date) => {
    const official = officials.get(date) ?? null;
    const proxy = proxies.get(date) ?? null;
    if (official !== null && proxy !== null) {
      return {
        date, official: official.value, proxy: proxy.value, delta: proxy.value - official.value, status: "both-present",
        officialProvenance: provenanceOf(official),
        proxyProvenance: provenanceOf(proxy),
      };
    }
    if (official !== null) {
      // §5.4: un oficial que completa una fecha missing obliga a recalcular
      // conjunto, numerador y denominador; no entra en δ con peso cero.
      return {
        date, official: official.value, proxy: null, delta: null, status: "official-added",
        officialProvenance: provenanceOf(official),
        proxyProvenance: null,
      };
    }
    if (proxy !== null) {
      return {
        date, official: null, proxy: proxy.value, delta: null, status: "proxy-only-pending-official",
        officialProvenance: null,
        proxyProvenance: provenanceOf(proxy),
      };
    }
    return { date, official: null, proxy: null, delta: null, status: "missing-both", officialProvenance: null, proxyProvenance: null };
  });

  const paired = dates.filter((row) => row.status === "both-present");
  const officialAll = dates.filter((row) => row.official !== null);
  const proxyAll = dates.filter((row) => row.proxy !== null);
  const officialOnlyDates = dates.filter((row) => row.status === "official-added").map((row) => row.date);
  const proxyOnlyDates = dates.filter((row) => row.status === "proxy-only-pending-official").map((row) => row.date);
  const missingBothDates = dates.filter((row) => row.status === "missing-both").map((row) => row.date);

  const N = paired.length;
  const sumDelta = N > 0 ? paired.reduce((total, row) => total + row.delta, 0) : null;
  const meanDelta = N > 0 ? sumDelta / N : null;
  const officialMean = officialAll.length > 0
    ? officialAll.reduce((total, row) => total + row.official, 0) / officialAll.length
    : null;
  const proxyMean = proxyAll.length > 0
    ? proxyAll.reduce((total, row) => total + row.proxy, 0) / proxyAll.length
    : null;
  const setEqual = officialOnlyDates.length === 0 && proxyOnlyDates.length === 0 && officials.size > 0;
  const equalityComparable = setEqual && N > 0;

  // §5.4: B_official − B_proxy = −(1/N)Σδ_d exige «N fechas sin cambios»
  // (mismo conjunto en ambas vistas). Con conjuntos distintos, la diferencia
  // entre medias de vistas desiguales no acredita la identidad; fail-closed
  // a null.
  const officialMinusProxy = equalityComparable ? -meanDelta : null;

  const core = {
    dates,
    N,
    sumDelta,
    meanDelta,
    officialMean,
    proxyMean,
    officialMinusProxy,
    setEqual,
    equalityComparable,
    officialOnlyDates,
    proxyOnlyDates,
    missingBothDates,
    proxyPreserved: proxies.size > 0,
    // §5.4 «Reconciliación por sustitución no demuestra que el proxy sea
    // idéntico al settlement»: la equivalencia no se acredita aquí; queda
    // fail-closed hasta evidencia de fuente oficial (DEP-06/07/08/09).
    equivalent: false,
    equivalentReason: setEqual
      ? "No se acredita equivalencia por sustitución: oficial y proxy se conservan como valores distintos, pendiente fuente oficial."
      : "Los conjuntos de fechas difieren: la fórmula §5.4 exige N fechas sin cambios.",
  };

  return {
    defined: dates.length > 0,
    ...core,
    // §25.1 output «reconciliation receipt»: hash reproducible del contenido
    // reconciliado (incluye procedencia, timestamps y hashes por fecha).
    receipt: {
      receiptId: sha256Hex(canonicalJson(core)),
      algorithm: "sha256(canonicalJson(core))",
    },
  };
}

// §5.4 «Se conservan ambos valores, procedencia, timestamps y hashes de filas
// cuando estén disponibles»: los campos disponibles viajan junto al valor de
// cada vista; la ausencia se conserva como null (no como fila borrada).
function provenanceOf(entry) {
  if (entry === null) {
    return null;
  }
  return {
    source: entry.source ?? null,
    providerTimestamp: entry.providerTimestamp ?? null,
    rowHash: entry.rowHash ?? null,
  };
}

function buildDateMap(references, label) {
  if (!Array.isArray(references)) {
    return null;
  }
  const map = new Map();
  for (const row of references) {
    if (row === null || typeof row !== "object") {
      return null;
    }
    if (row.date === null) {
      // Fecha missing explícita permitida por contrato.
      continue;
    }
    if (typeof row.date !== "string" || row.date.length === 0) {
      return null;
    }
    const value = row.value !== undefined ? row.value : row.selected;
    if (!isFiniteNumber(value)) {
      return null;
    }
    map.set(row.date, {
      value,
      label,
      source: row.source ?? null,
      providerTimestamp: row.providerTimestamp ?? null,
      rowHash: row.rowHash ?? null,
    });
  }
  return map;
}
