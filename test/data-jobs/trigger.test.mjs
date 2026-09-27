// DATA-01: disparador de la cola. Prueba el parseo del log de descarga, la
// decisión fail-closed ante un sha distinto al declarado, la idempotencia por
// huella y el estado persistido.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createTempDir } from "../helpers/tmpdir.mjs";
import path from "node:path";

import {
  TRIGGER_KIND,
  parseChecksumEvents,
  resolveTrigger,
  triggerFingerprint,
} from "../../src/data-jobs/trigger.mjs";
import { planTriggerAction, readTriggerState, writeTriggerState } from "../../src/data-jobs/run.mjs";

const SHA_OK = "c0b8389dd2eae768e0144ebffa2eb8c557c1407ec8bbccb014c0ecdee075cdd3";
const SHA_OTHER = "a".repeat(64);
const LOG_OK = `2026-09-25T17:00:43Z intento 1, llevo 0 bytes\n2026-09-25T17:01:00Z tamano final 108015856868 (esperado 108015856868)\n2026-09-25T23:31:00Z CHECKSUM OK ${SHA_OK}\n`;
const LOG_FALLA = `2026-09-25T17:00:43Z intento 1, llevo 0 bytes\n2026-09-25T23:31:00Z CHECKSUM FALLA ${SHA_OTHER}\n`;

test("DATA-01 trigger: sólo las líneas terminales se parsean, con su sha y número de línea", () => {
  const events = parseChecksumEvents(LOG_OK);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { at: "2026-09-25T23:31:00Z", verdict: "OK", sha256: SHA_OK, lineNumber: 3, line: `2026-09-25T23:31:00Z CHECKSUM OK ${SHA_OK}` });
  // Una línea de progreso no dispara nada.
  assert.deepEqual(parseChecksumEvents("2026-09-25T17:00:43Z intento 1, llevo 0 bytes\n"), []);
});

test("DATA-01 trigger: sin línea terminal la descarga sigue (PENDING) y no dispara", () => {
  const trigger = resolveTrigger({ text: "2026-09-25T17:00:43Z intento 1, llevo 0 bytes\n", expectedSha256: SHA_OK });
  assert.equal(trigger.kind, TRIGGER_KIND.PENDING);
  assert.equal(trigger.event, null);
  assert.equal(triggerFingerprint(trigger), null);
});

test("DATA-01 trigger: CHECKSUM OK con el sha declarado dispara la cola", () => {
  const trigger = resolveTrigger({ text: LOG_OK, expectedSha256: SHA_OK });
  assert.equal(trigger.kind, TRIGGER_KIND.CHECKSUM_OK);
  assert.equal(trigger.event.sha256, SHA_OK);
  assert.match(triggerFingerprint(trigger), /^CHECKSUM_OK:2026-09-25T23:31:00Z:c0b8389d/);
});

test("DATA-01 trigger: CHECKSUM OK con sha distinto al declarado es MISMATCH (fail-closed, no lanza)", () => {
  const trigger = resolveTrigger({ text: `2026-09-25T23:31:00Z CHECKSUM OK ${SHA_OTHER}\n`, expectedSha256: SHA_OK });
  assert.equal(trigger.kind, TRIGGER_KIND.CHECKSUM_MISMATCH);
  // Sin hash declarado tampoco se confía en un OK.
  assert.equal(resolveTrigger({ text: LOG_OK, expectedSha256: null }).kind, TRIGGER_KIND.CHECKSUM_MISMATCH);
});

test("DATA-01 trigger: CHECKSUM FALLA no lanza nada", () => {
  const trigger = resolveTrigger({ text: LOG_FALLA, expectedSha256: SHA_OK });
  assert.equal(trigger.kind, TRIGGER_KIND.CHECKSUM_FALLA);
  assert.equal(trigger.event.sha256, SHA_OTHER);
});

test("DATA-01 trigger: manda la última línea terminal (la descarga reintenta)", () => {
  const fallaThenOk = resolveTrigger({ text: LOG_FALLA + LOG_OK, expectedSha256: SHA_OK });
  assert.equal(fallaThenOk.kind, TRIGGER_KIND.CHECKSUM_OK);
  const okThenFalla = resolveTrigger({ text: LOG_OK + LOG_FALLA, expectedSha256: SHA_OK });
  assert.equal(okThenFalla.kind, TRIGGER_KIND.CHECKSUM_FALLA);
});

test("DATA-01 trigger: la misma línea terminal no se reprocesa (SKIP)", () => {
  const trigger = resolveTrigger({ text: LOG_OK, expectedSha256: SHA_OK });
  const fingerprint = triggerFingerprint(trigger);
  assert.equal(planTriggerAction({ trigger, previousFingerprint: null }).action, "RUN_QUEUE");
  assert.equal(planTriggerAction({ trigger, previousFingerprint: fingerprint }).action, "SKIP");
  assert.equal(planTriggerAction({ trigger: resolveTrigger({ text: "", expectedSha256: SHA_OK }) }).action, "WAIT");
  assert.equal(planTriggerAction({ trigger: resolveTrigger({ text: LOG_FALLA, expectedSha256: SHA_OK }) }).action, "ALERT_ONLY");
  assert.equal(planTriggerAction({ trigger: resolveTrigger({ text: `2026-09-25T23:31:00Z CHECKSUM OK ${SHA_OTHER}\n`, expectedSha256: SHA_OK }) }).action, "ALERT_ONLY");
});

test("DATA-01 trigger: el estado persistido sobrevive el reinicio y uno corrupto no marca nada como manejado", () => {
  const runsDir = createTempDir("data01-state-");
  try {
    assert.equal(readTriggerState(runsDir).lastHandled, null);
    writeTriggerState(runsDir, { lastHandled: { fingerprint: "CHECKSUM_OK:x", kind: "CHECKSUM_OK" } });
    assert.equal(readTriggerState(runsDir).lastHandled.fingerprint, "CHECKSUM_OK:x");
    writeFileSync(path.join(runsDir, "TRIGGER_STATE.json"), "{roto");
    const corrupt = readTriggerState(runsDir);
    assert.equal(corrupt.lastHandled, null);
    assert.equal(corrupt.corrupt, true);
  } finally {
    rmSync(runsDir, { recursive: true, force: true });
  }
});
