import { test } from "node:test";
import assert from "node:assert/strict";

import {
  REVIEW_VERDICTS,
  buildReviewVerdict,
  evaluateReviewIndependence,
  reviewSubtask,
} from "../../src/office/review.mjs";
import { packetFor, receiptFor } from "./fixtures.mjs";

test("el author no se revisa a sí mismo; el Command/decomposer no revisa sus propias decisiones", () => {
  assert.equal(evaluateReviewIndependence({ author: "w1", command: "c1", reviewer: "w1" }).ok, false);
  assert.equal(evaluateReviewIndependence({ author: "w1", command: "c1", reviewer: "w1" }).code, "REVIEWER_IS_AUTHOR");
  const commandSelf = evaluateReviewIndependence({ author: "w1", command: "c1", reviewer: "c1" });
  assert.equal(commandSelf.ok, false);
  assert.equal(commandSelf.code, "REVIEWER_IS_COMMAND");
  assert.equal(evaluateReviewIndependence({ author: "w1", command: "c1", reviewer: "r2" }).ok, true);
});

test("una prueba determinista no exige retraso ceremonial de independencia (§20.2.9)", () => {
  const deterministic = evaluateReviewIndependence({ author: "w1", command: "c1", reviewer: "c1", deterministic: true });
  assert.equal(deterministic.ok, true);
});

test("el failover de Command queda registrado con su rol", () => {
  const outcome = evaluateReviewIndependence({ author: "w1", command: "opus", reviewer: "r2", failover: true });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.record.failover, true);
  assert.equal(outcome.record.command, "opus");
  assert.equal(outcome.record.reviewer, "r2");
});

test("tests no ejecutados o evidencia no real fuerzan CAMBIOS (§20.2.9)", () => {
  const good = buildReviewVerdict({
    scopeRespected: true,
    frozenDecisionsPreserved: true,
    outputsComplete: true,
    testsActuallyRun: true,
    evidenceReal: true,
    dependenciesLegitimatelySatisfied: true,
  });
  assert.equal(good.verdict, REVIEW_VERDICTS.APROBADO);

  const forged = buildReviewVerdict({
    scopeRespected: true,
    frozenDecisionsPreserved: true,
    outputsComplete: true,
    testsActuallyRun: false,
    evidenceReal: false,
    dependenciesLegitimatelySatisfied: true,
  });
  assert.equal(forged.verdict, REVIEW_VERDICTS.CAMBIOS);
  assert.ok(forged.failures.some((failure) => failure.code === "TESTS_NOT_RUN"));
  assert.ok(forged.failures.some((failure) => failure.code === "EVIDENCE_NOT_REAL"));
});

test("una review de subtarea válida pasa; un receipt sin tests/evidencia o desligado no pasa", () => {
  const packet = packetFor("IMP-01");
  const receipt = receiptFor(packet);
  const ok = reviewSubtask({ packet, receipt, independence: { ok: true } });
  assert.equal(ok.verdict, REVIEW_VERDICTS.APROBADO, JSON.stringify(ok.failures));

  const forged = receiptFor(packet);
  forged.testsRun = [];
  forged.evidenceProduced = [];
  const bad = reviewSubtask({ packet, receipt: forged });
  assert.equal(bad.verdict, REVIEW_VERDICTS.CAMBIOS);
  assert.ok(bad.failures.some((failure) => failure.code === "TESTS_NOT_RUN"));
  assert.ok(bad.failures.some((failure) => failure.code === "EVIDENCE_MISSING"));

  const unlinked = receiptFor(packet);
  unlinked.packetSubtaskParentIdentity.packetId = "WP-IMP-99-ST-9-v9";
  const mismatch = reviewSubtask({ packet, receipt: unlinked });
  assert.equal(mismatch.verdict, REVIEW_VERDICTS.CAMBIOS);
  assert.ok(mismatch.failures.some((failure) => failure.code === "ST_RECEIPT_UNLINKED"));
});
