// DATA-01: entrypoint de la cola automática de jobs de data. Lo corre la unidad
// systemd --user (operations/data-jobs/systemd/), no un humano.
//
// Uso: node operations/data-jobs/run-data-queue.mjs
// Variables: DATA_REPO_ROOT, DATA_ARCHIVE_LOG, DATA_ARCHIVE_PATH,
//   DATA_ARCHIVE_SHA256, DATA_ARCHIVE_BYTES, DATA_EXTRACT_DIR, DATA_SCRATCH_DIR,
//   DATA_RUNS_DIR, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
//   DATA_DISABLE_SYSTEMD_SCOPE (1 = no envolver cada job en su scope).
//
// Salida: 0 si no había nada que lanzar, si avisó de un fallo de checksum, o si
// la cola terminó bien; 1 si la cola falló (para que systemd lo marque).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DATA_ARCHIVE,
  TRIGGER_KIND,
  buildDataQueueSteps,
  createDataQueueRunner,
  createTelegramNotifier,
  planTriggerAction,
  readTriggerState,
  resolveTrigger,
  triggerNotificationText,
  writeTriggerState,
} from "../../src/data-jobs/index.mjs";

const REPO_ROOT = process.env.DATA_REPO_ROOT ?? path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

function archiveFromEnv() {
  return {
    ...DATA_ARCHIVE,
    logPath: process.env.DATA_ARCHIVE_LOG ?? DATA_ARCHIVE.logPath,
    path: process.env.DATA_ARCHIVE_PATH ?? DATA_ARCHIVE.path,
    expectedSha256: process.env.DATA_ARCHIVE_SHA256 ?? DATA_ARCHIVE.expectedSha256,
    expectedBytes: process.env.DATA_ARCHIVE_BYTES === undefined ? DATA_ARCHIVE.expectedBytes : Number.parseInt(process.env.DATA_ARCHIVE_BYTES, 10),
    extractDir: process.env.DATA_EXTRACT_DIR ?? DATA_ARCHIVE.extractDir,
  };
}

async function main() {
  const archive = archiveFromEnv();
  const runsDir = process.env.DATA_RUNS_DIR ?? path.join(REPO_ROOT, "operations/data-runs");
  const scratchDir = process.env.DATA_SCRATCH_DIR ?? path.join(path.dirname(archive.path), "scratch");
  const notifier = createTelegramNotifier({
    token: process.env.TELEGRAM_BOT_TOKEN ?? null,
    chatId: process.env.TELEGRAM_CHAT_ID ?? null,
  });
  const runner = createDataQueueRunner({
    repoRoot: REPO_ROOT,
    runsDir,
    notifier,
    useSystemdScope: process.env.DATA_DISABLE_SYSTEMD_SCOPE !== "1",
  });

  if (!existsSync(archive.logPath)) {
    process.stdout.write(`DATA-01: sin log de descarga en ${archive.logPath}; no se lanza nada\n`);
    return 0;
  }
  const trigger = resolveTrigger({ text: readFileSync(archive.logPath, "utf8"), expectedSha256: archive.expectedSha256 });
  const state = readTriggerState(runsDir);
  const plan = planTriggerAction({ trigger, previousFingerprint: state.lastHandled?.fingerprint ?? null });

  if (plan.action === "WAIT") {
    process.stdout.write("DATA-01: la descarga sigue sin línea de checksum; no se lanza nada\n");
    return 0;
  }
  if (plan.action === "SKIP") {
    process.stdout.write(`DATA-01: disparador ya procesado (${plan.fingerprint}); no se repite\n`);
    return 0;
  }
  if (plan.action === "ALERT_ONLY") {
    const notification = await notifier.notify(triggerNotificationText(trigger));
    writeTriggerState(runsDir, { lastHandled: { fingerprint: plan.fingerprint, kind: trigger.kind, at: trigger.event?.at ?? null, sha256: trigger.event?.sha256 ?? null, handledAt: new Date().toISOString(), notification } });
    process.stdout.write(`DATA-01: ${trigger.kind}; no se lanza nada y se avisa (${notification.code ?? "ok"})\n`);
    return 0;
  }

  await notifier.notify(triggerNotificationText(trigger));
  const steps = buildDataQueueSteps({ repoRoot: REPO_ROOT, archive, scratchDir });
  const result = await runner.runQueue({ trigger, steps });
  if (!result.ok) {
    process.stderr.write(`DATA-01: la cola falló (${result.code})${result.queue?.failedStep ? ` en ${result.queue.failedStep.jobKind}` : ""}\n`);
    // No se marca el disparador como manejado: un evento nuevo reanuda la cola.
    return 1;
  }
  writeTriggerState(runsDir, { lastHandled: { fingerprint: plan.fingerprint, kind: trigger.kind, at: trigger.event?.at ?? null, sha256: trigger.event?.sha256 ?? null, handledAt: new Date().toISOString(), queueId: result.queueId, reused: result.reused === true } });
  process.stdout.write(`DATA-01: cola ${result.reused ? "ya completa" : "completa"} ${result.queueId}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`DATA-01: error inesperado: ${error?.message ?? error}\n`);
    process.exitCode = 1;
  });
}

export { main };
