import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveSymbol, scopesForLabel } from "../../src/contracts/namespaces.mjs";
import { namespacesForLabel } from "../../src/contracts/states.mjs";

test("q_t sin scope se rechaza por ambigüedad", () => {
  const outcome = resolveSymbol({ symbol: "q_t" });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "AMBIGUOUS_SYMBOL");
  assert.deepEqual(outcome.allowedScopes, ["sentiment", "quantity"]);
});

test("q_t admite Sentiment y cantidad como namespaces distintos", () => {
  const sentiment = resolveSymbol({ symbol: "q_t", scope: "sentiment" });
  const quantity = resolveSymbol({ symbol: "q_t", scope: "quantity" });
  assert.equal(sentiment.ok, true);
  assert.equal(quantity.ok, true);
  assert.equal(sentiment.canonicalId, "sentiment:q_t");
  assert.equal(quantity.canonicalId, "quantity:q_t");
  assert.notEqual(sentiment.canonicalId, quantity.canonicalId);
});

test("q_t no adquiere significado de quarter; el índice q de V_q es otro símbolo", () => {
  const quarterOnQ = resolveSymbol({ symbol: "q_t", scope: "quarter" });
  assert.equal(quarterOnQ.ok, false);
  assert.equal(quarterOnQ.code, "UNKNOWN_SCOPE");

  const quarterIndex = resolveSymbol({ symbol: "q", scope: "quarter" });
  assert.equal(quarterIndex.ok, true);
  assert.equal(quarterIndex.canonicalId, "quarter:q");
  assert.notEqual(quarterIndex.canonicalId, resolveSymbol({ symbol: "q_t", scope: "sentiment" }).canonicalId);
});

test("q_t con scope no declarado se rechaza", () => {
  const outcome = resolveSymbol({ symbol: "q_t", scope: "quantity_control" });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "UNKNOWN_SCOPE");
});

test("A0/A1 separan ablation de autonomía", () => {
  const ablation = resolveSymbol({ symbol: "A1", scope: "ablation" });
  const autonomy = resolveSymbol({ symbol: "A1", scope: "autonomy" });
  assert.equal(ablation.ok, true);
  assert.equal(autonomy.ok, true);
  assert.equal(ablation.canonicalId, "ablation:A1");
  assert.equal(autonomy.canonicalId, "autonomy:A1");
});

test("A0/A1 sin scope se rechazan", () => {
  for (const symbol of ["A0", "A1"]) {
    const outcome = resolveSymbol({ symbol });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, "AMBIGUOUS_SYMBOL");
  }
});

test("S1 separa Strategy de workstream histórico y código bibliográfico", () => {
  const strategy = resolveSymbol({ symbol: "S1", scope: "strategy" });
  const history = resolveSymbol({ symbol: "S1", scope: "history_workstream" });
  const bibliography = resolveSymbol({ symbol: "S1", scope: "master_plan_code" });
  assert.equal(strategy.ok, true);
  assert.equal(history.ok, true);
  assert.equal(bibliography.ok, true);
  assert.notEqual(strategy.canonicalId, history.canonicalId);
  assert.notEqual(strategy.canonicalId, bibliography.canonicalId);
});

test("S2 declara strategy y código bibliográfico; el workstream histórico se rechaza", () => {
  const strategy = resolveSymbol({ symbol: "S2", scope: "strategy" });
  const bibliography = resolveSymbol({ symbol: "S2", scope: "master_plan_code" });
  assert.equal(strategy.ok, true);
  assert.equal(bibliography.ok, true);
  assert.notEqual(strategy.canonicalId, bibliography.canonicalId);
  const history = resolveSymbol({ symbol: "S2", scope: "history_workstream" });
  assert.equal(history.ok, false);
  assert.equal(history.code, "UNKNOWN_SCOPE");
});

test("S5 no es código bibliográfico del Master Plan (S1–S4) y sí workstream histórico", () => {
  const bibliography = resolveSymbol({ symbol: "S5", scope: "master_plan_code" });
  assert.equal(bibliography.ok, false);
  assert.equal(bibliography.code, "UNKNOWN_SCOPE");
  assert.equal(resolveSymbol({ symbol: "S5", scope: "history_workstream" }).ok, true);
});

test("un símbolo no colisionante se resuelve sin scope", () => {
  const outcome = resolveSymbol({ symbol: "Sizing" });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.canonicalId, "Sizing");
  assert.equal(outcome.ambiguous, false);
});

test("scopesForLabel expone los ámbitos de una etiqueta compartida", () => {
  const scopes = scopesForLabel("A1").map((entry) => entry.scope).sort();
  assert.deepEqual(scopes, ["ablation", "autonomy"]);
  assert.deepEqual(scopesForLabel("DATA_BLOCKED").map((entry) => entry.scope).sort(), ["data_readiness", "run_validity"]);
});

test("HOLD conserva research, admisión por rol y governance; no es run status", () => {
  const scopes = scopesForLabel("HOLD").map((entry) => entry.scope).sort();
  assert.deepEqual(scopes, ["governance_event", "research_verdict", "role_admission"]);
  assert.equal(resolveSymbol({ symbol: "HOLD", scope: "run_validity" }).ok, false);
  assert.equal(resolveSymbol({ symbol: "HOLD", scope: "governance_event" }).ok, true);
});

test("scopesForLabel y namespacesForLabel concuerdan en etiquetas compartidas de estado", () => {
  for (const label of ["DATA_BLOCKED", "HOLD"]) {
    const scopes = scopesForLabel(label).map((entry) => entry.scope).sort();
    const namespaces = namespacesForLabel(label).map((entry) => entry.namespace).sort();
    assert.deepEqual(scopes, namespaces, `desacuerdo para "${label}"`);
  }
});

test("una referencia sin symbol se rechaza", () => {
  const outcome = resolveSymbol({ scope: "sentiment" });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "MISSING_SYMBOL");
});

test("las claves heredadas de Object no son scopes declarados", () => {
  for (const symbol of ["q_t", "A0", "A1", "S1"]) {
    for (const scope of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      const outcome = resolveSymbol({ symbol, scope });
      assert.equal(outcome.ok, false, `${symbol}/${scope}`);
      assert.equal(outcome.code, "UNKNOWN_SCOPE", `${symbol}/${scope}`);
    }
  }
});

test("un símbolo con nombre de propiedad heredada no se trata como colisión", () => {
  const outcome = resolveSymbol({ symbol: "toString" });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.ambiguous, false);
});

test("una reference o un scope malformado se rechaza sin lanzar", () => {
  for (const reference of [null, undefined, "q_t", 42, {}]) {
    const outcome = resolveSymbol(reference);
    assert.equal(outcome.ok, false);
  }
  for (const scope of [42, {}, Symbol("sentiment")]) {
    const outcome = resolveSymbol({ symbol: "q_t", scope });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, "INVALID_SCOPE");
  }
});