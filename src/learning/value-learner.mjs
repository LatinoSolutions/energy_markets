// Arquitectura de Value/Policy Learning (IMP-19, DEP-20). Fuente: SPEC v1.1.1
// §11.1 (Value Layer explícito; V_pi(s) y Q_pi(s,a); action space {BUY,WAIT};
// sizing separado), §11.2 (Bellman Q_pi(s,a)=E[r+gamma E_{a'~pi}[Q_pi(s',a')]];
// Q*=E[r+gamma max Q*]; Q-learning es el FIRST RL CANDIDATE, no un algoritmo de
// producción obligatorio; la selección empírica comprueba memoria/soporte/
// campañas/valor incremental; no se fija gamma y gamma=1 puede ser adecuado
// para horizonte finito sujeto a estabilidad; reglas simples/bandit pueden
// prevalecer), §11.4 (pi(a|s) proportional to exp(Q/tau); no se congela tau) y
// §25.1 fila IMP-19 (MUST NOT: "Bellman/value explícitos, algoritmo no
// obligatorio; gamma/tau no arbitrarios"; acceptance: "Q-learning compite por
// mérito").
//
// El módulo materializa las identidades explícitas y un motor determinista de
// value iteration / Q-learning sobre un MDP DECLARADO (BUY/WAIT). No inventa
// recompensas ni transiciones ni elige gamma/tau sin justificación. La
// comparación learner/baseline ordena por valor esperado bajo el mismo reward
// global; si un baseline gana, el learner queda refutado — nunca se declara una
// selección positiva por construir el soporte.

export const BELLMAN = Object.freeze({
  qPi: "Q_pi(s,a) = E[ r + gamma * E_{a'~pi}[ Q_pi(s',a') ] ]",
  qStar: "Q*(s,a) = E[ r + gamma * max_{a'} Q*(s',a') ]",
  source: "SPEC v1.1.1 §11.2",
});
export const VALUE_FUNCTIONS = Object.freeze({
  vPi: "V_pi(s): valor económico futuro esperado desde s siguiendo pi",
  qPi: "Q_pi(s,a): valor económico futuro esperado de realizar a en s y después seguir pi",
  distinction: "distintas del resultado realizado V=B-H de §5; no equivalen a confidence de una Strategy ni al reward ya observado",
  source: "SPEC v1.1.1 §11.1",
});
export const FIRST_RL_CANDIDATE = "Q_LEARNING";
export const STOCHASTIC_POLICY = Object.freeze({
  formula: "pi(a|s) proportional to exp(Q(s,a)/tau)",
  note: "tau mayor = más exploración; tau->0 aproxima determinista; no se congela tau (§11.4).",
  source: "SPEC v1.1.1 §11.4",
});

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function fail(errors) {
  return { ok: errors.length === 0, errors };
}

// §11.2/§11.4: gamma y tau NO se eligen arbitrariamente. gamma admite 1 para
// horizonte finito sin descuento, pero siempre con justificación declarada y
// horizonte; tau (si existe) también exige justificación. Sin declaración el
// parámetro queda no-utilizable (fail-closed).
export function assertDiscountingDeclared({ gamma = null, horizon = null, gammaJustification = null, tau = null, tauJustification = null } = {}) {
  const errors = [];
  if (gamma !== null && gamma !== undefined) {
    if (!isFiniteNumber(gamma) || gamma < 0 || gamma > 1) {
      errors.push({ field: "gamma", code: "INVALID_GAMMA", message: "gamma debe ser finito en [0,1] (§11.2)." });
    }
    if (!isNonEmptyString(gammaJustification)) {
      errors.push({ field: "gammaJustification", code: "ARBITRARY_GAMMA", message: "gamma no es arbitrario: exige justificación declarada (p. ej. horizonte finito, gamma=1) (§11.2)." });
    }
    if (gamma === 1 && !isNonEmptyString(horizon)) {
      errors.push({ field: "horizon", code: "MISSING_HORIZON", message: "gamma=1 sólo procede con horizonte finito declarado (§11.2)." });
    }
  }
  if (tau !== null && tau !== undefined) {
    if (!isFiniteNumber(tau) || tau <= 0) {
      errors.push({ field: "tau", code: "INVALID_TAU", message: "tau debe ser finito y positivo (§11.4)." });
    }
    if (!isNonEmptyString(tauJustification)) {
      errors.push({ field: "tauJustification", code: "ARBITRARY_TAU", message: "tau no se congela libremente: exige justificación declarada (§11.4)." });
    }
  }
  return fail(errors);
}

function indexTransitions(transitions) {
  const byStateAction = new Map();
  for (const transition of transitions) {
    if (!transition || !isNonEmptyString(transition.state) || !isNonEmptyString(transition.action)
      || !isNonEmptyString(transition.nextState) || !isFiniteNumber(transition.probability)
      || !isFiniteNumber(transition.reward)) {
      return { ok: false, code: "INVALID_TRANSITION", message: "Cada transición declara state/action/nextState/probability/reward finitos (§11.2)." };
    }
    const key = `${transition.state}\u0000${transition.action}`;
    if (!byStateAction.has(key)) {
      byStateAction.set(key, []);
    }
    byStateAction.get(key).push(transition);
  }
  return { ok: true, byStateAction };
}

function actionsOf({ states, actions, byStateAction }) {
  const valid = new Set(actions);
  for (const state of states) {
    for (const action of actions) {
      const list = byStateAction.get(`${state}\u0000${action}`) ?? [];
      const mass = list.reduce((sum, entry) => sum + entry.probability, 0);
      if (list.length === 0) {
        continue; // estado terminal o acción sin salida: V/Q quedan en 0
      }
      if (!valid.has(action) || Math.abs(mass - 1) > 1e-9) {
        return { ok: false, code: "TRANSITION_MASS_INVALID", message: `Las probabilidades de (${state},${action}) deben sumar 1; masa observada ${mass} (§11.2).` };
      }
    }
  }
  return { ok: true };
}

// Bellman óptimo por value iteration sobre un MDP declarado. Devuelve V, Q y la
// policy greedy; converge o reporta el número de iteraciones. No selecciona el
// algoritmo para producción: es un candidato/medio de evaluación (§11.2).
export function valueIteration({ states = [], actions = ["BUY", "WAIT"], transitions = [], gamma = 1, horizon = null, gammaJustification = null, tolerance = 1e-9, maxIterations = 10000 } = {}) {
  const discount = assertDiscountingDeclared({ gamma, horizon, gammaJustification });
  if (!discount.ok) {
    return { ok: false, code: "DISCOUNTING_DECLARATION_INVALID", errors: discount.errors };
  }
  const indexed = indexTransitions(transitions);
  if (!indexed.ok || !Array.isArray(states) || !Array.isArray(actions) || actions.length === 0) {
    return { ok: false, code: indexed.code ?? "INVALID_MDP", message: indexed.message ?? "El MDP exige states y actions declarados (§11.1)." };
  }
  const massCheck = actionsOf({ states, actions, byStateAction: indexed.byStateAction });
  if (!massCheck.ok) {
    return { ok: false, code: massCheck.code, message: massCheck.message };
  }

  let value = Object.fromEntries(states.map((state) => [state, 0]));
  let converged = false;
  let iterations = 0;
  for (; iterations < maxIterations; iterations += 1) {
    const next = {};
    let delta = 0;
    for (const state of states) {
      let best = -Infinity;
      for (const action of actions) {
        const list = indexed.byStateAction.get(`${state}\u0000${action}`) ?? [];
        const q = list.length === 0
          ? 0
          : list.reduce((sum, entry) => sum + entry.probability * (entry.reward + gamma * (value[entry.nextState] ?? 0)), 0);
        if (q > best) {
          best = q;
        }
      }
      next[state] = best === -Infinity ? 0 : best;
      delta = Math.max(delta, Math.abs(next[state] - value[state]));
    }
    value = next;
    if (delta <= tolerance) {
      converged = true;
      iterations += 1;
      break;
    }
  }
  const qValues = {};
  const policy = {};
  for (const state of states) {
    qValues[state] = {};
    let bestAction = null;
    let bestQ = -Infinity;
    for (const action of actions) {
      const list = indexed.byStateAction.get(`${state}\u0000${action}`) ?? [];
      const q = list.length === 0
        ? 0
        : list.reduce((sum, entry) => sum + entry.probability * (entry.reward + gamma * (value[entry.nextState] ?? 0)), 0);
      qValues[state][action] = q;
      if (q > bestQ) {
        bestQ = q;
        bestAction = action;
      }
    }
    policy[state] = bestAction;
  }
  return {
    ok: true,
    algorithm: "VALUE_ITERATION",
    algorithmIsMandatory: false,
    bellman: BELLMAN,
    value,
    qValues,
    policy,
    gamma,
    converged,
    iterations,
    note: "Un algoritmo no es obligatorio; la selección es empírica y Q-learning compite por mérito (§25.1 IMP-19).",
  };
}

// PRNG determinista (mulberry32) — la reproducibilidad exige seed declarada
// (§14.9/§11.4). No introduce aleatoriedad fuera del protocolo.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Q-learning tabular determinista sobre transiciones declaradas. Es el FIRST
// RL CANDIDATE (§11.2); su resultado NO se presume ganador: compara por mérito.
export function qLearning({ states = [], actions = ["BUY", "WAIT"], transitions = [], gamma = 1, horizon = null, gammaJustification = null, alpha = 0.5, episodes = 2000, epsilon = 0.1, seed = 1 } = {}) {
  const discount = assertDiscountingDeclared({ gamma, horizon, gammaJustification });
  if (!discount.ok) {
    return { ok: false, code: "DISCOUNTING_DECLARATION_INVALID", errors: discount.errors };
  }
  if (!isFiniteNumber(alpha) || alpha <= 0 || alpha > 1) {
    return { ok: false, code: "INVALID_ALPHA", message: "alpha en (0,1] (§11.2)." };
  }
  if (!isFiniteNumber(epsilon) || epsilon < 0 || epsilon > 1) {
    return { ok: false, code: "INVALID_EPSILON", message: "epsilon en [0,1] (§11.4 exploration)." };
  }
  const indexed = indexTransitions(transitions);
  if (!indexed.ok) {
    return { ok: false, code: indexed.code, message: indexed.message };
  }
  const random = mulberry32(seed);
  const q = {};
  for (const state of states) {
    q[state] = {};
    for (const action of actions) {
      q[state][action] = 0;
    }
  }
  for (let episode = 0; episode < episodes; episode += 1) {
    // Estado inicial determinista por episodio (round-robin) para no depender
    // de un sampling no declarado.
    const start = states[episode % states.length];
    let state = start;
    let guard = 0;
    while (guard < states.length * actions.length) {
      guard += 1;
      const availableActions = actions.filter((action) => (indexed.byStateAction.get(`${state}\u0000${action}`) ?? []).length > 0);
      if (availableActions.length === 0) {
        break;
      }
      let action;
      if (random() < epsilon) {
        action = availableActions[Math.floor(random() * availableActions.length)];
      } else {
        action = availableActions.reduce((best, candidate) => (q[state][candidate] > q[state][best] ? candidate : best), availableActions[0]);
      }
      const actionTransitions = indexed.byStateAction.get(`${state}\u0000${action}`) ?? [];
      // Transición determinista por muestreo declarado con el PRNG.
      let roll = random();
      let chosen = actionTransitions[actionTransitions.length - 1];
      for (const candidate of actionTransitions) {
        roll -= candidate.probability;
        if (roll <= 0) {
          chosen = candidate;
          break;
        }
      }
      const bestNext = actions.reduce((best, candidate) => {
        const target = q[chosen.nextState]?.[candidate];
        return target !== undefined && target > best ? target : best;
      }, -Infinity);
      const bootstrapped = bestNext === -Infinity ? 0 : bestNext;
      q[state][action] += alpha * ((chosen.reward + gamma * bootstrapped) - q[state][action]);
      state = chosen.nextState;
    }
  }
  const policy = {};
  const value = {};
  for (const state of states) {
    let bestAction = actions[0];
    for (const action of actions) {
      if (q[state][action] > q[state][bestAction]) {
        bestAction = action;
      }
    }
    policy[state] = bestAction;
    value[state] = q[state][bestAction];
  }
  return {
    ok: true,
    algorithm: "Q_LEARNING",
    algorithmIsMandatory: false,
    firstRlCandidate: FIRST_RL_CANDIDATE,
    bellman: BELLMAN,
    qValues: q,
    policy,
    value,
    gamma,
    alpha,
    epsilon,
    episodes,
    seed,
  };
}

// Policy fija (baseline): asigna la misma acción a todos los estados. Sirve de
// comparator simple (§11.2: "alternativas simples").
export function fixedPolicy({ states = [], action = "BUY" } = {}) {
  if (!isNonEmptyString(action) || !Array.isArray(states)) {
    return { ok: false, code: "INVALID_FIXED_POLICY", message: "Una policy fija exige states y una acción declarada." };
  }
  return { ok: true, name: `ALWAYS_${action}`, policy: Object.fromEntries(states.map((state) => [state, action])) };
}

// Evaluación V_pi por iteración de la política sobre las mismas transiciones
// declaradas (§11.1). No aprende ni optimiza: mide una policy dada.
export function evaluatePolicy({ policy = null, states = [], transitions = [], gamma = 1, horizon = null, gammaJustification = null, tolerance = 1e-9, maxIterations = 10000 } = {}) {
  const discount = assertDiscountingDeclared({ gamma, horizon, gammaJustification });
  if (!discount.ok) {
    return { ok: false, code: "DISCOUNTING_DECLARATION_INVALID", errors: discount.errors };
  }
  if (!policy || typeof policy !== "object") {
    return { ok: false, code: "MISSING_POLICY", message: "Se evalúa una policy declarada (§11.1)." };
  }
  const indexed = indexTransitions(transitions);
  if (!indexed.ok) {
    return { ok: false, code: indexed.code, message: indexed.message };
  }
  let value = Object.fromEntries(states.map((state) => [state, 0]));
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const next = {};
    let delta = 0;
    for (const state of states) {
      const action = policy[state];
      const list = indexed.byStateAction.get(`${state}\u0000${action}`) ?? [];
      next[state] = list.length === 0
        ? 0
        : list.reduce((sum, entry) => sum + entry.probability * (entry.reward + gamma * (value[entry.nextState] ?? 0)), 0);
      delta = Math.max(delta, Math.abs(next[state] - value[state]));
    }
    value = next;
    if (delta <= tolerance) {
      return { ok: true, value, gamma, iterations: iteration + 1 };
    }
  }
  return { ok: true, value, gamma, iterations: maxIterations, converged: false };
}

// Comparación learner/baseline por mérito (§25.1 IMP-19). Todos los candidatos
// se miden con el MISMO reward global, el mismo MDP y el mismo gamma
// justificado. El learner compite: si no supera al mejor baseline, se registra
// la refutación; no se declara selección positiva por construir el soporte
// (§25.2.3 IMP-19).
export function comparePoliciesByMerit({ candidate = null, baselines = [], states = [], transitions = [], gamma = 1, horizon = null, gammaJustification = null, initialStates = null } = {}) {
  if (!candidate || !isNonEmptyString(candidate.name) || !candidate.policy) {
    return { ok: false, code: "MISSING_CANDIDATE", message: "La comparación exige un candidato con nombre y policy (§25.1)." };
  }
  const startStates = Array.isArray(initialStates) && initialStates.length > 0 ? initialStates : states;
  const evaluated = [];
  for (const entry of [candidate, ...baselines]) {
    const outcome = evaluatePolicy({ policy: entry.policy, states, transitions, gamma, horizon, gammaJustification });
    if (!outcome.ok) {
      return { ok: false, code: "POLICY_EVALUATION_FAILED", policy: entry.name, errors: outcome.errors ?? null, message: outcome.message ?? null };
    }
    const expectedValue = startStates.reduce((sum, state) => sum + (outcome.value[state] ?? 0), 0) / startStates.length;
    evaluated.push({ name: entry.name, isCandidate: entry === candidate, expectedValue, value: outcome.value });
  }
  const ranked = [...evaluated].sort((left, right) => right.expectedValue - left.expectedValue);
  const best = ranked[0];
  const candidateRow = evaluated.find((entry) => entry.isCandidate);
  const tied = ranked.length > 1 && Math.abs(ranked[0].expectedValue - ranked[1].expectedValue) <= 1e-9;
  const selectedByMerit = best.isCandidate === true && !tied;
  const refuted = !selectedByMerit;
  return {
    ok: true,
    ranking: ranked,
    selectedByMerit,
    refuted,
    selectedPolicy: selectedByMerit ? candidate.name : best.name,
    rewardScope: "mismo reward global, mismo MDP y mismo gamma justificado para todos (§25.1 IMP-19)",
    note: refuted
      ? "El learner no supera por mérito al baseline: se registra la refutación; no se declara selección positiva (§25.2.3)."
      : "El learner queda por delante por mérito en la mecánica evaluada; esto NO cierra DEP-20 ni demuestra edge (evidence real y gates aparte).",
  };
}