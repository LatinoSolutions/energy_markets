import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CANONICAL_IMP_COUNT,
  buildCanonicalGraph,
  expandDepIds,
  expandImpIds,
  getImp,
  listImps,
  normalizeImpId,
  parseCanonicalGraph,
  parseRequires,
  requiredDepIds,
} from "../../src/office/canonical-graph.mjs";
import { CANONICAL_SPEC_IDENTITY } from "../../src/office/spec-binding.mjs";
import { SPEC_MARKDOWN, realGraph } from "./fixtures.mjs";

test("buildCanonicalGraph deriva exactamente los 29 IMPs de las tablas §25.1/§25.2.2", () => {
  const outcome = buildCanonicalGraph({ specMarkdown: SPEC_MARKDOWN });
  assert.equal(outcome.ok, true, JSON.stringify(outcome.errors));
  assert.equal(listImps(outcome.graph).length, CANONICAL_IMP_COUNT);
  assert.equal(getImp(outcome.graph, "IMP-01").id, "IMP-01");
  assert.equal(getImp(outcome.graph, "IMP-29").id, "IMP-29");
  assert.equal(getImp(outcome.graph, "IMP-99"), null);
});

test("la fila IMP-26 conserva objetivo, acceptance y MUST NOT CHANGE verbatim de la SPEC", () => {
  const row = getImp(realGraph(), "IMP-26");
  assert.equal(row.objective, "Vincular la SPEC y canonical IMP graph a la ejecución del office, extendiendo sólo las brechas verificadas.");
  assert.match(row.acceptanceTest, /Project OFF impide dispatch/);
  assert.match(row.acceptanceTest, /ST accepted no cierra parent/);
  assert.match(row.mustNotChange, /no autocambio de SPEC/);
  assert.match(row.sourceSections, /§§20\.2,25\.2/);
});

test("los REQUIRES* tipados se extraen de la fila (IMP-26 y IMP-05)", () => {
  const graph = realGraph();
  const imp26 = getImp(graph, "IMP-26");
  assert.deepEqual(imp26.requires, ["IMP-01", "IMP-25"]);
  assert.deepEqual(imp26.requiresAuditDeps, ["DEP-27"]);
  assert.deepEqual(imp26.requiresEvidenceDeps, []);
  assert.deepEqual(imp26.resolvesAuditDeps, []);
  assert.deepEqual(imp26.producesEvidenceDeps, []);

  const imp05 = getImp(graph, "IMP-05");
  assert.deepEqual(imp05.requires, ["IMP-02", "IMP-03", "IMP-04"]);
  assert.deepEqual(imp05.requiresAuditDeps, ["DEP-01", "DEP-03", "DEP-06", "DEP-07", "DEP-10"]);
});

test("los casos condicionales (framework/validación/procedencia) se marcan, no se resuelven", () => {
  const graph = realGraph();
  assert.equal(getImp(graph, "IMP-27").conditional, true);
  assert.deepEqual(getImp(graph, "IMP-27").requires, ["IMP-01"]);
  assert.equal(getImp(graph, "IMP-28").conditional, true);
  assert.deepEqual(getImp(graph, "IMP-28").conditionalRequires, ["IMP-27"]);
  assert.equal(getImp(graph, "IMP-24").conditional, true);
  assert.ok(getImp(graph, "IMP-24").conditionalRequires.includes("IMP-19"));
});

test("parseRequires separa el prefijo duro de los requisitos condicionales", () => {
  assert.deepEqual(parseRequires("IMP-05", "IMP-02,03,04 aceptados."), { requires: ["IMP-02", "IMP-03", "IMP-04"], conditionalRequires: [], conditional: false });
  const conditional = parseRequires("IMP-28", "IMP-01 aceptado para framework. En evaluación concreta del rol: IMP-27 framework aceptado.");
  assert.deepEqual(conditional.requires, ["IMP-01"]);
  assert.deepEqual(conditional.conditionalRequires, ["IMP-27"]);
  assert.equal(conditional.conditional, true);
});

test("expansores de ids respetan el shorthand de la SPEC y las columnas que empiezan con guión", () => {
  assert.deepEqual(expandImpIds("IMP-05,07,08,13,14 aceptados"), ["IMP-05", "IMP-07", "IMP-08", "IMP-13", "IMP-14"]);
  assert.deepEqual(expandDepIds("DEP-01–04"), ["DEP-01", "DEP-02", "DEP-03", "DEP-04"]);
  assert.deepEqual(expandDepIds("DEP-06/07"), ["DEP-06", "DEP-07"]);
  assert.deepEqual(requiredDepIds("—; no exige DEP-05 ya cerrada."), []);
  assert.deepEqual(normalizeImpId("IMP-5"), "IMP-05");
});

test("HT-IMP-26-002: la negación 'sin exigir … IMP-26' en §25.2.2 no crea REQUIRES para IMP-25 (§20.2.3)", async () => {
  const graph = realGraph();
  assert.deepEqual(getImp(graph, "IMP-25").requires, []);
  const { evaluateEligibility } = await import("../../src/office/eligibility.mjs");
  const outcome = evaluateEligibility({ graph, impId: "IMP-25", projectOn: true, acceptedInstances: [{ imp: "IMP-01" }] });
  assert.ok(!outcome.blockers.some((blocker) => blocker.code === "REQUIRES_MISSING"), JSON.stringify(outcome.blockers));
});

test("HT-IMP-26-003: DEP-13/14 (IMP-16) y DEP-25 (IMP-23/24/29) negados/diferidos no se promueven a REQUIRES*", () => {
  const graph = realGraph();
  assert.deepEqual(getImp(graph, "IMP-16").requiresEvidenceDeps, ["DEP-11"]);
  const imp23 = getImp(graph, "IMP-23");
  assert.deepEqual(imp23.requiresAuditDeps, ["DEP-01", "DEP-03"]);
  assert.ok(!imp23.requiresAuditDeps.includes("DEP-25"));
  assert.ok(!getImp(graph, "IMP-24").requiresAuditDeps.includes("DEP-25"));
  assert.ok(!getImp(graph, "IMP-29").requiresAuditDeps.includes("DEP-25"));
});

test("HT-IMP-26-004: el rango 'DEP-01/03–07' no añade DEP-02 (IMP-09/IMP-14)", () => {
  const graph = realGraph();
  assert.deepEqual(getImp(graph, "IMP-09").requiresAuditDeps, ["DEP-01", "DEP-03", "DEP-04", "DEP-05", "DEP-06", "DEP-07"]);
  assert.deepEqual(getImp(graph, "IMP-14").requiresAuditDeps, ["DEP-01", "DEP-03", "DEP-04", "DEP-05", "DEP-06", "DEP-07", "DEP-08", "DEP-09"]);
});

test("HT-IMP-26-005: 'IMP-16 y/o18' expande ambas alternativas (IMP-19)", () => {
  const graph = realGraph();
  assert.deepEqual(getImp(graph, "IMP-19").conditionalRequires, ["IMP-16", "IMP-18"]);
  assert.deepEqual(expandImpIds("IMP-16 y/o18 aceptados según la procedencia"), ["IMP-16", "IMP-18"]);
  assert.deepEqual(expandImpIds("IMP-11 y16"), ["IMP-11", "IMP-16"]);
});

test("HT-IMP-26-006: IMP-26 UNLOCKS no incluye IMP-25 ('no añade prerequisite retroactivo')", () => {
  assert.deepEqual(getImp(realGraph(), "IMP-26").unlocks, []);
});

test("una identidad declarada distinta de la canónica no produce grafo (fail-closed)", () => {
  const outcome = buildCanonicalGraph({ specMarkdown: SPEC_MARKDOWN, specIdentity: { ...CANONICAL_SPEC_IDENTITY, sha256: "0".repeat(64) } });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "SPEC_IDENTITY_MISMATCH"));
});

test("sin las tablas canónicas no hay grafo (fail-closed)", () => {
  assert.equal(parseCanonicalGraph("texto sin tablas"), null);
  const outcome = buildCanonicalGraph({ specMarkdown: "texto sin tablas" });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "CANONICAL_TABLE_UNLOCATED"));
});

test("un grafo truncado no sella (fail-closed)", () => {
  const withoutDepRow = SPEC_MARKDOWN.replace(/\| \*\*IMP-29\*\* \|[^\n]*\n/, "");
  const outcome = buildCanonicalGraph({ specMarkdown: withoutDepRow });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "CANONICAL_GRAPH_INCOMPLETE"));
});
