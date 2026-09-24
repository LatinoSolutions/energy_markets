// Tests de Value/Policy Learning (IMP-19, DEP-20). Fuente: SPEC v1.1.1 §11.1/
// §11.2/§11.4 y §25.1 fila IMP-19 ("Bellman/value explícitos, algoritmo no
// obligatorio; gamma/tau no arbitrarios"; "Q-learning compite por mérito").

import test from "node:test";
import assert from "node:assert/strict";

import {
  BELLMAN,
  VALUE_FUNCTIONS,
  FIRST_RL_CANDIDATE,
  assertDiscountingDeclared,
  valueIteration,
  qLearning,
  fixedPolicy,
  evaluatePolicy,
  comparePoliciesByMerit,
} from "../../src/learning/index.mjs";
import { SYNTHETIC_MDP } from "./fixtures.mjs";

const GAMMA_JUSTIFICATION = "horizonte finito sin descuento económico justificado (§11.2)";
const mdpArgs = { states: SYNTHETIC_MDP.states, actions: SYNTHETIC_MDP.actions, transitions: SYNTHETIC_MDP.transitions };

test("IMP-19 §11.1/§11.2 · Bellman y funciones de valor son explícitos", () => {
  assert.match(BELLMAN.qPi, /Q_pi/);
  assert.match(BELLMAN.qStar, /Q\*/);
  assert.match(VALUE_FUNCTIONS.distinction, /V=B-H/);
  assert.equal(FIRST_RL_CANDIDATE, "Q_LEARNING");
});

test("IMP-19 §11.2/§11.4 · gamma y tau no son arbitrarios", () => {
  const gammaAlone = assertDiscountingDeclared({ gamma: 0.99 });
  assert.equal(gammaAlone.ok, false);
  assert.ok(gammaAlone.errors.some((error) => error.code === "ARBITRARY_GAMMA"));

  const gammaOneNoHorizon = assertDiscountingDeclared({ gamma: 1, gammaJustification: "ok" });
  assert.equal(gammaOneNoHorizon.ok, false);
  assert.ok(gammaOneNoHorizon.errors.some((error) => error.code === "MISSING_HORIZON"));

  const declared = assertDiscountingDeclared({ gamma: 1, horizon: "finite", gammaJustification: GAMMA_JUSTIFICATION });
  assert.equal(declared.ok, true);

  const tauAlone = assertDiscountingDeclared({ gamma: null, tau: 0.5 });
  assert.equal(tauAlone.ok, false);
  assert.ok(tauAlone.errors.some((error) => error.code === "ARBITRARY_TAU"));
});

test("IMP-19 §11.2 · value iteration resuelve el óptimo del MDP declarado", () => {
  const outcome = valueIteration({ ...mdpArgs, gamma: 1, horizon: "finite", gammaJustification: GAMMA_JUSTIFICATION });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.algorithm, "VALUE_ITERATION");
  assert.equal(outcome.algorithmIsMandatory, false);
  assert.equal(outcome.policy.A, "BUY");
  assert.equal(outcome.policy.B, "WAIT");
  assert.equal(outcome.value.A, 10);
  assert.equal(outcome.value.B, 10);
});

test("IMP-19 §11.2 · gamma arbitrario bloquea value iteration", () => {
  const outcome = valueIteration({ ...mdpArgs, gamma: 1 });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "DISCOUNTING_DECLARATION_INVALID");
});

test("IMP-19 §11.1 · evaluatePolicy mide V_pi de una policy dada", () => {
  const alwaysBuy = fixedPolicy({ states: SYNTHETIC_MDP.states, action: "BUY" });
  const outcome = evaluatePolicy({ policy: alwaysBuy.policy, ...mdpArgs, gamma: 1, horizon: "finite", gammaJustification: GAMMA_JUSTIFICATION });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.value.A, 10);
  assert.equal(outcome.value.B, 0);
});

test("IMP-19 §25.1 · el learner compite por mérito y supera a las policies fijas", () => {
  const vi = valueIteration({ ...mdpArgs, gamma: 1, horizon: "finite", gammaJustification: GAMMA_JUSTIFICATION });
  const candidate = { name: "VALUE_ITERATION", policy: vi.policy };
  const baselines = [
    { name: "ALWAYS_BUY", policy: fixedPolicy({ states: SYNTHETIC_MDP.states, action: "BUY" }).policy },
    { name: "ALWAYS_WAIT", policy: fixedPolicy({ states: SYNTHETIC_MDP.states, action: "WAIT" }).policy },
  ];
  const comparison = comparePoliciesByMerit({ candidate, baselines, ...mdpArgs, gamma: 1, horizon: "finite", gammaJustification: GAMMA_JUSTIFICATION, initialStates: SYNTHETIC_MDP.initialStates });
  assert.equal(comparison.ok, true);
  assert.equal(comparison.selectedByMerit, true);
  assert.equal(comparison.refuted, false);
  assert.equal(comparison.ranking.length, 3);
  assert.equal(comparison.ranking[0].name, "VALUE_ITERATION");
  assert.match(comparison.rewardScope, /mismo reward global/);
});

test("IMP-19 §25.2.3 · si el learner no supera al baseline se registra la refutación", () => {
  const optimalPolicy = valueIteration({ ...mdpArgs, gamma: 1, horizon: "finite", gammaJustification: GAMMA_JUSTIFICATION }).policy;
  const candidate = { name: "BAD_LEARNER", policy: fixedPolicy({ states: SYNTHETIC_MDP.states, action: "BUY" }).policy };
  const baselines = [{ name: "OPTIMAL", policy: optimalPolicy }];
  const comparison = comparePoliciesByMerit({ candidate, baselines, ...mdpArgs, gamma: 1, horizon: "finite", gammaJustification: GAMMA_JUSTIFICATION, initialStates: SYNTHETIC_MDP.initialStates });
  assert.equal(comparison.ok, true);
  assert.equal(comparison.selectedByMerit, false);
  assert.equal(comparison.refuted, true);
  assert.equal(comparison.selectedPolicy, "OPTIMAL");
  assert.match(comparison.note, /refutación/);
});

test("IMP-19 §14.9/§11.4 · Q-learning es determinista con la misma seed y compite", () => {
  const first = qLearning({ ...mdpArgs, gamma: 1, horizon: "finite", gammaJustification: GAMMA_JUSTIFICATION, episodes: 500, seed: 7 });
  const second = qLearning({ ...mdpArgs, gamma: 1, horizon: "finite", gammaJustification: GAMMA_JUSTIFICATION, episodes: 500, seed: 7 });
  assert.equal(first.ok, true);
  assert.deepEqual(first.qValues, second.qValues);
  assert.equal(first.firstRlCandidate, "Q_LEARNING");
  assert.equal(first.algorithmIsMandatory, false);

  const candidate = { name: "Q_LEARNING", policy: first.policy };
  const baselines = [
    { name: "ALWAYS_BUY", policy: fixedPolicy({ states: SYNTHETIC_MDP.states, action: "BUY" }).policy },
    { name: "ALWAYS_WAIT", policy: fixedPolicy({ states: SYNTHETIC_MDP.states, action: "WAIT" }).policy },
  ];
  const comparison = comparePoliciesByMerit({ candidate, baselines, ...mdpArgs, gamma: 1, horizon: "finite", gammaJustification: GAMMA_JUSTIFICATION, initialStates: SYNTHETIC_MDP.initialStates });
  assert.equal(comparison.ok, true);
  assert.equal(comparison.ranking.length, 3);
});