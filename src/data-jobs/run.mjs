// DATA-01: decisión de la cola ante el estado del log de descarga. Separado del
// CLI para poder probarlo con fixtures (el CLI sólo cablea entorno y salida).
//
// Reglas (owner decision 2026-09-26):
//   - Sin línea terminal: WAIT (la descarga sigue; no se lanza nada).
//   - `CHECKSUM FALLA`: ALERT_ONLY (no se lanza nada y se avisa).
//   - `CHECKSUM OK` con sha distinto al declarado: ALERT_ONLY (fail-closed).
//   - `CHECKSUM OK` con el sha declarado: RUN_QUEUE.
//   - Un disparador ya procesado: SKIP (idempotente; no re-avisa ni re-lanza).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { TRIGGER_KIND, triggerFingerprint } from "./trigger.mjs";

export const TRIGGER_STATE_FILE = "TRIGGER_STATE.json";

export function planTriggerAction({ trigger, previousFingerprint = null } = {}) {
  const fingerprint = triggerFingerprint(trigger);
  if (trigger?.kind === TRIGGER_KIND.PENDING) return { action: "WAIT", fingerprint };
  if (fingerprint !== null && fingerprint === previousFingerprint) return { action: "SKIP", fingerprint };
  if (trigger?.kind === TRIGGER_KIND.CHECKSUM_OK) return { action: "RUN_QUEUE", fingerprint };
  return { action: "ALERT_ONLY", fingerprint };
}

export function readTriggerState(runsDir) {
  const file = path.join(runsDir, TRIGGER_STATE_FILE);
  if (!existsSync(file)) return { artifactKind: "DATA-01_TRIGGER_STATE", lastHandled: null };
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // Estado ilegible: fail-closed. Sin estado no se puede afirmar que el
    // disparador ya se procesó, así que no se marca como manejado.
    return { artifactKind: "DATA-01_TRIGGER_STATE", lastHandled: null, corrupt: true };
  }
}

export function writeTriggerState(runsDir, state) {
  mkdirSync(runsDir, { recursive: true });
  const file = path.join(runsDir, TRIGGER_STATE_FILE);
  writeFileSync(file, JSON.stringify({ artifactKind: "DATA-01_TRIGGER_STATE", ...state }, null, 1));
  return file;
}
