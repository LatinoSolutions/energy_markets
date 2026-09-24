import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const planStatusPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "PLAN_STATUS.md",
);

function imp15Row() {
  const lines = readFileSync(planStatusPath, "utf8").split("\n");
  return lines.find((line) => line.startsWith("| IMP-15 |"));
}

test("IMP-15: la fila de PLAN_STATUS no declara bloqueo humano por datos que P-006 declaró no requeridos (IMP15-H8)", () => {
  const row = imp15Row();
  assert.ok(row, "PLAN_STATUS.md debe contener una fila IMP-15");

  // La aclaración del owner (P-006, resuelta 23-sep-2026) fijó la identidad de
  // campaña como determinista (GAS-Q-YYYYQn) y declaró que NO se requiere
  // Campaign ID comercial ni campaign/fills/ownership live. Registrarlos como
  // "dato que solo Bru tiene" reabre una pregunta ya respondida.
  assert.equal(/Falta un dato que solo Bru/.test(row), false);
  assert.ok(
    row.includes("no un hecho externo") && row.includes("dato que solo Bru tenga"),
    "la fila debe negar explícitamente que el bloqueo sea un hecho externo o dato privado",
  );
  assert.ok(
    row.includes("GAS-Q-YYYYQn") || row.toLowerCase().includes("determinista"),
    "la fila debe registrar la identidad determinista fijada por el owner (P-006)",
  );
  assert.ok(
    !/ningún Campaign ID|ningun Campaign ID|no Campaign ID/i.test(row),
    "la fila no debe declarar la falta de Campaign ID como bloqueo",
  );
});

test("IMP-15: la fila registra el bloqueo real del parent sin marcar aceptación (IMP15-H9)", () => {
  const row = imp15Row();
  const status = row.split("|")[2].trim();

  // El acceptance del parent §25.2.2 (REQUIRES_AUDIT DEP-01–09, campaña manual
  // real) no queda satisfecho por el cierre sobre fixture sintética; la fila
  // debe registrar esa frontera sin marcar el IMP aceptado (eso lo decide Bru).
  assert.equal(status, "pendiente");
  assert.ok(row.includes("DEP-01–09"), "debe citar el REQUIRES_AUDIT del parent");
  assert.ok(
    row.includes("sintética") || row.toLowerCase().includes("synthetic"),
    "debe declarar que el cierre actual es sintético",
  );
  assert.ok(
    row.includes("DEP-06/07") && row.includes("UNRECONCILED"),
    "la ficha real exige lago EEX auditado (DEP-06/07) y benchmark reconciliado (IMP-05)",
  );
});
