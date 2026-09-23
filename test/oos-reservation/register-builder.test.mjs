import { test } from "node:test";
import assert from "node:assert/strict";

import { buildEligibilityRegister, OOS_PRODUCT, OOS_MISSION } from "../../src/oos-reservation/register-builder.mjs";
import { reserveSealedOos, CHRONOLOGICAL_RESERVATION_BASIS } from "../../src/oos-reservation/reservation.mjs";
import { IMP09_SPEC_IDENTITY } from "../../src/oos-reservation/campaign-register.mjs";

// Prescripción audit IMP-09 (pasos 3 y 6): builder determinista del registro
// contiguo 2021Q1..asOf desde reglas cliente + P-006 + calendario oficial +
// evidencia EEX fijada; sin calendario → HOLD; cada evidencia es sintética y
// ligada por su SHA-256. Los tests no leen el lago.

function sha64(char) {
  return char.repeat(64);
}

// Calendario sintético: todos los días hábiles son Exchange Day. Es una
// fixture del builder (el calendario OFICIAL real se descarga por
// prescripción paso 2; los tests no acceden a la red ni al lago).
function syntheticExchangeDays({ from = "2020-01-01", to = "2026-12-31" } = {}) {
  const days = [];
  let cursor = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const end = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  while (cursor <= end) {
    const date = new Date(cursor);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      days.push(date.toISOString().slice(0, 10));
    }
    cursor += 24 * 60 * 60 * 1000;
  }
  return days;
}

function syntheticInput({ from, to, exclude } = {}) {
  const episodes = {};
  let cursor = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const end = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  while (cursor <= end) {
    const date = new Date(cursor).toISOString().slice(0, 10);
    const month = Number(date.slice(5, 7));
    const quarter = Math.ceil(month / 3);
    const maturity = `${date.slice(0, 4)}Q${quarter}`;
    if (exclude !== maturity) {
      episodes[maturity] = { tradedInWindow: true, tobCovered: true, windowDaysMissingTob: [] };
    }
    // Salta al primer día del mes siguiente (episodio por maturity).
    cursor = Date.UTC(Number(date.slice(0, 4)), month, 1);
  }
  return {
    sourceHashes: {
      clientPackageCampaignRules: "a".repeat(64),
      eexEvidence: "c".repeat(64),
    },
    p006: { sha256: "b".repeat(64) },
    evidenceSha256: "c".repeat(64),
    asOfIso: to,
    exchangeCalendar: { sourceUrl: "https://synthetic.example/eex-calendar", retrievedAtUtc: "2026-09-23T22:00:00Z", sha256: "d".repeat(64), exchangeDays: syntheticExchangeDays() },
    evidence: { snapshot: { identity: "SYNTHETIC snapshot", sha256: "e".repeat(64) }, episodes },
  };
}

test("con evidencia sintética completa deriva un registro contiguo de episodios ELIGIBLE+COMPLETE", () => {
  const input = syntheticInput({ from: "2021-01-01", to: "2023-08-31" });
  const outcome = buildEligibilityRegister(input);
  assert.equal(outcome.ok, true, JSON.stringify(outcome.errors));
  assert.equal(outcome.register.length, 11);
  assert.equal(outcome.register[0].maturity, "2021Q1");
  assert.equal(outcome.register.at(-1).maturity, "2023Q3");
  assert.ok(outcome.register.every((episode) => episode.eligibility === "ELIGIBLE"));
  assert.ok(outcome.register.every((episode) => episode.completeness === "COMPLETE"));
  assert.ok(outcome.register.every((episode) => episode.campaignId.startsWith("GAS-Q-")));
  assert.ok(outcome.register.every((episode) => episode.deadline !== null));
  assert.ok(outcome.registerHash.length === 64);
});

test("la derivaciónvable reproducible: mismo input → mismo registro hash", () => {
  const input = syntheticInput({ from: "2021-01-01", to: "2023-08-31" });
  const first = buildEligibilityRegister(input);
  const second = buildEligibilityRegister(input);
  assert.equal(first.registerHash, second.registerHash);
});

test("el registro derivado alimenta la reserva: RESERVED con 8 episodios en ≥2 años", () => {
  const built = buildEligibilityRegister(syntheticInput({ from: "2021-01-01", to: "2023-08-31" }));
  const reservation = reserveSealedOos({
    campaigns: built.register,
    reservationBasis: CHRONOLOGICAL_RESERVATION_BASIS,
    spec: IMP09_SPEC_IDENTITY,
    reservationBinding: { cutoffIso: "2023-08-31", sourceHashes: { clientPackageCampaignRules: "a".repeat(64), eexEvidence: "c".repeat(64), exchangeCalendar: "d".repeat(64) } },
  });
  assert.equal(reservation.decision, "RESERVED");
  assert.equal(reservation.sealedOosCount, 8);
  assert.ok(reservation.span.coversMinYears);
});

test("sin calendario oficial el builder no deriva nada (HOLD, prescripción paso 2)", () => {
  const input = syntheticInput({ from: "2021-01-01", to: "2023-08-31" });
  delete input.exchangeCalendar;
  const outcome = buildEligibilityRegister(input);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((error) => error.code === "MISSING_EXCHANGE_CALENDAR"));
  assert.deepEqual(outcome.register, []);
});

test("un quarter omitido en la evidencia rompe la contigüidad (no se rellena)", () => {
  const input = syntheticInput({ from: "2021-01-01", to: "2023-08-31", exclude: "2022Q2" });
  const outcome = buildEligibilityRegister(input);
  assert.equal(outcome.ok, true);
  const hole = outcome.register.find((episode) => episode.maturity === "2022Q2");
  assert.notEqual(hole, undefined);
  assert.equal(hole.eligibility, "INELIGIBLE");
  const reservation = reserveSealedOos({
    campaigns: outcome.register,
    reservationBasis: CHRONOLOGICAL_RESERVATION_BASIS,
    spec: IMP09_SPEC_IDENTITY,
    reservationBinding: { cutoffIso: "2023-08-31", sourceHashes: { eexEvidence: "c".repeat(64), exchangeCalendar: "d".repeat(64) } },
  });
  assert.equal(reservation.decision, "HOLD");
  assert.ok(reservation.errors.some((error) => error.code === "NON_CONTIGUOUS_ELIGIBLE_SEQUENCE"));
});

test("la evidencia sin TOB ‑11:00 completo deja el episodio INCOMPLETE", () => {
  const input = syntheticInput({ from: "2021-01-01", to: "2023-08-31" });
  input.evidence.episodes["2023Q2"].tobCovered = false;
  input.evidence.episodes["2023Q2"].windowDaysMissingTob = ["2023-05-30"];
  const outcome = buildEligibilityRegister(input);
  const episode = outcome.register.find((item) => item.maturity === "2023Q2");
  assert.equal(episode.completeness, "INCOMPLETE");
  assert.deepEqual(episode.missingTobDays, ["2023-05-30"]);
});

test("identity de producto/Mission y DELISTING por trienio (año 2021)", () => {
  const built = buildEligibilityRegister(syntheticInput({ from: "2021-01-01", to: "2022-12-31" }));
  assert.ok(built.register.every((episode) => episode.product === OOS_PRODUCT && episode.mission === OOS_MISSION));
  assert.equal(built.register[0].campaignId, `GAS-Q-2021Q1`);
});

test("sin fuente ni P-006 ni evidencia no deriva el registro (fail-closed)", () => {
  const outcome = buildEligibilityRegister({});
  assert.equal(outcome.ok, false);
  for (const code of ["MISSING_SOURCE_HASHES", "MISSING_P006_SOURCE", "MISSING_CUTOFF_DATE", "MISSING_EEX_EVIDENCE", "MISSING_EXCHANGE_CALENDAR", "EEX_EVIDENCE_WITHOUT_SNAPSHOT"]) {
    assert.ok(outcome.errors.some((error) => error.code === code), code);
  }
});
