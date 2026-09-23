import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Corrección HALLAZGO IMP09-CALENDAR-BOXING-DAY / IMP09-CALENDAR-FALSE-VERIFICATION:
// el calendario oficial de Exchange Days de Gas Futures EEX debe incluir Boxing
// Day (26-12, holiday de la regla continua del PDF) y su verificación debe
// PARSEAR la hoja real del xlsx oficial 2026, no comparar un set hardcodeado.
// Este test blinda el artefacto derivado y que el script de construcción lea de
// verdad el xlsx (si no, `--check` falla).

const CALENDAR_PATH = "operations/audit/IMP-09/eex-exchange-calendar.json";
const SHA256SUMS_PATH = "operations/audit/IMP-09/SHA256SUMS";
const EVAL_PATH = "operations/audit/IMP-09/eex-quarterly-register-eval.json";
const SCRIPT_PATH = "operations/audit/IMP-09/build-eex-exchange-calendar.py";

const sha256Of = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Fechas reales de la columna "Exchange Holidays - Natural Gas Futures" de la
// hoja "2026 Natural Gas Holidays" del xlsx oficial (E = serial, F = evento).
// Boxing Day 26-12-2026 cae en sábado: no aparece en esa columna. El xlsx lo
// registra como Bank Holiday de Natural Gas Spot (2026-12-28), no como exchange
// holiday de Futures.
const XLSX_2026_FUTURES_EXCHANGE_HOLIDAYS = ["2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01", "2026-12-25"];

test("el calendario oficial incluye Boxing Day como holiday de Gas Futures en todos los años", () => {
  const calendar = loadJson(CALENDAR_PATH);
  assert.equal(calendar.artifactKind, "IMP-09_EEX_OFFICIAL_EXCHANGE_CALENDAR");
  for (const year of [2022, 2023, 2024, 2025, 2026]) {
    assert.equal(calendar.holidaysByYear[year]["Boxing Day"], `${year}-12-26`, `Boxing Day ausente en ${year}`);
  }
});

test("los 26-12 hábiles (Boxing Day) quedan fuera de exchangeDays; 24-12 y 31-12 siguen siendo Exchange Days", () => {
  const calendar = loadJson(CALENDAR_PATH);
  const exchangeDays = new Set(calendar.exchangeDays);
  for (const boxingDayWeekday of ["2022-12-26", "2023-12-26", "2024-12-26", "2025-12-26"]) {
    assert.equal(exchangeDays.has(boxingDayWeekday), false, `${boxingDayWeekday} no debe ser Exchange Day`);
  }
  for (const halfDay of ["2024-12-24", "2024-12-31", "2025-12-24", "2025-12-31"]) {
    assert.equal(exchangeDays.has(halfDay), true, `${halfDay} es Exchange Day de horario acortado`);
  }
});

test("el artefacto registra el holiday set real parseado del xlsx oficial 2026 (sin Boxing Day Futures)", () => {
  const calendar = loadJson(CALENDAR_PATH);
  assert.deepEqual(calendar.verifiedXlsx2026ExchangeHolidays, XLSX_2026_FUTURES_EXCHANGE_HOLIDAYS);
});

test("el script de construcción lee el xlsx real: `--check` coincide y no falla", () => {
  const output = execFileSync("python3", [SCRIPT_PATH, "--check"], { encoding: "utf8" });
  for (const holiday of XLSX_2026_FUTURES_EXCHANGE_HOLIDAYS) {
    assert.ok(output.includes(holiday), `--check no reporta ${holiday}: ${output}`);
  }
});

test("la evaluación real refleja el calendario corregido: 2026Q2 completo y HOLD sólo por falta de campañas", () => {
  const calendarHash = sha256Of(CALENDAR_PATH);
  const evaluation = loadJson(EVAL_PATH);
  assert.equal(evaluation.hashes.exchangeCalendar, calendarHash, "la evaluación cita el hash del calendario corregido");
  assert.deepEqual(
    evaluation.register.eligibleComplete.map((episode) => episode.maturity),
    ["2026Q1", "2026Q2", "2026Q3"],
  );
  assert.deepEqual(evaluation.reservation.blockedBy, ["INSUFFICIENT_ELIGIBLE_COMPLETE_CAMPAIGNS"]);
  assert.equal(evaluation.reservation.decision, "HOLD");
  assert.equal(evaluation.reservation.sealedOosCount, 0);
});

test("los hashes locales de SHA256SUMS coinciden con los artefactos de IMP-09", () => {
  const lines = readFileSync(SHA256SUMS_PATH, "utf8").trim().split("\n");
  const local = lines
    .map((line) => line.trim().split(/\s+/))
    .filter(([, path]) => !path.includes(":"));
  assert.ok(local.length > 0);
  for (const [declaredHash, path] of local) {
    assert.equal(sha256Of(`operations/audit/IMP-09/${path}`), declaredHash, `hash stale para ${path}`);
  }
});
