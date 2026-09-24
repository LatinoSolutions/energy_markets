// Tests ejecución intradía causal por hora Q07 (IMP-21).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createIntradaySnapshotRegistry,
  selectCausalSnapshot,
  runQ07HourArm,
  assertHourArmsParity,
} from "../../src/imp21-q07/index.mjs";
import {
  createSyntheticFrozenProtocol,
  createNondenerateFrozenProtocol,
  FIXTURE_SNAPSHOTS,
  EXPECTED_HARM_BY_HOUR_ID,
  mutateAndRefreeze,
} from "./fixtures.mjs";

const registry = createIntradaySnapshotRegistry("SYNTHETIC_FIXTURE_SOURCE", FIXTURE_SNAPSHOTS);

test("registro: snapshots duplicados de asOf se rechazan", () => {
  const bad = createIntradaySnapshotRegistry("SRC", [
    ...FIXTURE_SNAPSHOTS,
    { snapshotId: "dup", asOfUtc: FIXTURE_SNAPSHOTS[0].asOfUtc, priceEurPerMwh: 10 },
  ]);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "DUPLICATED_AS_OF_UTC");
});

test("causalidad: devuelve el último snapshot asOf <= decisión; el futuro no es consumible", () => {
  const causal = selectCausalSnapshot({ registry: registry.registry, decisionAtUtc: "2026-10-02T09:15:00Z" });
  assert.equal(causal.snapshot.snapshotId, "S1-1");
  const afterLunch = selectCausalSnapshot({ registry: registry.registry, decisionAtUtc: "2026-10-02T13:45:00Z" });
  assert.equal(afterLunch.snapshot.snapshotId, "S1-2");
  const beforeAny = selectCausalSnapshot({ registry: { snapshots: [] }, decisionAtUtc: "2026-10-02T08:00:00Z" });
  assert.equal(beforeAny.snapshot, null);
  assert.equal(beforeAny.code, "NO_CAUSAL_SNAPSHOT");
});

test("cada brazo de hora reproduce el H esperado calculado a mano (IMP-13: expected independiente)", () => {
  const frozen = createSyntheticFrozenProtocol();
  for (const hourId of Object.keys(EXPECTED_HARM_BY_HOUR_ID)) {
    const arm = runQ07HourArm({ frozen, hourId, snapshotRegistry: registry });
    const expected = EXPECTED_HARM_BY_HOUR_ID[hourId];
    if (!arm.ok) {
      throw new Error(`arm inválido ${hourId}: ${arm.code}`);
    }
    assert.equal(arm.H, expected.H, `H de ${hourId}`);
    assert.equal(arm.filledVolumeMw, expected.filledVolumeMw, `volumen de ${hourId}`);
    assert.equal(arm.coverageFraction, expected.coverageFraction);
    assert.equal(arm.fills.length, expected.fills);
  }
});

test("la secuencia de decisión es idéntica entre horas: cambia sólo el instante de fill (paridad)", () => {
  const frozen = createSyntheticFrozenProtocol();
  const arms = Object.keys(EXPECTED_HARM_BY_HOUR_ID).map((hourId) =>
    runQ07HourArm({ frozen, hourId, snapshotRegistry: registry }));
  const parity = assertHourArmsParity(arms);
  assert.equal(parity.ok, true, `paridad: ${parity.code}`);
  for (const arm of arms) {
    assert.equal(arm.decisionSequence.length, 5);
    assert.equal(arm.fills.length, 5);
    for (const fill of arm.fills) {
      assert.ok(fill.asOfUtc <= fill.decisionAtUtc, `fill causal (${fill.date} ${fill.hourId})`);
    }
  }
});

test("sin snapshot causal en la hora del candidato el fill se DENIEGA (no look-ahead al precio futuro)", () => {
  const frozen = mutateAndRefreeze(createSyntheticFrozenProtocol(), (protocol) => {
    protocol.candidates = [
      { hourId: "H_06_00", kind: "FIXED_HOUR_AND_MINUTES", hour: 6, minutes: 0 },
      { hourId: "H_22_00", kind: "FIXED_HOUR_AND_MINUTES", hour: 22, minutes: 0 },
    ];
    protocol.referenceHourId = null;
  });
  const emptyRegistry = createIntradaySnapshotRegistry("SRC_VACIO", []);
  const armAt6 = runQ07HourArm({ frozen, hourId: "H_06_00", snapshotRegistry: emptyRegistry });
  assert.equal(armAt6.ok, true);
  assert.equal(armAt6.fills.length, 0);
  assert.equal(armAt6.deniedFills.length, 5);
  for (const denied of armAt6.deniedFills) {
    assert.equal(denied.code, "FILL_DENIED_NO_CAUSAL_SNAPSHOT");
  }
  assert.equal(armAt6.filledVolumeMw, 0);
  // La obligación sigue viva: WAIT/no-compra no reduce remaining (§13.4).
  assert.equal(armAt6.coverageFraction, 0);
});

test("ventana dinámica: fill causal dentro de la ventana predeclarada; deny si no hay", () => {
  const frozen = mutateAndRefreeze(createSyntheticFrozenProtocol(), (protocol) => {
    protocol.candidates = [
      { hourId: "W_EARLY", kind: "DYNAMIC_WINDOW", windowStartHour: 9, windowEndHour: 11 },
      { hourId: "W_LATE", kind: "DYNAMIC_WINDOW", windowStartHour: 12, windowEndHour: 17 },
    ];
    protocol.referenceHourId = null;
  });
  const early = runQ07HourArm({ frozen, hourId: "W_EARLY", snapshotRegistry: registry });
  // Los snapshots 08:00 quedan fuera de la ventana 9..11: deny, no look-ahead.
  assert.equal(early.ok, true);
  assert.equal(early.fills.length, 0);
  assert.equal(early.deniedFills.length, 5);

  const late = runQ07HourArm({ frozen, hourId: "W_LATE", snapshotRegistry: registry });
  // El snapshot 12:00 cae en la ventana 12..17: 5 fills a precio de reloj.
  assert.equal(late.fills.length, 5);
  assert.equal(late.H, 2004);
  for (const fill of late.fills) {
    const hourPart = Number(fill.asOfUtc.slice(11, 13));
    assert.ok(hourPart >= 12 && hourPart <= 17, `fill dentro de ventana (${fill.date})`);
  }
});

test("paridad H4/H5: cobertura causal distinta entre horas no rompe la paridad de decisión, con plan no degenerado", () => {
  // W_EARLY no tiene snapshot en 9..11 (0 fills), W_LATE sí (3 fills): la
  // paridad debe ceñirse a la secuencia de decisión, no al resultado de fills.
  // Escenario NO degenerado (H6: lot=cap=12 forzaba 12 MW/día constante y
  // ocultaba el defecto): lote 1 MW (parámetro auditado, IMP-07) y cap que
  // no clipea; si la secuencia se re-derivara del remaining vivo (contaminado
  // por outcomes de fill), brazos con deny divergirían y el profile abortaría.
  const candidates = [
    { hourId: "W_EARLY", kind: "DYNAMIC_WINDOW", windowStartHour: 9, windowEndHour: 11 },
    { hourId: "W_LATE", kind: "DYNAMIC_WINDOW", windowStartHour: 12, windowEndHour: 17 },
  ];
  const frozen = createNondenerateFrozenProtocol(candidates);
  const arms = candidates.map((candidate) =>
    runQ07HourArm({ frozen, hourId: candidate.hourId, snapshotRegistry: registry }));
  assert.notEqual(arms[0].fills.length, arms[1].fills.length);
  // La secuencia de decisión es la del plan de calendario, compartida por los
  // dos brazos aunque su cobertura causal difiera (§25.1; §13.9 no rescue).
  const expected = [
    { date: "2026-10-02", action: "BUY", requestedQuantityMw: 33 },
    { date: "2026-10-09", action: "BUY", requestedQuantityMw: 33 },
    { date: "2026-10-16", action: "BUY", requestedQuantityMw: 34 },
  ];
  for (const arm of arms) {
    assert.deepEqual(arm.decisionSequence, expected);
  }
  // Cobertura causal distinta conservada: el fill denegado deja su volumen
  // como faltante (§25.1 IMP-12; §14.5), no re-agendado.
  assert.equal(arms[0].coverageFraction, 0);
  assert.equal(arms[1].coverageFraction, 1);
  const parity = assertHourArmsParity(arms);
  assert.equal(parity.ok, true, `paridad: ${parity.code}`);
});

test("anti-mutación H2: un brazo no corre sobre protocolo alterado post-freeze", () => {
  const frozen = createSyntheticFrozenProtocol();
  const attack = { ...frozen, minObservations: frozen.minObservations + 1 };
  const arm = runQ07HourArm({ frozen: attack, hourId: "H_09_15", snapshotRegistry: registry });
  assert.equal(arm.ok, false);
  assert.equal(arm.code, "PROTOCOL_HASH_MISMATCH");
});
