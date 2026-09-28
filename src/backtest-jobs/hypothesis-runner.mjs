// BT-08 (PLAN_STATUS fila BT-08, intake D-20260928T161943-70c6, Bru 2026-09-28):
// jobs de hipótesis H-S1-01 por la MISMA ruta canónica de BT-05/BT-07.
//
//   - Un solo motor: comparte el lock por generaciones y el directorio de runs
//     de BT-05 (mismo runsRoot), el proceso hijo acotado y el patrón de
//     receipt/manifest/registro append-only. No hay segundo motor ni servicio.
//   - La petición ata hipótesis/versión, misión canónica, fase DEVELOPMENT,
//     modo de datos y referencias candidate/search-space/config por hash.
//     Desconocida o mal atada: fail-closed, sin fallback a DIP10/HOUR.
//   - Identidad: run_id = sha256 de {commit, hashes de inputs, spec canónico,
//     parámetros, versión del motor}; mismo run_id con resultado = reutilizado.
//     Los pointers vigente/superado se llevan POR FAMILIA
//     hipótesis+misión+fase+modo: Power nunca reemplaza el vigente de Gas.
//   - Readiness por misión en modo lectura (nunca corre el backtest): fuente
//     ausente, provenance/frescura, warm-up, binding, freeze o reserva quedan
//     explícitos en inglés, sin presentar fixture como dato real.

import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, copyFileSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalValueSha256 } from "../pit-views/pit-record.mjs";
import { MISSIONS as SEM_MISSIONS, MISSION_LABELS } from "../backtesting-semantics/contract.mjs";
import { contentHashOf } from "../sizing-controller/versioning.mjs";
import {
  DEVELOPMENT_PHASE,
  EPISODE_SCHEMA_VERSION,
  EXECUTION_MODEL,
  assessAvailabilityRows,
  assessDevelopmentInputs,
} from "../s1-strategy/development-episode.mjs";
import {
  adaptAvailabilitySource,
  adaptBenchmarkSource,
  adaptDeliveryHoursSource,
  adaptObservationsSource,
} from "./hypothesis-inputs.mjs";
import { createHS1Candidate, H_S1_01, H_S1_01_MISSIONS, H_S1_01_N_GRID } from "../s1-strategy/h-s1-01.mjs";import {
  JOB_STATUS,
  REGISTRY_EVENT,
  RESULT_STATE,
  claimJobLock,
  readCgroupMemoryPeak,
  readJobLock,
  releaseJobLock,
} from "./runner.mjs";

export const HYPOTHESIS_JOB_KIND = "HYPOTHESIS_DEVELOPMENT";
export const HYPOTHESIS_JOB_VERSION = "1";
export const HYPOTHESIS_RECEIPT_KIND = "BT-08_HYPOTHESIS_RUN_RECEIPT";
export const HYPOTHESIS_REGISTRY_FILE = "HYPOTHESIS_REGISTRY.jsonl";
export const HYPOTHESIS_ENTRY = "src/backtest-jobs/hypothesis-entry.mjs";
export const HYPOTHESIS_ENGINE = "src/s1-strategy/development-episode.mjs";
export const HYPOTHESIS_SPEC_FILE = "spec.json";
export const HYPOTHESIS_RESULTS_PATH = "output/hypothesis-development-results.json";
export const HYPOTHESIS_MANIFEST_PATH = "output/hypothesis-development-results.MANIFEST.json";
export const HYPOTHESIS_DEVELOPMENT_DATA_ROOT = "operations/hypothesis/H-S1-01/development";
export const HYPOTHESIS_DATA_MODES = Object.freeze(["TOB"]);
// PROVISIONAL (REGLA 2): techo de tiempo para que un job colgado no bloquee el
// lock. Recalibrar con la duración medida del primer run real de Bru.
export const HYPOTHESIS_TIMEOUT_MS = 30 * 60 * 1000;

const CHILD_ENTRY = fileURLToPath(new URL("./child-entry.mjs", import.meta.url));
const HYP_RUN_ID_PATTERN = /^HYP-RUN-[0-9a-f]{64}$/;
const ATTEMPT_DIR_PATTERN = /^attempt-(\d+)$/;
const PINNED_CODE_PATHS = ["src", HYPOTHESIS_ENTRY];
const RECEIPT_FILE = "RUN_RECEIPT.json";
const WORKSPACE_DIR = "workspace";
const OUTPUT_DIR = "output";
const WORKSPACE_RETENTION = "TEMPORARY";
const MAX_TRADING_DATES = 400;

const sha256Of = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isHash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isIsoDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJsonAtomic(file, value) {
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 1));
  renameSync(temporary, file);
}

function relative(repoRoot, absolute) {
  return path.relative(repoRoot, absolute).split(path.sep).join("/");
}

// ---------- validación de la petición canónica (BT08-01) ----------

const missionLabelOf = (missionId) => SEM_MISSIONS.find((mission) => mission.id === missionId) ? MISSION_LABELS[missionId] : null;

function requestError(code, message, field = null) {
  return { ok: false, code, message, ...(field ? { field } : {}) };
}

function validateProvenance(provenance, field) {
  if (!provenance || typeof provenance !== "object"
    || !isNonEmptyString(provenance.authority) || !isNonEmptyString(provenance.locator)) {
    return requestError("BINDING_INVALID", `${field} must declare provenance with authority and locator`, field);
  }
  return null;
}

function validateInputEntry(entry, field, missionId) {
  // Las entradas de la misión son de la misión pedida (hallazgo BT08-T06):
  // archivos de otra misión no pueden atar este run.
  if (!entry || !isNonEmptyString(entry.path) || path.isAbsolute(entry.path)
    || entry.path.includes("..") || !entry.path.startsWith(`${HYPOTHESIS_DEVELOPMENT_DATA_ROOT}/${missionId}/`)) {
    return requestError("MISSION_INPUT_MISMATCH", `${field} must reference a file under ${HYPOTHESIS_DEVELOPMENT_DATA_ROOT}/${missionId}/`, field);
  }
  if (!isHash(entry.sha256)) {
    return requestError("HASH_MISMATCH", `${field}.sha256 is not a sha256 binding`, field);
  }
  return null;
}

// La petición canónica de un job de hipótesis. Desconocida, mal atada o fuera
// de la grilla predeclarada: fail-closed (nunca un fallback a DIP10/HOUR).
export function validateHypothesisJobRequest(job) {
  if (!job || typeof job !== "object" || Array.isArray(job)) {
    return requestError("INVALID_HYPOTHESIS_REQUEST", "the hypothesis job request is malformed");
  }
  if (job.hypothesisId !== H_S1_01.hypothesisId) {
    return requestError("UNKNOWN_HYPOTHESIS", `hypothesis "${String(job.hypothesisId ?? "")}" is not a registered runnable hypothesis on this path`);
  }
  if (job.hypothesisVersion !== H_S1_01.version) {
    return requestError("HYPOTHESIS_VERSION_MISMATCH", `hypothesis version must be ${H_S1_01.version}`);
  }
  if (!SEM_MISSIONS.some((mission) => mission.id === job.missionId)) {
    return requestError("UNKNOWN_MISSION", `mission "${String(job.missionId ?? "")}" is not a canonical mission`);
  }
  const missionLabel = missionLabelOf(job.missionId);
  if (!H_S1_01_MISSIONS.includes(missionLabel)) {
    return requestError("MISSION_NOT_APPLICABLE", `hypothesis ${H_S1_01.hypothesisId} does not declare mission ${job.missionId}`);
  }
  if (job.phase !== DEVELOPMENT_PHASE) {
    return requestError("PHASE_NOT_DEVELOPMENT", `phase must be ${DEVELOPMENT_PHASE}; OOS, Bridge and Forward are rejected on the hypothesis path`);
  }
  if (!HYPOTHESIS_DATA_MODES.includes(job.dataMode)) {
    return requestError("INVALID_DATA_MODE", `data mode must be one of ${HYPOTHESIS_DATA_MODES.join(", ")}`);
  }
  const space = job.searchSpace;
  if (!space || space.artifactKind !== "HYPOTHESIS_SEARCH_SPACE" || space.mission !== missionLabel
    || space.hypothesisHash !== H_S1_01.contentHash || space.status !== "PREDECLARED_UNCALIBRATED") {
    return requestError("SEARCH_SPACE_INTEGRITY", "the search space artifact does not bind the accepted hypothesis definition and mission");
  }
  const candidate = job.candidate;
  if (!candidate || candidate.artifactKind !== "HYPOTHESIS_CANDIDATE") {
    return requestError("CANDIDATE_INTEGRITY", "the candidate artifact is missing or malformed");
  }
  // El candidato se reproduce con el HYP-1 real: fuera de la grilla
  // predeclarada o con hash alterado, no arranca (BT08-07).
  const rebuilt = createHS1Candidate({ searchSpace: space, tau: candidate.tau, N: candidate.N });
  if (!rebuilt.ok) {
    return requestError("OUTSIDE_PREDECLARED_SPACE", `the candidate (N=${String(candidate.N)}) is outside the predeclared search space`, { code: rebuilt.code });
  }
  if (rebuilt.candidate.contentHash !== candidate.contentHash) {
    return requestError("CANDIDATE_INTEGRITY", "the candidate content hash does not match the candidate rebuilt from the predeclared search space");
  }
  if (job.configuration !== undefined && job.configuration !== null) {
    const configuration = job.configuration;
    if (configuration.artifactKind !== "HYPOTHESIS_MISSION_CONFIGURATION"
      || configuration.hypothesisId !== H_S1_01.hypothesisId
      || configuration.hypothesisVersion !== H_S1_01.version
      || configuration.missionId !== job.missionId
      || configuration.candidateHash !== candidate.contentHash
      || configuration.searchSpaceHash !== space.contentHash) {
      return requestError("CONFIGURATION_INTEGRITY", "the mission configuration does not bind this hypothesis, mission and candidate");
    }
    if (configuration.tau !== undefined && configuration.tau !== candidate.tau.localTime) {
      return requestError("PARAMETER_CANDIDATE_MISMATCH", "the declared tau does not match the bound candidate");
    }
    if (configuration.N !== undefined && configuration.N !== candidate.N) {
      return requestError("PARAMETER_CANDIDATE_MISMATCH", "the declared N does not match the bound candidate");
    }
    // Íntegridad completa (hallazgo BT08-T08): el configurationHash declarado
    // se recalcula contra el contenido; un campo alterado conservando el hash
    // no entra al run.
    const { configurationHash, ...configurationCore } = configuration;
    if (!isHash(configurationHash) || contentHashOf(configurationCore) !== configurationHash) {
      return requestError("CONFIGURATION_INTEGRITY", "the mission configuration content does not match its declared configurationHash");
    }
  }
  const campaign = job.campaign;
  if (!campaign || !isNonEmptyString(campaign.campaignId) || !Array.isArray(campaign.tradingDates)
    || campaign.tradingDates.length === 0 || campaign.tradingDates.length > MAX_TRADING_DATES
    || !campaign.tradingDates.every(isIsoDate)
    || new Set(campaign.tradingDates).size !== campaign.tradingDates.length
    || !isFiniteNumber(campaign.targetVolumeMw) || campaign.targetVolumeMw <= 0) {
    return requestError("BINDING_INVALID", "campaign must bind campaignId, unique ISO tradingDates and a positive targetVolumeMw");
  }
  const campaignProvenance = validateProvenance(campaign.provenance, "campaign.provenance");
  if (campaignProvenance) return campaignProvenance;
  const sizing = job.sizing;
  if (!sizing || !Number.isInteger(sizing.lotSizeMw) || sizing.lotSizeMw <= 0
    || !isFiniteNumber(sizing.dailyCapMw) || sizing.dailyCapMw <= 0) {
    return requestError("BINDING_INVALID", "sizing must declare a positive integer lotSizeMw and a positive dailyCapMw of this mission");
  }
  const sizingProvenance = validateProvenance(sizing.provenance, "sizing.provenance");
  if (sizingProvenance) return sizingProvenance;
  const execution = job.execution;
  if (!execution || execution.model !== EXECUTION_MODEL
    || !isFiniteNumber(execution.slippageEurMwh) || execution.slippageEurMwh < 0) {
    return requestError("BINDING_INVALID", `execution must bind model ${EXECUTION_MODEL} and a non-negative slippageEurMwh`);
  }
  const executionProvenance = validateProvenance(execution.provenance, "execution.provenance");
  if (executionProvenance) return executionProvenance;
  const fees = job.fees;
  if (!fees || !Object.values({ KNOWN: "KNOWN", UNKNOWN: "UNKNOWN" }).includes(fees.status)) {
    return requestError("BINDING_INVALID", "fees must declare status KNOWN or UNKNOWN");
  }
  if (fees.status === "KNOWN") {
    if (!Array.isArray(fees.costs) || !fees.costs.every((cost) => isNonEmptyString(cost?.label) && isFiniteNumber(cost?.valueEurMwh))) {
      return requestError("BINDING_INVALID", "known fees must enumerate labeled valueEurMwh costs");
    }
  } else if (fees.costs !== undefined) {
    return requestError("BINDING_INVALID", "unknown fees must not enumerate costs; unknown stays unknown, never zero");
  }
  const feesProvenance = validateProvenance(fees.provenance, "fees.provenance");
  if (feesProvenance) return feesProvenance;
  const evaluation = job.evaluation;
  const benchmark = evaluation?.benchmark;
  if (!benchmark || benchmark.identity !== "BENCHMARK" || !isNonEmptyString(benchmark.version)
    || !["BENCHMARK_PROVISIONAL", "RECONCILED_OFFICIAL"].includes(benchmark.status)
    || !isFiniteNumber(benchmark.value) || benchmark.unit !== "EUR/MWh" || !isHash(benchmark.artifactSha256)) {
    return requestError("BINDING_INVALID", "evaluation.benchmark must bind one BENCHMARK identity with version, status, unit EUR/MWh and artifact hash");
  }
  // Un benchmark declarado ata ESTA campaña y obligación (hallazgo BT08-T12):
  // una referencia oficial de otra campaña o revisión no publica nada aquí.
  if (!isNonEmptyString(benchmark.campaignId) || !isNonEmptyString(benchmark.obligationId)
    || benchmark.campaignId !== campaign.campaignId || benchmark.obligationId !== campaign.obligationId) {
    return requestError("BINDING_INVALID", "evaluation.benchmark must bind the campaign's own campaignId and obligationId");
  }
  const benchmarkProvenance = validateProvenance(benchmark.provenance, "evaluation.benchmark.provenance");
  if (benchmarkProvenance) return benchmarkProvenance;
  if (job.search !== undefined && typeof job.search !== "boolean") {
    return requestError("INVALID_HYPOTHESIS_REQUEST", "search must be a boolean");
  }
  const manifest = job.inputManifest;
  if (!manifest || typeof manifest !== "object") {
    return requestError("BINDING_INVALID", "inputManifest is required");
  }
  const requiredInputs = ["availability", "observations", "benchmark", "deliveryHours"];
  for (const field of requiredInputs) {
    const problem = validateInputEntry(manifest[field], `inputManifest.${field}`, job.missionId);
    if (problem) return problem;
  }
  const paths = requiredInputs.map((field) => manifest[field].path);
  if (new Set(paths).size !== paths.length) {
    return requestError("BINDING_INVALID", "inputManifest entries must reference distinct files");
  }
  // La referencia de horas de entrega es el archivo hash-bound (una sola
  // verdad); el request la referencia, no la duplica.
  const deliveryHours = evaluation.deliveryHours;
  if (!deliveryHours || deliveryHours.path !== manifest.deliveryHours.path || deliveryHours.sha256 !== manifest.deliveryHours.sha256) {
    return requestError("BINDING_INVALID", "evaluation.deliveryHours must reference the hash-bound delivery-hours file; MW is never converted to MWh without evidenced hours");
  }
  return {
    ok: true,
    request: {
      hypothesisId: H_S1_01.hypothesisId,
      hypothesisName: H_S1_01.name,
      hypothesisVersion: H_S1_01.version,
      hypothesisHash: H_S1_01.contentHash,
      missionId: job.missionId,
      missionLabel,
      phase: DEVELOPMENT_PHASE,
      dataMode: job.dataMode,
      searchSpace: space,
      candidate,
      configuration: job.configuration ?? null,
      campaign: campaign,
      sizing,
      execution,
      fees,
      evaluation,
      search: job.search === true,
      inputManifest: { availability: manifest.availability, observations: manifest.observations, benchmark: manifest.benchmark, deliveryHours: manifest.deliveryHours },
    },
  };
}

// ---------- identidad (BT08-08) ----------

// Forma canónica del spec que ata la identidad: sólo la petición validada, sin
// timestamps ni requestedBy, para que la misma petición dé el mismo run_id.
export function canonicalSpecOf(request) {
  return JSON.stringify({ artifactKind: "HYPOTHESIS_EXPERIMENT_SPEC", schemaVersion: EPISODE_SCHEMA_VERSION, job: request });
}

export function familyKeyOf(request) {
  return `${request.hypothesisId}|${request.missionId}|${request.phase}|${request.dataMode}`;
}

export function computeHypothesisRunIdentity({ codeCommit, files, specSha256, request }) {
  const identity = {
    codeCommit,
    inputFilesSha256: canonicalValueSha256(files.map((file) => ({ path: file.path, sha256: file.sha256 }))).sha256,
    specSha256,
    parameters: {
      jobKind: HYPOTHESIS_JOB_KIND,
      entry: HYPOTHESIS_ENTRY,
      family: familyKeyOf(request),
      hypothesisId: request.hypothesisId,
      hypothesisVersion: request.hypothesisVersion,
      missionId: request.missionId,
      phase: request.phase,
      dataMode: request.dataMode,
      candidateHash: request.candidate.contentHash,
      searchSpaceHash: request.searchSpace.contentHash,
      configurationHash: request.configuration?.configurationHash ?? null,
      sizingVersion: canonicalValueSha256(request.sizing).sha256,
      executionVersion: canonicalValueSha256(request.execution).sha256,
      evaluationVersion: canonicalValueSha256(request.evaluation).sha256,
      search: request.search,
    },
    engineVersion: HYPOTHESIS_JOB_VERSION,
  };
  return { runId: `HYP-RUN-${canonicalValueSha256(identity).sha256}`, identity };
}

// ---------- verificación de inputs ----------

function verifyInputFiles(repoRoot, files) {
  const verified = [];
  for (const file of files) {
    let bytes;
    try {
      bytes = readFileSync(path.join(repoRoot, file.path));
    } catch {
      return { ok: false, code: "INPUT_MISSING", path: file.path };
    }
    const actual = sha256Of(bytes);
    if (actual !== file.sha256) {
      return { ok: false, code: "INPUT_HASH_MISMATCH", path: file.path, expected: file.sha256, actual };
    }
    verified.push({ path: file.path, sha256: actual });
  }
  return { ok: true, files: verified };
}

function inputFilesOf(request) {
  const declared = request.inputManifest;
  return [declared.availability, declared.observations, declared.benchmark, declared.deliveryHours];
}

function git(repoRoot, args) {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

export function readHypothesisCodeCommit(repoRoot) {
  const head = git(repoRoot, ["rev-parse", "--verify", "HEAD"])?.trim() ?? "";
  if (!/^[0-9a-f]{40}$/.test(head)) {
    return { ok: false, code: "CODE_COMMIT_UNKNOWN", message: "the git commit of the code could not be read" };
  }
  const dirty = git(repoRoot, ["status", "--porcelain", "--untracked-files=all", "--", ...PINNED_CODE_PATHS]);
  if (dirty === null) {
    return { ok: false, code: "CODE_COMMIT_UNKNOWN", message: "git status of the code could not be read" };
  }
  if (dirty.trim().length > 0) {
    const paths = dirty.trim().split("\n").slice(0, 5).map((line) => line.slice(3));
    return { ok: false, code: "CODE_NOT_COMMITTED", message: `the code has uncommitted changes: ${paths.join(", ")}` };
  }
  return { ok: true, commit: head };
}

// ---------- readiness read-only por misión (BT08-03) ----------

function readJsonOrNull(repoRoot, relativePath) {
  try {
    return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8"));
  } catch {
    return null;
  }
}

// Readiness de UNA misión en modo lectura: nunca corre el backtest ni consume
const hypothesisReadinessBlockerShape = (adapterBlockers) => adapterBlockers.map(({ ok, ...blocker }) => blocker);

// Readiness de UNA misión en modo lectura: nunca corre el backtest ni consume
// nada. Códigos en inglés para UI-08; el estado real del repo manda. Ya no
// basta la presencia de archivos (hallazgo BT08-T05): cada fuente pasa por el
// adaptador de productores y el gate de inputs completo (contenido, freeze,
// reserva y horas de entrega) sin ejecutar nada.
export function hypothesisReadinessForMission(repoRoot, missionId) {
  const missionLabel = missionLabelOf(missionId);
  if (!missionLabel) {
    return { missionId, missionLabel: null, status: "BLOCKED", blockers: [{ code: "UNKNOWN_MISSION", message: `"${String(missionId)}" is not a canonical mission` }] };
  }
  const blockers = [];
  const base = `${HYPOTHESIS_DEVELOPMENT_DATA_ROOT}/${missionId}`;
  const loaded = new Map();
  for (const [field, file] of [["availability", "availability.json"], ["observations", "observations.json"], ["benchmark", "benchmark.json"], ["deliveryHours", "delivery-hours.json"]]) {
    const document = readJsonOrNull(repoRoot, `${base}/${file}`);
    if (document === null) {
      blockers.push({ code: "SOURCE_MISSING", message: `no ${field} source is committed under ${base}/${file}` });
    } else {
      loaded.set(field, document);
    }
  }
  let availabilityOutcome = null;
  if (loaded.has("availability")) {
    // Diagnóstico semántico por fila también en readiness: un documento con
    // filas inválidas sigue reportando el código exacto (PROVENANCE_INVALID).
    const document = loaded.get("availability");
    if (Array.isArray(document?.availability)) {
      const assessment = assessAvailabilityRows({ session: document.session, availability: document.availability });
      if (!assessment.ok) blockers.push({ code: assessment.code, message: assessment.message });
    }
    availabilityOutcome = adaptAvailabilitySource(document, missionId);
    if (!availabilityOutcome.ok) {
      blockers.push(...hypothesisReadinessBlockerShape(availabilityOutcome.blockers));
    } else {
      const warmUp = warmUpBlocker(document);
      if (warmUp) blockers.push(warmUp);
      if (document.availability?.some?.((row) => row.requiresFreeze === true) && !isHash(document.freezeArtifactSha256)) {
        blockers.push({ code: "FREEZE_PENDING", message: "the availability source declares a required freeze that is not bound" });
      }
    }
  }
  const adaptedOk = new Map([["availability", Boolean(availabilityOutcome?.ok)], ["observations", false], ["benchmark", false], ["deliveryHours", false]]);
  for (const field of ["observations", "benchmark", "deliveryHours"]) {
    if (!loaded.has(field)) continue;
    const outcome = field === "deliveryHours"
      ? adaptDeliveryHoursSource(loaded.get(field))
      : field === "benchmark"
        ? adaptBenchmarkSource(loaded.get(field), missionId)
        : adaptObservationsSource(loaded.get(field), missionId);
    adaptedOk.set(field, outcome.ok);
    if (!outcome.ok) blockers.push(...hypothesisReadinessBlockerShape(outcome.blockers));
  }
  // Contenido completo (hallazgo BT08-T05): con las cuatro fuentes presentes,
  // adaptadas y la disponibilidad con filas válidas, el mismo gate del child
  // (sin campaña para la ventana por día) evalúa rows, benchmark, freeze y
  // reserva; aquí no corre el run.
  if (availabilityOutcome?.ok === true && [...adaptedOk.values()].every(Boolean)) {
    const assessment = assessDevelopmentInputs({
      session: availabilityOutcome.session,
      availability: availabilityOutcome.availability,
      observations: adaptObservationsSource(loaded.get("observations"), missionId).observations,
      benchmark: adaptBenchmarkSource(loaded.get("benchmark"), missionId).benchmark,
      deliveryHours: adaptDeliveryHoursSource(loaded.get("deliveryHours")).deliveryHours,
      campaign: null,
    });
    if (!assessment.ok) blockers.push({ code: assessment.code, message: assessment.message, ...(assessment.detail ? { detail: assessment.detail } : {}) });
  }
  return {
    missionId,
    missionLabel,
    status: blockers.length === 0 ? "RUNNABLE" : "BLOCKED",
    blockers,
  };
}

// Warm-up: sin N+1 días con PIT válido para algún N de la grilla, la misión no
// soporta ningún candidato (HYP-1: DATA_BLOCKED, nunca señal inventada).
function warmUpBlocker(availability) {
  const rows = availability?.availability;
  if (!Array.isArray(rows)) return null;
  const byAnchor = new Map();
  for (const row of rows) {
    if (row.available === true) (byAnchor.get(row.anchor) ?? byAnchor.set(row.anchor, new Set()).get(row.anchor)).add(row.sessionDate);
  }
  const supports = [...byAnchor.values()].some((days) => H_S1_01_N_GRID.some((N) => days.size >= N + 1));
  return supports ? null : { code: "WARM_UP_BLOCKED", message: "no anchor has enough PIT-valid Development days for any N of the predeclared grid; the mission stays DATA_BLOCKED" };
}

export function hypothesisReadiness(repoRoot, missionIds = SEM_MISSIONS.map((mission) => mission.id)) {
  return missionIds.map((missionId) => hypothesisReadinessForMission(repoRoot, missionId));
}

// Metadatos canónicos en inglés para UI-08 (BT08-10): identidad de la
// hipótesis aceptada de HYP-1/FIX-07, sin segundo registro ni traducción en la
// UI. La pregunta aceptada del HYP-1 no se reemite aquí: es artifact histórico.
export function hypothesisMetadata() {
  return {
    hypothesisId: H_S1_01.hypothesisId,
    name: H_S1_01.name,
    version: H_S1_01.version,
    hypothesisHash: H_S1_01.contentHash,
    comparator: H_S1_01.comparator,
    missions: [...H_S1_01_MISSIONS],
    runnablePhases: [DEVELOPMENT_PHASE],
    dataModes: [...HYPOTHESIS_DATA_MODES],
    nGrid: [...H_S1_01_N_GRID],
  };
}

// ---------- runner ----------

function listFilesUnder(root, relativeDir) {
  const files = [];
  for (const entry of readdirSync(path.join(root, relativeDir), { withFileTypes: true })) {
    const child = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...listFilesUnder(root, child));
    else files.push(child);
  }
  return files;
}

function stagedCodeSeal(workspace) {
  const files = [...listFilesUnder(workspace, "src")].sort()
    .map((relativePath) => ({ path: relativePath, sha256: sha256Of(readFileSync(path.join(workspace, relativePath))) }));
  return { files: files.length, sha256: canonicalValueSha256(files).sha256 };
}

function stageWorkspace(repoRoot, workspace, commit, files) {
  mkdirSync(workspace, { recursive: true });
  const archive = `${workspace}.code.tar`;
  try {
    execFileSync("git", ["archive", "--format=tar", "-o", archive, commit, "--", ...PINNED_CODE_PATHS], { cwd: repoRoot, stdio: ["ignore", "ignore", "pipe"] });
    execFileSync("tar", ["-xf", archive, "-C", workspace], { stdio: ["ignore", "ignore", "pipe"] });
  } finally {
    rmSync(archive, { force: true });
  }
  for (const file of files) {
    if (file.path.startsWith("src/")) continue;
    const target = path.join(workspace, file.path);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(repoRoot, file.path), target);
    if (sha256Of(readFileSync(target)) !== file.sha256) {
      throw new Error(`staged copy differs from the verified input: ${file.path}`);
    }
  }
  return stagedCodeSeal(workspace);
}

function preserveOutput(workspace, outputDir, relativePath, sha256) {
  const inWorkspace = path.relative(workspace, path.resolve(workspace, relativePath));
  const escapes = inWorkspace === "" || inWorkspace === ".." || inWorkspace.startsWith(`..${path.sep}`) || path.isAbsolute(inWorkspace);
  if (escapes) throw new Error(`path outside the workspace: ${relativePath}`);
  const source = path.join(workspace, inWorkspace);
  const target = path.join(outputDir, inWorkspace);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
  if (sha256Of(readFileSync(target)) !== sha256) throw new Error(`preserved copy differs from the original: ${relativePath}`);
  return target;
}

function discardWorkspace(workspace) {
  try {
    rmSync(workspace, { recursive: true, force: true });
    return { removed: true };
  } catch (error) {
    return { removed: false, error: String(error?.message ?? error) };
  }
}

function runManifest(receipt) {
  return {
    runId: receipt.runId,
    attempt: receipt.attempt,
    jobKind: receipt.jobKind,
    family: receipt.identity?.parameters?.family ?? null,
    identity: receipt.identity,
    inputs: receipt.inputs,
    requestedBy: receipt.requestedBy,
    startedAt: receipt.startedAt,
    finishedAt: receipt.finishedAt ?? null,
    status: receipt.status,
    failureCode: receipt.failure?.code ?? null,
    memoryPeak: { childMaxRssKb: receipt.memory?.childMaxRssKb ?? null },
    resultSha256: receipt.result?.results?.sha256 ?? null,
    receiptPath: receipt.receiptPath,
  };
}

export function publicHypothesisJobView(receipt, retention = null) {
  if (receipt == null) return null;
  return {
    runId: receipt.runId,
    attempt: receipt.attempt ?? null,
    jobKind: receipt.jobKind,
    family: receipt.identity?.parameters?.family ?? null,
    hypothesisId: receipt.identity?.parameters?.hypothesisId ?? null,
    hypothesisVersion: receipt.identity?.parameters?.hypothesisVersion ?? null,
    missionId: receipt.identity?.parameters?.missionId ?? null,
    phase: receipt.identity?.parameters?.phase ?? null,
    dataMode: receipt.identity?.parameters?.dataMode ?? null,
    status: receipt.status,
    requestedBy: receipt.requestedBy,
    startedAt: receipt.startedAt,
    finishedAt: receipt.finishedAt ?? null,
    failure: receipt.failure ?? null,
    result: receipt.result ?? null,
    memory: receipt.memory ?? null,
    identity: receipt.identity ?? null,
    retention,
    receiptPath: receipt.receiptPath,
  };
}

export function createHypothesisJobRunner({
  repoRoot,
  runsDir = null,
  timeoutMs = HYPOTHESIS_TIMEOUT_MS,
  nodeBinary = process.execPath,
  now = () => new Date(),
  appendRegistryLine = appendFileSync,
} = {}) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0) {
    throw new TypeError("createHypothesisJobRunner requiere repoRoot.");
  }
  // Mismo runsRoot que BT-05/BT-07: el lock de generaciones es uno solo.
  const runsRoot = runsDir ?? path.join(repoRoot, "operations/backtest-runs");
  mkdirSync(runsRoot, { recursive: true });
  const registryPath = path.join(runsRoot, HYPOTHESIS_REGISTRY_FILE);
  let active = null;
  let heldLockGeneration = null;

  const attemptDir = (runId, attempt) => path.join(runsRoot, runId, `attempt-${attempt}`);
  const receiptFile = (runId, attempt) => path.join(attemptDir(runId, attempt), RECEIPT_FILE);
  const attemptKey = (runId, attempt) => `${runId}#${attempt}`;

  function listAttempts(runId) {
    try {
      return readdirSync(path.join(runsRoot, runId), { withFileTypes: true })
        .map((entry) => (entry.isDirectory() ? ATTEMPT_DIR_PATTERN.exec(entry.name) : null))
        .filter((match) => match !== null)
        .map((match) => Number.parseInt(match[1], 10))
        .sort((a, b) => a - b);
    } catch {
      return [];
    }
  }

  function readAttemptReceipt(runId, attempt) {
    try {
      return readJson(receiptFile(runId, attempt));
    } catch {
      return null;
    }
  }

  function readLatestReceipt(runId) {
    if (!HYP_RUN_ID_PATTERN.test(runId ?? "")) return null;
    const attempts = listAttempts(runId);
    return attempts.length === 0 ? null : readAttemptReceipt(runId, attempts.at(-1));
  }

  function listRunIds() {
    return readdirSync(runsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && HYP_RUN_ID_PATTERN.test(entry.name))
      .map((entry) => entry.name);
  }

  function readRegistry() {
    let text;
    try {
      text = readFileSync(registryPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return { ok: true, events: [] };
      return { ok: false, code: "REGISTRY_UNREADABLE", message: String(error?.message ?? error) };
    }
    const events = [];
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].length === 0) continue;
      try {
        events.push(JSON.parse(lines[index]));
      } catch {
        return { ok: false, code: "REGISTRY_CORRUPT", message: `${HYPOTHESIS_REGISTRY_FILE} line ${index + 1} is not JSON` };
      }
    }
    return { ok: true, events };
  }

  function appendRegistry(event) {
    appendRegistryLine(registryPath, `${JSON.stringify({ at: now().toISOString(), ...event })}\n`);
  }

  // Retención POR FAMILIA (BT08-08): el vigente de una familia solo lo
  // reemplaza otra promoción de la misma familia.
  function foldRetention(events) {
    const currentByFamily = new Map();
    const promotedAttempts = new Set();
    for (const event of events) {
      if (event.event !== REGISTRY_EVENT.RESULT_PROMOTED) continue;
      promotedAttempts.add(attemptKey(event.runId, event.attempt));
      currentByFamily.set(event.family, event.runId);
    }
    return { currentByFamily, promotedAttempts };
  }

  function retentionOf(receipt, folded) {
    if (receipt === null || folded === null) return null;
    const family = receipt.identity?.parameters?.family ?? null;
    const promoted = folded.promotedAttempts.has(attemptKey(receipt.runId, receipt.attempt));
    if (!promoted) return { state: RESULT_STATE.NONE, supersededBy: null, family };
    const currentRunId = folded.currentByFamily.get(family) ?? null;
    return currentRunId === receipt.runId
      ? { state: RESULT_STATE.CURRENT, supersededBy: null, family }
      : { state: RESULT_STATE.SUPERSEDED, supersededBy: currentRunId, family };
  }

  function viewOf(receipt, folded) {
    return receipt === null ? null : publicHypothesisJobView(receipt, retentionOf(receipt, folded));
  }

  function liveLock() {
    const lock = readJobLock(runsRoot);
    return lock !== null && lock.live ? lock : null;
  }

  function acquireLock(runId, attempt) {
    const observed = readJobLock(runsRoot);
    if (observed !== null && observed.live) return false;
    const generation = claimJobLock(runsRoot, observed?.generation ?? 0, { runId, attempt, pid: process.pid, jobKind: HYPOTHESIS_JOB_KIND });
    if (generation === null) return false;
    heldLockGeneration = generation;
    return true;
  }

  function releaseLock() {
    if (heldLockGeneration === null) return;
    const generation = heldLockGeneration;
    heldLockGeneration = null;
    releaseJobLock(runsRoot, generation, now().toISOString());
  }

  // Sólo huérfanos HYP-RUN: los receipts de BT-05/BT-07 son de otros runners.
  function closeOrphans(ownRunId, ownAttempt) {
    for (const runId of listRunIds()) {
      for (const attempt of listAttempts(runId)) {
        if (runId === ownRunId && attempt === ownAttempt) continue;
        const receipt = readAttemptReceipt(runId, attempt);
        if (receipt?.status !== JOB_STATUS.RUNNING) continue;
        const closed = {
          ...receipt,
          status: JOB_STATUS.INTERRUPTED,
          finishedAt: now().toISOString(),
          failure: { code: "INTERRUPTED", message: "the process running the hypothesis job no longer exists; the run did not complete" },
          workspace: receipt.workspace?.retention === WORKSPACE_RETENTION
            ? { ...receipt.workspace, ...discardWorkspace(path.join(attemptDir(runId, attempt), WORKSPACE_DIR)) }
            : receipt.workspace,
        };
        writeJsonAtomic(receiptFile(runId, attempt), closed);
        appendRegistry({ event: REGISTRY_EVENT.RUN_CLOSED, runId, attempt, family: closed.identity?.parameters?.family ?? null, manifest: runManifest(closed) });
      }
    }
  }

  function latestStartedReceipt() {
    let latest = null;
    for (const runId of listRunIds()) {
      const receipt = readLatestReceipt(runId);
      if (receipt === null) continue;
      if (latest === null || String(receipt.startedAt) > String(latest.startedAt)) latest = receipt;
    }
    return latest;
  }

  function status() {
    const lock = liveLock();
    const registry = readRegistry();
    const folded = registry.ok ? foldRetention(registry.events) : null;
    const running = lock === null ? null : readAttemptReceipt(lock.runId, lock.attempt);
    const families = [...folded.currentByFamily.entries()].map(([family, runId]) => {
      const receipt = readLatestReceipt(runId);
      return { family, currentRunId: runId, tested: receipt?.result?.validComparison === true, retention: retentionOf(receipt, folded) };
    });
    return {
      running: lock !== null,
      current: viewOf(running, folded),
      latest: viewOf(latestStartedReceipt(), folded),
      families,
      registry: registry.ok
        ? { ok: true, path: relative(repoRoot, registryPath), events: registry.events.length }
        : { ok: false, code: registry.code, message: registry.message },
    };
  }

  function get(runId) {
    const receipt = readLatestReceipt(runId);
    if (receipt === null) return null;
    const registry = readRegistry();
    const folded = registry.ok ? foldRetention(registry.events) : null;
    return { receipt, job: viewOf(receipt, folded) };
  }

  function alreadyRunning() {
    const lock = liveLock();
    const receipt = lock === null ? null : readAttemptReceipt(lock.runId, lock.attempt);
    const view = receipt === null ? null
      : receipt.jobKind === HYPOTHESIS_JOB_KIND ? publicHypothesisJobView(receipt)
        : { runId: receipt.runId, jobKind: receipt.jobKind, status: receipt.status, startedAt: receipt.startedAt };
    return { ok: false, code: "JOB_ALREADY_RUNNING", message: "a job is already running (the shared backtests lock is held)", job: view };
  }

  function planRun(runId, registry) {
    if (!registry.ok) return { error: { ok: false, code: registry.code, message: registry.message } };
    const folded = foldRetention(registry.events);
    const previous = readLatestReceipt(runId);
    if (previous?.status === JOB_STATUS.SUCCEEDED && folded.promotedAttempts.has(attemptKey(previous.runId, previous.attempt))) {
      return { reused: { ok: true, reused: true, job: viewOf(previous, folded), done: Promise.resolve(previous) } };
    }
    return { attempt: (listAttempts(runId).at(-1) ?? 0) + 1, previous };
  }

  function finish(receipt, patch) {
    const workspacePath = path.join(attemptDir(receipt.runId, receipt.attempt), WORKSPACE_DIR);
    const workspace = receipt.workspace?.retention === WORKSPACE_RETENTION
      ? { ...receipt.workspace, ...discardWorkspace(workspacePath) }
      : receipt.workspace;
    const closed = { ...receipt, ...patch, workspace, finishedAt: now().toISOString() };
    try {
      writeJsonAtomic(receiptFile(closed.runId, closed.attempt), closed);
      appendRegistry({ event: REGISTRY_EVENT.RUN_CLOSED, runId: closed.runId, attempt: closed.attempt, family: closed.identity?.parameters?.family ?? null, manifest: runManifest(closed) });
      if (closed.status === JOB_STATUS.SUCCEEDED) {
        const registry = readRegistry();
        if (!registry.ok) throw new Error(`${registry.code}: ${registry.message}`);
        const family = closed.identity.parameters.family;
        const previous = foldRetention(registry.events).currentByFamily.get(family) ?? null;
        appendRegistry({ event: REGISTRY_EVENT.RESULT_PROMOTED, runId: closed.runId, attempt: closed.attempt, family, supersedes: previous === closed.runId ? null : previous });
      }
    } catch (error) {
      return { ...closed, settlement: { ok: false, code: "REGISTRY_WRITE_FAILED", message: String(error?.message ?? error) } };
    } finally {
      active = null;
      releaseLock();
    }
    return closed;
  }

  function collectResult(workspace, outputDir, receipt) {
    let sealAfter;
    try {
      sealAfter = stagedCodeSeal(workspace);
    } catch {
      sealAfter = null;
    }
    if (sealAfter?.sha256 !== receipt.code.staged.sha256) {
      return { error: { code: "CODE_CHANGED_DURING_RUN", message: "the workspace code does not match the code extracted from the commit" } };
    }
    let specSha256;
    let spec;
    try {
      const specBytes = readFileSync(path.join(workspace, HYPOTHESIS_SPEC_FILE));
      spec = JSON.parse(specBytes);
      // El hash de la identidad es el del spec canónico (sin timestamps).
      specSha256 = sha256Of(Buffer.from(canonicalSpecOf(spec.job)));
    } catch {
      return { error: { code: "RUN_SPEC_MISSING", message: "the experiment spec could not be re-read from the workspace" } };
    }
    if (specSha256 !== receipt.identity.specSha256) {
      return { error: { code: "SPEC_CHANGED_DURING_RUN", message: "the experiment spec changed during the run" } };
    }
    const dataDrift = receipt.inputs.files
      .filter((file) => !file.path.startsWith("src/") && sha256Of(readFileSync(path.join(workspace, file.path))) !== file.sha256)
      .map((file) => file.path);
    if (dataDrift.length > 0) {
      return { error: { code: "INPUT_CHANGED_DURING_RUN", message: `input data differs from the verified inputs: ${dataDrift.join(", ")}` } };
    }
    let manifestBytes;
    let manifest;
    try {
      manifestBytes = readFileSync(path.join(workspace, HYPOTHESIS_MANIFEST_PATH));
      manifest = JSON.parse(manifestBytes);
    } catch {
      return { error: { code: "RUN_MANIFEST_MISSING", message: "the child did not write its MANIFEST" } };
    }
    const resultsPath = path.join(workspace, manifest?.results?.path ?? "");
    let resultsBytes;
    let results;
    try {
      resultsBytes = readFileSync(resultsPath);
      results = JSON.parse(resultsBytes);
    } catch {
      return { error: { code: "RUN_RESULTS_MISSING", message: "the run MANIFEST points at missing or unreadable results" } };
    }
    const resultsSha256 = sha256Of(resultsBytes);
    if (resultsSha256 !== manifest.results.sha256) {
      return { error: { code: "RUN_RESULTS_HASH_MISMATCH", message: "the results do not match their run MANIFEST" } };
    }
    if (results.specSha256 !== receipt.identity.specSha256) {
      return { error: { code: "SPEC_BINDING_MISMATCH", message: "the results are not bound to the identity spec of the run" } };
    }
    // Los generadores declarados tienen que ser el código staged del commit.
    const pinned = new Map(listFilesUnder(workspace, "src").map((file) => [file, sha256Of(readFileSync(path.join(workspace, file)))]));
    const generatorDrift = (manifest.generators ?? [])
      .filter((entry) => !entry.path.startsWith("src/") || pinned.get(entry.path) !== entry.sha256)
      .map((entry) => entry.path);
    if (generatorDrift.length > 0) {
      return { error: { code: "GENERATOR_CHANGED_DURING_RUN", message: `generator code differs from the verified code: ${generatorDrift.join(", ")}` } };
    }
    const declaredInputs = receipt.inputs.files.filter((file) => !file.path.startsWith("src/"));
    const manifestInputs = (manifest.inputs ?? []).map((entry) => `${entry.path}:${entry.sha256}`).sort();
    const expectedInputs = declaredInputs.map((file) => `${file.path}:${file.sha256}`).sort();
    if (JSON.stringify(manifestInputs) !== JSON.stringify(expectedInputs)) {
      return { error: { code: "INPUT_BINDING_MISMATCH", message: "the run MANIFEST does not bind exactly the verified inputs" } };
    }
    const producedManifestSha256 = sha256Of(manifestBytes);
    let preservedResults;
    let preservedManifest;
    try {
      preservedResults = preserveOutput(workspace, outputDir, manifest.results.path, resultsSha256);
      preservedManifest = preserveOutput(workspace, outputDir, HYPOTHESIS_MANIFEST_PATH, producedManifestSha256);
    } catch (error) {
      rmSync(outputDir, { recursive: true, force: true });
      return { error: { code: "RUN_OUTPUT_NOT_PRESERVED", message: String(error?.message ?? error) } };
    }
    return {
      result: {
        status: results.status ?? null,
        validComparison: results.validComparison === true,
        scientificConclusion: null,
        researchPass: false,
        // Comparación y ablation producidas, ligadas por hash al MANIFEST
        // (hallazgo BT08-T15): el consumidor HTTP/MCP obtiene los datos, no
        // sólo el puntero al archivo.
        comparison: results.comparison ?? null,
        ablation: results.comparison?.ablation ?? null,
        results: { path: relative(repoRoot, preservedResults), sha256: resultsSha256 },
        manifest: { path: relative(repoRoot, preservedManifest), sha256: producedManifestSha256 },
      },
    };
  }

  function start({ requestedBy, job } = {}) {
    if (requestedBy !== "ui" && requestedBy !== "mcp") {
      return { ok: false, code: "INVALID_REQUESTER", message: 'requestedBy must be "ui" or "mcp"' };
    }
    const validated = validateHypothesisJobRequest(job);
    if (!validated.ok) {
      return { ok: false, code: validated.code, message: validated.message, detail: validated.detail ?? null, field: validated.field ?? null };
    }
    if (active !== null || liveLock() !== null) return alreadyRunning();
    const registry = readRegistry();
    if (!registry.ok) return { ok: false, code: registry.code, message: registry.message };
    const code = readHypothesisCodeCommit(repoRoot);
    if (!code.ok) return { ok: false, code: code.code, message: code.message };
    const files = inputFilesOf(validated.request);
    const verified = verifyInputFiles(repoRoot, files);
    if (!verified.ok) {
      return { ok: false, code: verified.code, message: `${verified.code === "INPUT_MISSING" ? "missing verified input" : "verified input does not match its hash"}: ${verified.path}`, detail: verified };
    }
    const specSha256 = sha256Of(Buffer.from(canonicalSpecOf(validated.request)));
    const { runId, identity } = computeHypothesisRunIdentity({ codeCommit: code.commit, files: verified.files, specSha256, request: validated.request });

    const beforeLock = planRun(runId, registry);
    if (beforeLock.reused) return beforeLock.reused;
    if (!acquireLock(runId, beforeLock.attempt)) return alreadyRunning();
    const underLock = planRun(runId, readRegistry());
    if (underLock.error || underLock.reused || underLock.attempt !== beforeLock.attempt) {
      releaseLock();
      return underLock.error ?? underLock.reused ?? start({ requestedBy, job });
    }
    const { attempt } = underLock;
    try {
      closeOrphans(runId, attempt);
    } catch (error) {
      releaseLock();
      return { ok: false, code: "REGISTRY_WRITE_FAILED", message: String(error?.message ?? error) };
    }

    const startedAt = now();
    const runDir = attemptDir(runId, attempt);
    const workspace = path.join(runDir, WORKSPACE_DIR);
    const spec = {
      artifactKind: "HYPOTHESIS_EXPERIMENT_SPEC",
      schemaVersion: EPISODE_SCHEMA_VERSION,
      runId,
      requestedBy,
      startedAt: startedAt.toISOString(),
      job: validated.request,
    };    let receipt = {
      receiptKind: HYPOTHESIS_RECEIPT_KIND,
      schemaVersion: "1",
      runId,
      attempt,
      jobKind: HYPOTHESIS_JOB_KIND,
      jobVersion: HYPOTHESIS_JOB_VERSION,
      identity,
      status: JOB_STATUS.RUNNING,
      requestedBy,
      startedAt: startedAt.toISOString(),
      receiptPath: relative(repoRoot, receiptFile(runId, attempt)),
      code: { gitHead: code.commit, entry: HYPOTHESIS_ENTRY },
      inputs: { files: verified.files },
      authority: "BT-08 owner intake D-20260928T161943-70c6 (Bru, 2026-09-28); command authorized with receipt (SPEC v1.1.1 §26.5). Development-only: the hypothesis path never opens or consumes OOS.",
      workspace: { path: relative(repoRoot, workspace), retention: WORKSPACE_RETENTION, removed: false },
    };
    let seal;
    try {
      mkdirSync(runDir, { recursive: true });
      writeJsonAtomic(receiptFile(runId, attempt), receipt);
      seal = stageWorkspace(repoRoot, workspace, code.commit, verified.files);
      writeJsonAtomic(path.join(workspace, HYPOTHESIS_SPEC_FILE), spec);
      const writtenSpec = readJson(path.join(workspace, HYPOTHESIS_SPEC_FILE));
      if (sha256Of(Buffer.from(canonicalSpecOf(writtenSpec.job))) !== specSha256) {
        throw new Error("the written spec does not match the identity spec hash");
      }
      receipt = { ...receipt, code: { ...receipt.code, source: "git archive del commit", staged: seal } };
      writeJsonAtomic(receiptFile(runId, attempt), receipt);
    } catch (error) {
      const closed = finish(receipt, { status: JOB_STATUS.FAILED, failure: { code: "STAGING_FAILED", message: String(error?.message ?? error) } });
      return { ok: false, code: "STAGING_FAILED", job: publicHypothesisJobView(closed) };
    }

    const memoryBefore = readCgroupMemoryPeak();
    const rusageFile = path.join(runDir, "child-rusage.json");
    let logFd = null;
    let child;
    try {
      logFd = openSync(path.join(runDir, "job.log"), "a");
      child = spawn(nodeBinary, [CHILD_ENTRY, rusageFile, path.join(workspace, HYPOTHESIS_ENTRY), HYPOTHESIS_SPEC_FILE, HYPOTHESIS_RESULTS_PATH, HYPOTHESIS_MANIFEST_PATH], {
        cwd: workspace,
        stdio: ["ignore", logFd, logFd],
      });
    } catch (error) {
      const closed = finish(receipt, { status: JOB_STATUS.FAILED, failure: { code: "SPAWN_FAILED", message: String(error?.message ?? error) } });
      return { ok: false, code: "SPAWN_FAILED", job: publicHypothesisJobView(closed) };
    } finally {
      if (logFd !== null) closeSync(logFd);
    }
    receipt = { ...receipt, pid: child.pid };

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const done = new Promise((resolveOnce) => {
      let settled = false;
      const resolve = (value) => {
        settled = true;
        resolveOnce(value);
      };
      child.once("error", (error) => {
        clearTimeout(timer);
        if (settled) return;
        resolve(finish(receipt, { status: JOB_STATUS.FAILED, failure: { code: "SPAWN_FAILED", message: String(error?.message ?? error) } }));
      });
      child.once("exit", (exitCode, signal) => {
        clearTimeout(timer);
        if (settled) return;
        let childMaxRssKb = null;
        try {
          childMaxRssKb = readJson(rusageFile).maxRSSKb ?? null;
        } catch {
          childMaxRssKb = null;
        }
        const memoryAfter = readCgroupMemoryPeak();
        const memory = {
          childMaxRssKb,
          cgroup: memoryAfter.cgroup,
          cgroupMemoryPeakBytesBefore: memoryBefore.memoryPeakBytes,
          cgroupMemoryPeakBytesAfter: memoryAfter.memoryPeakBytes,
          cgroupOomKillsDuringRun: memoryBefore.oomKills === null || memoryAfter.oomKills === null ? null : memoryAfter.oomKills - memoryBefore.oomKills,
        };
        const exit = { code: exitCode, signal };
        if (timedOut) {
          resolve(finish(receipt, { status: JOB_STATUS.FAILED, exit, memory, failure: { code: "TIMEOUT", message: `the run exceeded ${timeoutMs} ms (provisional ceiling)` } }));
          return;
        }
        if (exitCode !== 0 && memory.cgroupOomKillsDuringRun > 0) {
          resolve(finish(receipt, { status: JOB_STATUS.FAILED, exit, memory, failure: { code: "OOM_KILLED", message: `cgroup ${memory.cgroup} killed the job for memory (service MemoryMax)` } }));
          return;
        }
        if (exitCode !== 0 && exitCode !== BLOCKED_EXIT_CODE) {
          resolve(finish(receipt, { status: JOB_STATUS.FAILED, exit, memory, failure: { code: "RUN_FAILED", message: `the hypothesis entry exited with code=${exitCode} signal=${signal}; see job.log` } }));
          return;
        }
        const collected = collectResult(workspace, path.join(runDir, OUTPUT_DIR), receipt);
        if (collected.error) {
          resolve(finish(receipt, { status: JOB_STATUS.FAILED, exit, memory, failure: collected.error }));
          return;
        }
        if (exitCode === BLOCKED_EXIT_CODE) {
          // Bloqueo explícito de la misión (provenance/freshness/warm-up/...):
          // el receipt falla cerrado y preserva el artefacto de bloqueo como
          // evidencia; nunca se promueve como resultado.
          let blockers = [];
          try {
            blockers = JSON.parse(readFileSync(path.join(workspace, HYPOTHESIS_RESULTS_PATH), "utf8")).blockers ?? [];
          } catch {
            blockers = [];
          }
          resolve(finish(receipt, {
            status: JOB_STATUS.FAILED, exit, memory,
            result: collected.result,
            failure: { code: "DEVELOPMENT_BLOCKED", message: "the mission's Development inputs are not runnable; see blockers", blockers },
          }));
          return;
        }
        resolve(finish(receipt, { status: JOB_STATUS.SUCCEEDED, exit, memory, result: collected.result }));
      });
    });
    active = { receipt, child, done };
    try {
      writeJsonAtomic(receiptFile(runId, attempt), receipt);
    } catch {
      // el receipt en disco queda RUNNING sin pid hasta que finish() lo cierre
    }
    return { ok: true, reused: false, job: publicHypothesisJobView(receipt, { state: RESULT_STATE.NONE, supersededBy: null }), done };
  }

  // Lote de misiones (BT08-02): secuenciales bajo el MISMO lock compartido,
  // con registro separado por misión. Un fallo corta el lote; el resultado del
  // lote no anuncia éxito completo salvo que TODAS las misiones hayan
  // terminado en éxito (hallazgo BT08-T16): outcomes distingue el estado final
  // por misión y `complete` lo resume.
  async function startBatch({ requestedBy, jobs } = {}) {
    if (!Array.isArray(jobs) || jobs.length === 0 || jobs.length > SEM_MISSIONS.length) {
      return { ok: false, code: "INVALID_HYPOTHESIS_REQUEST", message: `jobs must list between 1 and ${SEM_MISSIONS.length} hypothesis job requests` };
    }
    const batch = [];
    const outcomes = [];
    for (const job of jobs) {
      const started = start({ requestedBy, job });
      if (!started.ok) return { ok: false, code: started.code, message: started.message, detail: started.detail ?? null, batch, outcomes };
      batch.push(started);
      const receipt = await started.done;
      outcomes.push({
        ok: receipt.status === JOB_STATUS.SUCCEEDED,
        reused: started.reused === true,
        runId: receipt.runId,
        status: receipt.status,
        failure: receipt.failure ?? null,
        result: receipt.result ?? null,
      });
    }
    return { ok: true, reused: false, batch, outcomes, complete: outcomes.every((outcome) => outcome.ok) };
  }

  // Al arrancar el servicio: si nadie tiene el lock, cierra los HYP-RUN huérfanos.
  if (acquireLock(null, null)) {
    try {
      closeOrphans(null, null);
    } finally {
      releaseLock();
    }
  }

  return {
    runsRoot,
    registryPath,
    start,
    startBatch,
    status,
    get,
    readiness: (missionIds) => hypothesisReadiness(repoRoot, missionIds),
    now,
    waitForIdle: () => (active?.done ?? Promise.resolve(null)),
  };
}

// Código 3 del hijo: la misión queda BLOCKED por sus inputs (provenance,
// frescura, warm-up, freeze, reserva). Nunca es un éxito silencioso.
export const BLOCKED_EXIT_CODE = 3;
