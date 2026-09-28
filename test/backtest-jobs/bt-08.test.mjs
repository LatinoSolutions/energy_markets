// Tests BT-08 (PLAN_STATUS fila BT-08, intake D-20260928T161943-70c6): H-S1-01
// ejecuta por la MISMA ruta canónica de jobs (HTTP + MCP), Development-only,
// cuatro misiones separadas con el HYP-1 real, CONTROL compartido, economía
// evidence-bound, idempotencia por familia y lock compartido. Sólo fixtures
// pequeñas; nunca un run real ni OOS.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BACKTEST_JOBS_PATH,
  HYPOTHESIS_DEVELOPMENT_DATA_ROOT,
  HYPOTHESIS_JOB_KIND,
  JOB_STATUS,
  REGISTRY_EVENT,
  RESULT_STATE,
  TRADES_ACCESS_REGISTRY_PATH,
  adaptDevelopmentInputs,
  claimJobLock,
  createBacktestJobRunner,
  createHypothesisJobRunner,
  familyKeyOf,
  handleMcpMessage,
  hypothesisReadiness,
  hypothesisReadinessForMission,
  readJobLock,
  validateHypothesisJobRequest,
} from "../../src/backtest-jobs/index.mjs";
import { FAILURE_WORDS, describeHypothesisStatus } from "../../src/backtest-jobs/display.mjs";
import { createUiServer } from "../../src/ui/index.mjs";
import { assessDevelopmentInputs, pairedAblation, runHS1DevelopmentEpisode } from "../../src/s1-strategy/development-episode.mjs";
import {
  MISSION_TARGETS_MW,
  fixtureCandidate,
  fixtureMissionConfiguration,
  fixtureSearchSpace,
  hypothesisJobRequest,
  makeHypothesisFixtureRepo,
} from "./hypothesis-fixture-repo.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DEAD_PID = 2 ** 22 + 12345;
const ALL_MISSIONS = ["GAS_MONTHLY", "GAS_QUARTERLY", "POWER_MONTHLY", "POWER_QUARTERLY"];

const newRunner = (repo, options = {}) => createHypothesisJobRunner({ repoRoot: repo.root, ...options });

const hypothesisRegistry = (runner) => {
  if (!existsSync(runner.registryPath)) return [];
  return readFileSync(runner.registryPath, "utf8").split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line));
};

const lockIsFree = (runner) => readJobLock(runner.runsRoot)?.live !== true;

const hypRunDirs = (repo) => (existsSync(path.join(repo.root, "operations/backtest-runs"))
  ? readdirSync(path.join(repo.root, "operations/backtest-runs")).filter((name) => name.startsWith("HYP-RUN-"))
  : []);

async function withServer(options, run) {
  const { server, ready } = createUiServer({ port: 0, ...options });
  const served = await ready;
  const base = served.url.slice(0, -1);
  try {
    await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const postJob = (base, body, headers = { "Content-Type": "application/json" }) =>
  fetch(`${base}${BACKTEST_JOBS_PATH}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

// Carga los inputs del fixture y arma el spec del motor puro con el MISMO
// camino que el child: validación canónica → archivos → adaptación → assess →
// episodio.
function engineSpecFrom(repo, request, runId = `HYP-RUN-${"0".repeat(64)}`) {
  const validated = validateHypothesisJobRequest(request);
  if (!validated.ok) return { ok: false, code: validated.code, message: validated.message };
  const canonical = validated.request;
  const read = (entry) => JSON.parse(readFileSync(path.join(repo.root, entry.path), "utf8"));
  const files = {
    availability: read(canonical.inputManifest.availability),
    observations: read(canonical.inputManifest.observations),
    benchmark: read(canonical.inputManifest.benchmark),
    deliveryHours: read(canonical.inputManifest.deliveryHours),
  };
  const adapted = adaptDevelopmentInputs(files, canonical.missionId);
  if (!adapted.ok) return { ok: false, code: adapted.blockers[0].code, message: adapted.blockers[0].message, blockers: adapted.blockers };
  const benchmark = { ...adapted.inputs.benchmark, sourceHash: canonical.inputManifest.benchmark.sha256 };
  const assessment = assessDevelopmentInputs({
    session: adapted.inputs.session,
    availability: adapted.inputs.availability,
    observations: adapted.inputs.observations,
    benchmark,
    deliveryHours: adapted.inputs.deliveryHours,
    campaign: canonical.campaign,
  });
  if (!assessment.ok) return assessment;
  return runHS1DevelopmentEpisode({
    runId,
    missionId: canonical.missionId,
    missionLabel: canonical.missionLabel,
    candidate: canonical.candidate,
    campaign: canonical.campaign,
    session: adapted.inputs.session,
    observations: adapted.inputs.observations,
    sizing: canonical.sizing,
    execution: canonical.execution,
    fees: canonical.fees,
    evaluation: { benchmark, deliveryHours: adapted.inputs.deliveryHours },
  });
}

// ---------- BT08-01: frontera compartida HTTP + MCP ----------

test("BT08-01: POST /api/backtest-jobs en modo HYPOTHESIS lanza el job; GET publica receipt y readiness", async () => {
  const repo = makeHypothesisFixtureRepo();
  const runner = newRunner(repo);
  const request = hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" });
  await withServer({ hypothesisJobRunner: runner }, async (base) => {
    const response = await postJob(base, { requestedBy: "ui", mode: "HYPOTHESIS", job: request });
    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.mode, "HYPOTHESIS");
    assert.match(payload.job.runId, /^HYP-RUN-[0-9a-f]{64}$/);
    assert.match(payload.display.line, /^Running hypothesis development · H-S1-01 · GAS_MONTHLY · development ·/);
    await runner.waitForIdle();
    const receipt = runner.get(payload.job.runId).receipt;
    assert.equal(receipt.status, JOB_STATUS.SUCCEEDED, JSON.stringify(receipt.failure));

    const detail = await (await fetch(`${base}${BACKTEST_JOBS_PATH}/${payload.job.runId}`)).json();
    assert.equal(detail.ok, true);
    assert.equal(detail.job.jobKind, HYPOTHESIS_JOB_KIND);
    assert.equal(detail.receipt.identity.parameters.missionId, "GAS_MONTHLY");
    assert.equal(detail.receipt.identity.parameters.phase, "DEVELOPMENT");

    const status = await (await fetch(`${base}${BACKTEST_JOBS_PATH}`)).json();
    assert.equal(status.hypothesis.configured, true);
    assert.equal(status.hypothesis.hypothesisMetadata.name, "Session-Anchored Rolling Reference");
    assert.deepEqual(status.hypothesis.hypothesisMetadata.missions, ["Gas Monthly", "Gas Quarterly", "Power Monthly", "Power Quarterly"]);
    assert.equal(status.hypothesis.readiness.find((entry) => entry.missionId === "GAS_MONTHLY").missionLabel, "Gas Monthly");
    assert.equal(status.hypothesis.families[0].currentRunId, payload.job.runId);
  });
});

test("BT08-01: MCP start_hypothesis_development pasa por el mismo backend (reuso idempotente)", async () => {
  const repo = makeHypothesisFixtureRepo();
  const runner = newRunner(repo);
  const request = hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" });
  await withServer({ hypothesisJobRunner: runner }, async (base) => {
    const baseUrl = `${base}/`;
    const list = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { baseUrl });
    assert.equal(list.result.tools.some((tool) => tool.name === "start_hypothesis_development"), true);

    const first = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "start_hypothesis_development", arguments: { job: request } } }, { baseUrl });
    assert.equal(first.result.isError, false);
    assert.equal(first.result.structuredContent.ok, true);
    assert.equal(first.result.structuredContent.reused, false);
    const runId = first.result.structuredContent.job.runId;
    await runner.waitForIdle();

    // El mismo request por HTTP y por MCP da el MISMO run: misma ruta backend.
    const viaHttp = await postJob(base, { requestedBy: "ui", mode: "HYPOTHESIS", job: request });
    assert.equal(viaHttp.status, 200);
    assert.equal((await viaHttp.json()).job.runId, runId);

    const again = await handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "start_hypothesis_development", arguments: { job: request } } }, { baseUrl });
    assert.equal(again.result.isError, false);
    assert.equal(again.result.structuredContent.reused, true);
    assert.equal(hypRunDirs(repo).length, 1);
  });
});

test("BT08-01: hipótesis desconocida, versión/hash inválidos, fase/modo imposibles y petición malformada fallan cerrados", async () => {
  const repo = makeHypothesisFixtureRepo();
  const runner = newRunner(repo);
  const base = hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" });
  const cases = [
    ["UNKNOWN_HYPOTHESIS", { ...base, hypothesisId: "H-RD-01" }],
    ["UNKNOWN_HYPOTHESIS", { ...base, hypothesisId: "DIP10" }],
    ["HYPOTHESIS_VERSION_MISMATCH", { ...base, hypothesisVersion: "H-S1-01/phase-A/v1" }],
    ["PHASE_NOT_DEVELOPMENT", { ...base, phase: "OOS" }],
    ["PHASE_NOT_DEVELOPMENT", { ...base, phase: "BRIDGE" }],
    ["INVALID_DATA_MODE", { ...base, dataMode: "TRADES" }],
    ["CANDIDATE_INTEGRITY", { ...base, candidate: { ...base.candidate, contentHash: "0".repeat(64) } }],
    ["OUTSIDE_PREDECLARED_SPACE", { ...base, candidate: { ...base.candidate, N: 7 } }],
    ["PARAMETER_CANDIDATE_MISMATCH", { ...base, configuration: { artifactKind: "HYPOTHESIS_MISSION_CONFIGURATION", hypothesisId: "H-S1-01", hypothesisVersion: base.hypothesisVersion, missionId: "GAS_MONTHLY", candidateHash: base.candidate.contentHash, searchSpaceHash: base.searchSpace.contentHash, N: 5 } }],
    ["BINDING_INVALID", { ...base, evaluation: { ...base.evaluation, benchmark: { ...base.evaluation.benchmark, unit: "EUR/MW" } } }],
    ["MISSION_INPUT_MISMATCH", { ...base, inputManifest: { ...base.inputManifest, benchmark: { ...base.inputManifest.benchmark, path: "src/evil.json" } } }],
    // Hallazgo BT08-T12: un benchmark declarado de otra campaña no ata esta campaña.
    ["BINDING_INVALID", { ...base, evaluation: { ...base.evaluation, benchmark: { ...base.evaluation.benchmark, campaignId: "FIXTURE-POWER_MONTHLY" } } }],
    ["BINDING_INVALID", { ...base, evaluation: { ...base.evaluation, benchmark: { ...base.evaluation.benchmark, obligationId: "OBL-POWER_MONTHLY" } } }],
    // Hallazgo BT08-T08: el configurationHash declarado se recalcula contra el
    // contenido; un campo alterado conservando el hash no entra.
    ["CONFIGURATION_INTEGRITY", { ...base, configuration: { ...fixtureMissionConfiguration("GAS_MONTHLY", base.candidate, base.searchSpace), note: "tampered" } }],
  ];
  const validConfiguration = fixtureMissionConfiguration("GAS_MONTHLY", base.candidate, base.searchSpace);
  assert.equal(validateHypothesisJobRequest({ ...base, configuration: validConfiguration }).ok, true);
  for (const [expectedCode, job] of cases) {
    const outcome = validateHypothesisJobRequest(job);
    assert.equal(outcome.ok, false, expectedCode);
    assert.equal(outcome.code, expectedCode, expectedCode);
    const started = runner.start({ requestedBy: "ui", job });
    assert.equal(started.ok, false, expectedCode);
    assert.equal(started.code, expectedCode, expectedCode);
  }
  assert.equal(hypRunDirs(repo).length, 0);
  assert.equal(lockIsFree(runner), true);
  assert.equal(runner.start({ requestedBy: "ui" }).code, "INVALID_HYPOTHESIS_REQUEST");
});

test("BT08-01: el input verificado por hash falla cerrado (INPUT_HASH_MISMATCH / INPUT_MISSING)", async () => {
  const repo = makeHypothesisFixtureRepo({ missions: ["GAS_MONTHLY", "GAS_QUARTERLY"] });
  const runner = newRunner(repo);
  const tampered = hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" });
  repo.write(`${HYPOTHESIS_DEVELOPMENT_DATA_ROOT}/GAS_MONTHLY/benchmark.json`, `${JSON.stringify({ identity: "BENCHMARK", version: "B-CHANGED", status: "BENCHMARK_PROVISIONAL", value: 1, unit: "EUR/MWh", artifactSha256: "c".repeat(64), sourceHash: "d".repeat(64), provenance: { authority: "x", locator: "y" } }, null, 1)}\n`);
  const drifted = runner.start({ requestedBy: "ui", job: tampered });
  assert.equal(drifted.ok, false);
  assert.equal(drifted.code, "INPUT_HASH_MISMATCH");

  // La petición se construye con el archivo en disco y luego el archivo se
  // elimina: la verificación de arranque falla cerrada con INPUT_MISSING.
  const missing = hypothesisJobRequest(repo, { missionId: "GAS_QUARTERLY" });
  rmSync(path.join(repo.root, `${HYPOTHESIS_DEVELOPMENT_DATA_ROOT}/GAS_QUARTERLY/availability.json`));
  const blocked = runner.start({ requestedBy: "ui", job: missing });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "INPUT_MISSING");
  assert.equal(hypRunDirs(repo).length, 0);
});

// ---------- BT08-02: cuatro misiones, HYP-1 real, registros separados ----------

test("BT08-02: lote de las cuatro misiones, secuencial bajo el mismo lock, con registros y ledgers independientes", async () => {
  const repo = makeHypothesisFixtureRepo({ missions: ALL_MISSIONS });
  const runner = newRunner(repo);
  const batch = await runner.startBatch({ requestedBy: "ui", jobs: ALL_MISSIONS.map((missionId) => hypothesisJobRequest(repo, { missionId })) });
  assert.equal(batch.ok, true);
  const receipts = await Promise.all(batch.batch.map((entry) => entry.done));
  const resultPaths = new Set();
  for (const receipt of receipts) {
    assert.equal(receipt.status, JOB_STATUS.SUCCEEDED, JSON.stringify(receipt.failure));
    assert.equal(receipt.result.status, "JOB_COMPLETED");
    resultPaths.add(receipt.result.results.path);
    const results = JSON.parse(readFileSync(path.join(repo.root, receipt.result.results.path), "utf8"));
    assert.equal(results.missionId, receipt.identity.parameters.missionId);
    assert.equal(results.search.objective, null); // modo sin búsqueda: sin objetivo emitido
    assert.equal(results.developmentPopulation.campaignId, `FIXTURE-${results.missionId}`);
    assert.equal(results.developmentPopulation.targetVolumeMw, MISSION_TARGETS_MW[results.missionId]);
    // El HYP-1 real decidió: warm-up (3 días) → ABSTAIN; señal disponible después.
    const activeActions = results.comparison.active.ledger.map((row) => row.action);
    assert.deepEqual(activeActions.slice(0, 3), ["ABSTAIN", "ABSTAIN", "ABSTAIN"]);
    assert.equal(results.comparison.active.ledger[3].action, "BUY");
    assert.equal(results.comparison.active.ledger[3].reference, 35);
    // CONTROL (calendar-only) completa la obligación de SU misión.
    assert.equal(results.comparison.control.summary.remainingMw, 0);
  }
  assert.equal(resultPaths.size, 4);
  assert.equal(new Set(receipts.map((receipt) => receipt.runId)).size, 4);
});

test("BT08-02: un binding cruzado de misión se rechaza (el candidato de Gas nunca corre Power)", () => {
  const repo = makeHypothesisFixtureRepo({ missions: ["GAS_MONTHLY", "POWER_MONTHLY"] });
  const crossMission = hypothesisJobRequest(repo, {
    missionId: "POWER_MONTHLY",
    jobOverrides: { searchSpace: fixtureSearchSpace("GAS_MONTHLY"), candidate: fixtureCandidate("GAS_MONTHLY") },
  });
  const outcome = validateHypothesisJobRequest(crossMission);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "SEARCH_SPACE_INTEGRITY");
});

// Hallazgo BT08-T06: los archivos del manifest son de la misión pedida; los de
// Gas atados a una petición Power se rechazan antes de iniciar el job.
test("BT08-02: inputManifest con archivos de otra misión se rechaza antes de ejecutar", async () => {
  const repo = makeHypothesisFixtureRepo({ missions: ["GAS_MONTHLY", "POWER_MONTHLY"] });
  const runner = newRunner(repo);
  const power = hypothesisJobRequest(repo, { missionId: "POWER_MONTHLY" });
  const crossed = {
    ...power,
    inputManifest: {
      ...power.inputManifest,
      observations: { path: `${HYPOTHESIS_DEVELOPMENT_DATA_ROOT}/GAS_MONTHLY/observations.json`, sha256: "a".repeat(64) },
    },
  };
  const validation = validateHypothesisJobRequest(crossed);
  assert.equal(validation.ok, false);
  assert.equal(validation.code, "MISSION_INPUT_MISMATCH");
  const started = runner.start({ requestedBy: "ui", job: crossed });
  assert.equal(started.ok, false);
  assert.equal(started.code, "MISSION_INPUT_MISMATCH");
  assert.equal(hypRunDirs(repo).length, 0);
  assert.equal(lockIsFree(runner), true);
});

test("BT08-02: una misión bloqueada falla con su propio registro, sin sustituciones ni préstamos", async () => {
  // POWER_MONTHLY con freeze requerido y no atado: su job queda BLOCKED;
  // GAS_MONTHLY corre y su resultado no se toca.
  const repo = makeHypothesisFixtureRepo({
    missions: ["GAS_MONTHLY", "POWER_MONTHLY"],
    deliveryOptions: { POWER_MONTHLY: { requiresFreeze: true } },
  });
  const runner = newRunner(repo);
  const batch = await runner.startBatch({
    requestedBy: "ui",
    jobs: [hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" }), hypothesisJobRequest(repo, { missionId: "POWER_MONTHLY" })],
  });
  assert.equal(batch.ok, true);
  const [gasReceipt, powerReceipt] = await Promise.all(batch.batch.map((entry) => entry.done));
  assert.equal(gasReceipt.status, JOB_STATUS.SUCCEEDED, JSON.stringify(gasReceipt.failure));
  assert.equal(powerReceipt.status, JOB_STATUS.FAILED);
  assert.equal(powerReceipt.failure.code, "DEVELOPMENT_BLOCKED");
  assert.equal(powerReceipt.failure.blockers[0].code, "FREEZE_PENDING");
  assert.notEqual(powerReceipt.runId, gasReceipt.runId);
  const gasResults = JSON.parse(readFileSync(path.join(repo.root, gasReceipt.result.results.path), "utf8"));
  assert.equal(gasResults.missionId, "GAS_MONTHLY");
  assert.equal(gasReceipt.result.status, "JOB_COMPLETED");
  assert.equal(hypRunDirs(repo).length, 2);
});

// ---------- BT08-03: readiness read-only y bloqueos por formato fuente ----------

test("BT08-03: readiness del repo real lista bloqueos por misión sin correr el backtest", () => {
  const report = hypothesisReadiness(REPO_ROOT);
  assert.equal(report.length, 4);
  const anySource = existsSync(path.join(REPO_ROOT, HYPOTHESIS_DEVELOPMENT_DATA_ROOT, "GAS_MONTHLY", "availability.json"));
  if (anySource) return; // cuando exista data real adaptada, este caso deja de aplicar
  for (const entry of report) {
    assert.equal(entry.status, "BLOCKED");
    assert.equal(entry.missionLabel, { GAS_MONTHLY: "Gas Monthly", GAS_QUARTERLY: "Gas Quarterly", POWER_MONTHLY: "Power Monthly", POWER_QUARTERLY: "Power Quarterly" }[entry.missionId]);
    assert.equal(entry.blockers.some((blocker) => blocker.code === "SOURCE_MISSING"), true);
  }
  assert.equal(hypRunDirs({ root: REPO_ROOT }).length, 0);
});

test("BT08-03: fixtures pequeñas cubren provenance, frescura y warm-up en la readiness", () => {
  const variants = [
    [{ corruptRow: true }, "PROVENANCE_INVALID"],
    [{ futurePit: true }, "FRESHNESS_BLOCKED"],
    [{ rows: 2 }, "WARM_UP_BLOCKED"],
  ];
  for (const [options, expectedCode] of variants) {
    const repo = makeHypothesisFixtureRepo({ missions: ["GAS_MONTHLY"], availabilityOptions: { GAS_MONTHLY: options } });
    const report = hypothesisReadinessForMission(repo.root, "GAS_MONTHLY");
    assert.equal(report.status, "BLOCKED", expectedCode);
    assert.equal(report.blockers.some((blocker) => blocker.code === expectedCode), true, expectedCode);
  }
  const ok = makeHypothesisFixtureRepo();
  const runnable = hypothesisReadinessForMission(ok.root, "GAS_MONTHLY");
  assert.equal(runnable.status, "RUNNABLE", JSON.stringify(runnable.blockers));
  assert.deepEqual(runnable.blockers, []);
});

test("BT08-03: los bloqueos del child llegan al receipt con blockers en inglés (freeze/reserva/horas)", async () => {
  const cases = [
    [{ requiresFreeze: true }, "FREEZE_PENDING"],
    [{ oosReservation: { reserved: true } }, "RESERVATION_INVALID"],
    [{ mode: "PER_TRADING_DAY", perDayGap: true }, "MISSING_DELIVERY_HOURS"],
  ];
  for (const [deliveryOptions, expectedCode] of cases) {
    const repo = makeHypothesisFixtureRepo({ missions: ["GAS_MONTHLY"], deliveryOptions: { GAS_MONTHLY: deliveryOptions } });
    const runner = newRunner(repo);
    const receipt = await runner.start({ requestedBy: "ui", job: hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" }) }).done;
    assert.equal(receipt.status, JOB_STATUS.FAILED, expectedCode);
    assert.equal(receipt.failure.code, "DEVELOPMENT_BLOCKED", expectedCode);
    assert.equal(receipt.failure.blockers.some((blocker) => blocker.code === expectedCode), true, expectedCode);
    assert.equal(receipt.result.status, "BLOCKED");
    assert.equal(receipt.result.researchPass, false);
    assert.equal(receipt.result.scientificConclusion, null);
  }
});

// ---------- BT08-04: sólo Development; sin cadena TRADES ni aperturas OOS ----------

test("BT08-04: llamadas válidas, reintentos y fases rechazadas nunca mutan el registro de aperturas OOS", async () => {
  const repo = makeHypothesisFixtureRepo();
  const sentinel = `${JSON.stringify({ artifactKind: "OOS_ACCESS_REGISTRY_SENTINEL" })}\n`;
  repo.write(TRADES_ACCESS_REGISTRY_PATH, sentinel);
  const runner = newRunner(repo);
  const request = hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" });

  const first = await runner.start({ requestedBy: "ui", job: request }).done;
  assert.equal(first.status, JOB_STATUS.SUCCEEDED, JSON.stringify(first.failure));
  await runner.start({ requestedBy: "ui", job: request }).done;
  const rejected = runner.start({ requestedBy: "ui", job: { ...request, phase: "OOS" } });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, "PHASE_NOT_DEVELOPMENT");

  assert.equal(readFileSync(path.join(repo.root, TRADES_ACCESS_REGISTRY_PATH), "utf8"), sentinel);
  assert.equal(readdirSync(path.join(repo.root, "operations/backtest-runs")).some((name) => name.startsWith("TR-RUN-")), false);
  assert.equal(existsSync(path.join(repo.root, "operations/trades/TR-04/OWNER_FREEZE_APPROVAL.json")), false);
  assert.equal(lockIsFree(runner), true);
});

test("BT08-04: la ruta de hipótesis no importa loaders del OOS ni la secuencia TRADES", () => {
  for (const file of [
    "src/backtest-jobs/hypothesis-runner.mjs",
    "src/backtest-jobs/hypothesis-entry.mjs",
    "src/backtest-jobs/hypothesis-inputs.mjs",
    "src/s1-strategy/development-episode.mjs",
  ]) {
    const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
    assert.equal(source.includes("trades-engine"), false, file);
    assert.equal(source.includes("oos-reservation"), false, file);
    assert.equal(source.includes("readOosOpenings"), false, file);
    assert.equal(source.includes("TRADES_RUN_PHASES"), false, file);
  }
});

// ---------- BT08-05: CONTROL vs activo, misma sizing/execution ----------

test("BT08-05: BUY/WAIT/ABSTAIN, requested vs filled y obligación viva en el mismo episodio", () => {
  const repo = makeHypothesisFixtureRepo();
  const request = hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" });
  const outcome = engineSpecFrom(repo, request);
  assert.equal(outcome.ok, true, outcome.code);
  const { control, active } = outcome.episode;

  const activeActions = active.ledger.map((row) => row.action);
  assert.deepEqual(activeActions, ["ABSTAIN", "ABSTAIN", "ABSTAIN", "BUY", "WAIT"]);
  // requested vs filled separados: en ABSTAIN el controller pide para el mismo
  // input state del brazo activo, pero el fill es 0.
  assert.equal(active.ledger[0].requestedMw, 2);
  assert.equal(active.ledger[0].filledMw, 0);
  // Paridad de cantidad con el mismo input state: en el BUY del día 4 el
  // controller del brazo activo (remaining 10, 2 oportunidades) pide 5 y llena 5.
  assert.equal(active.ledger[3].requestedMw, 5);
  assert.equal(active.ledger[3].filledMw, 5);
  assert.equal(active.ledger[3].fillPriceEurMwh, 20 + 0.15);
  // El CONTROL con SU input state pidió 2 ese día: la política es la misma, el
  // estado evolucionado no se fuerza igual (WAIT conserva la obligación viva).
  assert.equal(control.ledger[3].requestedMw, 2);
  // WAIT conservó el remaining del día anterior.
  assert.equal(active.ledger[4].remainingMw, active.ledger[3].remainingMw);
  assert.equal(active.summary.remainingMw, 5);
  assert.equal(active.summary.status, "OPEN_OBLIGATION");
  assert.equal(control.summary.remainingMw, 0);
  assert.equal(control.summary.status, "COMPLETE");
  for (const row of control.ledger) {
    assert.equal(typeof row.fillPriceEurMwh === "number" || row.fillPriceEurMwh === null, true);
    assert.equal(row.priceSourceHash === null || /^[a-f0-9]{64}$/.test(row.priceSourceHash), true);
  }
});

test("BT08-05: sin override oculto de 12 MW — el cap es el de la misión", () => {
  const repo = makeHypothesisFixtureRepo({ missions: ["GAS_QUARTERLY"] });
  const request = hypothesisJobRequest(repo, { missionId: "GAS_QUARTERLY", capMw: 4 });
  const outcome = engineSpecFrom(repo, request);
  assert.equal(outcome.ok, true, outcome.code);
  for (const row of outcome.episode.control.ledger) {
    assert.ok(row.requestedMw <= 4, `requestedMw ${row.requestedMw} superó el cap de la misión (4)`);
  }
  // Con target 60 y cap 4 el primer día pide exactamente el cap, no 12.
  assert.equal(outcome.episode.control.ledger[0].requestedMw, 4);
});

// ---------- BT08-06: economía evidence-bound; BENCHMARK ≠ ablation ----------

// Cobertura emparejada (hallazgo BT08-T10): en la fixture oficial CONTROL
// completa la obligación (10 MW) y el brazo activo compra 5 MW → HOLD explícito,
// sin delta publicado. El delta válido exige ambas obligaciones servidas.
test("BT08-06: cobertura desigual no publica delta (CONTROL 10 MW vs activo 5 MW); obligación servida sí", () => {
  const officialBenchmark = { status: "RECONCILED_OFFICIAL", version: "B-OFFICIAL-v1" };
  const repo = makeHypothesisFixtureRepo({ missions: ["GAS_MONTHLY"], benchmarkOptions: { GAS_MONTHLY: officialBenchmark } });
  const request = hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY", benchmark: officialBenchmark });
  const official = engineSpecFrom(repo, request, `HYP-RUN-${"1".repeat(64)}`);
  assert.equal(official.ok, true, official.code);
  assert.equal(official.episode.control.summary.boughtMw, 10);
  assert.equal(official.episode.active.summary.boughtMw, 5);
  const coverage = pairedAblation({
    runId: `HYP-RUN-${"1".repeat(64)}`,
    campaign: request.campaign,
    missionId: request.missionId,
    controllerHash: official.episode.controller.contentHash,
    calendarHash: official.episode.calendarHash,
    executionHash: official.episode.executionContractHash,
    benchmark: request.evaluation.benchmark,
    controlEpisode: official.episode.control,
    activeEpisode: official.episode.active,
  });
  assert.equal(coverage.ok, false);
  assert.equal(coverage.verdict, "HOLD");
  assert.equal(coverage.code, "COVERAGE_MISMATCH");
  assert.equal(coverage.controlBoughtMw, 10);
  assert.equal(coverage.activeBoughtMw, 5);
  assert.equal(coverage.deltaV, undefined);
});

// Con la obligación completa en ambos brazos (fixture con señal favorable el
// día 5) y benchmark oficial + fees conocidos, el delta emparejado se publica
// con veredicto HOLD (el criterio absoluto no se evalúa aquí).
test("BT08-06: benchmark oficial + fees conocidos publican el delta emparejado; provisional lo mantiene HOLD", () => {
  const officialBenchmark = { status: "RECONCILED_OFFICIAL", version: "B-OFFICIAL-v1" };
  const repo = makeHypothesisFixtureRepo({
    missions: ["GAS_MONTHLY"],
    benchmarkOptions: { GAS_MONTHLY: officialBenchmark },
    observationOptions: { GAS_MONTHLY: { prices: { "2025-03-07": 25 } } },
  });
  const request = hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY", benchmark: officialBenchmark });
  const official = engineSpecFrom(repo, request, `HYP-RUN-${"1".repeat(64)}`);
  assert.equal(official.ok, true, official.code);
  assert.equal(official.episode.control.summary.status, "COMPLETE");
  assert.equal(official.episode.active.summary.status, "COMPLETE");
  const ablation = pairedAblation({
    runId: `HYP-RUN-${"1".repeat(64)}`,
    campaign: request.campaign,
    missionId: request.missionId,
    controllerHash: official.episode.controller.contentHash,
    calendarHash: official.episode.calendarHash,
    executionHash: official.episode.executionContractHash,
    benchmark: request.evaluation.benchmark,
    controlEpisode: official.episode.control,
    activeEpisode: official.episode.active,
  });
  assert.equal(ablation.paired, true);
  assert.equal(ablation.ok, true, ablation.code);
  const controlH = official.episode.control.economics.H;
  const activeH = official.episode.active.economics.H;
  assert.ok(Math.abs(ablation.deltaV - (controlH - activeH)) < 1e-9);
  // La evaluación absoluta contra BENCHMARK y el efecto incremental contra
  // CONTROL quedan como registros distintos.
  assert.equal(official.episode.control.economics.B, request.evaluation.benchmark.value);
  assert.equal(official.episode.active.economics.B, request.evaluation.benchmark.value);
  assert.equal(ablation.verdict, "HOLD"); // criterio absoluto: no se evalúa aquí
  assert.equal(ablation.absolutePass, false);

  const provisional = engineSpecFrom(repo, request, `HYP-RUN-${"2".repeat(64)}`);
  const provisionalAblation = pairedAblation({
    runId: `HYP-RUN-${"2".repeat(64)}`,
    campaign: request.campaign,
    missionId: request.missionId,
    controllerHash: provisional.episode.controller.contentHash,
    calendarHash: provisional.episode.calendarHash,
    executionHash: provisional.episode.executionContractHash,
    benchmark: { ...request.evaluation.benchmark, status: "BENCHMARK_PROVISIONAL" },
    controlEpisode: provisional.episode.control,
    activeEpisode: provisional.episode.active,
  });
  assert.equal(provisionalAblation.ok, false);
  assert.equal(provisionalAblation.code, "ECONOMIC_EVIDENCE_INSUFFICIENT");
  assert.equal(provisionalAblation.deltaV, undefined);
});

test("BT08-06: fees unknown, unidades y horizonte de referencia — sin deltas válidos ni ceros por coerción", () => {
  const repo = makeHypothesisFixtureRepo({
    missions: ["GAS_MONTHLY"],
    observationOptions: { GAS_MONTHLY: { prices: { "2025-03-07": 25 } } },
  });
  const unknownFees = engineSpecFrom(repo, hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY", fees: { status: "UNKNOWN" } }));
  assert.equal(unknownFees.episode.control.economics.H, null);
  assert.match(unknownFees.episode.control.economics.hReason, /unknown/);
  const ablation = pairedAblation({
    runId: "HYP-RUN-x",
    campaign: unknownFees.episode.population,
    missionId: "GAS_MONTHLY",
    controllerHash: unknownFees.episode.controller.contentHash,
    calendarHash: unknownFees.episode.calendarHash,
    executionHash: unknownFees.episode.executionContractHash,
    benchmark: { identity: "BENCHMARK", version: "B", status: "RECONCILED_OFFICIAL", value: 30, unit: "EUR/MWh", artifactSha256: "c".repeat(64) },
    controlEpisode: unknownFees.episode.control,
    activeEpisode: unknownFees.episode.active,
  });
  assert.equal(ablation.ok, false);
  assert.equal(ablation.code, "ECONOMIC_EVIDENCE_INSUFFICIENT");

  // Unidad incompatible en la referencia declarada: la petición no pasa.
  const badUnit = validateHypothesisJobRequest(hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY", benchmark: { unit: "EUR/MW" } }));
  assert.equal(badUnit.ok, false);
  assert.equal(badUnit.code, "BINDING_INVALID");

  // Horas de delivery sin evidencia para un día: bloqueo explícito del child,
  // nunca conversión MW→MWh por suposición.
  const gapRepo = makeHypothesisFixtureRepo({ missions: ["GAS_MONTHLY"], deliveryOptions: { GAS_MONTHLY: { mode: "PER_TRADING_DAY", perDayGap: true } } });
  const gapOutcome = engineSpecFrom(gapRepo, hypothesisJobRequest(gapRepo, { missionId: "GAS_MONTHLY" }));
  assert.equal(gapOutcome.ok, false);
  assert.equal(gapOutcome.code, "MISSING_DELIVERY_HOURS");
});

// ---------- BT08-06 (execución) / hallazgo BT08-T09: best ask ejecutable -----

test("BT08-06: sin ask válido el día no ejecuta; volumen del ask limita el fill (parcial); la obligación sobrevive", () => {
  // Fixture A: el último día sin best ask → control pide 2 MW y no llena
  // nada; la obligación residual queda viva al cierre del episodio.
  const noAskRepo = makeHypothesisFixtureRepo({ missions: ["GAS_MONTHLY"], observationOptions: { GAS_MONTHLY: { noAskDates: ["2025-03-07"] } } });
  const noAsk = engineSpecFrom(noAskRepo, hypothesisJobRequest(noAskRepo, { missionId: "GAS_MONTHLY" }), `HYP-RUN-${"3".repeat(64)}`);
  assert.equal(noAsk.ok, true, noAsk.code);
  const noAskRow = noAsk.episode.control.ledger.at(-1);
  assert.equal(noAskRow.action, "BUY");
  assert.equal(noAskRow.requestedMw, 2);
  assert.equal(noAskRow.filledMw, 0);
  assert.equal(noAskRow.fillStatus, "NO_FILL");
  assert.equal(noAskRow.fillPriceEurMwh, null);
  assert.equal(noAskRow.bestAskEurMwh, null);
  assert.equal(noAskRow.remainingMw, 2);
  assert.equal(noAsk.episode.control.summary.status, "OPEN_OBLIGATION");

  // Fixture B: ask con volumen 1 frente a 2 MW pedidos → fill parcial y
  // obligación residual 9 con contrato íntegro.
  const partialRepo = makeHypothesisFixtureRepo({ missions: ["GAS_MONTHLY"], observationOptions: { GAS_MONTHLY: { askVolumes: { "2025-03-03": 1 } } } });
  const partial = engineSpecFrom(partialRepo, hypothesisJobRequest(partialRepo, { missionId: "GAS_MONTHLY" }), `HYP-RUN-${"4".repeat(64)}`);
  assert.equal(partial.ok, true, partial.code);
  const partialRow = partial.episode.control.ledger[0];
  assert.equal(partialRow.requestedMw, 2);
  assert.equal(partialRow.filledMw, 1);
  assert.equal(partialRow.fillStatus, "PARTIAL");
  assert.equal(partialRow.fillPriceEurMwh, 35 + 0.15);
  assert.equal(partialRow.remainingMw, 9);
  // El precio de decisión (35) no fue el ejecutable: es la observación, no el ask.
  assert.equal(partialRow.decisionPriceEurMwh, 35);

  // Fixture C: fila con ask malformado (sin volumen) es dato corrupto, no no-fill.
  const corruptRepo = makeHypothesisFixtureRepo();
  corruptRepo.write(`${HYPOTHESIS_DEVELOPMENT_DATA_ROOT}/GAS_MONTHLY/observations.json`, `${JSON.stringify({
    artifactKind: "HYPOTHESIS_DEVELOPMENT_OBSERVATIONS",
    observations: [{ date: "2025-03-03", price: 35, bestAskEurMwh: 35, bestAskVolumeMw: null, availableAtUtc: "2025-03-03T10:00:00Z", sourceHash: "b".repeat(64) }],
    sourceHash: "f".repeat(64),
    provenance: { authority: "x", locator: "y" },
  }, null, 1)}\n`);
  const corrupt = engineSpecFrom(corruptRepo, hypothesisJobRequest(corruptRepo, { missionId: "GAS_MONTHLY" }));
  assert.equal(corrupt.ok, false);
  assert.equal(corrupt.code, "PROVENANCE_INVALID");
});

// ---------- BT08-07: grilla tau/N acotada, búsqueda sin ganador ----------

test("BT08-07: búsqueda graba la población Development y las configuraciones probadas sin elegir ganador", async () => {
  const repo = makeHypothesisFixtureRepo({ missions: ["GAS_MONTHLY"] });
  const runner = newRunner(repo);
  const space = fixtureSearchSpace("GAS_MONTHLY");
  const request = hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY", search: true, jobOverrides: { searchSpace: space } });
  const receipt = await runner.start({ requestedBy: "ui", job: request }).done;
  assert.equal(receipt.status, JOB_STATUS.SUCCEEDED, JSON.stringify(receipt.failure));
  const results = JSON.parse(readFileSync(path.join(repo.root, receipt.result.results.path), "utf8"));
  assert.equal(results.search.enabled, true);
  assert.equal(results.search.testedConfigurations.length, space.candidates.length);
  assert.equal(results.search.winner, null);
  assert.equal(results.search.promotionStatus, "NOT_PROMOTED");
  assert.equal(results.researchPass, false);
  assert.equal(results.scientificConclusion, null);
  assert.equal(results.validComparison, false);
  // Objetivo y folds predeclarados vinculados al registro (hallazgo BT08-T14):
  // nulos cáen fuera del contrato del search space.
  assert.equal(results.search.objective.metric, "PAIRED_INCREMENTAL_DELTA_V_VS_CONTROL");
  assert.equal(results.search.objective.unit, "EUR/MWh");
  assert.ok(results.search.folds.length >= 1);
  for (const record of results.search.testedConfigurations) {
    assert.equal(record.status, "EPISODE_RECORDED");
    assert.ok(space.candidates.some((point) => point.N === record.N && point.tau.localTime === record.tau.localTime));
    assert.deepEqual(record.objective, results.search.objective);
    const point = space.candidates.find((p) => p.N === record.N && p.tau.localTime === record.tau.localTime);
    assert.deepEqual(record.folds, { rule: space.evaluationContract.foldRule, anchor: record.tau.localTime, warmUpDays: record.N, evaluationDays: point.supportedDays - record.N });
  }
  // Fuera de la grilla no hay candidato: la validación lo rechaza.
  assert.equal(validateHypothesisJobRequest({ ...request, candidate: { ...request.candidate, N: 20 } }).code, "OUTSIDE_PREDECLARED_SPACE");
});

// ---------- BT08-08: identidad, reuso y pointers por familia ----------

test("BT08-08: misma petición reutiliza el resultado; binding distinto crea identidad nueva", async () => {
  const repo = makeHypothesisFixtureRepo({ missions: ["GAS_MONTHLY"] });
  const runner = newRunner(repo);
  const gas = hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" });
  const first = await runner.start({ requestedBy: "ui", job: gas }).done;
  assert.equal(first.status, JOB_STATUS.SUCCEEDED);
  const second = runner.start({ requestedBy: "mcp", job: gas });
  assert.equal(second.ok, true);
  assert.equal(second.reused, true);
  assert.equal(second.job.runId, first.runId);
  assert.equal(hypRunDirs(repo).length, 1);

  // Cambiar un input (contenido distinto, manifest re-atado) crea otro run_id.
  repo.write(`${HYPOTHESIS_DEVELOPMENT_DATA_ROOT}/GAS_MONTHLY/benchmark.json`, `${JSON.stringify({
    artifactKind: "HYPOTHESIS_DEVELOPMENT_BENCHMARK",
    identity: "BENCHMARK",
    version: "B-FIXTURE-v2",
    status: "BENCHMARK_PROVISIONAL",
    value: 35,
    unit: "EUR/MWh",
    artifactSha256: "c".repeat(64),
    sourceHash: "d".repeat(64),
    campaignId: "FIXTURE-GAS_MONTHLY",
    obligationId: "OBL-GAS_MONTHLY",
    window: "1-0-1",
    provenance: { authority: "x", locator: "y" },
  }, null, 1)}\n`);
  const changed = hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY", benchmark: { version: "B-FIXTURE-v2", value: 35 } });
  const third = await runner.start({ requestedBy: "ui", job: changed }).done;
  assert.equal(third.status, JOB_STATUS.SUCCEEDED, JSON.stringify(third.failure));
  assert.notEqual(third.runId, first.runId);
  assert.equal(hypRunDirs(repo).length, 2);
  // El historial append-only conserva los dos runs.
  assert.equal(hypothesisRegistry(runner).filter((event) => event.event === REGISTRY_EVENT.RESULT_PROMOTED).length, 2);
});

test("BT08-08: el vigente es por familia — Power no reemplaza el resultado vigente de Gas", async () => {
  const repo = makeHypothesisFixtureRepo({ missions: ["GAS_MONTHLY", "POWER_MONTHLY"] });
  const runner = newRunner(repo);
  const gas = await runner.start({ requestedBy: "ui", job: hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" }) }).done;
  const power = await runner.start({ requestedBy: "ui", job: hypothesisJobRequest(repo, { missionId: "POWER_MONTHLY" }) }).done;
  assert.equal(power.status, JOB_STATUS.SUCCEEDED);
  const families = Object.fromEntries(runner.status().families.map((entry) => [entry.family, entry]));
  assert.equal(families[familyKeyOf({ hypothesisId: "H-S1-01", missionId: "GAS_MONTHLY", phase: "DEVELOPMENT", dataMode: "TOB" })].currentRunId, gas.runId);
  assert.equal(families[familyKeyOf({ hypothesisId: "H-S1-01", missionId: "POWER_MONTHLY", phase: "DEVELOPMENT", dataMode: "TOB" })].currentRunId, power.runId);
  assert.equal(runner.get(gas.runId).job.retention.state, RESULT_STATE.CURRENT);

  // Dentro de la MISMA familia el vigente sí se reemplaza.
  const baseRequest = hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" });
  const gasSecond = await runner.start({
    requestedBy: "ui",
    job: { ...baseRequest, campaign: { ...baseRequest.campaign, populationId: "POP-CHANGED" } },
  }).done;
  assert.notEqual(gasSecond.runId, gas.runId);
  assert.equal(runner.get(gas.runId).job.retention.state, RESULT_STATE.SUPERSEDED);
  assert.equal(runner.get(gasSecond.runId).job.retention.state, RESULT_STATE.CURRENT);
  assert.ok(hypothesisRegistry(runner).every((event) => event.event !== REGISTRY_EVENT.RESULT_PROMOTED || typeof event.family === "string"));
});

// ---------- BT08-09: lock compartido, recovery y limpieza ----------

test("BT08-09: un solo lock compartido con BT-05 en ambas direcciones", async () => {
  const repo = makeHypothesisFixtureRepo();
  const runner = newRunner(repo);
  // Un lock vivo de otro runner bloquea la ruta de hipótesis.
  claimJobLock(runner.runsRoot, readJobLock(runner.runsRoot)?.generation ?? 0, { runId: "BT-RUN-otro", attempt: 1, pid: process.pid });
  const blocked = runner.start({ requestedBy: "ui", job: hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" }) });
  assert.equal(blocked.code, "JOB_ALREADY_RUNNING");
  assert.equal(hypRunDirs(repo).length, 0);

  // Y viceversa: con el job de hipótesis en curso, el runner de BT-05 no lanza.
  const free = makeHypothesisFixtureRepo();
  const hypRunner = newRunner(free);
  const started = hypRunner.start({ requestedBy: "ui", job: hypothesisJobRequest(free, { missionId: "GAS_MONTHLY" }) });
  assert.equal(started.ok, true);
  const exploratory = createBacktestJobRunner({ repoRoot: free.root, runsDir: hypRunner.runsRoot });
  assert.equal(exploratory.start({ requestedBy: "ui" }).code, "JOB_ALREADY_RUNNING");
  assert.equal((await started.done).status, JOB_STATUS.SUCCEEDED);
  assert.equal(lockIsFree(hypRunner), true);
});

test("BT08-09: receipt huérfano RUNNING se cierra INTERRUPTED y su workspace temporal se borra", () => {
  const repo = makeHypothesisFixtureRepo();
  const runner = newRunner(repo);
  const orphanDir = path.join(runner.runsRoot, `HYP-RUN-${"a".repeat(64)}`, "attempt-1");
  mkdirSync(path.join(orphanDir, "workspace"), { recursive: true });
  writeFileSync(path.join(orphanDir, "RUN_RECEIPT.json"), JSON.stringify({
    receiptKind: "BT-08_HYPOTHESIS_RUN_RECEIPT", runId: `HYP-RUN-${"a".repeat(64)}`, attempt: 1,
    jobKind: HYPOTHESIS_JOB_KIND, identity: { parameters: { family: "H-S1-01|GAS_MONTHLY|DEVELOPMENT|TOB" } },
    status: JOB_STATUS.RUNNING, workspace: { retention: "TEMPORARY" },
  }));
  writeFileSync(path.join(orphanDir, "workspace", "leftover.txt"), "temp");
  claimJobLock(runner.runsRoot, readJobLock(runner.runsRoot)?.generation ?? 0, { runId: `HYP-RUN-${"a".repeat(64)}`, attempt: 1, pid: DEAD_PID });
  newRunner(repo);
  const closed = JSON.parse(readFileSync(path.join(orphanDir, "RUN_RECEIPT.json"), "utf8"));
  assert.equal(closed.status, JOB_STATUS.INTERRUPTED);
  assert.equal(existsSync(path.join(orphanDir, "workspace")), false);
  assert.equal(lockIsFree(runner), true);
});

test("BT08-09: el run exitoso no deja workspace; el pico de RAM del hijo queda medido; el log va a archivo", async () => {
  const repo = makeHypothesisFixtureRepo();
  const runner = newRunner(repo);
  const receipt = await runner.start({ requestedBy: "ui", job: hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" }) }).done;
  assert.equal(receipt.status, JOB_STATUS.SUCCEEDED, JSON.stringify(receipt.failure));
  const attemptDir = path.join(runner.runsRoot, receipt.runId, "attempt-1");
  assert.equal(existsSync(path.join(attemptDir, "workspace")), false);
  assert.ok(existsSync(path.join(attemptDir, "job.log")));
  assert.ok(receipt.memory.childMaxRssKb > 0);
  assert.equal(receipt.workspace.removed, true);
  const events = hypothesisRegistry(runner);
  assert.equal(events.filter((event) => event.event === REGISTRY_EVENT.RUN_CLOSED).length, 1);
  assert.equal(events.filter((event) => event.event === REGISTRY_EVENT.RESULT_PROMOTED).length, 1);
});

// ---------- BT08-10: payload inglés para UI-08 ----------

test("BT08-10: el payload distingue estados registered/runnable/tested/blocked con vocabulario en inglés", async () => {
  const repo = makeHypothesisFixtureRepo({ missions: ["GAS_MONTHLY"], availabilityOptions: { GAS_MONTHLY: { rows: 2 } } });
  const runner = newRunner(repo);
  await withServer({ hypothesisJobRunner: runner }, async (base) => {
    const status = await (await fetch(`${base}${BACKTEST_JOBS_PATH}`)).json();
    // registered: identidad canónica servida por el backend, en inglés.
    assert.equal(status.hypothesis.hypothesisMetadata.name, "Session-Anchored Rolling Reference");
    assert.deepEqual(status.hypothesis.hypothesisMetadata.runnablePhases, ["DEVELOPMENT"]);
    // blocked: la misión con warm-up insuficiente, con blocker legible.
    const gasReadiness = status.hypothesis.readiness.find((entry) => entry.missionId === "GAS_MONTHLY");
    assert.equal(gasReadiness.missionLabel, "Gas Monthly");
    assert.equal(gasReadiness.status, "BLOCKED");
    assert.equal(gasReadiness.blockers[0].code, "WARM_UP_BLOCKED");
    assert.match(gasReadiness.blockers[0].message, /^no anchor has enough/);
    assert.equal(status.hypothesis.display.line, "No hypothesis run has been launched yet");
    assert.equal(status.hypothesis.families.length, 0);
    // runnable honesto: la otra misión de este fixture tampoco tiene datos completos.
    assert.equal(status.hypothesis.readiness.find((entry) => entry.missionId === "GAS_QUARTERLY").status, "BLOCKED");
    assert.equal(status.hypothesis.readiness.find((entry) => entry.missionId === "GAS_QUARTERLY").blockers[0].code, "SOURCE_MISSING");
  });

  // tested: con datos completas, obligación servida en ambos brazos y
  // comparación emparejada publicada, la familia queda TESTED con su vigente
  // por familia.
  const runnableRepo = makeHypothesisFixtureRepo({
    missions: ["GAS_MONTHLY"],
    benchmarkOptions: { GAS_MONTHLY: { status: "RECONCILED_OFFICIAL", version: "B-OFFICIAL-v1" } },
    observationOptions: { GAS_MONTHLY: { prices: { "2025-03-07": 25 } } },
  });
  const runnableRunner = newRunner(runnableRepo);
  const ready = hypothesisReadinessForMission(runnableRepo.root, "GAS_MONTHLY");
  assert.equal(ready.status, "RUNNABLE", JSON.stringify(ready.blockers));
  const receipt = await runnableRunner.start({
    requestedBy: "ui",
    job: hypothesisJobRequest(runnableRepo, { missionId: "GAS_MONTHLY", benchmark: { status: "RECONCILED_OFFICIAL", version: "B-OFFICIAL-v1" } }),
  }).done;
  assert.equal(receipt.status, JOB_STATUS.SUCCEEDED, JSON.stringify(receipt.failure));
  const family = runnableRunner.status().families[0];
  assert.equal(family.tested, true);
  assert.equal(family.retention.state, RESULT_STATE.CURRENT);
});

test("BT08-10: los failure codes de la ruta de hipótesis tienen frase en inglés", () => {
  for (const code of [
    "HYPOTHESIS_NOT_CONFIGURED", "UNKNOWN_HYPOTHESIS", "HYPOTHESIS_VERSION_MISMATCH", "UNKNOWN_MISSION",
    "MISSION_NOT_APPLICABLE", "PHASE_NOT_DEVELOPMENT", "INVALID_DATA_MODE", "SEARCH_SPACE_INTEGRITY",
    "CANDIDATE_INTEGRITY", "OUTSIDE_PREDECLARED_SPACE", "CONFIGURATION_INTEGRITY", "PARAMETER_CANDIDATE_MISMATCH",
    "BINDING_INVALID", "INVALID_HYPOTHESIS_REQUEST", "MISSION_INPUT_MISMATCH", "DEVELOPMENT_BLOCKED", "SPEC_CHANGED_DURING_RUN",
  ]) {
    assert.equal(typeof FAILURE_WORDS[code], "string", code);
    assert.match(FAILURE_WORDS[code], /^[a-z]/, code);
  }
  assert.equal(describeHypothesisStatus(null, new Date()), "Hypothesis jobs are not configured on this server");
});

test("BT08-10: un job bloqueado publica su línea y blockers en inglés", async () => {
  const repo = makeHypothesisFixtureRepo({ missions: ["GAS_MONTHLY"], deliveryOptions: { GAS_MONTHLY: { requiresFreeze: true } } });
  const runner = newRunner(repo);
  const receipt = await runner.start({ requestedBy: "ui", job: hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" }) }).done;
  assert.equal(receipt.failure.code, "DEVELOPMENT_BLOCKED");
  assert.equal(receipt.failure.blockers[0].code, "FREEZE_PENDING");
  assert.equal(receipt.failure.blockers[0].message, "the availability source declares a required freeze that is not bound");
  assert.match(describeHypothesisStatus(runner.status(), new Date()), /^Last hypothesis run: failed · the mission's Development inputs are blocked \(see blockers\) · 1 blocker recorded$/);
});

// ---------- hallazgos BT08-T07: frontera y disponibilidad predeclarada ----------

test("BT08-06: la disponibilidad corrida debe ser la predeclarada por el search space (T07)", async () => {
  const repo = makeHypothesisFixtureRepo();
  const runner = newRunner(repo);
  // Tres días en disco mientras el espacio predeclara cinco: las filas ya no
  // pinchan con el availabilityHash del espacio → bloqueo antes del run.
  const shortAvailability = JSON.stringify({
    artifactKind: "HYPOTHESIS_DEVELOPMENT_AVAILABILITY",
    mission: "Gas Monthly",
    session: { mission: "Gas Monthly", zone: "UTC", anchors: ["10:00"], sourceHash: "a".repeat(64) },
    availability: (["2025-03-03", "2025-03-04", "2025-03-05"]).map((day) => ({
      mission: "Gas Monthly", atUtc: `${day}T10:00:00Z`, sessionDate: day,
      anchor: "10:00", available: true, pitAvailableAtUtc: `${day}T10:00:00Z`, sourceHash: "b".repeat(64),
    })),
    sourceHash: "a".repeat(64),
    provenance: { authority: "x", locator: "y" },
  }, null, 1);
  repo.write(`${HYPOTHESIS_DEVELOPMENT_DATA_ROOT}/GAS_MONTHLY/availability.json`, `${shortAvailability}\n`);
  repo.commitAll("menos días");
  const request = hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" });
  const receipt = await runner.start({ requestedBy: "ui", job: request }).done;
  assert.equal(receipt.status, JOB_STATUS.FAILED, JSON.stringify(receipt.failure?.code));
  assert.equal(receipt.failure.code, "DEVELOPMENT_BLOCKED");
  assert.equal(receipt.failure.blockers[0].code, "AVAILABILITY_NOT_PREDECLARED");
  assert.equal(receipt.result.status, "BLOCKED");
  assert.equal(receipt.result.validComparison, false);
});

test("BT08-06: una observación tras la frontera Development no corre (T07)", async () => {
  const repo = makeHypothesisFixtureRepo();
  const runner = newRunner(repo);
  const observations = JSON.parse(readFileSync(path.join(repo.root, `${HYPOTHESIS_DEVELOPMENT_DATA_ROOT}/GAS_MONTHLY/observations.json`), "utf8"));
  observations.observations.push({
    date: "2025-03-10", price: 20, bestAskEurMwh: 20, bestAskVolumeMw: 10,
    availableAtUtc: "2025-03-10T10:00:00Z", sourceHash: "b".repeat(64),
  });
  repo.write(`${HYPOTHESIS_DEVELOPMENT_DATA_ROOT}/GAS_MONTHLY/observations.json`, `${JSON.stringify(observations, null, 1)}\n`);
  repo.commitAll("observación fuera de frontera");
  const receipt = await runner.start({ requestedBy: "ui", job: hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" }) }).done;
  assert.equal(receipt.status, JOB_STATUS.FAILED, JSON.stringify(receipt.failure?.code));
  assert.equal(receipt.failure.blockers[0].code, "NON_DEVELOPMENT_OBSERVATION");
  assert.equal(receipt.failure.blockers[0].date, "2025-03-10");
});

// ---------- hallazgo BT08-T12: benchmark atado a campaña/productor ----------

test("BT08-06: un benchmark autoconsistente de otra campaña queda HOLD sin publicar (T12)", async () => {
  const repo = makeHypothesisFixtureRepo();
  const runner = newRunner(repo);
  const crossCampaign = {
    artifactKind: "HYPOTHESIS_DEVELOPMENT_BENCHMARK",
    identity: "BENCHMARK",
    version: "B-OTHER-CAMPAIGN-v1",
    status: "RECONCILED_OFFICIAL",
    value: 30,
    unit: "EUR/MWh",
    artifactSha256: "c".repeat(64),
    sourceHash: "d".repeat(64),
    campaignId: "FIXTURE-POWER_MONTHLY",
    obligationId: "OBL-POWER_MONTHLY",
    window: "1-0-1", // ventana correcta de la misión; la campaña es otra
    provenance: { authority: "SYNTHETIC_FIXTURE", locator: "benchmark-of-another-campaign" },
  };
  repo.write(`${HYPOTHESIS_DEVELOPMENT_DATA_ROOT}/GAS_MONTHLY/benchmark.json`, `${JSON.stringify(crossCampaign, null, 1)}\n`);
  repo.commitAll("benchmark de otra campaña");
  const receipt = await runner.start({ requestedBy: "ui", job: hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" }) }).done;
  assert.equal(receipt.status, JOB_STATUS.FAILED, JSON.stringify(receipt.failure?.code));
  assert.equal(receipt.failure.code, "DEVELOPMENT_BLOCKED");
  assert.equal(receipt.failure.blockers[0].code, "BINDING_INVALID");
  assert.match(receipt.failure.blockers[0].message, /declared evaluation reference of this campaign/);
  assert.equal(receipt.result.status, "BLOCKED"); // HOLD: nada publicado
  assert.equal(receipt.result.validComparison, false);
  assert.equal(receipt.result.researchPass, false);
  assert.equal(receipt.result.scientificConclusion, null);
});

test("BT08-06: el benchmark comprometido debe cubrir la ventana canónica de la misión (T12)", async () => {
  const repo = makeHypothesisFixtureRepo();
  const runner = newRunner(repo);
  const wrongWindow = {
    artifactKind: "HYPOTHESIS_DEVELOPMENT_BENCHMARK",
    identity: "BENCHMARK",
    version: "B-WRONG-WINDOW-v1",
    status: "BENCHMARK_PROVISIONAL",
    value: 34,
    unit: "EUR/MWh",
    artifactSha256: "c".repeat(64),
    sourceHash: "d".repeat(64),
    campaignId: "FIXTURE-GAS_MONTHLY",
    obligationId: "OBL-GAS_MONTHLY",
    window: "3-1-3", // ventana Quarterly para la misión Monthly
    provenance: { authority: "SYNTHETIC_FIXTURE", locator: "wrong-window" },
  };
  repo.write(`${HYPOTHESIS_DEVELOPMENT_DATA_ROOT}/GAS_MONTHLY/benchmark.json`, `${JSON.stringify(wrongWindow, null, 1)}\n`);
  repo.commitAll("ventana incorrecta");
  const receipt = await runner.start({ requestedBy: "ui", job: hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" }) }).done;
  assert.equal(receipt.status, JOB_STATUS.FAILED);
  assert.equal(receipt.failure.blockers[0].code, "SOURCE_ARTIFACT_INVALID");
  assert.match(receipt.failure.blockers[0].message, /reference window does not cover mission/);
});

// ---------- hallazgo BT08-T13: conversión MW→MWh por día de entrega ----------

test("BT08-06: el notional usa las horas del día de entrega de cada fila, con cálculo independiente", () => {
  const perDay = { "2025-03-03": 1, "2025-03-04": 2, "2025-03-05": 3, "2025-03-06": 4, "2025-03-07": 5 };
  const repo = makeHypothesisFixtureRepo({
    observationOptions: { GAS_MONTHLY: { prices: { "2025-03-07": 25 } } },
    deliveryOptions: { GAS_MONTHLY: { mode: "PER_TRADING_DAY", perDay } },
  });
  const request = hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" });
  const outcome = engineSpecFrom(repo, request, `HYP-RUN-${"5".repeat(64)}`);
  assert.equal(outcome.ok, true, outcome.code);
  for (const [armLabel, arm] of [["control", outcome.episode.control], ["active", outcome.episode.active]]) {
    // Cálculo independiente fila por fila: suma de filledMw × horas del día de cada fila.
    const independentMwh = arm.ledger.reduce((sum, row) => sum + row.filledMw * perDay[row.date], 0);
    assert.ok(independentMwh > 0, armLabel);
    assert.equal(arm.economics.boughtMwh, independentMwh);
    assert.ok(arm.economics.totalEur !== null);
    // La suma del calendario (15 h) multiplicada por TODO el MW daría otro número.
    assert.notEqual(arm.economics.boughtMwh, arm.economics.boughtMw * 15, armLabel);
  }
  const controlMwh = outcome.episode.control.ledger.reduce((sum, row) => sum + row.filledMw * perDay[row.date], 0);
  assert.equal(controlMwh, 2 * (1 + 2 + 3 + 4 + 5));
});

// ---------- hallazgo BT08-T16: el lote no anuncia éxito completo ----------

test("BT08-02: el resultado del lote distingue los estados finales por misión", async () => {
  const repo = makeHypothesisFixtureRepo({
    missions: ["GAS_MONTHLY", "POWER_MONTHLY"],
    deliveryOptions: { POWER_MONTHLY: { requiresFreeze: true } },
  });
  const runner = newRunner(repo);
  const batch = await runner.startBatch({
    requestedBy: "ui",
    jobs: [hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" }), hypothesisJobRequest(repo, { missionId: "POWER_MONTHLY" })],
  });
  assert.equal(batch.ok, true);
  await Promise.all(batch.batch.map((entry) => entry.done));
  assert.equal(batch.complete, false);
  assert.equal(batch.outcomes.length, 2);
  const gasOutcome = batch.outcomes[0];
  const powerOutcome = batch.outcomes[1];
  assert.equal(gasOutcome.ok, true);
  assert.equal(gasOutcome.status, JOB_STATUS.SUCCEEDED);
  assert.equal(gasOutcome.result.status, "JOB_COMPLETED");
  assert.equal(powerOutcome.ok, false);
  assert.equal(powerOutcome.status, JOB_STATUS.FAILED);
  assert.equal(powerOutcome.failure.code, "DEVELOPMENT_BLOCKED");
  assert.equal(powerOutcome.runId === gasOutcome.runId, false);
});

// ---------- hallazgos BT08-T02/T03/T15/T17: frontera HTTP y contrato inglés ----------

const stubStatus = () => ({ running: false, current: null, latest: null, currentResult: null, registry: { ok: true, path: "x", events: 0 } });

test("BT08-01: un payload de hipótesis sin mode HYPOTHESIS se rechaza sin ningún runner legacy (T02)", async () => {
  const repo = makeHypothesisFixtureRepo();
  const launches = [];
  const stubTob = {
    start: () => { launches.push("TOB"); return { ok: true, reused: false, job: { runId: "BT-RUN-x" } }; },
    now: () => new Date(),
    status: stubStatus,
    get: () => null,
    runsRoot: repo.root,
  };
  const runner = newRunner(repo);
  await withServer({ jobRunner: stubTob, tradesJobRunner: null, hypothesisJobRunner: runner }, async (base) => {
    const response = await postJob(base, { requestedBy: "ui", job: { hypothesisId: "H-S1-01" } });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.code, "INVALID_MODE");
    assert.match(payload.message, /requires mode "HYPOTHESIS"/);
    assert.match(payload.message, /legacy/);
    // Con mode TOB explícito y payload de hipótesis: tampoco hay fallback.
    const explicit = await postJob(base, { requestedBy: "ui", mode: "TOB", job: { hypothesisId: "H-S1-01" } });
    assert.equal(explicit.status, 400);
  });
  assert.deepEqual(launches, []);
});

test("BT08-01: POST sobre el path de un run responde 405 y no inicia job (T03)", async () => {
  const repo = makeHypothesisFixtureRepo();
  const launches = [];
  const stubTob = {
    start: () => { launches.push("TOB"); return { ok: true, reused: false, job: { runId: "BT-RUN-x" } }; },
    now: () => new Date(),
    status: stubStatus,
    get: () => ({ receipt: {}, job: { runId: "BT-RUN-x" } }),
    runsRoot: repo.root,
  };
  const runner = newRunner(repo);
  await withServer({ jobRunner: stubTob, tradesJobRunner: null, hypothesisJobRunner: runner }, async (base) => {
    const onRunPath = await fetch(`${base}${BACKTEST_JOBS_PATH}/HYP-RUN-${"b".repeat(64)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestedBy: "ui", mode: "HYPOTHESIS", job: { hypothesisId: "H-S1-01" } }),
    });
    assert.equal(onRunPath.status, 405);
    assert.equal((await onRunPath.json()).code, "METHOD_NOT_ALLOWED");
    const legacyOnRunPath = await fetch(`${base}${BACKTEST_JOBS_PATH}/BT-RUN-${"b".repeat(64)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestedBy: "ui", mode: "TOB" }),
    });
    assert.equal(legacyOnRunPath.status, 405);
  });
  assert.deepEqual(launches, []);
  assert.equal(lockIsFree(runner), true);
});

test("BT08-01: GET del run entrega por HTTP/MCP la comparación y ablation ligadas al manifest (T15)", async () => {
  const official = { status: "RECONCILED_OFFICIAL", version: "B-OFFICIAL-v1" };
  const repo = makeHypothesisFixtureRepo({
    missions: ["GAS_MONTHLY"],
    benchmarkOptions: { GAS_MONTHLY: official },
    observationOptions: { GAS_MONTHLY: { prices: { "2025-03-07": 25 } } },
  });
  const runner = newRunner(repo);
  const request = hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY", benchmark: official });
  await withServer({ hypothesisJobRunner: runner }, async (base) => {
    const response = await postJob(base, { requestedBy: "ui", mode: "HYPOTHESIS", job: request });
    const { job } = await response.json();
    await runner.waitForIdle();
    const viaHttp = await (await fetch(`${base}${BACKTEST_JOBS_PATH}/${job.runId}`)).json();
    const result = viaHttp.job.result;
    assert.equal(result.comparison === null, false);
    assert.equal(result.comparison.control.armId, "CONTROL");
    assert.equal(result.comparison.active.armId, "H-S1-01");
    assert.equal(result.ablation.ok, true);
    assert.equal(typeof result.ablation.deltaV, "number");
    // Ligado al manifest: el hash del manifest liga spec e inputs del run.
    assert.match(result.manifest.path, /^operations\/backtest-runs\//);
    assert.match(result.manifest.sha256, /^[a-f0-9]{64}$/);
    // La comparación publicada queda atada a la campaña del spec.
    assert.equal(result.comparison.control.economics.campaignId, "FIXTURE-GAS_MONTHLY");
    assert.equal(result.comparison.active.economics.campaignId, "FIXTURE-GAS_MONTHLY");
    const baseUrl = `${base}/`;
    const viaMcp = await handleMcpMessage({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "backtest_status", arguments: { runId: job.runId } } }, { baseUrl });
    const mcpPayload = viaMcp.result.structuredContent;
    assert.equal(mcpPayload.job.result.ablation.ok, true);
    assert.equal(mcpPayload.job.result.comparison.active.economics.campaignId, "FIXTURE-GAS_MONTHLY");
  });
});

test("BT08-10: CODE_COMMIT_UNKNOWN, CODE_NOT_COMMITTED e INVALID_REQUESTER en inglés (T17)", async () => {
  const unknownRepo = makeHypothesisFixtureRepo();
  rmSync(path.join(unknownRepo.root, ".git"), { recursive: true, force: true });
  const unknown = newRunner(unknownRepo).start({ requestedBy: "ui", job: hypothesisJobRequest(unknownRepo, { missionId: "GAS_MONTHLY" }) });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "CODE_COMMIT_UNKNOWN");
  assert.equal(unknown.message, "the git commit of the code could not be read");

  const dirtyRepo = makeHypothesisFixtureRepo();
  dirtyRepo.write("src/s1-strategy/h-s1-01.mjs", `// dirty sentinel\n`);
  const dirty = newRunner(dirtyRepo).start({ requestedBy: "ui", job: hypothesisJobRequest(dirtyRepo, { missionId: "GAS_MONTHLY" }) });
  assert.equal(dirty.ok, false);
  assert.equal(dirty.code, "CODE_NOT_COMMITTED");
  assert.match(dirty.message, /^the code has uncommitted changes:/);

  const repo = makeHypothesisFixtureRepo();
  const runner = newRunner(repo);
  const requester = runner.start({ requestedBy: "bot", job: hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" }) });
  assert.equal(requester.ok, false);
  assert.equal(requester.code, "INVALID_REQUESTER");
  assert.equal(requester.message, 'requestedBy must be "ui" or "mcp"');

  await withServer({ hypothesisJobRunner: runner }, async (base) => {
    const viaHttp = await postJob(base, { mode: "HYPOTHESIS", job: hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" }) });
    assert.equal(viaHttp.status, 400);
    const payload = await viaHttp.json();
    assert.equal(payload.code, "INVALID_REQUESTER");
    assert.match(payload.message, /^requestedBy must be/);
  });
  assert.equal(hypRunDirs(repo).length, 0);
});

// ---------- validComparison honesta (hallazgo BT08-T11) end-to-end ----------

test("BT08-02: benchmark provisional o fees unknown no marcan la comparación como probada (T11)", async () => {
  for (const [label, jobOptions] of [
    ["provisional benchmark", { benchmark: { status: "BENCHMARK_PROVISIONAL" } }],
    ["unknown fees", { fees: { status: "UNKNOWN" } }],
  ]) {
    const repo = makeHypothesisFixtureRepo({
      missions: ["GAS_MONTHLY"],
      observationOptions: { GAS_MONTHLY: { prices: { "2025-03-07": 25 } } },
      benchmarkOptions: label === "provisional benchmark" ? {} : { GAS_MONTHLY: { status: "RECONCILED_OFFICIAL", version: "B-OFFICIAL-v1" } },
    });
    const runner = newRunner(repo);
    const request = hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY", ...jobOptions,
      benchmark: label === "provisional benchmark" ? { status: "BENCHMARK_PROVISIONAL" } : { status: "RECONCILED_OFFICIAL", version: "B-OFFICIAL-v1" } });
    const receipt = await runner.start({ requestedBy: "ui", job: request }).done;
    assert.equal(receipt.status, JOB_STATUS.SUCCEEDED, label);
    assert.equal(receipt.result.validComparison, false, label);
    assert.equal(receipt.result.ablation.ok, false, label);
    assert.equal(runner.status().families[0].tested, false, label);
    assert.equal(runner.status().families[0].retention.state, RESULT_STATE.CURRENT, label);
  }
});

test("BT08-02: el POST de lote no anuncia éxito completo cuando una misión queda bloqueada (T16)", async () => {
  const repo = makeHypothesisFixtureRepo({
    missions: ["GAS_MONTHLY", "POWER_MONTHLY"],
    deliveryOptions: { POWER_MONTHLY: { requiresFreeze: true } },
  });
  const runner = newRunner(repo);
  await withServer({ hypothesisJobRunner: runner }, async (base) => {
    const response = await postJob(base, {
      requestedBy: "ui",
      mode: "HYPOTHESIS",
      jobs: [hypothesisJobRequest(repo, { missionId: "GAS_MONTHLY" }), hypothesisJobRequest(repo, { missionId: "POWER_MONTHLY" })],
    });
    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    await runner.waitForIdle();
    // Estados finales diferenciados publicados al consumidor HTTP.
    const viaHttp = payload.outcomes;
    assert.equal(Array.isArray(viaHttp), true);
    assert.equal(viaHttp.length, 2);
    assert.equal(viaHttp.every((outcome) => outcome.status === JOB_STATUS.SUCCEEDED), false);
    const gasFinal = viaHttp.find((outcome) => outcome.status === JOB_STATUS.SUCCEEDED);
    const powerFinal = viaHttp.find((outcome) => outcome.status === JOB_STATUS.FAILED);
    assert.equal(gasFinal.result.status, "JOB_COMPLETED");
    assert.equal(powerFinal.failure.code, "DEVELOPMENT_BLOCKED");
    assert.equal(typeof payload.complete, "boolean");
  });
});
