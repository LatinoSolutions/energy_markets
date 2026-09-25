// BT-01: campaign-scoped B receipts using the accepted IMP-05 daily proxy
// methodology. Official settlement is deliberately empty and fail-closed.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  benchmarkB,
  benchmarkCalendarMissingDates,
  benchmarkProvisionalStatus,
  benchmarkVersion,
  deriveBenchmarkWindow,
  intradayProxyReference,
  reconcileOfficialProxy,
} from "../../../src/economic-calculation/index.mjs";

const repoRoot = new URL("../../../", import.meta.url).pathname;
const BT01 = "operations/audit/BT-01";

// v1 = benchmark aceptado (BT-01), se conserva byte a byte y sigue reproducible.
// v2 = misma metodología IMP-05 con la ventana §5.2 en fracción de segundo y dedup
// por observación de mercado (hallazgo BT04-C1-PROXY-WINDOW-DEDUP, 2026-09-25);
// SPEC §5.3: recalcular «conservando cobertura y versiones anteriores».
export const VERSIONS = Object.freeze({
  v1: Object.freeze({
    rowsArtifact: `${BT01}/campaign-proxy-rows-BT-01.json`,
    artifact: `${BT01}/campaign-provisional-benchmarks-BT-01.json`,
    manifest: `${BT01}/campaign-provisional-benchmarks-BT-01.MANIFEST.json`,
    versionTag: "BT-01-IMP-05-campaign-proxy-1",
    supersedes: null,
  }),
  v2: Object.freeze({
    rowsArtifact: `${BT01}/v2/campaign-proxy-rows-BT-01.json`,
    artifact: `${BT01}/v2/campaign-provisional-benchmarks-BT-01.json`,
    manifest: `${BT01}/v2/campaign-provisional-benchmarks-BT-01.MANIFEST.json`,
    versionTag: "BT-01-IMP-05-campaign-proxy-2",
    supersedes: `${BT01}/campaign-provisional-benchmarks-BT-01.json`,
  }),
});
export const CURRENT_VERSION = "v2";
const absolute = (relativePath) => `${repoRoot}${relativePath}`;
export const rowsArtifactPath = absolute(VERSIONS.v1.rowsArtifact);
export const artifactPath = absolute(VERSIONS.v1.artifact);
export const manifestPath = absolute(VERSIONS.v1.manifest);

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function campaignStart(maturity) {
  return `${maturity.slice(0, 4)}-${maturity.slice(4)}-01`;
}

export function buildCampaignBenchmarkArtifact({ rowsArtifact, rowsArtifactSha256, exchangeDays, calendarSha256, release = VERSIONS.v1, supersededSha256 = null }) {
  if (rowsArtifact?.artifactKind !== "BT-01_CAMPAIGN_PROXY_ROWS" || !Array.isArray(rowsArtifact.campaigns)) {
    throw new TypeError("Se requiere el artefacto de extracción de campañas BT-01.");
  }
  if (!Array.isArray(exchangeDays) || calendarSha256 !== rowsArtifact.calendar?.sha256) {
    throw new Error("Se requiere el calendario IMP-09 que coincide con el hash del artefacto de filas.");
  }
  const sortedExchangeDays = [...exchangeDays].sort();
  if (new Set(sortedExchangeDays).size !== sortedExchangeDays.length) {
    throw new Error("El calendario IMP-09 contiene fechas duplicadas.");
  }

  const campaigns = rowsArtifact.campaigns.map((campaign) => {
    const mission = campaign.mission;
    const productClass = mission === "quarterly" ? "gas" : mission === "monthly" ? "gas" : null;
    const startDate = campaignStart(campaign.maturity);
    const window = deriveBenchmarkWindow({ mission, startDate });
    if (!window.defined || window.windowStart !== campaign.windowStart || window.windowEnd !== campaign.windowEnd) {
      throw new Error(`Ventana de benchmark no coincide con el plan para ${campaign.campaignKey}.`);
    }
    const expectedDates = campaign.expectedDates;
    const calendarExpectedDates = sortedExchangeDays.filter((date) => date >= window.windowStart && date < window.windowEnd);
    if (JSON.stringify(expectedDates) !== JSON.stringify(calendarExpectedDates)) {
      throw new Error(`Fechas esperadas no coinciden con el calendario IMP-09 para ${campaign.campaignKey}.`);
    }
    if (!Array.isArray(campaign.perDate) || JSON.stringify(campaign.perDate.map(({ trdDate }) => trdDate)) !== JSON.stringify(expectedDates)) {
      throw new Error(`Fechas diarias no coinciden con las fechas esperadas para ${campaign.campaignKey}.`);
    }
    const perDate = [];
    const references = [];
    const eligibleRows = (dateRecord) => (dateRecord.rows ?? []).filter((row) => row.instrumentType === "Simple Instrument" && row.instrument);
    const campaignInstruments = [...new Set(campaign.perDate.flatMap((dateRecord) =>
      dateRecord.instrumentIdentities ?? eligibleRows(dateRecord).map((row) => row.instrument),
    ))].sort();
    const campaignIdentityAmbiguous = campaignInstruments.length > 1;

    for (const dateRecord of campaign.perDate) {
      const eligibleDateRows = eligibleRows(dateRecord);
      const instruments = [...new Set(dateRecord.instrumentIdentities ?? eligibleDateRows.map((row) => row.instrument))].sort();
      // A maturity with conflicting instrument identities cannot be silently
      // pooled: preserve the date as missing and expose the ambiguity.
      const instrumentAmbiguous = instruments.length > 1 || campaignIdentityAmbiguous;
      const identifiedRows = eligibleDateRows;
      const rows = instrumentAmbiguous ? [] : identifiedRows.map((row) => ({
        product: campaign.campaignKey,
        instrument: row.instrument,
        trdDate: row.trdDate,
        tmUtc: row.tmUtc,
        instrumentType: "Simple Instrument",
        price: row.price,
        bid: row.bid,
        ask: row.ask,
        accessible: true, // Existing P-005 rights decision; not inferred from readability.
        rowHash: row.rowHash,
        observationKey: row.observationKey,
      }));
      const proxy = dateRecord.proxyResult ?? (dateRecord.dailyReference !== undefined ? {
        ...dateRecord,
        value: dateRecord.dailyReference,
      } : null) ?? intradayProxyReference({
        rows,
        product: campaign.campaignKey,
        trdDate: dateRecord.trdDate,
        productClass,
        requireAccessible: true,
      });
      const record = {
        trdDate: dateRecord.trdDate,
        maturity: campaign.maturity,
        instrumentISIN: instruments.length === 1 && !campaignIdentityAmbiguous ? instruments[0] : null,
        instrumentIdentityAmbiguous: instrumentAmbiguous,
        sourceRows: dateRecord.sourceRows ?? dateRecord.rows.length,
        excludedRowsUnsupportedInstrument: dateRecord.exclusions?.unsupportedInstrument ?? (dateRecord.rows ? dateRecord.rows.length - eligibleDateRows.length : 0),
        excludedRowsWithoutInstrument: dateRecord.exclusions?.withoutInstrument ?? (dateRecord.rows ? eligibleDateRows.filter((row) => !row.instrument).length : 0),
        excludedRowsInvalidMarketMetadata: dateRecord.exclusions?.invalidMarketMetadata ?? 0,
        excludedRowsInvalidTimestamp: dateRecord.exclusions?.invalidTimestamp ?? 0,
        excludedRowsOutsideLocalDate: dateRecord.exclusions?.outsideLocalDate ?? 0,
        excludedRowsOutsideWindow: dateRecord.exclusions?.outsideWindow ?? 0,
        sourceFiles: dateRecord.sourceFiles ?? [],
        sourceRowHashes: dateRecord.sourceRowHashesDigest !== undefined
          ? { count: dateRecord.sourceRowHashCount, digest: dateRecord.sourceRowHashesDigest }
          : [...new Set((dateRecord.rows ?? []).map((row) => row.rowHash).filter(Boolean))].sort(),
        sourceCounts: dateRecord.sourceCounts,
        strictCounts: proxy.strictCounts,
        fallbackCounts: proxy.fallbackCounts,
        windowUsed: proxy.windowUsed,
        fallbackUsed: proxy.fallbackUsed,
        sourceLabel: proxy.sourceLabel,
        dailyReference: proxy.defined && !instrumentAmbiguous ? proxy.value : null,
        defined: proxy.defined && !instrumentAmbiguous,
        reason: instrumentAmbiguous ? `Identidad ambigua para maturity: ${instruments.join(", ")}` : proxy.reason,
      };
      perDate.push(record);
      if (record.defined) references.push({ date: record.trdDate, selected: record.dailyReference, source: `proxy:${record.sourceLabel}` });
    }

    const benchmark = benchmarkB({ references, expectedDates: expectedDates.length });
    const missingDates = benchmarkCalendarMissingDates({ expectedDates, references });
    const provisionalStatus = benchmarkProvisionalStatus({ references });
    const version = benchmarkVersion({
      computation: { campaignKey: campaign.campaignKey, B: benchmark.B, count: benchmark.count, expectedDates },
      versionTag: release.versionTag,
    });
    const reconciliation = reconcileOfficialProxy({ officialReferences: [], proxyReferences: references, expectedDates });

    return {
      campaignKey: campaign.campaignKey,
      product: campaign.product,
      maturity: campaign.maturity,
      mission,
      benchmarkWindow: { rule: campaign.windowRule, startInclusive: window.windowStart, endExclusive: window.windowEnd },
      expectedDates,
      perDate,
      benchmark: {
        B: benchmark.B,
        count: benchmark.count,
        sum: benchmark.sum,
        coverage: benchmark.coverage,
        expectedDatesCount: expectedDates.length,
        missingDates,
        dailyWeight: "equal por fecha (§5.3)",
      },
      status: {
        status: provisionalStatus.status,
        BENCHMARK_PROVISIONAL: provisionalStatus.BENCHMARK_PROVISIONAL,
        officialDates: provisionalStatus.officialDates,
        nonOfficialDates: provisionalStatus.nonOfficialDates,
        officialSettlement: "UNKNOWN; sin fuente oficial en el alcance BT-01",
      },
      benchmarkVersion: { versionId: version.versionId, versionTag: release.versionTag, algorithm: version.algorithm },
      reconciliation: {
        N: reconciliation.N,
        setEqual: reconciliation.setEqual,
        equalityComparable: reconciliation.equalityComparable,
        equivalent: reconciliation.equivalent,
        equivalentReason: reconciliation.equivalentReason,
        officialOnlyDates: reconciliation.officialOnlyDates,
        proxyOnlyDates: reconciliation.proxyOnlyDates,
        missingBothDates: reconciliation.missingBothDates,
        proxyPreserved: reconciliation.proxyPreserved,
        engineReceipt: reconciliation.receipt,
      },
    };
  });

  return {
    artifactKind: "BT-01_CAMPAIGN_PROVISIONAL_BENCHMARKS",
    schemaVersion: "1.0",
    status: "BENCHMARK_PROVISIONAL",
    methodology: "IMP-05 §5.2–§5.3: daily proxy reference, equal daily weight; no official equivalence claim",
    ...(release.supersedes === null ? {} : {
      methodologyVersion: 2,
      supersedes: { path: release.supersedes, sha256: supersededSha256, reason: "v1 truncated Tm to whole seconds at the §5.2 window bounds and deduplicated on (Tm, price, bid, ask), merging distinct market rows (BT04-C1-PROXY-WINDOW-DEDUP)" },
    }),
    sourceArtifact: { path: release.rowsArtifact, sha256: rowsArtifactSha256 },
    declaration: {
      campaignScope: "Existing exploratory G0BQ/G0BM maturities only; not a client campaign mandate",
      officialSettlement: "UNKNOWN; official references intentionally empty; reconciliation fail-closed",
      rights: "EEX data use is based on accepted P-005; accessibility is not inferred from filesystem access",
    },
    campaigns,
  };
}

export function buildCampaignBenchmarkManifest({ artifact, artifactSha256, rowsArtifact, rowsArtifactSha256, release = VERSIONS.v1 }) {
  return {
    artifactKind: "BT-01_CAMPAIGN_PROVISIONAL_BENCHMARK_MANIFEST",
    schemaVersion: "1.0",
    status: "BENCHMARK_PROVISIONAL",
    artifact: { path: release.artifact, sha256: artifactSha256 },
    ...(artifact.supersedes ? { supersedes: artifact.supersedes } : {}),
    inputs: {
      rowsArtifact: { path: release.rowsArtifact, sha256: rowsArtifactSha256 },
      campaignPopulation: rowsArtifact.campaignPopulation,
      calendar: rowsArtifact.calendar,
      sourceFileHashes: rowsArtifact.sourceFileHashes,
    },
    campaigns: artifact.campaigns.map(({ campaignKey, benchmarkVersion, benchmark }) => ({ campaignKey, benchmarkVersion, B: benchmark.B, coverage: benchmark.coverage })),
  };
}

// Uso: node build-campaign-benchmarks.mjs [--version v1|v2] [--check]
function main() {
  const versionIndex = process.argv.indexOf("--version");
  const versionName = versionIndex === -1 ? CURRENT_VERSION : process.argv[versionIndex + 1];
  const release = VERSIONS[versionName];
  if (!release) throw new Error(`Versión BT-01 desconocida: ${versionName}`);
  const rowsBytes = readFileSync(absolute(release.rowsArtifact));
  const rowsArtifact = JSON.parse(rowsBytes);
  const rowsArtifactSha256 = digest(rowsBytes);
  const calendarBytes = readFileSync(new URL("../IMP-09/eex-exchange-calendar.json", import.meta.url));
  const calendar = JSON.parse(calendarBytes);
  const calendarSha256 = digest(calendarBytes);
  const supersededSha256 = release.supersedes === null ? null : digest(readFileSync(absolute(release.supersedes)));
  const artifact = buildCampaignBenchmarkArtifact({ rowsArtifact, rowsArtifactSha256, exchangeDays: calendar.exchangeDays, calendarSha256, release, supersededSha256 });
  const artifactBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
  const artifactSha256 = digest(artifactBytes);
  const manifest = buildCampaignBenchmarkManifest({ artifact, artifactSha256, rowsArtifact, rowsArtifactSha256, release });
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  if (process.argv.includes("--check")) {
    const committedArtifact = readFileSync(absolute(release.artifact));
    const committedManifest = readFileSync(absolute(release.manifest));
    if (!committedArtifact.equals(artifactBytes) || !committedManifest.equals(manifestBytes)) {
      throw new Error(`Los artefactos BT-01 ${versionName} no son reproducibles desde sus inputs versionados.`);
    }
    console.log(`BT-01 ${versionName} benchmark artifact + manifest reproducibles`);
    return;
  }
  writeFileSync(absolute(release.artifact), artifactBytes);
  writeFileSync(absolute(release.manifest), manifestBytes);
  console.log(`${versionName} campaigns=${artifact.campaigns.length} sha256=${artifactSha256}`);
  for (const campaign of artifact.campaigns) {
    console.log(`${campaign.campaignKey} B=${campaign.benchmark.B} coverage=${campaign.benchmark.coverage} ${campaign.status.status}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
