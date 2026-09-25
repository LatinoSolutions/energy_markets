import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildBt02Manifest,
  buildBt02Reconciliation,
  sha256Hex,
} from "../../src/exploratory/reconciliation.mjs";

const root = resolve(import.meta.dirname, "../..");
const readJson = (relativePath) => JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
const bytes = (relativePath) => readFileSync(resolve(root, relativePath));
const resultsPath = "operations/exploratory/backtest-results.json";
const resultsManifestPath = "operations/exploratory/MANIFEST.json";
const benchmarkPath = "operations/audit/BT-01/campaign-provisional-benchmarks-BT-01.json";
const benchmarkManifestPath = "operations/audit/BT-01/campaign-provisional-benchmarks-BT-01.MANIFEST.json";

const resultsBytes = bytes(resultsPath);
const resultsManifestBytes = bytes(resultsManifestPath);
const benchmarkBytes = bytes(benchmarkPath);
const benchmarkManifestBytes = bytes(benchmarkManifestPath);
const resultsManifest = readJson(resultsManifestPath);
const benchmarkManifest = readJson(benchmarkManifestPath);
if (resultsManifest.results?.sha256 !== sha256Hex(resultsBytes)) throw new Error("exploratory results do not match MANIFEST.json");
if (benchmarkManifest.artifact?.sha256 !== sha256Hex(benchmarkBytes)) throw new Error("BT-01 benchmark does not match its manifest");
if (benchmarkManifest.inputs?.campaignPopulation?.sha256 !== sha256Hex(resultsBytes)) throw new Error("BT-01 campaign population does not bind to exploratory results");

const artifact = buildBt02Reconciliation({
  results: JSON.parse(resultsBytes),
  benchmarkArtifact: JSON.parse(benchmarkBytes),
  resultsSha256: sha256Hex(resultsBytes),
  resultsManifestSha256: sha256Hex(resultsManifestBytes),
  benchmarkSha256: sha256Hex(benchmarkBytes),
  benchmarkManifestSha256: sha256Hex(benchmarkManifestBytes),
});
const artifactBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
const artifactPath = "operations/exploratory/reconciled-results-BT-02.json";
writeFileSync(resolve(root, artifactPath), artifactBytes);
const manifest = buildBt02Manifest({ artifact, artifactSha256: sha256Hex(artifactBytes) });
writeFileSync(resolve(root, "operations/exploratory/reconciled-results-BT-02.MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`BT-02 reconciled ${artifact.campaigns.length} campaigns`);
