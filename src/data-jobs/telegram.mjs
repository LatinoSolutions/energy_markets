// DATA-01: aviso por Telegram al terminar o fallar cada job (owner decision
// 2026-09-26). El transporte se inyecta para que los tests no toquen la red.
//
// Nunca se registra ni se devuelve el token: el resultado del aviso sólo dice si
// salió, el código de error y el status HTTP. Un aviso que no se puede mandar no
// tumba la cola: queda declarado en el receipt como fallo de notificación.

export const TELEGRAM_API_ORIGIN = "https://api.telegram.org";

export function createTelegramNotifier({ token = null, chatId = null, fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  const configured = typeof token === "string" && token.length > 0 && typeof chatId === "string" && chatId.length > 0;
  const at = () => now().toISOString();

  async function notify(text) {
    if (!configured) return { configured: false, ok: false, code: "TELEGRAM_NOT_CONFIGURED", at: at() };
    if (typeof fetchImpl !== "function") return { configured: true, ok: false, code: "TELEGRAM_TRANSPORT_MISSING", at: at() };
    try {
      const response = await fetchImpl(`${TELEGRAM_API_ORIGIN}/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: String(text ?? ""), disable_web_page_preview: true }),
      });
      if (response?.ok === true) return { configured: true, ok: true, at: at() };
      return { configured: true, ok: false, code: "TELEGRAM_HTTP_ERROR", status: response?.status ?? null, at: at() };
    } catch (error) {
      return { configured: true, ok: false, code: "TELEGRAM_UNREACHABLE", message: String(error?.message ?? error), at: at() };
    }
  }

  return { configured, notify };
}

// Texto del aviso: una línea por job, sin secretos ni rutas de token. El índice
// se muestra 1-based (posición del job en la cola).
export function jobNotificationText({ queueId, step, receipt }) {
  const status = receipt?.status ?? "UNKNOWN";
  const position = Number.isInteger(step?.index) ? step.index + 1 : "?";
  const head = `${status} · DATA-01 ${step?.jobKind ?? "job"} (${position}/${step?.total ?? "?"}) · ${queueId}`;
  if (status === "SUCCEEDED") return head;
  const code = receipt?.failure?.code ?? "UNKNOWN";
  const message = receipt?.failure?.message ?? "";
  return message.length > 0 ? `${head} · ${code}: ${message}` : `${head} · ${code}`;
}

export function triggerNotificationText(trigger) {
  if (trigger?.kind === "CHECKSUM_OK") return `DATA-01 · CHECKSUM OK ${trigger.event.sha256} · lanzando la cola de data`;
  if (trigger?.kind === "CHECKSUM_FALLA") return `DATA-01 · CHECKSUM FALLA ${trigger.event?.sha256 ?? "sin sha"} · no se lanza nada`;
  if (trigger?.kind === "CHECKSUM_MISMATCH") return `DATA-01 · CHECKSUM OK con sha distinto al declarado (${trigger.event?.sha256 ?? "sin sha"}) · no se lanza nada`;
  return `DATA-01 · descarga sin línea de checksum · no se lanza nada`;
}
