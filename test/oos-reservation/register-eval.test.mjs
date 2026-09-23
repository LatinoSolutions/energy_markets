import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { buildQuarterlyRegisterEvaluation } from "../../operations/audit/IMP-09/evaluate-quarterly-register.mjs";

// Regresión de reproducibilidad (riesgo señalado en review): el artefacto de
// evaluación del caso real está pinneado por SHA256SUMS y debe ser una función
// pura de sus entradas. Antes estampaba createdAtUtc y regenerarlo rompía su
// hash; ahora la función no lee el reloj y el archivo commiteado se reproduce
// byte a byte desde la evidencia y el calendario commiteados.

const AUDIT = "operations/audit/IMP-09";
const sha256Of = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function evaluationInputs() {
  const evidencePath = `${AUDIT}/eex-quarterly-episode-evidence.json`;
  const calendarPath = `${AUDIT}/eex-exchange-calendar.json`;
  const committed = JSON.parse(readFileSync(`${AUDIT}/eex-quarterly-register-eval.json`, "utf8"));
  return {
    evidence: JSON.parse(readFileSync(evidencePath, "utf8")),
    evidenceHash: sha256Of(evidencePath),
    calendar: JSON.parse(readFileSync(calendarPath, "utf8")),
    calendarHash: sha256Of(calendarPath),
    clientRulesSha256: committed.hashes.clientPackageCampaignRules,
    p006Hash: sha256Of("src/procurement-contract/campaign-contract.mjs"),
  };
}

test("la evaluación del caso real es determinista y no lee el reloj", () => {
  const input = evaluationInputs();
  const first = buildQuarterlyRegisterEvaluation(input);
  const second = buildQuarterlyRegisterEvaluation(input);
  assert.deepEqual(first, second);
  assert.equal("createdAtUtc" in first, false);
});

test("el artefacto commiteado es exactamente la salida de la función pura", () => {
  const committed = JSON.parse(readFileSync(`${AUDIT}/eex-quarterly-register-eval.json`, "utf8"));
  const rebuilt = buildQuarterlyRegisterEvaluation(evaluationInputs());
  assert.deepEqual(rebuilt, committed);
});

test("la evaluación real sigue fail-closed: HOLD sin reserva ficticia", () => {
  const rebuilt = buildQuarterlyRegisterEvaluation(evaluationInputs());
  assert.equal(rebuilt.reservation.decision, "HOLD");
  assert.deepEqual(rebuilt.reservation.blockedBy, ["INSUFFICIENT_ELIGIBLE_COMPLETE_CAMPAIGNS"]);
  assert.equal(rebuilt.reservation.sealedOosCount, 0);
  assert.deepEqual(rebuilt.register.eligibleComplete.map((episode) => episode.maturity), ["2026Q1", "2026Q2", "2026Q3"]);
});
