// Herramienta de captura de la auditoría de fidelidad UI (no es producto ni
// test). Renderiza las cuatro superficies con los FIXTURES SINTÉTICOS de los
// tests del boundary (test/operator-interface/fixtures.mjs) para ver cómo se
// llenan las ranuras del diseño cuando hay datos atados al manifest. Esos
// valores son datos de test, no hechos de producto.
//
// Uso: node docs/product/ui-fidelity/render-fixture-pages.mjs <dir-salida>

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalValueSha256 } from "../../../src/pit-views/pit-record.mjs";
import {
  backendIndexFromManifest,
  buildExposure,
  buildOperatorTimeline,
  EXPOSURE_CONDITION,
  EXPOSURE_SOURCE_KIND,
  WORKING_MODE,
} from "../../../src/operator-interface/index.mjs";
import { EXECUTION_CLASS } from "../../../src/operator-interface/timeline.mjs";
import {
  buildBacktestsViewModel,
  buildCampaignsViewModel,
  buildReplayViewModel,
  buildResearchViewModel,
  renderSurfacePage,
} from "../../../src/ui/index.mjs";
import {
  AUTHORITY_BASE,
  DECISION_BASE,
  EVALUATION_BENCHMARK,
  RECEIPT_BASE,
  RECOMMENDATION_BASE,
  backendRefOf,
  buildManifest,
} from "../../../test/operator-interface/fixtures.mjs";

const COMPARISON = {
  key: "BT.G0BQ.202604.comparison",
  viewScope: "evaluation",
  occurredAtUtc: "2026-06-30T17:20:00Z",
  publishedAtUtc: "2026-07-01T06:05:00Z",
  consumableAtUtc: "2026-07-01T06:35:00Z",
  consumableEvidence: { source: "fixture://ingest-log", locator: "row @ fixture", sha256: "a".repeat(64) },
  revisionId: "bt-v1",
  value: { arm: "A0", measure: "B", economicValue: 25.1 },
};

const outDir = process.argv[2];
if (typeof outDir !== "string" || outDir.length === 0) {
  console.error("usage: node docs/product/ui-fidelity/render-fixture-pages.mjs <dir-salida>");
  process.exit(2);
}

const built = buildManifest({ records: [DECISION_BASE, RECOMMENDATION_BASE, EVALUATION_BENCHMARK, AUTHORITY_BASE, RECEIPT_BASE, COMPARISON] });
if (!built.ok) {
  console.error(JSON.stringify(built.errors));
  process.exit(1);
}
const manifest = built.manifest;
const backendIndex = backendIndexFromManifest(manifest);
const recommendationRef = backendRefOf(RECOMMENDATION_BASE);

const timeline = buildOperatorTimeline({
  manifest,
  decisionBoundaryUtc: "2026-04-01T07:00:00Z",
  evaluationAsOfUtc: "2026-07-01T07:00:00Z",
  workingMode: WORKING_MODE.REPLAY,
  executions: [
    { eventId: "SIM-1", class: EXECUTION_CLASS.SIMULATED, relatedRecommendationRef: recommendationRef, occurredAtUtc: "2026-04-02T08:01:00Z" },
    {
      eventId: "REAL-1",
      class: EXECUTION_CLASS.REAL,
      relatedRecommendationRef: recommendationRef,
      occurredAtUtc: "2026-04-02T08:03:00Z",
      authorization: {
        authorityRef: backendRefOf(AUTHORITY_BASE),
        receipt: { receiptRef: backendRefOf(RECEIPT_BASE), receiptSha256: canonicalValueSha256(RECEIPT_BASE.value).sha256 },
      },
    },
  ],
  interventions: [{ eventId: "HUM-1", relatedRecommendationRef: recommendationRef, occurredAtUtc: "2026-04-02T08:04:00Z", attribution: "HUMAN" }],
});
const exposure = buildExposure({
  boundaryUtc: "2026-04-01T07:00:00Z",
  observations: [
    {
      field: "recommendation",
      condition: EXPOSURE_CONDITION.AVAILABLE,
      value: RECOMMENDATION_BASE.value,
      provenance: { sourceKind: EXPOSURE_SOURCE_KIND.RECOMMENDATION, recordKey: RECOMMENDATION_BASE.key, revisionId: RECOMMENDATION_BASE.revisionId, valueSha256: canonicalValueSha256(RECOMMENDATION_BASE.value).sha256 },
    },
    {
      field: "outcomes",
      condition: EXPOSURE_CONDITION.AVAILABLE,
      value: EVALUATION_BENCHMARK.value,
      provenance: { sourceKind: EXPOSURE_SOURCE_KIND.OUTCOME, recordKey: EVALUATION_BENCHMARK.key, revisionId: EVALUATION_BENCHMARK.revisionId, valueSha256: canonicalValueSha256(EVALUATION_BENCHMARK.value).sha256 },
    },
  ],
  backendManifest: manifest,
});

const pages = {
  replay: buildReplayViewModel({ timeline, exposure, backendIndex }),
  backtests: buildBacktestsViewModel({
    backendIndex,
    rows: [{ label: "B G0BQ 202604", arm: "A0", measure: "B", recordKey: COMPARISON.key, revisionId: COMPARISON.revisionId, value: COMPARISON.value }],
  }),
  research: buildResearchViewModel({ backendIndex, records: [] }),
  campaigns: buildCampaignsViewModel({
    backendIndex,
    campaigns: [],
    runs: [{ runId: "RUN.G0BQ.202604", recordKey: DECISION_BASE.key, revisionId: DECISION_BASE.revisionId, value: DECISION_BASE.value }],
  }),
};

mkdirSync(outDir, { recursive: true });
for (const [surface, vm] of Object.entries(pages)) {
  if (vm.ok !== true) {
    console.error(`${surface}: ${JSON.stringify(vm.errors)}`);
    process.exit(1);
  }
  writeFileSync(join(outDir, `${surface}.html`), renderSurfacePage(surface, vm));
}
console.log(`fixture pages written to ${outDir}`);
