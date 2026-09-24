// Suite IMP-15 — cerrar instrumento P6 y campaña manual end-to-end (§14.10,
// §25.1, §25.2.2). Fuente: SPEC v1.1.1 §25.1 fila IMP-15 ("Closure receipt P6,
// comparativa manual/evaluator"; acuerdos: "volumen/costes cuadran, vistas
// separadas, paridad, cero convenience fills; B/H/V/coverage manual
// coinciden"), §25.2 ("Closure receipt P6 y coincidencia manual/evaluator en
// B/H/V/coverage para la campaña; evidencia de validez del instrumento, no
// research PASS"; "no requiere S1 OOS ni DEP-13"), §14.10 (closure gate) y
// §14.6 (H desde execution ledger; V=B−H; coverage separada).
//
// Los expected de la campaña manual se calcularon a mano ANTES de codificar
// este test: operations/audit/IMP-15/manual-campaign-oracle.md. Todos los
// inputs son sintéticos explícitos (patrón IMP-13): no son datos reales del
// cliente, no prueban market edge y no cierran DEP-01–09 para una campaña
// manual real (§14.8 "no certifica market edge"; §25.2 "evidencia de validez
// del instrumento, no research PASS").
//
// GATE-01 consume el artefacto de ejecución REAL del suite IMP-13
// (operations/audit/IMP-15/imp13-fixture-suite-run.json, materializado por
// run-imp13-fixture-suite.mjs): la evidencia no se auto-atestúa en este
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOutputBundle,
  createRunReceiptRegistry,
  compareReproducibility,
  compareManualVsEvaluator,
  evaluateCampaignFromRun,
  evaluateP6ClosureGate,
  materializeP6ClosureReceipt,
  runP6Replay,
  MANUAL_FIXTURE_IDS,
  FIXTURE_SUITE_RUN_EVIDENCE_KIND,
  validateFixtureSuiteRunEvidence,
} from "../../src/p6-evaluator/index.mjs";

import {
  frozenCampaignBundle,
  createCostLedgerWithKnownNonEmbeddedFee,
  manualAndRunEvaluations,
  loadImp13SuiteRunEvidence,
  CAMPAIGN_DATES,
  BENCHMARK_ROWS,
  BENCHMARK_EVALUATION_KEYS,
} from "./campaign-fixture.mjs";

test("IMP-15: la campaña manual end-to-end cierra con paridad manual/evaluator en B/H/V/coverage", () => {
  const bundle = frozenCampaignBundle();

  // Run 1: replay del frozen bundle (§14.3).
  const runOutcome = runP6Replay(bundle, { runTimestampUtc: "2026-09-23T00:00:00Z" });
  assert.equal(runOutcome.ok, true);

  // La campaña (oráculo manual) queda: 60 MW, 10 fills de 6 MW, COVERED.
  assert.equal(runOutcome.replay.terminalCoverage.executedVolume, 60);
  assert.equal(runOutcome.replay.terminalCoverage.remainingVolume, 0);
  assert.equal(runOutcome.replay.terminalCoverage.coverageStatus, "COVERED");
  assert.equal(runOutcome.replay.status.validity, "VALID_RUN");

  // Precio de fill: latest ask at-or-before la frontera + 0.15 EUR/MWh
  // (slippage virtual frozen, §13.6 / OFICINA.md execution assumption).
  assert.equal(runOutcome.replay.ledgers.execution[0].executionPrice, 41.2 + 0.15);
  assert.equal(runOutcome.replay.ledgers.execution[9].executionPrice, 41.05 + 0.15);

  // --- Vía manual independiente y evaluación del run (vía ledgers) ----------
  const { manualEvaluation, campaignEvaluation, comparison } = manualAndRunEvaluations(runOutcome);
  assert.equal(manualEvaluation.ok, true, `captura manual válida: ${manualEvaluation.errors.join(" | ")}`);
  assert.equal(campaignEvaluation.ok, true);
  assert.equal(campaignEvaluation.benchmarkCount, 3);

  // El slippage del cost ledger va embebido en executionPrice: se registra
  // como embedded y NO se re-suma a H (exactamente una vez, §13.6/§5.5).
  assert.ok(Math.abs(campaignEvaluation.embeddedCostsByKindEur["cost.slippage.virtual"] - 0.15 * 60) <= 1e-9);
  assert.equal(campaignEvaluation.costsByKindEur["cost.slippage.virtual"], undefined);

  // --- Coincidencia manual/evaluator (§25.2 IMP-15) -------------------------
  assert.equal(comparison.code, "MANUAL_EVALUATOR_AGREEMENT");
  assert.equal(comparison.ok, true, JSON.stringify(comparison.components.filter((c) => !c.agree)));

  const H = comparison.components.find((component) => component.component === "H");
  const B = comparison.components.find((component) => component.component === "B");
  const V = comparison.components.find((component) => component.component === "V");
  assert.ok(Math.abs(H.manual - 41.265) <= 1e-9, `H manual ${H.manual} == 41.265 (oráculo)`);
  assert.ok(Math.abs(B.manual - 45.07) <= 1e-9, `B manual ${B.manual} == 45.07 (oráculo)`);
  assert.ok(Math.abs(V.manual - 3.805) <= 1e-9, `V manual ${V.manual} == 3.805 (oráculo)`);

  // --- Runs y output bundles (IMP-14) --------------------------------------
  const first = buildOutputBundle({ bundle, replayOutcome: runOutcome });
  assert.equal(first.ok, true);
  const rerunRecord = runP6Replay(bundle, { runTimestampUtc: "2026-09-23T01:00:00Z" });
  const rerun = buildOutputBundle({ bundle, replayOutcome: rerunRecord });
  assert.equal(rerun.ok, true);

  const registry = createRunReceiptRegistry();
  assert.equal(registry.register({ outputBundle: first.outputBundle }).ok, true);
  assert.equal(registry.register({ outputBundle: rerun.outputBundle }).ok, true);

  const imp13SuiteRunEvidence = loadImp13SuiteRunEvidence();
  const gate = evaluateP6ClosureGate({
    runOutcome,
    firstOutputBundle: first.outputBundle,
    rerunOutputBundle: rerun.outputBundle,
    a1OutputBundle: null,
    fixtureSuiteEvidence: imp13SuiteRunEvidence,
    benchmarkEvaluationKeys: BENCHMARK_EVALUATION_KEYS,
    manualEvaluation,
    campaignEvaluation,
    manualComparison: comparison,
    bundle,
    singleArmDeclaration: {
      singleArm: true,
      reasoning: "El run de cierre del instrumento es del brazo A0 (Calendar-only): el brazo A1/S1 no existe todavía (IMP-11 pendiente) y §25.2 IMP-15 no exige S1 OOS. La paridad de treatment A0/A1 queda NOT_EVALUATED hasta que existan dos brazos distintos; no se declara verificada.",
    },
  });
  assert.equal(gate.failedIds.length, 0, `gate fallido: ${JSON.stringify(gate.failedIds)} ${JSON.stringify(gate.items.filter((i) => !i.ok).map((i) => ({ id: i.id, code: i.code, problems: i.problems })))}`);
  assert.equal(gate.ok, true);
  // El ítem A0/A1 NO se da por verificado con un solo brazo (IMP15-H2):
  // queda NOT_EVALUATED y el gate declara el §14.10 incompleto.
  assert.equal(gate.pendingIds.includes("IMP15-GATE-04"), true);
  assert.equal(gate.gateComplete, false);
  assert.equal(gate.singleArmScope, true);
  const armParity = gate.items.find((gateItem) => gateItem.id === "IMP15-GATE-04");
  assert.equal(armParity.code, "A0_A1_NOT_EVALUATED");
  assert.equal(armParity.status, "NOT_EVALUATED");

  const closure = materializeP6ClosureReceipt({
    gate,
    manualComparison: comparison,
    outputBundle: first.outputBundle,
    rerunOutputBundle: rerun.outputBundle,
    bundle,
    closureTimestampUtc: "2026-09-23T02:00:00Z",
    fixtureSuiteEvidence: imp13SuiteRunEvidence,
    closureScopeNote: "Campaña sintética con el perfil confirmado de la campaña Gas Quarterly vigente (IMP-02): 60 MW, lotes 1 MW, cap 12 MW/day. El cierre prueba el instrumento P6, no el mercado.",
  });
  assert.equal(closure.ok, true, JSON.stringify(closure.message ?? ""));
  assert.equal(closure.receipt.receiptKind, "P6_CLOSURE_RECEIPT");
  assert.equal(typeof closure.closureId, "string");
  assert.equal(closure.receipt.gateResult.ok, true);
  // El receipt NO declara el closure gate §14.10 completo (IMP15-H2).
  assert.equal(closure.receipt.gateResult.complete, false);
  assert.deepEqual(closure.receipt.gateResult.pendingIds, ["IMP15-GATE-04"]);
  assert.equal(closure.receipt.instrumentDeclaration.gateComplete, false);
  assert.deepEqual(closure.receipt.instrumentDeclaration.pendingGateItemIds, ["IMP15-GATE-04"]);
  assert.match(closure.receipt.scopeDeclaration.means, /NO se declara implementation-ready por gate superado/);
  assert.equal(closure.receipt.singleArmScope.declared, true);
  assert.match(closure.receipt.scopeDeclaration.doesNotMean, /research PASS/);
  assert.match(closure.receipt.scopeDeclaration.doesNotMean, /paridad A0\/A1 no verificada/);
  assert.ok(Math.abs(closure.receipt.manualEvaluatorComparison.components.find((c) => c.component === "V").manual - 3.805) <= 1e-9);
  assert.equal(closure.receipt.fixtureSuiteRunEvidence.suiteDigest, imp13SuiteRunEvidence.suiteDigest);

  // El receipt entra como entrada nueva al registro; nada se sobrescribe.
  const identityBefore = registry.snapshot().length;
  assert.equal(registry.has(closure.closureId), false);
  assert.equal(identityBefore, 2);
});

test("IMP-15: defectos del gate — fixtures no aprobados, comparativa divergente/forjada, sin reproducibilidad y evidencia alterada no cierran (fail-closed)", () => {
  const imp13SuiteRunEvidence = loadImp13SuiteRunEvidence();
  const bundle = frozenCampaignBundle();

  const runOutcome = runP6Replay(bundle, {});
  const first = buildOutputBundle({ bundle, replayOutcome: runOutcome });
  assert.equal(first.ok, true);

  // Comparativa real de la campaña: base para graduar los fallos.
  const { manualEvaluation, campaignEvaluation, comparison } = manualAndRunEvaluations(runOutcome);
  assert.equal(manualEvaluation.ok, true);
  assert.equal(campaignEvaluation.ok, true);
  assert.equal(comparison.ok, true);
  const declaredScope = { singleArm: true, reasoning: "scope de brazo único declarado para el escenario de fallo" };

  // Sin artefacto de ejecución real del suite §14.8: GATE-01 no pasa.
  const noFixtureGate = evaluateP6ClosureGate({
    runOutcome,
    firstOutputBundle: first.outputBundle,
    rerunOutputBundle: first.outputBundle,
    fixtureSuiteEvidence: null,
    benchmarkEvaluationKeys: BENCHMARK_EVALUATION_KEYS,
    manualEvaluation,
    campaignEvaluation,
    manualComparison: comparison,
    bundle,
    singleArmDeclaration: declaredScope,
  });
  assert.equal(noFixtureGate.failedIds.includes("IMP15-GATE-01"), true);

  // Evidencia del suite alterada (fixture declarado sin ok y digest que ya
  // no recomputa): GATE-01 no la acepta (IMP15-H4).
  const tamperedEvidence = JSON.parse(JSON.stringify(imp13SuiteRunEvidence));
  tamperedEvidence.fixtures[0].ok = false;
  const tamperedGate = evaluateP6ClosureGate({
    runOutcome,
    firstOutputBundle: first.outputBundle,
    rerunOutputBundle: first.outputBundle,
    fixtureSuiteEvidence: tamperedEvidence,
    benchmarkEvaluationKeys: BENCHMARK_EVALUATION_KEYS,
    manualEvaluation,
    campaignEvaluation,
    manualComparison: comparison,
    bundle,
    singleArmDeclaration: declaredScope,
  });
  assert.equal(tamperedGate.failedIds.includes("IMP15-GATE-01"), true);
  assert.equal(tamperedGate.items.find((gateItem) => gateItem.id === "IMP15-GATE-01").code, "FIXTURE_NOT_APPROVED");

  // Evidencia del suite con suiteStatus FAIL (fixture no aprobado): GATE-01 falla.
  const failedSuiteEvidence = JSON.parse(JSON.stringify(imp13SuiteRunEvidence));
  failedSuiteEvidence.suiteStatus = "FAIL";
  const failedSuiteGate = evaluateP6ClosureGate({
    runOutcome,
    firstOutputBundle: first.outputBundle,
    rerunOutputBundle: first.outputBundle,
    fixtureSuiteEvidence: failedSuiteEvidence,
    benchmarkEvaluationKeys: BENCHMARK_EVALUATION_KEYS,
    manualEvaluation,
    campaignEvaluation,
    manualComparison: comparison,
    bundle,
    singleArmDeclaration: declaredScope,
  });
  assert.equal(failedSuiteGate.failedIds.includes("IMP15-GATE-01"), true);

  // Comparativa forjada (ok sin componentes reales): GATE-09 no la acepta
  // (IMP15-H3).
  const forgedComparison = { ok: true, code: "MANUAL_EVALUATOR_AGREEMENT", components: [], declared: {} };
  const forgedGate = evaluateP6ClosureGate({
    runOutcome,
    firstOutputBundle: first.outputBundle,
    rerunOutputBundle: first.outputBundle,
    fixtureSuiteEvidence: imp13SuiteRunEvidence,
    benchmarkEvaluationKeys: BENCHMARK_EVALUATION_KEYS,
    manualEvaluation,
    campaignEvaluation,
    manualComparison: forgedComparison,
    bundle,
    singleArmDeclaration: declaredScope,
  });
  assert.equal(forgedGate.failedIds.includes("IMP15-GATE-09"), true);
  const forgedItem = forgedGate.items.find((gateItem) => gateItem.id === "IMP15-GATE-09");
  assert.equal(forgedItem.code, "MANUAL_EVALUATOR_AGREEMENT_NOT_REPRODUCIBLE");
  assert.ok(forgedItem.problems.some((problem) => problem.includes("componente")));
  assert.ok(forgedItem.problems.some((problem) => problem.includes("digest")));

  // Comparativa en desacuerdo (evaluaciones reales, valores divergentes):
  // GATE-09 no pasa.
  const { campaignEvaluation: mismatchRunEvaluation } = manualAndRunEvaluations(runOutcome);
  const mismatchManualEvaluation = {
    ok: true, source: "MANUAL_CAPTURE", H: null, B: null, V: null,
    coverage: { executedVolume: 0, remainingVolume: 60, status: "COVERAGE_INCOMPLETE" },
  };
  const mismatchComparison = compareManualVsEvaluator({
    manualEvaluation: mismatchManualEvaluation,
    campaignEvaluation: mismatchRunEvaluation,
  });
  assert.equal(mismatchComparison.ok, false);
  const mismatchGate = evaluateP6ClosureGate({
    runOutcome,
    firstOutputBundle: first.outputBundle,
    rerunOutputBundle: first.outputBundle,
    fixtureSuiteEvidence: imp13SuiteRunEvidence,
    benchmarkEvaluationKeys: BENCHMARK_EVALUATION_KEYS,
    manualEvaluation: mismatchManualEvaluation,
    campaignEvaluation: mismatchRunEvaluation,
    manualComparison: mismatchComparison,
    bundle,
    singleArmDeclaration: declaredScope,
  });
  assert.equal(mismatchGate.failedIds.includes("IMP15-GATE-09"), true);

  // Reproducibilidad rota: GATE-06 no pasa (un run distinto → otros digests).
  // Las filas del ledger son inmutables (§14.4), así que la réplica alterada
  // se construye con una fila sustituida, no mutando el original.
  const alteredOutcome = runP6Replay(bundle, {});
  const alteredRows = alteredOutcome.replay.ledgers.execution.map((row, index) => index === 0
    ? { ...row, executionPrice: row.executionPrice + 1 }
    : row);
  alteredOutcome.replay.ledgers.execution = alteredRows;
  const mutated = buildOutputBundle({ bundle, replayOutcome: alteredOutcome });
  const divergentGate = evaluateP6ClosureGate({
    runOutcome,
    firstOutputBundle: first.outputBundle,
    rerunOutputBundle: mutated.outputBundle,
    fixtureSuiteEvidence: imp13SuiteRunEvidence,
    benchmarkEvaluationKeys: BENCHMARK_EVALUATION_KEYS,
    manualEvaluation,
    campaignEvaluation,
    manualComparison: comparison,
    bundle,
    singleArmDeclaration: declaredScope,
  });
  assert.equal(divergentGate.failedIds.includes("IMP15-GATE-06"), true);

  // Receipt bloqueado con el gate en fallo: no se materializa closure.
  const declined = materializeP6ClosureReceipt({
    gate: { ...divergentGate, ok: false, failedIds: ["IMP15-GATE-02"] },
    manualComparison: comparison,
    outputBundle: first.outputBundle,
    bundle,
  });
  assert.equal(declined.ok, false);
  assert.ok(declined.failedIds.includes("IMP15-GATE-02"));

  const reproComparison = compareReproducibility({ outputBundle: first.outputBundle }, { outputBundle: first.outputBundle });
  assert.equal(reproComparison.ok, true);
  assert.ok(reproComparison.receiptIds[0] === reproComparison.receiptIds[1]);
});

test("IMP-15: coste KNOWN no embebido en executionPrice mueve H y el evaluator lo cuenta exactamente una vez (IMP15-H1)", () => {
  const costLedger = createCostLedgerWithKnownNonEmbeddedFee();
  const bundle = frozenCampaignBundle({ costLedger });
  const runOutcome = runP6Replay(bundle, { runTimestampUtc: "2026-09-23T00:00:00Z" });
  assert.equal(runOutcome.ok, true);
  assert.equal(runOutcome.replay.status.validity, "VALID_RUN");

  const campaignEvaluation = evaluateCampaignFromRun({
    replayOutcome: runOutcome,
    benchmarkRows: BENCHMARK_ROWS,
    product: "Gas",
    windowStart: CAMPAIGN_DATES[0],
    windowEnd: "2026-06-13",
  });
  assert.equal(campaignEvaluation.ok, true);
  // El coste no embebido entra al H del run y NO se re-cuenta el slippage
  // embebido: H = oráculo 41.265 + 0.25 exacto (IMP15-H1; hoy, sin el fix,
  // el H del run ignoraba todo coste del ledger).
  assert.ok(Math.abs(campaignEvaluation.H - (41.265 + 0.25)) <= 1e-9, `H del run ${campaignEvaluation.H} debe moverse 0.25 sobre el oráculo`);
  assert.ok(Math.abs(campaignEvaluation.costsByKindEur["cost.exchange.fee.fixture"] - 0.25 * 60) <= 1e-9);
  assert.ok(Math.abs(campaignEvaluation.embeddedCostsByKindEur["cost.slippage.virtual"] - 0.15 * 60) <= 1e-9);
  assert.equal(campaignEvaluation.costsByKindEur["cost.slippage.virtual"], undefined);

  // La comparativa manual/evaluator cierra CON el mismo coste en la captura.
  const agreeCase = manualAndRunEvaluations(runOutcome, {
    extraUnitCosts: [{ costId: "cost.exchange.fee.fixture", amount: 0.25, unit: "EUR/MWh" }],
  });
  assert.equal(agreeCase.manualEvaluation.ok, true);
  assert.equal(agreeCase.campaignEvaluation.ok, true);
  assert.ok(Math.abs(agreeCase.manualEvaluation.H - (41.265 + 0.25)) <= 1e-9, `H manual ${agreeCase.manualEvaluation.H} == 41.515`);
  assert.equal(agreeCase.comparison.ok, true, JSON.stringify(agreeCase.comparison.components.filter((c) => !c.agree)));

  // Y si la captura OMITE ese coste, la comparativa FALLA: la paridad B/H/V
  // no se fabrica por coincidencia (reproducción del defecto IMP15-H1).
  const omitCase = manualAndRunEvaluations(runOutcome, { extraUnitCosts: [] });
  assert.equal(omitCase.comparison.ok, false);
  assert.equal(omitCase.comparison.code, "MANUAL_EVALUATOR_MISMATCH");
});

test("IMP-15: cierre de brazo único sin declaración no pasa el gate y no materializa receipt (IMP15-H2)", () => {
  const imp13SuiteRunEvidence = loadImp13SuiteRunEvidence();
  const bundle = frozenCampaignBundle();
  const runOutcome = runP6Replay(bundle, {});
  const first = buildOutputBundle({ bundle, replayOutcome: runOutcome });
  const rerun = buildOutputBundle({ bundle, replayOutcome: runP6Replay(bundle, {}) });
  const { manualEvaluation, campaignEvaluation, comparison } = manualAndRunEvaluations(runOutcome);

  // Un solo brazo SIN declaración de scope: fallo duro, no paridad fabricada.
  const undeclaredGate = evaluateP6ClosureGate({
    runOutcome,
    firstOutputBundle: first.outputBundle,
    rerunOutputBundle: first.outputBundle,
    a1OutputBundle: null,
    fixtureSuiteEvidence: imp13SuiteRunEvidence,
    benchmarkEvaluationKeys: BENCHMARK_EVALUATION_KEYS,
    manualEvaluation,
    campaignEvaluation,
    manualComparison: comparison,
    bundle,
    singleArmDeclaration: null,
  });
  assert.equal(undeclaredGate.failedIds.includes("IMP15-GATE-04"), true);
  assert.equal(undeclaredGate.ok, false);
  const undeclaredItem = undeclaredGate.items.find((gateItem) => gateItem.id === "IMP15-GATE-04");
  assert.equal(undeclaredItem.code, "SINGLE_ARM_PARITY_UNDECLARED");

  // Con el gate en fallo duro, el receipt no se materializa: nada acepta
  // un A0 comparado contra A0 como si fuera paridad A0/A1.
  const declined = materializeP6ClosureReceipt({
    gate: undeclaredGate,
    manualComparison: comparison,
    outputBundle: first.outputBundle,
    rerunOutputBundle: rerun.outputBundle,
    bundle,
    fixtureSuiteEvidence: imp13SuiteRunEvidence,
  });
  assert.equal(declined.ok, false);
  assert.ok(declined.failedIds.includes("IMP15-GATE-04"));
});
