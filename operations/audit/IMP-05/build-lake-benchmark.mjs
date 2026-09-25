// IMP-05 / SCOPE-01: benchmark proxy-side + cobertura por fecha sobre fechas
// auditadas del lago EEX + reconciliation receipt con equivalencia oficial
// fail-closed (P-007). Consume el artefacto de extracción read-only
// (lake-proxy-rows-IMP-05-v2.json) y produce el receipt versionado
// (lake-benchmark-receipt-IMP-05-v2.json). Sin resultado económico: B aquí es el
// benchmark proxy-side provisional sobre la muestra auditada.
// v2 (2026-09-25, hallazgo BT04-C1-PROXY-WINDOW-DEDUP): la ventana §5.2 conserva
// la fracción de segundo y el dedup es por `observationKey` (hallazgo
// BT04-C1-IMP05-DEDUP-NOT-APPLIED: el extractor v2 la emite). El receipt v1 se conserva intacto como versión anterior
// (SPEC §5.3 «conservando cobertura y versiones anteriores»).
//
// Uso: node operations/audit/IMP-05/build-lake-benchmark.mjs

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  benchmarkB,
  benchmarkCalendarMissingDates,
  benchmarkProvisionalStatus,
  benchmarkVersion,
  intradayProxyReference,
  reconcileOfficialProxy,
} from "../../../src/economic-calculation/index.mjs";

const here = new URL(".", import.meta.url).pathname;
export const ROWS_ARTIFACT_RELATIVE_PATH = "operations/audit/IMP-05/lake-proxy-rows-IMP-05-v2.json";
export const rowsArtifactPath = `${here}lake-proxy-rows-IMP-05-v2.json`;
export const receiptPath = `${here}lake-benchmark-receipt-IMP-05-v2.json`;
export const SUPERSEDED_RECEIPT = Object.freeze({
  path: "operations/audit/IMP-05/lake-benchmark-receipt-IMP-05.json",
  sha256: "d977288890d2589d93521b5576969fd7e693e13c3e56639794071019c7f63283",
  reason: "v1 truncaba Tm a segundos enteros (17:15:00.xxx entraba en la ventana estricta 17:00–17:15) y deduplicaba por tupla (Tm, precio, bid, ask), fundiendo trades distintos (BT04-C1-PROXY-WINDOW-DEDUP, BT04-C1-IMP05-DEDUP-NOT-APPLIED)",
});

// P-005 (aceptada, OWNER-DECISION-P-005-EEX-RIGHTS.md): los datos EEX están
// autorizados para este uso dentro del proyecto. Esa decisión es la base de
// `accessible: true`; no es una observación del lago.
function rowAccessiblePerP005(lakeRow, instrument, trdDate) {
  return {
    product: instrument,
    instrument,
    trdDate,
    tmUtc: lakeRow.tmUtc,
    instrumentType: "Simple Instrument",
    price: lakeRow.price,
    bid: lakeRow.bid,
    ask: lakeRow.ask,
    observationKey: lakeRow.observationKey,
    accessible: true,
  };
}

// Recorre fechas auditadas → referencia proxy §5.2 por fecha, B con peso
// diario igual (§5.3), cobertura por fecha separada, versión del cómputo y
// reconciliation receipt con la vista oficial vacía y fail-closed (P-007).
export function buildLakeBenchmarkReceipt({ rowsArtifact, rowsArtifactSha256 }) {
  const auditedDates = rowsArtifact.perDate
    .filter((dateRecord) => dateRecord.contract !== null)
    .map((dateRecord) => dateRecord.trdDate);

  const perDateSummary = [];
  const references = [];
  for (const dateRecord of rowsArtifact.perDate) {
    const trdDate = dateRecord.trdDate;
    if (dateRecord.contract === null) {
      perDateSummary.push({ trdDate, contract: null, dailyReference: null, defined: false, reason: dateRecord.reason });
      continue;
    }
    const rows = dateRecord.rows.map((lakeRow) => rowAccessiblePerP005(lakeRow, dateRecord.contract.instrument, trdDate));
    const proxy = intradayProxyReference({
      rows,
      product: dateRecord.contract.instrument,
      trdDate,
      productClass: "gas",
    });
    perDateSummary.push({
      trdDate,
      contract: {
        instrument: dateRecord.contract.instrument,
        expiryDate: dateRecord.contract.expiryDate,
        displayName: dateRecord.contract.displayName,
      },
      rowCounts: {
        top_of_book: rows.filter((row) => row.bid !== null).length,
        trade: rows.filter((row) => row.price !== null).length,
      },
      strictCounts: proxy.strictCounts,
      fallbackCounts: proxy.fallbackCounts,
      windowUsed: proxy.windowUsed,
      fallbackUsed: proxy.fallbackUsed,
      sourceLabel: proxy.sourceLabel,
      dailyReference: proxy.defined ? proxy.value : null,
      defined: proxy.defined,
      dedupRule: proxy.dedupRule,
      exclusionCount: proxy.exclusions.length,
    });
    if (proxy.defined) {
      references.push({ date: trdDate, selected: proxy.value, source: `proxy:${proxy.sourceLabel}` });
    }
  }

  // Peso igual por fecha (§5.3): B proxy-side sobre las fechas con referencia;
  // el calendario esperado son las fechas auditadas de la muestra, separado.
  const expectedDatesCount = auditedDates.length;
  const benchmark = benchmarkB({ references, expectedDates: expectedDatesCount });
  const calendarMissing = benchmarkCalendarMissingDates({ expectedDates: auditedDates, references });
  const status = benchmarkProvisionalStatus({ references });
  const version = benchmarkVersion({ computation: { B: benchmark.B, count: benchmark.count }, versionTag: "IMP-05-lake-proxy-eval-2" });

  // La lectura de settlement oficial está BLOQUEADA (assessment DEP-10 y
  // P-007: no hay feed Fundamental adicional; el lago no contiene filas
  // oficiales). La vista oficial entra vacía: la reconciliación queda
  // fail-closed y no se fabrica equivalencia.
  const reconciliation = reconcileOfficialProxy({
    officialReferences: [],
    proxyReferences: references,
    expectedDates: auditedDates,
  });

  return {
    artifactKind: "IMP-05_LAKE_PROXY_BENCHMARK_RECEIPT",
    schemaVersion: "1.0",
    benchmarkKind: "proxy-side provisional sobre fechas auditadas del lago",
    declaracion: {
      unexplainedInputs: "ningún dato inventado: filas reales del lago auditado (IMP-03 ST-03.2) con reglas declaradas en el artefacto de extracción",
      contratoCampana: "NO resuelto: DEP-01/03 DOCUMENTED_ABSENCE; la regla de contrato por fecha es provisional y declarada",
      estadoOficial: "reference.read.official BLOQUEADA (BLOCKED_PENDING_OFFICIAL_SETTLEMENT_SOURCE); P-007: no hay feed Fundamental adicional",
    },
    supersedes: SUPERSEDED_RECEIPT,
    rowsArtifact: {
      path: ROWS_ARTIFACT_RELATIVE_PATH,
      sha256: rowsArtifactSha256,
      auditedDates,
    },
    perDate: perDateSummary,
    benchmark: {
      B: benchmark.B,
      count: benchmark.count,
      sum: benchmark.sum,
      coverage: benchmark.coverage,
      expectedDatesCount,
      dailyWeight: "igual peso por fecha (§5.3)",
    },
    calendarMissingDates: calendarMissing,
    provisionalStatus: {
      status: status.status,
      BENCHMARK_PROVISIONAL: status.BENCHMARK_PROVISIONAL,
      officialDates: status.officialDates,
      nonOfficialDates: status.nonOfficialDates,
    },
    benchmarkVersion: {
      versionId: version.versionId,
      versionTag: version.versionTag,
      algorithm: version.algorithm,
    },
    reconciliation: {
      dates: reconciliation.dates,
      N: reconciliation.N,
      sumDelta: reconciliation.sumDelta,
      meanDelta: reconciliation.meanDelta,
      officialMinusProxy: reconciliation.officialMinusProxy,
      setEqual: reconciliation.setEqual,
      equalityComparable: reconciliation.equalityComparable,
      officialOnlyDates: reconciliation.officialOnlyDates,
      proxyOnlyDates: reconciliation.proxyOnlyDates,
      missingBothDates: reconciliation.missingBothDates,
      proxyPreserved: reconciliation.proxyPreserved,
      equivalent: reconciliation.equivalent,
      equivalentReason: reconciliation.equivalentReason,
    },
    engineReceipt: reconciliation.receipt,
  };
}

function main() {
  const rowsArtifact = JSON.parse(readFileSync(rowsArtifactPath, "utf8"));
  const rowsArtifactSha256 = createHash("sha256").update(readFileSync(rowsArtifactPath)).digest("hex");
  const receipt = buildLakeBenchmarkReceipt({ rowsArtifact, rowsArtifactSha256 });
  const serialized = JSON.stringify(receipt, null, 2) + "\n";
  writeFileSync(receiptPath, serialized);
  const sha = createHash("sha256").update(serialized).digest("hex");
  console.log(`Receipt escrito: ${receiptPath}`);
  console.log(`receipt_sha256: ${sha}`);
  console.log(`B(proxy, ${receipt.benchmark.count}/${receipt.benchmark.expectedDatesCount} fechas auditadas) = ${receipt.benchmark.B}`);
  console.log(`missing: ${receipt.calendarMissingDates.length ? receipt.calendarMissingDates.join(", ") : "ninguna"}`);
  console.log(`status: ${receipt.provisionalStatus.status}; version: ${receipt.benchmarkVersion.versionId}`);
  console.log(`equivalent: ${receipt.reconciliation.equivalent} (${receipt.reconciliation.equivalentReason})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
