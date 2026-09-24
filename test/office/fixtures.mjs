// Fixtures de test/office (IMP-26). Los fixtures sintéticos prueban ingeniería;
// no acreditan disponibilidad factual, procurement ni acceptance de un IMP.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildCanonicalGraph } from "../../src/office/canonical-graph.mjs";
import { CANONICAL_SPEC_IDENTITY } from "../../src/office/spec-binding.mjs";

export const SPEC_DOC_PATH = fileURLToPath(
  new URL("../../docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md", import.meta.url),
);

export const SPEC_MARKDOWN = readFileSync(SPEC_DOC_PATH, "utf8");

export function realGraph() {
  const outcome = buildCanonicalGraph({ specMarkdown: SPEC_MARKDOWN });
  if (!outcome.ok) throw new Error(`grafo canónico inválido: ${JSON.stringify(outcome.errors)}`);
  return outcome.graph;
}

// Fila de grafo sintética: sólo los campos que la elegibilidad consume.
export function row({
  id,
  requires = [],
  conditionalRequires = [],
  conditional = false,
  requiresAuditDeps = [],
  requiresEvidenceDeps = [],
  resolvesAuditDeps = [],
  producesEvidenceDeps = [],
  objective = "objetivo sintético",
  acceptanceTest = "acceptance sintético",
}) {
  return {
    id,
    requires,
    conditionalRequires,
    conditional,
    requiresAuditDeps,
    requiresEvidenceDeps,
    resolvesAuditDeps,
    producesEvidenceDeps,
    objective,
    acceptanceTest,
  };
}

export function makeGraph(rows) {
  const imps = {};
  for (const entry of rows) imps[entry.id] = entry;
  return { spec: { ...CANONICAL_SPEC_IDENTITY }, imps };
}

export function packetFor(parentImp = "IMP-01") {
  return {
    packetId: `WP-${parentImp}-ST-1-v1.1`,
    project: "energy-markets",
    spec: { ...CANONICAL_SPEC_IDENTITY },
    parentImp,
    subtaskId: `ST-${parentImp.replace("IMP-", "")}.1`,
    objective: "objetivo sintético",
    allowedScope: "src/office/**, test/office/**",
    prohibitedScope: "SPEC read-only",
    inputs: ["SPEC §§20.2,25.2"],
    sourceSections: "§§20.2,25.1,25.2",
    dependenciesConsumed: "REQUIRES=IMP-01",
    frozenDecisions: "P1-P7, D1-D5",
    mustNotChange: "semántica frozen",
    expectedOutputs: "binding",
    subtaskAcceptance: "criterios del hijo",
    parentAcceptanceContext: "gate del padre",
    requiredTests: "node --test test/office/*.test.mjs",
    requiredEvidence: "salidas reales",
    baselineVersion: "1.1.1",
    handoffFormat: "ST_RECEIPT §20.2.8",
  };
}

export function receiptFor(packet) {
  return {
    packetSubtaskParentIdentity: {
      packetId: packet.packetId,
      subtaskId: packet.subtaskId,
      parentImp: packet.parentImp,
      project: packet.project,
      specId: packet.spec.id,
      specVersion: packet.spec.version,
      specSha256: packet.spec.sha256,
    },
    workerModelRoute: "openrouter/deepseek-v4.1-flash",
    startingBaseline: "rama run/energy-markets-IMP-26",
    resultingVersion: { contentHash: "a".repeat(64) },
    inputsUsed: ["SPEC §§20.2,25.2"],
    artifactsChanged: ["src/office/eligibility.mjs"],
    result: "binding materializado",
    testsRun: ["node --test test/office/*.test.mjs"],
    testResults: ["pass"],
    evidenceProduced: ["TAP de tests"],
    assumptions: [],
    deviations: [],
    dependencyFindings: [],
    failuresRetries: [],
    recommendedStatus: "in_review",
  };
}
