// DATA-01: aviso por Telegram. El transporte se inyecta; nunca se filtra el
// token y un aviso que falla no tumba la cola.

import { test } from "node:test";
import assert from "node:assert/strict";

import { TELEGRAM_API_ORIGIN, createTelegramNotifier, jobNotificationText, triggerNotificationText } from "../../src/data-jobs/telegram.mjs";

const TOKEN = "123456:SECRET-TOKEN-VALUE";

test("DATA-01 telegram: sin token/chat no se manda nada y queda declarado", async () => {
  const notifier = createTelegramNotifier({ token: null, chatId: null });
  assert.equal(notifier.configured, false);
  const result = await notifier.notify("hola");
  assert.equal(result.ok, false);
  assert.equal(result.code, "TELEGRAM_NOT_CONFIGURED");
});

test("DATA-01 telegram: con token manda el mensaje al API y nunca devuelve el token", async () => {
  const calls = [];
  const notifier = createTelegramNotifier({
    token: TOKEN,
    chatId: "-100123",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200 };
    },
    now: () => new Date("2026-09-26T00:00:00Z"),
  });
  const result = await notifier.notify("DATA-01 OK");
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${TELEGRAM_API_ORIGIN}/bot${TOKEN}/sendMessage`);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.chat_id, "-100123");
  assert.equal(body.text, "DATA-01 OK");
  // El resultado no filtra el token.
  assert.equal(JSON.stringify(result).includes("SECRET-TOKEN-VALUE"), false);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
});

test("DATA-01 telegram: un error HTTP o de red queda declarado, no lanza", async () => {
  const httpError = await createTelegramNotifier({ token: TOKEN, chatId: "c", fetchImpl: async () => ({ ok: false, status: 502 }) }).notify("x");
  assert.equal(httpError.ok, false);
  assert.equal(httpError.code, "TELEGRAM_HTTP_ERROR");
  assert.equal(httpError.status, 502);
  const unreachable = await createTelegramNotifier({ token: TOKEN, chatId: "c", fetchImpl: async () => { throw new Error("sin red"); } }).notify("x");
  assert.equal(unreachable.code, "TELEGRAM_UNREACHABLE");
  assert.equal(JSON.stringify(unreachable).includes(TOKEN), false);
});

test("DATA-01 telegram: los textos de aviso describen el hecho sin secretos", () => {
  const ok = triggerNotificationText({ kind: "CHECKSUM_OK", event: { sha256: "abc" } });
  assert.match(ok, /CHECKSUM OK/);
  assert.match(triggerNotificationText({ kind: "CHECKSUM_FALLA", event: { sha256: "abc" } }), /no se lanza nada/);
  assert.match(triggerNotificationText({ kind: "CHECKSUM_MISMATCH", event: { sha256: "abc" } }), /sha distinto/);
  assert.match(triggerNotificationText({ kind: "PENDING", event: null }), /sin línea de checksum/);
  assert.equal(jobNotificationText({ queueId: "Q", step: { jobKind: "TR01_SCAN", index: 1, total: 5 }, receipt: { status: "SUCCEEDED" } }), "SUCCEEDED · DATA-01 TR01_SCAN (2/5) · Q");
  assert.equal(jobNotificationText({ queueId: "Q", step: { jobKind: "BT06_EXTRACT", index: 3, total: 5 }, receipt: { status: "FAILED", failure: { code: "OOM_KILLED" } } }), "FAILED · DATA-01 BT06_EXTRACT (4/5) · Q · OOM_KILLED");
});
