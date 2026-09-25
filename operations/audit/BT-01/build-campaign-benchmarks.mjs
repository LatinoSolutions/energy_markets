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

const directory = new URL(".", import.meta.url).pathname;
export const rowsArtifactPath = `${directory}campaign-proxy-rows-BT-01.json`;
export const artifactPath = `${directory}campaign-provisional-benchmarks-BT-01.json`;
export const manifestPath = `${directory}campaign-provisional-benchmarks-BT-01.MANIFEST.json`;

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function campaignStart(maturity) {
  return `${maturity.slice(0, 4)}-${maturity.slice(4)}-01`;
}

export function buildCampaignBenchmarkArtifact({ rowsArtifact, rowsArtifactSha256 }) {
  if (rowsArtifact?.artifactKind !== "BT-01_CAMPAIGN_PROXY_ROWS" || !Array.isArray(rowsArtifact.campaigns)) {
    throw new TypeError("Se requiere el artefacto de extracción de campañas BT-01.");
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
    const perDate = [];
    const references = [];
    const campaignInstruments = [...new Set(campaign.perDate.flatMap((dateRecord) => dateRecord.rows.map((row) => row.instrument).filter(Boolean)))].sort();
    const campaignIdentityAmbiguous = campaignInstruments.length > 1;

    for (const dateRecord of campaign.perDate) {
      const instruments = [...new Set(dateRecord.rows.map((row) => row.instrument).filter(Boolean))].sort();
      // A maturity with conflicting instrument identities cannot be silently
      // pooled: preserve the date as missing and expose the ambiguity.
      const instrumentAmbiguous = instruments.length > 1 || campaignIdentityAmbiguous;
      const identifiedRows = dateRecord.rows.filter((row) => row.instrument);
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
      }));
      const proxy = intradayProxyReference({
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
        sourceRows: dateRecord.rows.length,
        excludedRowsWithoutInstrument: dateRecord.rows.length - identifiedRows.length,
        sourceHashes: [...new Set(dateRecord.rows.map((row) => row.rowHash).filter(Boolean))].sort(),
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
      versionTag: "BT-01-IMP-05-campaign-proxy-1",
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
      benchmarkVersion: { versionId: version.versionId, versionTag: version.versionTag, algorithm: version.algorithm },
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
    sourceArtifact: { path: "operations/audit/BT-01/campaign-proxy-rows-BT-01.json", sha256: rowsArtifactSha256 },
    declaration: {
      campaignScope: "Existing exploratory G0BQ/G0BM maturities only; not a client campaign mandate",
      officialSettlement: "UNKNOWN; official references intentionally empty; reconciliation fail-closed",
      rights: "EEX data use is based on accepted P-005; accessibility is not inferred from filesystem access",
    },
    campaigns,
  };
}

export function buildCampaignBenchmarkManifest({ artifact, artifactSha256, rowsArtifact, rowsArtifactSha256 }) {
  return {
    artifactKind: "BT-01_CAMPAIGN_PROVISIONAL_BENCHMARK_MANIFEST",
    schemaVersion: "1.0",
    status: "BENCHMARK_PROVISIONAL",
    artifact: { path: "operations/audit/BT-01/campaign-provisional-benchmarks-BT-01.json", sha256: artifactSha256 },
    inputs: {
      rowsArtifact: { path: "operations/audit/BT-01/campaign-proxy-rows-BT-01.json", sha256: rowsArtifactSha256 },
      campaignPopulation: rowsArtifact.campaignPopulation,
      calendar: rowsArtifact.calendar,
      sourceFileHashes: rowsArtifact.sourceFileHashes,
    },
    campaigns: artifact.campaigns.map(({ campaignKey, benchmarkVersion, benchmark }) => ({ campaignKey, benchmarkVersion, B: benchmark.B, coverage: benchmark.coverage })),
  };
}

function main() {
  const rowsBytes = readFileSync(rowsArtifactPath);
  const rowsArtifact = JSON.parse(rowsBytes);
  const rowsArtifactSha256 = digest(rowsBytes);
  const artifact = buildCampaignBenchmarkArtifact({ rowsArtifact, rowsArtifactSha256 });
  const artifactBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
  const artifactSha256 = digest(artifactBytes);
  const manifest = buildCampaignBenchmarkManifest({ artifact, artifactSha256, rowsArtifact, rowsArtifactSha256 });
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const check = process.argv.includes("--check");
  if (check) {
    const committedArtifact = readFileSync(artifactPath);
    const committedManifest = readFileSync(manifestPath);
    if (!committedArtifact.equals(artifactBytes) || !committedManifest.equals(manifestBytes)) {
      throw new Error("Los artefactos BT-01 no son reproducibles desde sus inputs versionados.");
    }
    console.log("BT-01 benchmark artifact + manifest reproducibles");
    return;
  }
  writeFileSync(artifactPath, artifactBytes);
  writeFileSync(manifestPath, manifestBytes);
  console.log(`campaigns=${artifact.campaigns.length} sha256=${artifactSha256}`);
  for (const campaign of artifact.campaigns) {
    console.log(`${campaign.campaignKey} B=${campaign.benchmark.B} coverage=${campaign.benchmark.coverage} ${campaign.status.status}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
