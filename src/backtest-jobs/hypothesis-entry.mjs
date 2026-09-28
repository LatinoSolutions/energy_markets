// BT-08: entry del job de hipótesis. Corre dentro del workspace (código staged
// del commit) con cwd = workspace y lee:
//   argv[2] = spec.json   (petición canónica validada por el runner)
//   argv[3] = resultados  (JSON con el episodio Development y su economía)
//   argv[4] = MANIFEST    (liga por hash resultados, spec e inputs)
// Ejecuta el HYP-1 real (src/s1-strategy) sobre los inputs verificados; una
// misión bloqueada (provenance/frescura/warm-up/freeze/reserva) sale con código
// 3 y blockers explícitos, nunca como éxito silencioso.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  assessDevelopmentInputs,
  pairedAblation,
  runHS1DevelopmentEpisode,
} from "../s1-strategy/development-episode.mjs";
import { createHS1Candidate } from "../s1-strategy/h-s1-01.mjs";

const sha256Of = (bytes) => createHash("sha256").update(bytes).digest("hex");
const [specPath, resultsPath, manifestPath] = process.argv.slice(2);

const specBytes = readFileSync(specPath);
const spec = JSON.parse(specBytes);
const job = spec.job;
// El specSha256 canónico reconstruye la forma sin timestamps: es el valor que
// ata la identidad del run (canonicalSpecOf en hypothesis-runner.mjs).
const specSha256 = sha256Of(Buffer.from(JSON.stringify({ artifactKind: spec.artifactKind, schemaVersion: spec.schemaVersion, job })));

const readInput = (entry) => JSON.parse(readFileSync(entry.path, "utf8"));
const availabilitySource = readInput(job.inputManifest.availability);
const observations = readInput(job.inputManifest.observations);
const benchmarkSource = readInput(job.inputManifest.benchmark);
const deliveryHours = readInput(job.inputManifest.deliveryHours);
const session = availabilitySource.session ?? null;
const availability = availabilitySource.availability ?? [];
const benchmark = { ...benchmarkSource, sourceHash: job.inputManifest.benchmark.sha256 };

// El benchmark comprometido tiene que ser exactamente la referencia declarada
// en la petición: una identidad BENCHMARK, sin segunda verdad.
const declared = job.evaluation.benchmark;
if (benchmarkSource.identity !== declared.identity || benchmarkSource.version !== declared.version
  || benchmarkSource.status !== declared.status || benchmarkSource.value !== declared.value
  || benchmarkSource.unit !== declared.unit || benchmarkSource.artifactSha256 !== declared.artifactSha256) {
  writeBlocked([{ code: "BINDING_INVALID", message: "the committed benchmark artifact does not match the declared evaluation reference" }]);
}

function writeResults(results) {
  mkdirSync(dirname(resultsPath), { recursive: true });
  mkdirSync(dirname(manifestPath), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(results, null, 1)}\n`);
  writeFileSync(resultsPath, bytes);
  const manifest = {
    artifactKind: "HYPOTHESIS_RUN_MANIFEST",
    schemaVersion: "1",
    runId: spec.runId,
    results: { path: resultsPath, sha256: sha256Of(bytes) },
    spec: { path: specPath, sha256: sha256Of(specBytes) },
    inputs: [job.inputManifest.availability, job.inputManifest.observations, job.inputManifest.benchmark, job.inputManifest.deliveryHours],
    generators: [
      { path: "src/backtest-jobs/hypothesis-entry.mjs", sha256: sha256Of(readFileSync("src/backtest-jobs/hypothesis-entry.mjs")) },
      { path: "src/s1-strategy/development-episode.mjs", sha256: sha256Of(readFileSync("src/s1-strategy/development-episode.mjs")) },
    ],
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`);
}

function writeBlocked(blockers) {
  writeResults({
    artifactKind: "HYPOTHESIS_DEVELOPMENT_RESULTS",
    schemaVersion: "1",
    runId: spec.runId,
    specSha256,
    hypothesisId: job.hypothesisId,
    hypothesisVersion: job.hypothesisVersion,
    missionId: job.missionId,
    missionLabel: job.missionLabel,
    phase: job.phase,
    dataMode: job.dataMode,
    status: "BLOCKED",
    blockers,
    validComparison: false,
    scientificConclusion: null,
    researchPass: false,
  });
  // Código 3: bloqueo de la misión, no un fallo técnico del entry.
  process.exit(3);
}

const assessment = assessDevelopmentInputs({
  session,
  availability,
  observations,
  benchmark,
  deliveryHours,
  campaign: job.campaign,
});
if (!assessment.ok) writeBlocked([{ code: assessment.code, message: assessment.message, detail: assessment.detail ?? null }]);

// Un episodio por candidato. Modo búsqueda: toda la grilla predeclarada, con
// el registro completo; sin elegir ni promover ganador (BT08-07). La
// validación del runner garantiza que el candidato está en el espacio.
const candidates = job.search === true
  ? job.searchSpace.candidates.map((point) => createHS1Candidate({ searchSpace: job.searchSpace, tau: point.tau, N: point.N }))
  : [{ ok: true, candidate: job.candidate }];

const tested = [];
for (const outcome of candidates) {
  if (!outcome.ok) {
    tested.push({ tau: null, N: null, status: "BLOCKED", blockers: [{ code: outcome.code, message: "the candidate is outside the predeclared space" }] });
    continue;
  }
  const episode = runHS1DevelopmentEpisode({
    runId: spec.runId,
    missionId: job.missionId,
    missionLabel: job.missionLabel,
    candidate: outcome.candidate,
    campaign: job.campaign,
    session,
    observations,
    sizing: job.sizing,
    execution: job.execution,
    fees: job.fees,
    evaluation: job.evaluation,
  });
  if (!episode.ok) {
    tested.push({ tau: outcome.candidate.tau, N: outcome.candidate.N, status: "BLOCKED", blockers: [{ code: episode.code, message: episode.message, detail: episode.detail ?? null }] });
    continue;
  }
  const ablation = pairedAblation({
    runId: spec.runId,
    campaign: job.campaign,
    missionId: job.missionId,
    controllerHash: episode.episode.controller.contentHash,
    calendarHash: episode.episode.calendarHash,
    executionHash: episode.episode.executionContractHash,
    benchmark: job.evaluation.benchmark,
    controlEpisode: episode.episode.control,
    activeEpisode: episode.episode.active,
  });
  tested.push({
    tau: outcome.candidate.tau,
    N: outcome.candidate.N,
    candidateHash: outcome.candidate.contentHash,
    status: "EPISODE_RECORDED",
    control: episode.episode.control,
    active: episode.episode.active,
    ablation,
  });
}

const blocked = tested.filter((record) => record.status === "BLOCKED");
const recorded = tested.filter((record) => record.status === "EPISODE_RECORDED");
const results = {
  artifactKind: "HYPOTHESIS_DEVELOPMENT_RESULTS",
  schemaVersion: "1",
  runId: spec.runId,
  specSha256,
  hypothesisId: job.hypothesisId,
  hypothesisName: job.hypothesisName,
  hypothesisVersion: job.hypothesisVersion,
  missionId: job.missionId,
  missionLabel: job.missionLabel,
  phase: job.phase,
  dataMode: job.dataMode,
  developmentPopulation: {
    campaignId: job.campaign.campaignId,
    populationId: job.campaign.populationId ?? null,
    obligationId: job.campaign.obligationId ?? null,
    targetVolumeMw: job.campaign.targetVolumeMw,
    tradingDates: job.campaign.tradingDates.length,
  },
  search: {
    enabled: job.search === true,
    testedConfigurations: tested.map((record) => ({
      tau: record.tau, N: record.N, status: record.status,
      candidateHash: record.candidateHash ?? null,
      boughtMwControl: record.control?.summary?.boughtMw ?? null,
      boughtMwActive: record.active?.summary?.boughtMw ?? null,
      ablationVerdict: record.ablation ? (record.ablation.ok ? "DELTA_PUBLISHED" : record.ablation.code ?? "HOLD") : "BLOCKED",
    })),
    // Ninguna configuración se declara ganadora ni se promueve aquí.
    winner: null,
    promotionStatus: "NOT_PROMOTED",
    objective: null,
    folds: null,
  },
  comparison: recorded.length === 1
    ? { control: recorded[0].control, active: recorded[0].active, ablation: recorded[0].ablation }
    : null,
  episodes: recorded.map((record) => ({ control: record.control, active: record.active, ablation: record.ablation })),
  blockers: blocked.flatMap((record) => record.blockers.map((blocker) => ({ ...blocker, tau: record.tau, N: record.N }))),
  status: recorded.length > 0 ? "JOB_COMPLETED" : "BLOCKED",
  // En modo búsqueda el registro de configuraciones no es una comparación
  // publicada: ninguna configuración se promueve a resultado vigente aquí.
  validComparison: job.search !== true && recorded.length === 1 && recorded[0].ablation.paired === true,
  scientificConclusion: null,
  researchPass: false,
  provenance: {
    authority: "BT-08 (intake D-20260928T161943-70c6, Bru 2026-09-28); HYP-1 real + SEM-1 comparability gate",
    specSha256,
    inputs: [job.inputManifest.availability, job.inputManifest.observations, job.inputManifest.benchmark, job.inputManifest.deliveryHours],
  },
};
writeResults(results);
