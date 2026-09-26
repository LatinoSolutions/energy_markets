import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  EVIDENCE_HORIZON_END,
  TRADES_PATCH_IDENTITY,
  ZONE_BOUNDARIES,
  ZONES,
  assignZone,
  evaluateTradesZonesAcceptance,
  recordTradesOosAccess,
  registerTobSeenEpisodes,
  reserveTradesZones,
} from "../../src/oos-reservation/trades-zones.mjs";
import { reserveSealedOos, reserveGasQuarterlySealedOos, recordOosAccess } from "../../src/oos-reservation/reservation.mjs";
import { validReservationInput } from "./fixtures.mjs";
import { materializeTradesWindows } from "../../src/oos-reservation/trades-windows.mjs";

function dailyCalendar(startIso, endIso) {
  const days = [];
  const cursor = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

const CALENDAR = dailyCalendar("2020-01-01", "2026-12-31");

const BINDING = {
  cutoffIso: EVIDENCE_HORIZON_END,
  sourceHashes: {
    gasExchangeCalendar: "1".repeat(64),
    powerExchangeCalendar: "2".repeat(64),
    clientCampaignRules: "3".repeat(64),
    tradesSourceDecision: "4".repeat(64),
    tobExploratoryResults: "5".repeat(64),
  },
};

function validInput(overrides = {}) {
  return {
    reservationId: "TRADES-ZONES-SYN-1",
    gasExchangeDays: CALENDAR,
    powerExchangeDays: CALENDAR,
    coverageRecords: [],
    horizonEndIso: EVIDENCE_HORIZON_END,
    reservationBinding: BINDING,
    ...overrides,
  };
}

test("asigna zonas por ventana y purga las que cruzan el embargo (patch 03 §4)", () => {
  assert.equal(assignZone({ windowStart: "2024-03-01", deadline: "2024-05-31" }), ZONES.DEVELOPMENT);
  assert.equal(assignZone({ windowStart: "2024-06-01", deadline: "2024-08-31" }), ZONES.OOS_HISTORICO);
  assert.equal(assignZone({ windowStart: "2025-03-01", deadline: "2025-05-31" }), ZONES.OOS_HISTORICO);
  assert.equal(assignZone({ windowStart: "2025-06-01", deadline: "2025-08-31" }), ZONES.PURGE);
  assert.equal(assignZone({ windowStart: "2025-09-01", deadline: "2025-11-30" }), ZONES.PUENTE);
  assert.equal(assignZone({ windowStart: "2026-06-01", deadline: "2026-08-31" }), ZONES.POST_PUENTE);
  assert.equal(assignZone({ windowStart: "2026-07-01", deadline: "2026-07-30" }), ZONES.POST_PUENTE);
  assert.equal(assignZone({ windowStart: "2024-05-15", deadline: "2024-07-15" }), null);
});

test("reserva TRADES: 4 misiones por separado con las zonas de §4", () => {
  const plan = reserveTradesZones(validInput());
  assert.equal(plan.decision, "RESERVED");
  assert.equal(plan.blockedBy.length, 0);
  assert.equal(plan.schemaVersion, "TRADES_ZONES_V1");
  assert.equal(plan.spec.version, "EM-SPEC-OWNER-PATCH-2026-09-25-03");
  assert.equal(plan.forward.status, "OPEN_PENDING_FREEZE");
  assert.equal(plan.forward.fromIso, null);
  assert.equal(plan.accessRegistry.oosStatus, "SEALED");
  assert.equal(typeof plan.contentHash, "string");
  assert.equal(plan.contentHash.length, 64);

  const gasQ = plan.missions.GAS_QUARTERLY.zones;
  assert.deepEqual(gasQ[ZONES.OOS_HISTORICO].map((campaign) => campaign.campaignId), [
    "GAS-Q-2024Q4", "GAS-Q-2025Q1", "GAS-Q-2025Q2", "GAS-Q-2025Q3",
  ]);
  assert.deepEqual(gasQ[ZONES.DEVELOPMENT].map((campaign) => campaign.campaignId).slice(0, 2), ["GAS-Q-2021Q2", "GAS-Q-2021Q3"]);
  assert.deepEqual(gasQ[ZONES.PUENTE].map((campaign) => campaign.campaignId), ["GAS-Q-2026Q1", "GAS-Q-2026Q2", "GAS-Q-2026Q3"]);
  assert.deepEqual(gasQ[ZONES.POST_PUENTE].map((campaign) => campaign.campaignId), ["GAS-Q-2026Q4"]);
  assert.equal(gasQ[ZONES.EMBARGO].length, 0);

  const gasM = plan.missions.GAS_MONTHLY.zones;
  assert.equal(gasM[ZONES.OOS_HISTORICO].length, 12);
  assert.equal(gasM[ZONES.OOS_HISTORICO][0].campaignId, "GAS-M-2024-07");
  assert.equal(gasM[ZONES.OOS_HISTORICO].at(-1).campaignId, "GAS-M-2025-06");
  assert.deepEqual(gasM[ZONES.POST_PUENTE].map((campaign) => campaign.campaignId), ["GAS-M-2026-08", "GAS-M-2026-09"]);

  // Power entra completa, con las mismas entregas que Gas (patch 03 §4/§6).
  assert.deepEqual(plan.missions.POWER_QUARTERLY.zones[ZONES.OOS_HISTORICO].map((campaign) => campaign.campaignId), [
    "POW-Q-2024Q4", "POW-Q-2025Q1", "POW-Q-2025Q2", "POW-Q-2025Q3",
  ]);
  assert.equal(plan.missions.POWER_MONTHLY.zones[ZONES.OOS_HISTORICO].length, 12);

  // Purge declarado: GAS-Q-2025Q4 y las Monthly de entrega 2025-07/08/09.
  assert.deepEqual(plan.purge.map((entry) => entry.campaignId), [
    "GAS-Q-2025Q4",
    "GAS-M-2025-07", "GAS-M-2025-08", "GAS-M-2025-09",
    "POW-Q-2025Q4",
    "POW-M-2025-07", "POW-M-2025-08", "POW-M-2025-09",
  ]);
});

test("la cobertura de TR-01 queda visible por campaign sin sustituir campaigns", () => {
  const plan = reserveTradesZones(validInput({
    coverageRecords: [
      { cmdty: "NATGAS", area: "THE", shortCode: "G0BQ", maturity: "202410", trdDate: "2024-06-03", eligibleCount: 5, volumeSum: 15 },
    ],
  }));
  const oos = plan.missions.GAS_QUARTERLY.zones[ZONES.OOS_HISTORICO];
  const covered = oos.find((campaign) => campaign.campaignId === "GAS-Q-2024Q4");
  assert.equal(covered.coverage.status, "OBSERVED");
  assert.equal(covered.coverage.daysWithTrades, 1);
  // Las campaigns sin cobertura siguen listadas.
  assert.equal(oos.length, 4);
  assert.ok(oos.some((campaign) => campaign.coverage.status === "NO_COVERAGE"));
});

test("registra los episodios ya vistos por el backtest TOB exploratorio (puente)", () => {
  const tobCampaigns = [
    { product: "G0BQ", maturity: "202601" },
    { product: "G0BQ", maturity: "202604" },
    { product: "G0BQ", maturity: "202610" },
    { product: "G0BM", maturity: "202510" },
    { product: "G0BM", maturity: "202608" },
  ];
  const { seenCampaignIds, unmapped } = registerTobSeenEpisodes({ tobCampaigns });
  assert.deepEqual(seenCampaignIds, ["GAS-M-2025-10", "GAS-M-2026-08", "GAS-Q-2026Q1", "GAS-Q-2026Q2", "GAS-Q-2026Q4"]);
  assert.deepEqual(unmapped, []);

  const plan = reserveTradesZones(validInput({ tobSeenCampaignIds: seenCampaignIds }));
  assert.deepEqual(plan.bridge.seenCampaignIds, ["GAS-M-2025-10", "GAS-Q-2026Q1", "GAS-Q-2026Q2"]);
  assert.deepEqual(plan.bridge.notSeenCampaignIds, [
    "GAS-M-2025-11", "GAS-M-2025-12", "GAS-M-2026-01", "GAS-M-2026-02", "GAS-M-2026-03",
    "GAS-M-2026-04", "GAS-M-2026-05", "GAS-M-2026-06", "GAS-M-2026-07",
    "GAS-Q-2026Q3",
    "POW-M-2025-10", "POW-M-2025-11", "POW-M-2025-12", "POW-M-2026-01", "POW-M-2026-02",
    "POW-M-2026-03", "POW-M-2026-04", "POW-M-2026-05", "POW-M-2026-06", "POW-M-2026-07",
    "POW-Q-2026Q1", "POW-Q-2026Q2", "POW-Q-2026Q3",
  ]);
  // El puente nunca se presenta como OOS: los conjuntos son disjuntos. En este
  // fixture las únicas vistos son del puente (las de post-puente/purge tienen su
  // propio test), por eso el OOS queda sin marca.
  const oosIds = new Set(plan.missions.GAS_QUARTERLY.zones[ZONES.OOS_HISTORICO].map((campaign) => campaign.campaignId));
  for (const campaign of plan.missions.GAS_QUARTERLY.zones[ZONES.PUENTE]) {
    assert.equal(oosIds.has(campaign.campaignId), false);
  }
  assert.ok(plan.missions.GAS_QUARTERLY.zones[ZONES.PUENTE].some((campaign) => campaign.tobSeen === true));
  assert.ok(plan.missions.GAS_QUARTERLY.zones[ZONES.OOS_HISTORICO].every((campaign) => campaign.tobSeen === undefined));
});

test("los episodios vistos por TOB se registran en cualquier zona (post-puente y purge)", () => {
  const seenCampaignIds = [
    "GAS-Q-2026Q4", "GAS-M-2026-08", // post-puente: ya vistos por TOB v2
    "GAS-Q-2025Q4", "GAS-M-2025-09", // purge: ya vistos por TOB v2
    "GAS-Q-2026Q1", // puente
    "GAS-M-2026-10", // visto pero fuera del horizonte: no materializado
  ];
  const plan = reserveTradesZones(validInput({ tobSeenCampaignIds: seenCampaignIds }));
  assert.equal(plan.decision, "RESERVED");

  const postQ = plan.missions.GAS_QUARTERLY.zones[ZONES.POST_PUENTE].find((campaign) => campaign.campaignId === "GAS-Q-2026Q4");
  assert.equal(postQ.tobSeen, true);
  const postM = plan.missions.GAS_MONTHLY.zones[ZONES.POST_PUENTE].find((campaign) => campaign.campaignId === "GAS-M-2026-08");
  assert.equal(postM.tobSeen, true);

  const purgeQ = plan.purge.find((entry) => entry.campaignId === "GAS-Q-2025Q4");
  assert.equal(purgeQ.tobSeen, true);
  const purgeM = plan.purge.find((entry) => entry.campaignId === "GAS-M-2025-09");
  assert.equal(purgeM.tobSeen, true);

  // El registro global no pierde ninguna id vista y materializada; las vistas
  // fuera del horizonte se declaran como no materializadas, no se inventan.
  assert.deepEqual(plan.tobSeen.materializedCampaignIds, [
    "GAS-M-2025-09", "GAS-M-2026-08", "GAS-Q-2025Q4", "GAS-Q-2026Q1", "GAS-Q-2026Q4",
  ]);
  assert.deepEqual(plan.tobSeen.unmatchedCampaignIds, ["GAS-M-2026-10"]);

  // Las campaigns no vistas siguen sin marca, incluido el OOS y Power.
  assert.ok(plan.missions.POWER_QUARTERLY.zones[ZONES.POST_PUENTE].every((campaign) => campaign.tobSeen === undefined));
  assert.ok(plan.missions.GAS_QUARTERLY.zones[ZONES.OOS_HISTORICO].every((campaign) => campaign.tobSeen === undefined));
});

test("acceso TRADES al OOS: un run_id nuevo es una nueva apertura y se cuenta por misión", () => {
  const plan = reserveTradesZones(validInput());
  const first = recordTradesOosAccess(plan, { atUtc: "2026-09-25T10:00:00Z", actor: "run", purpose: "TRADES_OOS_OPENING", mission: "GAS_QUARTERLY", runId: "run-1" });
  assert.equal(first.ok, true);
  assert.equal(first.record.runId, "run-1");
  assert.equal(first.record.mission, "GAS_QUARTERLY");
  assert.equal(first.reservation.accessRegistry.oosStatus, "CONSUMED");
  assert.equal(first.oosOpenings, 1);
  assert.equal(first.oosOpeningsByMission.GAS_QUARTERLY, 1);

  const second = recordTradesOosAccess(first.reservation, { atUtc: "2026-09-25T11:00:00Z", actor: "run", purpose: "TRADES_OOS_OPENING", mission: "GAS_QUARTERLY", runId: "run-2" });
  assert.equal(second.oosOpenings, 2);
  // Repetir el mismo run_id no cuenta una apertura nueva ni añade una entrada
  // (idempotencia append-only: relanzar el productor no infla el registro).
  const repeat = recordTradesOosAccess(second.reservation, { atUtc: "2026-09-25T12:00:00Z", actor: "run", purpose: "TRADES_OOS_OPENING", mission: "GAS_QUARTERLY", runId: "run-1" });
  assert.equal(repeat.oosOpenings, 2);
  assert.equal(repeat.reservation.accessRegistry.entries.length, second.reservation.accessRegistry.entries.length);

  // La inspección sellada no consume; un propósito IMP-09 no es un acceso TRADES.
  const inspection = recordTradesOosAccess(plan, { atUtc: "2026-09-25T13:00:00Z", purpose: "TRADES_OOS_INSPECTION", mission: "GAS_QUARTERLY" });
  assert.equal(inspection.reservation.accessRegistry.oosStatus, "SEALED");
  assert.equal(recordTradesOosAccess(plan, { atUtc: "2026-09-25T13:00:00Z", purpose: "CALIBRATION", mission: "GAS_QUARTERLY" }).code, "NOT_A_TRADES_ACCESS_PURPOSE");
});

test("una apertura del OOS exige run_id y misión, y el OOS se consume por misión", () => {
  const plan = reserveTradesZones(validInput());

  // Sin run_id no hay apertura: no se consume el OOS ni se cuenta.
  const noRunId = recordTradesOosAccess(plan, { atUtc: "2026-09-25T10:00:00Z", purpose: "TRADES_OOS_OPENING", mission: "GAS_QUARTERLY" });
  assert.equal(noRunId.ok, false);
  assert.equal(noRunId.code, "MISSING_RUN_ID");
  assert.equal(plan.accessRegistry.oosStatus, "SEALED");

  // Sin misión válida tampoco.
  const noMission = recordTradesOosAccess(plan, { atUtc: "2026-09-25T10:00:00Z", purpose: "TRADES_OOS_OPENING", runId: "run-1" });
  assert.equal(noMission.ok, false);
  assert.equal(noMission.code, "MISSING_TRADES_MISSION");
  assert.equal(recordTradesOosAccess(plan, { atUtc: "2026-09-25T10:00:00Z", purpose: "TRADES_OOS_OPENING", mission: "MADE_UP", runId: "run-1" }).code, "MISSING_TRADES_MISSION");

  // Abrir Gas Quarterly NO consume Power Monthly (cada misión por separado).
  const opened = recordTradesOosAccess(plan, { atUtc: "2026-09-25T10:00:00Z", purpose: "TRADES_OOS_OPENING", mission: "GAS_QUARTERLY", runId: "run-gas-q" });
  assert.equal(opened.ok, true);
  assert.equal(opened.reservation.accessRegistry.oosStatus, "CONSUMED");
  assert.equal(opened.reservation.accessRegistry.oosStatusByMission.GAS_QUARTERLY, "CONSUMED");
  assert.equal(opened.reservation.accessRegistry.oosStatusByMission.POWER_MONTHLY, "SEALED");
  assert.equal(opened.reservation.accessRegistry.oosStatusByMission.POWER_QUARTERLY, "SEALED");
  assert.equal(opened.oosOpeningsByMission.POWER_MONTHLY, 0);
});

test("una reserva IMP-09 sellada no acepta propósitos de acceso TRADES", () => {
  const plan = reserveTradesZones(validInput());
  const imp09 = reserveSealedOos(validReservationInput());
  assert.equal(imp09.decision, "RESERVED");
  // La tabla IMP-09 no declara TRADES_OOS_OPENING: se rechaza sin consumir.
  const outcome = recordOosAccess(imp09, { atUtc: "2026-09-25T10:00:00Z", purpose: "TRADES_OOS_OPENING", runId: "run-1" });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "UNKNOWN_ACCESS_PURPOSE");
  assert.equal(imp09.accessRegistry.oosStatus, "SEALED");

  // La otra mitad: un plan TRADES no puede consumirse con la tabla IMP-09. Si se
  // aceptara, el estado global quedaría CONSUMED sin misión y el sello por
  // misión seguiría diciendo SEALED (fallo abierto del sello por misión).
  const misused = recordOosAccess(plan, { atUtc: "2026-09-25T10:00:00Z", purpose: "CALIBRATION", runId: "r1" });
  assert.equal(misused.ok, false);
  assert.equal(misused.code, "ACCESS_PURPOSE_ARTIFACT_MISMATCH");
  assert.equal(plan.accessRegistry.oosStatus, "SEALED");
  assert.equal(plan.accessRegistry.oosStatusByMission.GAS_QUARTERLY, "SEALED");
});

test("un consumo sin misión cuenta como consumo de las 4 misiones (fail-closed)", () => {
  const plan = reserveTradesZones(validInput());
  // Entrada no atribuible a misión (p. ej. de un registro legado): el sello por
  // misión no puede quedarse en SEALED con el OOS consumido.
  const contaminated = {
    ...plan,
    accessRegistry: {
      ...plan.accessRegistry,
      entries: [{ consumesOos: true, purpose: "PARAMETER_SELECTION", runId: "legacy-run" }],
    },
  };
  const outcome = recordTradesOosAccess(contaminated, { atUtc: "2026-09-25T11:00:00Z", purpose: "TRADES_OOS_INSPECTION", mission: "GAS_QUARTERLY" });
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.oosStatusByMission, {
    GAS_QUARTERLY: "CONSUMED", GAS_MONTHLY: "CONSUMED", POWER_QUARTERLY: "CONSUMED", POWER_MONTHLY: "CONSUMED",
  });
  assert.equal(outcome.oosOpeningsByMission.POWER_MONTHLY, 1);
});

test("falla cerrado sin binding, con spec ajena o sin calendario", () => {
  const noBinding = validInput();
  delete noBinding.reservationBinding;
  assert.equal(reserveTradesZones(noBinding).decision, "HOLD");
  assert.ok(reserveTradesZones(noBinding).blockedBy.includes("MISSING_RESERVATION_BINDING"));

  const wrongSpec = reserveTradesZones(validInput({ spec: { id: "OTHER.md", version: "9.9.9" } }));
  assert.equal(wrongSpec.decision, "HOLD");
  assert.ok(wrongSpec.blockedBy.includes("SPEC_IDENTITY_MISMATCH"));

  const noCalendar = reserveTradesZones(validInput({ gasExchangeDays: [] }));
  assert.equal(noCalendar.decision, "HOLD");
  assert.ok(noCalendar.blockedBy.includes("MISSING_EXCHANGE_CALENDAR"));
});

test("el binding de la norma TRADES no queda stale (sha256 del owner patch 03)", () => {
  const bytes = readFileSync(TRADES_PATCH_IDENTITY.path);
  const actual = createHash("sha256").update(bytes).digest("hex");
  assert.equal(actual, TRADES_PATCH_IDENTITY.sha256);
});

test("la reserva IMP-09 y su HOLD quedan intactas", () => {
  // Regresión de frontera: la función nueva no toca reserveSealedOos.
  const held = reserveGasQuarterlySealedOos();
  assert.equal(held.decision, "HOLD");
  assert.deepEqual(held.blockedBy, ["INSUFFICIENT_ELIGIBLE_COMPLETE_CAMPAIGNS"]);
  assert.deepEqual(reserveSealedOos({ campaigns: [], reservationBasis: "CHRONOLOGICAL_ELIGIBLE" }).sealedOosCampaignIds, []);
});

test("evaluateTradesZonesAcceptance sólo acredita la reserva materializada", () => {
  assert.equal(evaluateTradesZonesAcceptance(reserveTradesZones(validInput())).criterionMet, true);
  const noBinding = validInput();
  delete noBinding.reservationBinding;
  assert.equal(evaluateTradesZonesAcceptance(reserveTradesZones(noBinding)).criterionMet, false);
});

test("materializeTradesWindows expone las 4 misiones (producer price-blind)", () => {
  const windows = materializeTradesWindows({ gasExchangeDays: CALENDAR, powerExchangeDays: CALENDAR, horizonEndIso: EVIDENCE_HORIZON_END });
  assert.equal(windows.ok, true);
  assert.deepEqual(Object.keys(windows.missions).sort(), ["GAS_MONTHLY", "GAS_QUARTERLY", "POWER_MONTHLY", "POWER_QUARTERLY"]);
});

test("las fronteras declaradas son las del patch 03 §4", () => {
  assert.equal(ZONE_BOUNDARIES.OOS_START, "2024-06-01");
  assert.equal(ZONE_BOUNDARIES.OOS_END, "2025-05-31");
  assert.equal(ZONE_BOUNDARIES.EMBARGO_START, "2025-06-01");
  assert.equal(ZONE_BOUNDARIES.BRIDGE_START, "2025-08-12");
  assert.equal(ZONE_BOUNDARIES.BRIDGE_END, "2026-07-28");
  assert.equal(ZONE_BOUNDARIES.POST_BRIDGE_START, "2026-07-29");
});

test("el artefacto TR-02 commiteado es coherente con su manifest y con §4", () => {
  const manifest = JSON.parse(readFileSync("operations/trades/TR-02/trades-zone-plan.MANIFEST.json", "utf8"));
  const sha256OfFile = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  // Todo binding de procedencia del manifest (plan, generador, módulos y fuentes)
  // debe apuntar al archivo que está en HEAD; una entrada stale rompe la trazabilidad.
  const boundEntries = [
    manifest.plan,
    manifest.generator,
    ...manifest.modules,
    ...Object.values(manifest.sources),
  ];
  for (const entry of boundEntries) {
    assert.equal(sha256OfFile(entry.path), entry.sha256, `${entry.path} no coincide con el sha256 del manifest`);
  }
  const planBytes = readFileSync(manifest.plan.path);
  const plan = JSON.parse(planBytes);
  assert.equal(plan.decision, "RESERVED");
  assert.equal(plan.schemaVersion, "TRADES_ZONES_V1");
  assert.deepEqual(plan.missions.GAS_QUARTERLY.zones[ZONES.OOS_HISTORICO].map((campaign) => campaign.campaignId), [
    "GAS-Q-2024Q4", "GAS-Q-2025Q1", "GAS-Q-2025Q2", "GAS-Q-2025Q3",
  ]);
  assert.deepEqual(plan.purge.map((entry) => entry.campaignId), [
    "GAS-Q-2025Q4",
    "GAS-M-2025-07", "GAS-M-2025-08", "GAS-M-2025-09",
    "POW-Q-2025Q4",
    "POW-M-2025-07", "POW-M-2025-08", "POW-M-2025-09",
  ]);
  assert.equal(plan.forward.status, "OPEN_PENDING_FREEZE");
  assert.equal(plan.coverageStatus.status, "PENDING_SCAN_JOB");
  // El plan real registra los episodios ya vistos por TOB en post-puente y purge.
  assert.deepEqual(plan.tobSeen.unmatchedCampaignIds, ["GAS-M-2026-10", "GAS-M-2026-11", "GAS-M-2026-12"]);
  assert.ok(plan.tobSeen.materializedCampaignIds.includes("GAS-Q-2026Q4"));
  assert.ok(plan.tobSeen.materializedCampaignIds.includes("GAS-M-2026-08"));
  assert.equal(plan.purge.find((entry) => entry.campaignId === "GAS-Q-2025Q4").tobSeen, true);
  assert.equal(plan.purge.find((entry) => entry.campaignId === "GAS-M-2025-09").tobSeen, true);
  // El estado del OOS es por misión (todas selladas al materializar).
  assert.deepEqual(plan.accessRegistry.oosStatusByMission, {
    GAS_QUARTERLY: "SEALED", GAS_MONTHLY: "SEALED", POWER_QUARTERLY: "SEALED", POWER_MONTHLY: "SEALED",
  });
});
