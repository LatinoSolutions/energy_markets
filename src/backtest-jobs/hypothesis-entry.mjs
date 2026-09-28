// BT-08: entry del job de hipótesis. Corre dentro del workspace (código staged
// del commit) con cwd = workspace y lee:
//   argv[2] = spec.json   (petición canónica validada por el runner)
//   argv[3] = resultados  (JSON con el episodio Development y su economía)
//   argv[4] = MANIFEST    (liga por hash resultados, spec e inputs)
// Ejecuta el HYP-1 real (src/s1-strategy) sobre los inputs verificados, previa
// adaptación por el contrato de productores (hypothesis-inputs.mjs) y el gate
// de inputs de development-episode.mjs. Una misión bloqueada (procedencia,
// frescura, warm-up, freeze, reserva, binding de benchmark) sale con código 3
// y blockers explícitos en inglés, nunca como éxito silencioso.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { contentHashOf } from "../sizing-controller/versioning.mjs";
import {
  assessDevelopmentInputs,
  pairedAblation,
  runHS1DevelopmentEpisode,
} from "../s1-strategy/development-episode.mjs";
import { createHS1Candidate } from "../s1-strategy/h-s1-01.mjs";
import { adaptDevelopmentInputs } from "./hypothesis-inputs.mjs";

const sha256Of = (bytes) => createHash("sha256").update(bytes).digest("hex");
const [specPath, resultsPath, manifestPath] = process.argv.slice(2);

const specBytes = readFileSync(specPath);
const spec = JSON.parse(specBytes);
const job = spec.job;
// El specSha256 canónico reconstruye la forma sin timestamps: es el valor que
// ata la identidad del run (canonicalSpecOf en hypothesis-runner.mjs).
const specSha256 = sha256Of(Buffer.from(JSON.stringify({ artifactKind: spec.artifactKind, schemaVersion: spec.schemaVersion, job })));

const readInput = (entry) => JSON.parse(readFileSync(entry.path, "utf8"));
const files = {
  availability: readInput(job.inputManifest.availability),
  observations: readInput(job.inputManifest.observations),
  benchmark: readInput(job.inputManifest.benchmark),
  deliveryHours: readInput(job.inputManifest.deliveryHours),
};

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
      { path: "src/backtest-jobs/hypothesis-inputs.mjs", sha256: sha256Of(readFileSync("src/backtest-jobs/hypothesis-inputs.mjs")) },
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

// 1) Adaptación producer→motor (hallazgo BT08-T04): formato, procedencia y
// campos de documento; lo ausente queda bloqueado, nunca improvisado.
const adapted = adaptDevelopmentInputs(files, job.missionId);
if (!adapted.ok) writeBlocked(adapted.blockers.map(({ ok, ...blocker }) => blocker));
const { availability, observations, benchmark: benchmarkDocument, session, deliveryHours } = adapted.inputs;

// 2) La disponibilidad corrida es la predeclarada por el search space
// (hallazgo BT08-T07): mismo hash de filas y mismos límites de Development;
// datos añadidos u observaciones tras la frontera no corren.
if (contentHashOf(availability) !== job.searchSpace.availabilityHash) {
  writeBlocked([{
    code: "AVAILABILITY_NOT_PREDECLARED",
    message: "the availability rows executed by this run do not match the availability predeclared by the search space",
  }]);
}
const developmentEndUtc = job.searchSpace.developmentEndUtc;
const outsideFrontier = observations.find((row) => Date.parse(row.availableAtUtc) >= Date.parse(developmentEndUtc)) ?? null;
if (outsideFrontier !== null) {
  writeBlocked([{
    code: "NON_DEVELOPMENT_OBSERVATION",
    message: `the decision-price observation for ${outsideFrontier.date} is not inside the predeclared Development boundary`,
    date: outsideFrontier.date,
  }]);
}

// 3) El benchmark comprometido tiene que ser exactamente la referencia
// declarada en la petición (hallazgo BT08-T12), atada a ESTA campaña y a la
// ventana canónica de la misión: una sola identidad BENCHMARK, sin segunda
// verdad y sin benchmarks de otra campaña o revisión.
const declared = job.evaluation.benchmark;
if (benchmarkDocument.identity !== declared.identity || benchmarkDocument.version !== declared.version
  || benchmarkDocument.status !== declared.status || benchmarkDocument.value !== declared.value
  || benchmarkDocument.unit !== declared.unit || benchmarkDocument.artifactSha256 !== declared.artifactSha256
  || benchmarkDocument.campaignId !== declared.campaignId || benchmarkDocument.obligationId !== declared.obligationId) {
  writeBlocked([{ code: "BINDING_INVALID", message: "the committed benchmark artifact does not match the declared evaluation reference of this campaign" }]);
}
const benchmark = { ...benchmarkDocument, sourceHash: job.inputManifest.benchmark.sha256 };

// 4) Gate semántico de inputs (BT08-05); freeze y reserva incluidos.
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
// validación del runner garantiza que el candidato está en el espacio, y el
// objetivo/pliegues ya están predeclarados EN el search space (BT08-14).
const candidates = job.search === true
  ? job.searchSpace.candidates.map((point) => {
    const outcome = createHS1Candidate({ searchSpace: job.searchSpace, tau: point.tau, N: point.N });
    return { ...outcome, point };
  })
  : [{ ok: true, candidate: job.candidate, point: job.searchSpace.candidates.find((p) => p.N === job.candidate.N && p.tau.localTime === job.candidate.tau.localTime) ?? null }];

// Pliegues predeclarados por candidato: ventana móvil expansiva sobre los
// días avalados por el espacio; el motor no elige folds tras ver resultados.
function foldsFor(point, N) {
  if (!point || !job.searchSpace.evaluationContract) return null;
  return {
    rule: job.searchSpace.evaluationContract.foldRule,
    anchor: point.tau.localTime,
    warmUpDays: N,
    evaluationDays: Math.max(0, point.supportedDays - N),
  };
}
const objective = job.searchSpace.evaluationContract?.objective ?? null;

const tested = [];
for (const outcome of candidates) {
  if (!outcome.ok) {
    tested.push({ tau: null, N: null, status: "BLOCKED", blockers: [{ code: outcome.code, message: "the candidate is outside the predeclared space" }] });
    continue;
  }
  const folds = foldsFor(outcome.point, outcome.candidate.N);
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
    evaluation: { benchmark, deliveryHours },
  });
  if (!episode.ok) {
    tested.push({
      tau: outcome.candidate.tau, N: outcome.candidate.N, objective, folds,
      status: "BLOCKED", blockers: [{ code: episode.code, message: episode.message, detail: episode.detail ?? null }],
    });
    continue;
  }
  const ablation = pairedAblation({
    runId: spec.runId,
    campaign: job.campaign,
    missionId: job.missionId,
    controllerHash: episode.episode.controller.contentHash,
    calendarHash: episode.episode.calendarHash,
    executionHash: episode.episode.executionContractHash,
    benchmark: { ...declared, sourceHash: benchmark.sourceHash },
    controlEpisode: episode.episode.control,
    activeEpisode: episode.episode.active,
  });
  tested.push({
    tau: outcome.candidate.tau,
    N: outcome.candidate.N,
    candidateHash: outcome.candidate.contentHash,
    objective,
    folds,
    status: "EPISODE_RECORDED",
    control: episode.episode.control,
    active: episode.episode.active,
    ablation,
  });
}

const blocked = tested.filter((record) => record.status === "BLOCKED");
const recorded = tested.filter((record) => record.status === "EPISODE_RECORDED");
const singleAblation = recorded.length === 1 ? recorded[0].ablation : null;
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
      objective: record.objective ?? null,
      folds: record.folds ?? null,
      boughtMwControl: record.control?.summary?.boughtMw ?? null,
      boughtMwActive: record.active?.summary?.boughtMw ?? null,
      ablationVerdict: record.ablation ? (record.ablation.ok ? "DELTA_PUBLISHED" : record.ablation.code ?? "HOLD") : "BLOCKED",
    })),
    // En modo búsqueda el objetivo y los pliegues predeclarados quedan
    // vinculados y presentes en el registro completo (hallazgo BT08-T14);
    // ninguna configuración se declara ganadora ni se promueve aquí.
    objective: job.search === true ? objective : null,
    folds: job.search === true ? recorded.map((record) => record.folds) : null,
    winner: null,
    promotionStatus: "NOT_PROMOTED",
  },
  comparison: recorded.length === 1
    ? { control: recorded[0].control, active: recorded[0].active, ablation: singleAblation }
    : null,
  episodes: recorded.map((record) => ({ control: record.control, active: record.active, ablation: record.ablation })),
  blockers: blocked.flatMap((record) => record.blockers.map((blocker) => ({ ...blocker, tau: record.tau, N: record.N }))),
  status: recorded.length > 0 ? "JOB_COMPLETED" : "BLOCKED",
  // Comparación publicada (hallazgo BT08-T11) sólo si el gate SEM-1 publicó un
  // delta válido (ablation.ok): benchmark provisional, fees unknown, cobertura
  // desigual o bundle fuera del espacio la dejan false, nunca "probada".
  validComparison: job.search !== true && singleAblation !== null && singleAblation.paired === true && singleAblation.ok === true,
  scientificConclusion: null,
  researchPass: false,
  provenance: {
    authority: "BT-08 (intake D-20260928T161943-70c6, Bru 2026-09-28); HYP-1 real + SEM-1 comparability gate",
    specSha256,
    inputs: [job.inputManifest.availability, job.inputManifest.observations, job.inputManifest.benchmark, job.inputManifest.deliveryHours],
  },
};
writeResults(results);
