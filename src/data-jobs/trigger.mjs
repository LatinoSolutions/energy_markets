// DATA-01 (PLAN_STATUS, owner decision 2026-09-26): disparador de la cola
// automática de jobs de data. La descarga del archivo del cliente
// (/srv/data/eex-client-archive/descargar.sh) cierra con una de dos líneas:
//   <ISO-8601> CHECKSUM OK <sha256>
//   <ISO-8601> CHECKSUM FALLA <sha256>
// Mientras ninguna esté, la descarga sigue (PENDING) y la cola no lanza nada.
//
// Regla fail-closed: un `CHECKSUM OK` sólo dispara si el sha256 de la línea
// coincide con el hash declarado por el owner para ese archivo. Si no coincide,
// o si no hay hash declarado, el resultado es CHECKSUM_MISMATCH y no se lanza
// nada: no se confía en una verificación que no ata el contenido esperado.

export const CHECKSUM_LINE_PATTERN = /^(?<at>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) CHECKSUM (?<verdict>OK|FALLA) (?<sha256>[0-9a-f]{64})$/;

export const TRIGGER_KIND = Object.freeze({
  PENDING: "PENDING",
  CHECKSUM_OK: "CHECKSUM_OK",
  CHECKSUM_FALLA: "CHECKSUM_FALLA",
  CHECKSUM_MISMATCH: "CHECKSUM_MISMATCH",
});

// Todas las líneas terminales del log, en orden. Se conserva el número de línea
// para poder referenciar el hecho exacto en el receipt y en el aviso.
export function parseChecksumEvents(text) {
  const events = [];
  const lines = String(text ?? "").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = CHECKSUM_LINE_PATTERN.exec(lines[index].trim());
    if (match === null) continue;
    events.push({
      at: match.groups.at,
      verdict: match.groups.verdict,
      sha256: match.groups.sha256,
      lineNumber: index + 1,
      line: lines[index].trim(),
    });
  }
  return events;
}

// La última línea terminal manda: la descarga reintenta y puede dejar un FALLA
// intermedio antes de un OK final (o al revés). Sólo el último hecho es el estado.
export function resolveTrigger({ text, expectedSha256 = null } = {}) {
  const events = parseChecksumEvents(text);
  const event = events.at(-1) ?? null;
  if (event === null) {
    return { kind: TRIGGER_KIND.PENDING, event: null, expectedSha256 };
  }
  if (event.verdict === "FALLA") {
    return { kind: TRIGGER_KIND.CHECKSUM_FALLA, event, expectedSha256 };
  }
  if (expectedSha256 === null || event.sha256 !== expectedSha256) {
    return { kind: TRIGGER_KIND.CHECKSUM_MISMATCH, event, expectedSha256 };
  }
  return { kind: TRIGGER_KIND.CHECKSUM_OK, event, expectedSha256 };
}

// Huella estable del hecho que dispara la cola. Dos corridas sobre la misma
// línea terminal comparten huella: la cola es idempotente (no recalcula).
export function triggerFingerprint(trigger) {
  if (trigger?.event == null) return null;
  return `${trigger.kind}:${trigger.event.at}:${trigger.event.sha256}:${trigger.event.lineNumber}`;
}
