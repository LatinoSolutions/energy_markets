// BT-06 (PLAN_STATUS, owner request 2026-09-26): registro de misiones del backtest
// exploratorio TOB. Parametriza mercado/producto/cadencia/target para que el loader
// y el runner de la ruta versionada nueva (operations/exploratory/v3/) no tengan el
// gas fijo como el v2.
//
// `engineProduct` es el código que usan las funciones puras ya aceptadas de
// src/exploratory/backtest.mjs (`episodeTradingDays`) y comparison.mjs
// (`deliveryHours`): esas funciones sólo ramifican por producto para elegir el
// calendario 3-1-3 vs 1-0-1 y el número de meses de entrega (3 vs 1). Power DE
// usa las mismas reglas que Gas, así que su código real mapea al código aceptado
// que selecciona la misma rama. Así el v3 reusa el mismo motor sin duplicar la
// regla de calendario ni la de horas de entrega.
export const CADENCE = Object.freeze({ QUARTERLY: "QUARTERLY", MONTHLY: "MONTHLY" });

export const EXPLORATORY_MISSIONS = Object.freeze({
  GAS_QUARTERLY: Object.freeze({
    missionId: "GAS_QUARTERLY",
    market: "GAS_THE",
    cmdty: "NATGAS",
    area: "THE",
    product: "G0BQ",
    cadence: CADENCE.QUARTERLY,
    targetMw: 60,
    engineProduct: "G0BQ",
    calendarPath: "operations/audit/IMP-09/eex-exchange-calendar.json",
    calendarManifest: null,
  }),
  GAS_MONTHLY: Object.freeze({
    missionId: "GAS_MONTHLY",
    market: "GAS_THE",
    cmdty: "NATGAS",
    area: "THE",
    product: "G0BM",
    cadence: CADENCE.MONTHLY,
    targetMw: 10,
    engineProduct: "G0BM",
    calendarPath: "operations/audit/IMP-09/eex-exchange-calendar.json",
    calendarManifest: null,
  }),
  POWER_QUARTERLY: Object.freeze({
    missionId: "POWER_QUARTERLY",
    market: "POWER_DE",
    cmdty: "POWER",
    area: "DE",
    product: "DEBQ",
    cadence: CADENCE.QUARTERLY,
    targetMw: 10,
    engineProduct: "G0BQ",
    calendarPath: "operations/trades/TR-01/power-de-exchange-calendar.json",
    calendarManifest: "operations/trades/TR-01/power-de-exchange-calendar.MANIFEST.json",
  }),
  POWER_MONTHLY: Object.freeze({
    missionId: "POWER_MONTHLY",
    market: "POWER_DE",
    cmdty: "POWER",
    area: "DE",
    product: "DEBM",
    cadence: CADENCE.MONTHLY,
    targetMw: 10,
    engineProduct: "G0BM",
    calendarPath: "operations/trades/TR-01/power-de-exchange-calendar.json",
    calendarManifest: "operations/trades/TR-01/power-de-exchange-calendar.MANIFEST.json",
  }),
});

// La ruta v3 del release exploratorio de Power. Sus artefactos los produce el job
// de extracción+backtest (DATA-01) con el runner de esta misma ruta; hasta que ese
// job corra, no existen y la UI los declara ausentes (fail-closed, nunca un valor).
export const POWER_MISSION_IDS = Object.freeze(["POWER_QUARTERLY", "POWER_MONTHLY"]);

export const POWER_EXPLORATORY_RELEASE = Object.freeze({
  release: "v3",
  manifestKind: "EXPLORATORY_BACKTEST_MANIFEST",
  resultsKind: "EXPLORATORY_BACKTEST_RESULTS",
  manifest: "operations/exploratory/v3/MANIFEST.json",
  results: "operations/exploratory/v3/backtest-results.json",
  slots: "operations/exploratory/v3/tob-slots-power.json",
  generator: "operations/exploratory/v3/run-exploratory-backtest.mjs",
});

export function missionById(missionId) {
  return EXPLORATORY_MISSIONS[missionId] ?? null;
}

export function missionsByIds(missionIds) {
  const missions = [];
  for (const missionId of missionIds ?? []) {
    const mission = missionById(missionId);
    if (mission === null) {
      throw new Error(`misión desconocida: ${missionId}`);
    }
    missions.push(mission);
  }
  return missions;
}
