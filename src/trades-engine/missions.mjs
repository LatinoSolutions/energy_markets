// Misiones del motor TRADES (TR-05). Fuente normativa:
// docs/canonical/v1_1_1/OWNER_PATCH_TRADES_MODE_2026-09-25.md
// (EM-SPEC-OWNER-PATCH-2026-09-25-03) §6 ("las 4 misiones ... Gas Quarterly,
// Gas Monthly, Power Quarterly y Power Monthly entran completas"; "Power:
// producto base DEBQ, DEBM salvo decisión distinta de Bru"; volúmenes de patch
// 02 §1) y TRADES_MODE_PLAN.md TR-05 ("Productos y volúmenes por misión: Power
// no puede caer en la rama Monthly por defecto").
//
// Este módulo es PURO: declara identidad de misión, producto base y volumen
// objetivo. No lee precios, calendarios ni artifacts. La misión NO se deriva de
// un default de producto: cada clave declara su mercado, su producto y su
// target, de modo que Power Monthly nunca cae en la rama de Gas Monthly.

import { TRADES_MISSIONS } from "../oos-reservation/trades-windows.mjs";

export const TRADES_ENGINE_VERSION = "TRADES_ENGINE_V1";

// Volúmenes objetivo por misión (patch 03 §6 "Volúmenes: patch 02 §1 (Gas Q
// 60 MW, Power Q 10 MW, Gas M 10 MW, Power M 10 MW)").
export const TRADES_TARGET_MW = Object.freeze({
  GAS_QUARTERLY: 60,
  GAS_MONTHLY: 10,
  POWER_QUARTERLY: 10,
  POWER_MONTHLY: 10,
});

// Las 4 misiones del motor, con identidad completa. La lista de claves sale de
// `TRADES_MISSIONS` (fuente única de TR-02) para no duplicar identidad.
export const TRADES_ENGINE_MISSIONS = Object.freeze(Object.fromEntries(
  Object.entries(TRADES_MISSIONS).map(([missionKey, definition]) => [
    missionKey,
    Object.freeze({
      missionKey,
      product: definition.product,
      mission: definition.mission,
      market: definition.market,
      shortCode: definition.shortCode,
      targetMw: TRADES_TARGET_MW[missionKey],
    }),
  ]),
));

export function missionDefinition(missionKey) {
  const definition = TRADES_ENGINE_MISSIONS[missionKey] ?? null;
  if (definition === null) {
    return { ok: false, code: "UNKNOWN_MISSION", missionKey: missionKey ?? null, definition: null };
  }
  return { ok: true, code: null, missionKey, definition };
}

// Volumen objetivo de la misión; sin default silencioso (un target ausente no
// se sustituye por el de otra misión).
export function targetMwFor(missionKey) {
  const definition = TRADES_ENGINE_MISSIONS[missionKey];
  return definition ? definition.targetMw : null;
}

// Producto base -> misión. Sirve al loader generalizado (trades y TOB) para
// resolver la misión desde el `ShortCode` de una fila del lago, sin asumir el
// tenor por la forma del producto.
export function missionKeyForShortCode(shortCode) {
  const code = String(shortCode ?? "");
  for (const definition of Object.values(TRADES_ENGINE_MISSIONS)) {
    if (definition.shortCode === code) return definition.missionKey;
  }
  return null;
}

// Mapa `ShortCode|Maturity` de la tabla de trades/TOB -> misión. La maturity
// del lago es `YYYYMM` (primer mes de entrega en Quarterly, mes de entrega en
// Monthly); la forma no basta para decidir el tenor, así que se resuelve por el
// producto base.
export function missionKeyForContract({ shortCode, maturity } = {}) {
  if (String(maturity ?? "") === "") return null;
  return missionKeyForShortCode(shortCode);
}

export function isKnownMission(missionKey) {
  return Object.prototype.hasOwnProperty.call(TRADES_ENGINE_MISSIONS, missionKey);
}
