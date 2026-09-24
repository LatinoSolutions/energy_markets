import { test } from "node:test";
import assert from "node:assert/strict";

import {
  cDiagnostic,
  minimumEvidence,
  monthlyDiagnostics,
  quarterlyResearchVerdict,
  scoreQuarterly,
} from "../../src/economic-calculation/index.mjs";

// Fixtures FX-C09..C12, Monthly y evidencia del oráculo ST-08.1, con valores
// literales. n es n_nonzero; n_total/n_neutral se reportan aparte. El veredicto
// de research se decide fuera de la aritmética.
//
// Canal de admisibilidad de entradas (§5.8): un veredicto sólo puede ser PASS
// con cobertura "full" y benchmark no provisional declarados explícitamente.
const ADMISSIBLE = { coverage: "full", benchmarkProvisional: false };

test("FX-C09-SCORING-POS-NEG: +4/-1 -> n=2,p=.5,mu=1.5,R=C=4,sigma=1,Sortino=1.5", () => {
  const s = scoreQuarterly([4, -1]);
  assert.equal(s.nPlus, 1);
  assert.equal(s.nMinus, 1);
  assert.equal(s.n, 2);
  assert.equal(s.nNeutral, 0);
  assert.equal(s.nTotal, 2);
  assert.equal(s.p, 0.5);
  assert.equal(s.l, 0.5);
  assert.equal(s.G, 4);
  assert.equal(s.A, 1);
  assert.equal(s.mu, 1.5);
  assert.equal(s.R, 4);
  assert.equal(s.C, 4);
  assert.equal(s.sigmaDown, 1);
  assert.equal(s.sortino, 1.5);
  assert.equal(s.screenPass, true);
  assert.equal(s.defined, true);
  assert.equal(s.lossRms, 1);
  assert.equal(s.kappa, 1);
});

test("FX-C09-NEUTRAL-ADDITION: +4/-1/0 preserva n_nonzero=2 y n_total=3", () => {
  const s = scoreQuarterly([4, -1, 0]);
  assert.equal(s.n, 2);
  assert.equal(s.nNonzero, 2);
  assert.equal(s.nNeutral, 1);
  assert.equal(s.nTotal, 3);
  assert.equal(s.mu, 1.5);
  assert.equal(s.sigmaDown, 1);
  assert.equal(s.sortino, 1.5);
});

test("FX-C10-SCORING-SORTINO-1: +3/-1 -> mu=1,R=C=3,Sortino=1 no supera >1 estricto", () => {
  const s = scoreQuarterly([3, -1]);
  assert.equal(s.G, 3);
  assert.equal(s.A, 1);
  assert.equal(s.mu, 1);
  assert.equal(s.R, 3);
  assert.equal(s.C, 3);
  assert.equal(s.sigmaDown, 1);
  assert.equal(s.sortino, 1);
  assert.equal(s.screenPass, false);
  assert.equal(s.defined, true);
});

test("FX-C11-SCORING-ZERO-MEAN: +2/-2 -> mu=0,R=C=1,sigma=2,Sortino=0", () => {
  const s = scoreQuarterly([2, -2]);
  assert.equal(s.G, 2);
  assert.equal(s.A, 2);
  assert.equal(s.mu, 0);
  assert.equal(s.R, 1);
  assert.equal(s.C, 1);
  assert.equal(s.sigmaDown, 2);
  assert.equal(s.sortino, 0);
  assert.equal(s.screenPass, false);
});

test("FX-C12-ONLY-POSITIVES: [4,3] -> A/R/C indefinidos, sigma=0, Sortino indefinido", () => {
  const s = scoreQuarterly([4, 3]);
  assert.equal(s.nPlus, 2);
  assert.equal(s.nMinus, 0);
  assert.equal(s.n, 2);
  assert.equal(s.p, 1);
  assert.equal(s.l, 0);
  assert.equal(s.G, 3.5);
  assert.equal(s.A, null);
  assert.equal(s.mu, 3.5);
  assert.equal(s.R, null);
  assert.equal(s.C, null);
  assert.equal(s.sigmaDown, 0);
  assert.equal(s.sortino, null);
  assert.equal(s.screenPass, false);
  assert.equal(s.defined, false);
  assert.ok(s.undefinedReason.length > 0);
});

test("FX-C12-EXACT-ZERO-ONLY: [0,0] -> n_nonzero=0, todo indefinido", () => {
  const s = scoreQuarterly([0, 0]);
  assert.equal(s.nPlus, 0);
  assert.equal(s.nMinus, 0);
  assert.equal(s.n, 0);
  assert.equal(s.nNeutral, 2);
  assert.equal(s.nTotal, 2);
  assert.equal(s.p, null);
  assert.equal(s.G, null);
  assert.equal(s.mu, null);
  assert.equal(s.sortino, null);
  assert.equal(s.defined, false);
});

test("FX-C12-N-LT-2: [4] -> n-1=0, sigma_down y Sortino indefinidos", () => {
  const s = scoreQuarterly([4]);
  assert.equal(s.n, 1);
  assert.equal(s.G, 4);
  assert.equal(s.mu, 4);
  assert.equal(s.A, null);
  assert.equal(s.sigmaDown, null);
  assert.equal(s.sortino, null);
  assert.equal(s.defined, false);
});

test("FX-C12-EMPTY-POPULATION: [] -> todo indefinido, nada fabricado", () => {
  const s = scoreQuarterly([]);
  assert.equal(s.n, 0);
  assert.equal(s.nTotal, 0);
  assert.equal(s.mu, null);
  assert.equal(s.sortino, null);
  assert.equal(s.defined, false);
});

test("FX-C12-EMPTY-WINNER-GROUP: [-1,-2] -> A=1.5, sigma=sqrt(5), Sortino=-0.6708..., G/R/C indefinidos", () => {
  const s = scoreQuarterly([-1, -2]);
  assert.equal(s.nPlus, 0);
  assert.equal(s.nMinus, 2);
  assert.equal(s.p, 0);
  assert.equal(s.l, 1);
  assert.equal(s.G, null);
  assert.equal(s.A, 1.5);
  assert.equal(s.mu, -1.5);
  assert.equal(s.R, null);
  assert.equal(s.C, null);
  assert.equal(s.sigmaDown, Math.sqrt(5));
  assert.equal(s.sortino, -1.5 / Math.sqrt(5));
  assert.equal(s.screenPass, false);
  assert.equal(s.defined, false);
});

test("FX-MONTHLY-NO-SORTINO-IMPORT: Monthly no importa el screen Quarterly", () => {
  const outcome = monthlyDiagnostics({ Vm: [2, -1], monthsCompleted: 0 });
  assert.equal(outcome.quarterlySortinoScreenApplicable, false);
  assert.equal(outcome.monthlyEconomicCriterionMet, true);
  assert.equal(outcome.monthlyEvidenceMinimumMet, false);
  assert.equal(outcome.scoring.mu, 0.5);
  assert.equal(outcome.scoring.sortino, 0.5);
});

test("FX-MONTHLY-ONLY-POSITIVE-NO-HOLD: el HOLD Monthly es de alcance, no del Sortino indefinido", () => {
  const undefinedSortino = monthlyDiagnostics({ Vm: [4, 3], monthsCompleted: 36 });
  const definedSortino = monthlyDiagnostics({ Vm: [4, -1], monthsCompleted: 36 });
  assert.equal(undefinedSortino.quarterlySortinoScreenApplicable, false);
  assert.equal(undefinedSortino.scoring.sortino, null);
  assert.equal(undefinedSortino.scoring.defined, false);
  assert.ok(definedSortino.scoring.sortino !== null);
  assert.equal(undefinedSortino.monthlyEconomicCriterionMet, true);
  assert.equal(undefinedSortino.monthlyEvidenceMinimumMet, true);
  assert.equal(undefinedSortino.researchVerdict, "HOLD");
  assert.equal(definedSortino.researchVerdict, "HOLD");
  assert.equal(undefinedSortino.researchVerdictReason, definedSortino.researchVerdictReason);
  assert.match(undefinedSortino.researchVerdictReason, /limitación de alcance/);
});

test("FX-MONTHLY-REASON-DISCRIMINA: el HOLD Monthly discrimina por su propia razón", () => {
  const noCriterion = monthlyDiagnostics({ Vm: [-5, -4], monthsCompleted: 36 });
  const noEvidence = monthlyDiagnostics({ Vm: [5, 4], monthsCompleted: 0 });
  const scopeOnly = monthlyDiagnostics({ Vm: [5, 4], monthsCompleted: 36 });
  assert.equal(noCriterion.researchVerdict, "HOLD");
  assert.match(noCriterion.researchVerdictReason, /Criterio económico/);
  assert.match(noEvidence.researchVerdictReason, /Evidencia Monthly/);
  assert.match(scopeOnly.researchVerdictReason, /limitación de alcance/);
  assert.notEqual(noCriterion.researchVerdictReason, scopeOnly.researchVerdictReason);
  assert.notEqual(noEvidence.researchVerdictReason, scopeOnly.researchVerdictReason);
});

test("FX-EVIDENCE-TWO-CAMPAIGNS: 2 quarters / 1 año no cumplen el mínimo", () => {
  const evidence = minimumEvidence({ mission: "Quarterly", quartersCompleted: 2, calendarYearsCovered: 1 });
  assert.equal(evidence.minimumQuartersRequired, 8);
  assert.equal(evidence.minimumCalendarYearsRequired, 2);
  assert.equal(evidence.quartersCompleted, 2);
  assert.equal(evidence.calendarYearsCovered, 1);
  assert.equal(evidence.minimumEvidenceMet, false);
  const verdict = quarterlyResearchVerdict({ scoring: scoreQuarterly([4, -1]), evidence, dataQuality: ADMISSIBLE });
  assert.equal(verdict.verdict, "HOLD");
});

test("negativo: n nunca se sustituye por n_total", () => {
  const s = scoreQuarterly([4, -1, 0]);
  assert.equal(s.n, 2);
  assert.equal(s.nTotal, 3);
  assert.equal(s.mu, 1.5);
  assert.notEqual(s.mu, 1);
});

test("negativo: un ratio indefinido nunca se convierte en PASS", () => {
  const verdict = quarterlyResearchVerdict({
    scoring: scoreQuarterly([4, 3]),
    evidence: { minimumEvidenceMet: true },
  });
  assert.equal(verdict.verdict, "HOLD");
});

test("gate sintético: evidencia suficiente y screen falso -> FAIL, no PASS", () => {
  const verdict = quarterlyResearchVerdict({
    scoring: scoreQuarterly([3, -2, 0, 0, 0, 0, 0, 0]),
    evidence: minimumEvidence({ mission: "Quarterly", quartersCompleted: 8, calendarYearsCovered: 2 }),
    dataQuality: ADMISSIBLE,
  });
  assert.equal(verdict.verdict, "FAIL");
});

// IMP16-H11 (§5.8 / §13.7): mean(V_q)<=0 con prueba válida e interpretable y
// evidencia suficiente es refutación (FAIL), no falta de evidencia (HOLD).
test("IMP16-H11: mu<=0 con evidencia suficiente y calidad admisible -> FAIL (refutación), no HOLD", () => {
  const scoring = scoreQuarterly([3, -1, -2, -1, 3, -1, -2, -1]);
  assert.equal(scoring.mu, -0.25);
  assert.equal(scoring.sortino !== null, true);
  const evidence = minimumEvidence({ mission: "Quarterly", quartersCompleted: 8, calendarYearsCovered: 2 });
  assert.equal(evidence.minimumEvidenceMet, true);
  const verdict = quarterlyResearchVerdict({
    scoring,
    evidence,
    dataQuality: ADMISSIBLE,
  });
  assert.equal(verdict.verdict, "FAIL");
  assert.match(verdict.reason, /Refutación con prueba válida/);
});

// El HOLD para mean(V_q)<=0 se reserva a cuando falta algo más de fondo:
// sin canal de calidad declarado sigue siendo HOLD (§5.8 gates).
test("IMP16-H11: mu<=0 sin canal de calidad declarado sigue HOLD (falta evidencia de admisibilidad)", () => {
  const verdict = quarterlyResearchVerdict({
    scoring: scoreQuarterly([3, -1, -2, -1, 3, -1, -2, -1]),
    evidence: minimumEvidence({ mission: "Quarterly", quartersCompleted: 8, calendarYearsCovered: 2 }),
  });
  assert.equal(verdict.verdict, "HOLD");
});

test("gate sintético: evidencia suficiente y screen cumplido -> PASS (chequeo de rama, no evidencia real)", () => {
  const verdict = quarterlyResearchVerdict({
    scoring: scoreQuarterly([4, -1, 0, 0, 0, 0, 0, 0]),
    evidence: minimumEvidence({ mission: "Quarterly", quartersCompleted: 8, calendarYearsCovered: 2 }),
    dataQuality: ADMISSIBLE,
  });
  assert.equal(verdict.verdict, "PASS");
});

test("negativo (criterio 5): entradas inválidas no se ocultan tras un score alto", () => {
  const evidence = minimumEvidence({ mission: "Quarterly", quartersCompleted: 8, calendarYearsCovered: 2 });
  const dirty = quarterlyResearchVerdict({
    scoring: scoreQuarterly([4, -1, NaN, null, "12", undefined, 4, -1, 4, -1]),
    evidence,
    dataQuality: ADMISSIBLE,
  });
  const clean = quarterlyResearchVerdict({
    scoring: scoreQuarterly([4, -1, 4, -1, 4, -1, 0, 0]),
    evidence,
    dataQuality: ADMISSIBLE,
  });
  assert.equal(clean.verdict, "PASS");
  assert.equal(dirty.verdict, "INVALID");
  assert.notEqual(dirty.verdict, clean.verdict);
  assert.ok(dirty.reason.length > 0);
});

test("negativo (criterio 5): cobertura incompleta no se oculta tras un score alto", () => {
  const verdict = quarterlyResearchVerdict({
    scoring: scoreQuarterly([4, -1, 4, -1, 4, -1]),
    evidence: { minimumEvidenceMet: true },
    dataQuality: { coverage: "5/8", benchmarkProvisional: false },
  });
  assert.equal(verdict.verdict, "HOLD");
  assert.match(verdict.reason, /Cobertura/);
});

test("negativo (criterio 5): benchmark provisional no se oculta tras un score alto", () => {
  const verdict = quarterlyResearchVerdict({
    scoring: scoreQuarterly([4, -1, 4, -1, 4, -1]),
    evidence: { minimumEvidenceMet: true },
    dataQuality: { coverage: "full", benchmarkProvisional: true },
  });
  assert.equal(verdict.verdict, "HOLD");
  assert.match(verdict.reason, /Benchmark provisional/);
});

test("negativo (criterio 5): sin canal de calidad declarado no se emite PASS", () => {
  const verdict = quarterlyResearchVerdict({
    scoring: scoreQuarterly([4, -1, 4, -1, 4, -1]),
    evidence: { minimumEvidenceMet: true },
  });
  assert.equal(verdict.verdict, "HOLD");
});

test("negativo: C no es un gate de research", () => {
  const diagnostic = cDiagnostic({ C: 4 });
  assert.equal(diagnostic.hardResearchGate, false);
  assert.equal(diagnostic.researchPassFromCAlone, false);
  const undefinedC = cDiagnostic({ C: null });
  assert.equal(undefinedC.CReported, false);
});

test("negativo: entradas no finitas no se coercionan a cero en scoring", () => {
  const s = scoreQuarterly([4, null, -1, undefined, NaN]);
  assert.equal(s.invalidCount, 3);
  assert.equal(s.n, 2);
  assert.equal(s.mu, 1.5);
});
