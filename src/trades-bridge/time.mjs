// Tiempo y calendario del puente (TR-03). Fuente: TRADES_MODE_PLAN.md TR-03
// ("slot 08:00-17:30 Berlin") y OWNER_PATCH_TRADES_MODE_2026-09-25.md §4
// (puente 2025-08-12..2026-07-28, "mitad cronológica de calibración y mitad de
// evaluación").
//
// Sólo transforma días y horas a instantes UTC. No lee precios ni trades.

import { SLOT_LABELS } from "./constants.mjs";

const BERLIN_TIME_ZONE = "Europe/Berlin";

const berlinFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: BERLIN_TIME_ZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function berlinWallClockOf(epochMs) {
  const parts = {};
  for (const part of berlinFormat.formatToParts(new Date(epochMs))) {
    parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

// Desfase de Europe/Berlin respecto de UTC, en minutos, en ese instante.
export function berlinOffsetMinutes(epochMs) {
  const wall = berlinWallClockOf(epochMs);
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return Math.round((wallAsUtc - epochMs) / 60000);
}

// Instante UTC de una hora de pared de Berlin en un día ISO. Dos pasadas para
// resolver el cambio de horario: los slots 08:00-17:30 nunca caen en la
// transición (02:00-03:00), pero la segunda pasada lo cubre igual.
export function berlinWallClockToEpochMs(dayIso, hhmm) {
  const [year, month, day] = String(dayIso).split("-").map(Number);
  const [hour, minute] = String(hhmm).split(":").map(Number);
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstOffset = berlinOffsetMinutes(naiveUtc);
  const candidate = naiveUtc - firstOffset * 60000;
  const secondOffset = berlinOffsetMinutes(candidate);
  return secondOffset === firstOffset ? candidate : naiveUtc - secondOffset * 60000;
}

export function slotEpochMs(dayIso, slotLabel) {
  return berlinWallClockToEpochMs(dayIso, slotLabel);
}

// Etiqueta de slot Berlin (HH:MM) del instante. Sirve para comprobar que una
// frontera de decisión cae en la grilla declarada: el forward exige que TOB y
// TRADES decidan en el MISMO instante (TR-08; patch 03 §3.2), no en dos slots
// distintos por un default.
export function berlinSlotLabelOf(epochMs) {
  const wall = berlinWallClockOf(epochMs);
  return `${String(wall.hour).padStart(2, "0")}:${String(wall.minute).padStart(2, "0")}`;
}

// Instantes UTC de los 20 slots del día, en orden.
export function slotEpochsForDay(dayIso) {
  return SLOT_LABELS.map((label) => slotEpochMs(dayIso, label));
}

export function dayEpochMs(dayIso) {
  return Date.parse(`${dayIso}T00:00:00Z`);
}

export function isoDateOfEpochMs(epochMs) {
  return new Date(epochMs).toISOString().slice(0, 10);
}

// Mitad cronológica del puente: CALIBRATION = primera mitad, EVALUATION =
// segunda. La división es por días de calendario, no por presencia de datos
// (patch 03 §3.4). Declarada y reproducible.
export function bridgeHalves({ startIso, endIso }) {
  const start = dayEpochMs(startIso);
  const end = dayEpochMs(endIso);
  const totalDays = Math.round((end - start) / 86400000) + 1;
  const calibrationDays = Math.floor(totalDays / 2);
  return {
    totalDays,
    calibrationDays,
    evaluationDays: totalDays - calibrationDays,
    calibrationEndIso: isoDateOfEpochMs(start + (calibrationDays - 1) * 86400000),
    evaluationStartIso: isoDateOfEpochMs(start + calibrationDays * 86400000),
  };
}

export function halfOfDate(dayIso, halves) {
  return dayIso <= halves.calibrationEndIso ? "CALIBRATION" : "EVALUATION";
}

export function isWithinWindow(dayIso, { startIso, endIso }) {
  return dayIso >= startIso && dayIso <= endIso;
}
