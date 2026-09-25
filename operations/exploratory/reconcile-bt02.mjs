// Uso: node operations/exploratory/reconcile-bt02.mjs [--version v1|v2] [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BT02_CURRENT_RELEASE,
  BT02_RELEASES,
  buildBt02Manifest,
  buildBt02Reconciliation,
  sha256Hex,
} from "../../src/exploratory/reconciliation.mjs";

const root = resolve(import.meta.dirname, "../..");
const bytes = (relativePath) => readFileSync(resolve(root, relativePath));
const versionIndex = process.argv.indexOf("--version");
const versionName = versionIndex === -1 ? BT02_CURRENT_RELEASE : process.argv[versionIndex + 1];
const release = BT02_RELEASES[versionName];
if (!release) throw new Error(`unknown BT-02 version: ${versionName}`);

const resultsBytes = bytes(release.exploratoryResults);
const resultsManifestBytes = bytes(release.exploratoryManifest);
const benchmarkBytes = bytes(release.bt01Benchmark);
const benchmarkManifestBytes = bytes(release.bt01Manifest);
const resultsManifest = JSON.parse(resultsManifestBytes);
const benchmarkManifest = JSON.parse(benchmarkManifestBytes);
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
  release,
  supersededSha256: release.supersedes === null ? null : sha256Hex(bytes(release.supersedes)),
});
const artifactBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
const manifestBytes = Buffer.from(`${JSON.stringify(buildBt02Manifest({ artifact, artifactSha256: sha256Hex(artifactBytes), release }), null, 2)}\n`);
if (process.argv.includes("--check")) {
  if (!bytes(release.artifact).equals(artifactBytes) || !bytes(release.manifest).equals(manifestBytes)) {
    throw new Error(`BT-02 ${versionName} is not reproducible from its hash-bound inputs`);
  }
  console.log(`BT-02 ${versionName} reproducible`);
} else {
  writeFileSync(resolve(root, release.artifact), artifactBytes);
  writeFileSync(resolve(root, release.manifest), manifestBytes);
  console.log(`BT-02 ${versionName} reconciled ${artifact.campaigns.length} campaigns`);
}
