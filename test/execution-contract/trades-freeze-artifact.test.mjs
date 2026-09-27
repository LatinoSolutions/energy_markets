// Tests del artefacto committeado de TR-04 y su reproducibilidad. El artefacto
// real queda HOLD porque la medición del puente (TR-03) y la aprobación de Bru
// son jobs/decisión pendientes; los tests usan fixtures construidas con el
// productor real de TR-03 para probar el mecanismo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  MANIFEST_PATH,
  OUT_PATH,
  buildTradesFreezeArtifact,
} from "../../operations/trades/TR-04/build-trades-freeze.mjs";
import { approvalFor, measurementFixture, sourceDecisionFixture } from "./trades-fixtures.mjs";
import { syntheticDevelopmentEvidence } from "../trades-engine/development-evidence.mjs";

const committedArtifactBytes = readFileSync(OUT_PATH);
const committedArtifact = JSON.parse(committedArtifactBytes.toString("utf8"));

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Tras la cola DATA-01 (2026-09-26) la medición del puente existe: el artefacto
// publica el candidato y queda HOLD sólo por la aprobación de Bru (gate humano).
test("el artefacto committeado queda HOLD hasta medir la nueva grilla en TR-03", () => {
  assert.equal(committedArtifact.decision, "HOLD");
  assert.equal(committedArtifact.status, "PENDING_MEASUREMENT");
  assert.equal(committedArtifact.contractId, "EXEC-TRADES-v1");
  assert.equal(committedArtifact.frozenContract, null);
  assert.equal(committedArtifact.humanGate.requiresOwnerApproval, true);
  assert.deepEqual(committedArtifact.blockedBy, ["BRIDGE_MEASUREMENT_GRID_STALE"]);
  assert.deepEqual(committedArtifact.candidate.freshnessSelection.gridSeconds, [900, 1800, 3600, 14400, 86400]);
  assert.equal(committedArtifact.humanGate.configHash, committedArtifact.candidate.configHash);
});

test("el artefacto committeado es reproducible con los mismos inputs", () => {
  const sourceDecision = JSON.parse(readFileSync("operations/trades/TR-01/DATA_SOURCE_DECISION.json", "utf8"));
  const measurementBytes = readFileSync("operations/trades/TR-03/bridge-measurement.json");
  const { artifact } = buildTradesFreezeArtifact({
    measurement: JSON.parse(measurementBytes.toString("utf8")),
    sourceDecision,
    ownerApproval: null,
    bridgeMeasurementSha256: sha256(measurementBytes),
    inputsPresent: { measurement: true, measurementStatus: true, sourceDecision: true, ownerApproval: false },
  });
  const bytes = Buffer.from(`${JSON.stringify(artifact, null, 1)}\n`);
  assert.equal(bytes.equals(committedArtifactBytes), true);
});

test("el manifest ata el artefacto por hash", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  assert.equal(manifest.artifact.path, OUT_PATH);
  assert.equal(manifest.artifact.sha256, sha256(committedArtifactBytes));
});

test("con medición pero sin aprobación publica el candidato y su configHash", () => {
  const measurement = measurementFixture();
  const sourceDecision = sourceDecisionFixture();
  const { artifact } = buildTradesFreezeArtifact({
    measurement,
    sourceDecision,
    ...syntheticDevelopmentEvidence(measurement, sourceDecision, { measurement: true, sourceDecision: true }),
    ownerApproval: null,
    inputsPresent: { measurement: true, measurementStatus: true, sourceDecision: true, ownerApproval: false },
  });
  assert.equal(artifact.status, "PENDING_OWNER_APPROVAL");
  assert.match(artifact.humanGate.configHash, /^[0-9a-f]{64}$/);
  assert.equal(artifact.candidate.configHash, artifact.humanGate.configHash);
  assert.equal(artifact.frozenContract, null);
  assert.equal(artifact.inputs.measurement.brokenSpreadPolicy, "INCLUDE");
  // La configuración aprobada queda ligada a la identidad de la medición (TR-03).
  assert.match(artifact.candidate.generatedFrom.bridgeMeasurementSha256, /^[0-9a-f]{64}$/);
});

test("cambiar los bytes de la medición cambia el configHash del candidato", () => {
  const measurement = measurementFixture();
  const inputsPresent = { measurement: true, sourceDecision: true };
  const base = buildTradesFreezeArtifact({ measurement, sourceDecision: sourceDecisionFixture(), inputsPresent });
  const altered = measurementFixture();
  altered.counts.rowsSeen += 1;
  const changed = buildTradesFreezeArtifact({ measurement: altered, sourceDecision: sourceDecisionFixture(), inputsPresent });
  assert.notEqual(
    changed.artifact.candidate.generatedFrom.bridgeMeasurementSha256,
    base.artifact.candidate.generatedFrom.bridgeMeasurementSha256,
  );
  assert.notEqual(changed.artifact.humanGate.configHash, base.artifact.humanGate.configHash);
});

test("con medición y aprobación de Bru el artefacto queda FROZEN", () => {
  const measurement = measurementFixture();
  const sourceDecision = sourceDecisionFixture();
  const evidence = syntheticDevelopmentEvidence(measurement, sourceDecision, { measurement: true, sourceDecision: true });
  const candidateOutcome = buildTradesFreezeArtifact({
    measurement,
    sourceDecision,
    ...evidence,
    ownerApproval: null,
    inputsPresent: { measurement: true, sourceDecision: true },
  });
  const configHash = candidateOutcome.artifact.humanGate.configHash;
  const { artifact } = buildTradesFreezeArtifact({
    measurement,
    sourceDecision,
    ...evidence,
    ownerApproval: approvalFor(configHash),
    inputsPresent: { measurement: true, sourceDecision: true, ownerApproval: true },
  });
  assert.equal(artifact.decision, "FROZEN");
  assert.equal(artifact.status, "FROZEN");
  assert.equal(artifact.frozenContract.status, "FROZEN");
  assert.equal(artifact.frozenContract.configHash, configHash);
  assert.equal(artifact.humanGate.approvalRef, "OWNER-DECISION-TR-04-FIXTURE");
});

test("una política de TR-01 distinta a la de la medición deja el artefacto en HOLD", () => {
  const { artifact } = buildTradesFreezeArtifact({
    measurement: measurementFixture(),
    sourceDecision: sourceDecisionFixture({ brokenSpreadPolicy: "EXCLUDE" }),
    ownerApproval: null,
    inputsPresent: { measurement: true, sourceDecision: true },
  });
  assert.equal(artifact.decision, "HOLD");
  assert.equal(artifact.status, "INCONSISTENT_BROKEN_SPREAD_POLICY");
  assert.ok(artifact.blockedBy.includes("BROKEN_SPREAD_POLICY_MISMATCH"));
});
