// Fixtures SINTÉTICOS de la sesión Shadow (IMP-18). No son datos prospectivos
// reales del cliente: ejercitan la ingeniería de captura sobre el manifest
// congelado del experimento P5. El carácter sintético queda declarado en la
// sesión y en el receipt; no cierra DEP-22 (precedente IMP-08/15, §25.2).
//
// Mecánica (4 fronteras, obligación 12 MW, lote 1, cap diario 12):
//   A1 (versión fija): BUY en D1, WAIT en el spike de D2, BUY en D3 y D4.
//   Baseline A0: BUY calendar en D1..D4 → divergencia ACCIÓN en D2.
//   La trayectoria posterior se alimenta por frontera posterior.

import { buildExperimentFixture } from "../p5-experiment/fixtures.mjs";
import { freezeP5Experiment } from "../../src/p5-experiment/index.mjs";

// Manifest P5 congelado del experimento, versión fija del brazo A1.
export function frozenShadowFixture() {
  const fx = buildExperimentFixture({});
  const frozen = freezeP5Experiment(fx.freezeInput);
  if (!frozen.ok) {
    throw new Error(`el manifest P5 del fixture no se congela: ${JSON.stringify(frozen.failures ?? frozen)}`);
  }
  return { fx, frozen: frozen.frozen };
}

// Pasos posteriores sintéticos: tras cada decisión llega la observación del
// día siguiente (31 horas después, ya sabemos el path posterior del día).
const POSTERIOR_BEST_ASKS = {
  "2021-06-22": { timestamp: "2021-06-22T17:00:00Z", bestAsk: 39.8 },
  "2021-06-23": { timestamp: "2021-06-23T17:00:00Z", bestAsk: 51.5 },
  "2021-06-24": { timestamp: "2021-06-24T17:00:00Z", bestAsk: 39.7 },
};

export function posteriorObservationsFor(frontierDate) {
  return POSTERIOR_BEST_ASKS[frontierDate] ? [POSTERIOR_BEST_ASKS[frontierDate]] : [];
}

// La ventana sightable en cada frontera: sólo observaciones que YA LLEGARON
// (timestamp <= upToUtc). El caller prospectivo pasa la ventana real; la
// captura la audita known-at y aborta ante fugas (KNOWN_AT_VIOLATION).
export function sightableObservationsFor({ frozen, upToUtc }) {
  const upToMs = Date.parse(upToUtc);
  if (!Number.isFinite(upToMs)) {
    throw new Error("upToUtc no es un instante parseable");
  }
  return (frozen.frozenBundles.a1.priceObservations ?? [])
    .filter((observation) => Date.parse(observation.timestamp) <= upToMs);
}

// Fixture de closes diarios del benchmark (disponible al cierre).
export function benchmarkDailyClosesFixture({ overridden = {} } = {}) {
  return [
    { date: "2021-06-22", close: 40 },
    { date: "2021-06-23", close: 45 },
    { date: "2021-06-24", close: 40 },
    { date: "2021-06-25", close: 40.2 },
    ...Object.entries(overridden).map(([date, close]) => ({ date, close })),
  ];
}
