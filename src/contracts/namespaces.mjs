// Namespace/symbol contract. Fuente: SPEC v1.1 §3.3 (símbolos con más de un ámbito)
// y §3.1/§3.2 (vocabulario canónico). La serialización y el separador son
// IMPLEMENTATION DETAIL; lo normativo es que un símbolo ambiguo no se comparta
// sin namespace explícito.

export const NAMESPACE_SEPARATOR = ":";

// Cada símbolo colisionante declara sus ámbitos permitidos. Un uso sin `scope`,
// o con un scope no declarado, se rechaza: no se elige una variante en silencio (§0.2).
export const MULTI_SCOPE_SYMBOLS = {
  // §3.3: q_t es Sentiment (Z_t) o cantidad de compra (P1/P5). El índice `q`
  // de V_q identifica un quarter y es un símbolo distinto: q_t no adquiere
  // significado de quarter.
  q_t: {
    scopes: {
      sentiment: { meaning: "Sentiment dentro de Z_t (q_t)", section: "§3.1/§3.3" },
      quantity: { meaning: "Cantidad de compra P1/P5 q_t(control)", section: "§13.2" },
    },
  },
  A0: {
    scopes: {
      ablation: { meaning: "Brazo de ablation P5", section: "§13.5/§13.9" },
      autonomy: { meaning: "Nivel de autonomía A0", section: "§16.2" },
    },
  },
  A1: {
    scopes: {
      ablation: { meaning: "Brazo de ablation P5", section: "§13.5/§13.9" },
      autonomy: { meaning: "Nivel de autonomía A1", section: "§16.2" },
    },
  },
  S1: {
    scopes: {
      strategy: { meaning: "Strategy S1 del catálogo §8", section: "§3.3/§8.1" },
      history_workstream: { meaning: "Workstream histórico Alexandria S1", section: "§3.3/D14" },
      master_plan_code: { meaning: "Código bibliográfico del Master Plan", section: "§3.3" },
    },
  },
  // §3.3: los workstreams históricos de Alexandria son S1/S3/S4/S5 (S2 excluido);
  // los códigos bibliográficos del Master Plan son S1–S4 (S5 excluido).
  S2: {
    scopes: {
      strategy: { meaning: "Strategy S2 del catálogo §8", section: "§3.3/§8.2" },
      master_plan_code: { meaning: "Código bibliográfico del Master Plan", section: "§3.3" },
    },
  },
  S3: {
    scopes: {
      strategy: { meaning: "Strategy S3 del catálogo §8", section: "§3.3/§8.3" },
      history_workstream: { meaning: "Workstream histórico Alexandria S3", section: "§3.3/D14" },
      master_plan_code: { meaning: "Código bibliográfico del Master Plan", section: "§3.3" },
    },
  },
  S4: {
    scopes: {
      strategy: { meaning: "Strategy S4 del catálogo §8", section: "§3.3/§8.4" },
      history_workstream: { meaning: "Workstream histórico Alexandria S4", section: "§3.3/D14" },
      master_plan_code: { meaning: "Código bibliográfico del Master Plan", section: "§3.3" },
    },
  },
  S5: {
    scopes: {
      strategy: { meaning: "Strategy S5 del catálogo §8", section: "§3.3/§8.5" },
      history_workstream: { meaning: "Workstream histórico Alexandria S5", section: "§3.3/D14" },
    },
  },
  V: {
    scopes: {
      campaign_value: { meaning: "Resultado de campaña V = B − H", section: "§3.2/§14.6" },
      value_function: { meaning: "Valor futuro esperado V_pi(s)", section: "§3.2" },
      quarter_value: { meaning: "V_q de un quarter", section: "§3.3/§5.6" },
    },
  },
  Energy: {
    scopes: {
      market_intensity: { meaning: "Intensidad de movimiento e_t", section: "§3.1" },
      electricity: { meaning: "Energy/Power como electricidad del mandato", section: "§3.3" },
    },
  },
  Policy: {
    scopes: {
      candidate_policy: { meaning: "Candidate Policy de procurement", section: "§3.1" },
      public_policy: { meaning: "Política pública en drivers E9/G9", section: "§3.3" },
    },
  },
  H: {
    scopes: {
      all_in_cost: { meaning: "Coste all-in H de cubrir la obligación", section: "§3.2" },
      hypothesis: { meaning: "Hypothesis experimental", section: "§3.3" },
    },
  },
  Q: {
    scopes: {
      quarter: { meaning: "Quarter de la misión", section: "§3.3" },
      q_value: { meaning: "Q-value de la Value Layer", section: "§3.3" },
    },
  },
  B: {
    scopes: {
      benchmark: { meaning: "Benchmark B de evaluación", section: "§3.2" },
      baseline: { meaning: "Baseline experimental interno", section: "§3.3" },
    },
  },
  C: {
    scopes: {
      contribution_multiple: { meaning: "Múltiplo esperado C = pG/(ℓA)", section: "§3.2" },
      conviction: { meaning: "Conviction c_t", section: "§3.3" },
    },
  },
  R: {
    scopes: {
      win_loss: { meaning: "Ratio win/loss R", section: "§3.3" },
      campaign_reward: { meaning: "R_campaign de reward", section: "§3.3" },
    },
  },
  DATA_BLOCKED: {
    scopes: {
      data_readiness: { meaning: "Readiness por candidato", section: "§3.2" },
      run_validity: { meaning: "Run status del evaluator", section: "§14.10" },
    },
  },
  HOLD: {
    scopes: {
      research_verdict: { meaning: "Veredicto de research (incluye la interpretación de §13.6)", section: "§5.8/§13.6" },
      role_admission: { meaning: "Admisión de un rol externo pendiente", section: "§11.6.4" },
      governance_event: { meaning: "Transición de governance HOLD", section: "§18.4" },
    },
  },
};

function fail(code, message, details = {}) {
  return { ok: false, code, message, ...details };
}

// Resuelve una referencia `{ symbol, scope }` a un id canónico namespaced.
// Rechaza símbolos colisionantes sin ámbito explícito y ámbitos no declarados.
// Sólo cuentan las entradas propias: las claves heredadas de Object
// (toString, constructor, __proto__…) no son scopes declarados.
export function resolveSymbol(reference) {
  const symbol = reference?.symbol;
  if (typeof symbol !== "string" || symbol.length === 0) {
    return fail("MISSING_SYMBOL", "La referencia no declara `symbol`.");
  }

  const rawScope = reference?.scope;
  if (rawScope !== undefined && rawScope !== null && (typeof rawScope !== "string" || rawScope.length === 0)) {
    return fail("INVALID_SCOPE", "`scope` debe ser un string no vacío.", { symbol });
  }
  const scope = rawScope ?? null;

  const hasDeclaredCollision = Object.prototype.hasOwnProperty.call(MULTI_SCOPE_SYMBOLS, symbol);
  const collision = hasDeclaredCollision ? MULTI_SCOPE_SYMBOLS[symbol] : null;

  if (!collision) {
    const canonicalId = scope ? `${scope}${NAMESPACE_SEPARATOR}${symbol}` : symbol;
    return { ok: true, canonicalId, symbol, scope, ambiguous: false };
  }

  if (scope === null) {
    return fail(
      "AMBIGUOUS_SYMBOL",
      `El símbolo "${symbol}" tiene más de un ámbito; se requiere \`scope\` explícito.`,
      { symbol, allowedScopes: Object.keys(collision.scopes) },
    );
  }

  const hasDeclaredScope = Object.prototype.hasOwnProperty.call(collision.scopes, scope);
  if (!hasDeclaredScope) {
    return fail(
      "UNKNOWN_SCOPE",
      `El scope "${scope}" no está declarado para el símbolo "${symbol}".`,
      { symbol, scope, allowedScopes: Object.keys(collision.scopes) },
    );
  }

  const declared = collision.scopes[scope];
  return {
    ok: true,
    canonicalId: `${scope}${NAMESPACE_SEPARATOR}${symbol}`,
    symbol,
    scope,
    ambiguous: true,
    meaning: declared.meaning,
    section: declared.section,
  };
}

// Expone en qué ámbitos vive una etiqueta compartida; útil para no aplanar
// namespaces distintos (§3.3, p. ej. DATA_BLOCKED/HOLD).
export function scopesForLabel(label) {
  if (!Object.prototype.hasOwnProperty.call(MULTI_SCOPE_SYMBOLS, label)) {
    return [];
  }
  const collision = MULTI_SCOPE_SYMBOLS[label];
  return Object.entries(collision.scopes).map(([scope, meta]) => ({ scope, ...meta }));
}