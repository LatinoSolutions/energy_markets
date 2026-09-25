// Point-in-time de las filas Delete. Fuente: OWNER_PATCH_TRADES_MODE_2026-09-25.md
// §3.1: "Un trade con `Delete` posterior deja de ser elegible solo desde el
// momento del Delete, nunca antes (excluirlo antes sería look-ahead). TR-01
// verifica si la fila Delete lleva la hora del borrado o la del trade original;
// si no se puede saber, la regla se declara como supuesto."
//
// VERIFICADO en TR-01 (medición acotada, no escaneo completo): la fila Delete
// lleva la HORA DEL BORRADO en `Tm`, posterior al `Tm` de la fila New del mismo
// trade. Evidencia (lago /srv/hot-data/EEX/table=eex_derivative_trade):
//   - POWER/DE trd_date=2025-10-29: TrdID 3727 New 13:43:09.77007Z -> Delete
//     13:55:28.99848Z; TrdID 2527 New 11:24:14.373529Z -> Delete
//     11:28:54.163519Z.
//   - POWER/DE trd_date=2023-05-31: TrdID 3606 New 14:57:57.628961Z -> Delete
//     15:05:56.018946Z; TrdID 2587 New 13:10:56.067777Z -> Delete
//     14:46:09.741011Z; TrdID 1147 New 09:28:37.23253Z -> Delete
//     10:04:53.322587Z.
// En los seis casos Delete.Tm > New.Tm. La igualdad New.Tm == Delete.Tm
// (POWER/DE 2026-06-17, TrdID 4746..4750) también es compatible con "hora del
// borrado": el alta y el borrado ocurrieron en el mismo instante.
//
// Regla PIT resultante: en el instante de decisión T un trade New es elegible si
// New.Tm <= T y NINGÚN Delete de su misma identidad tiene Delete.Tm <= T.
// La identidad de la pata es (TrdDate, Cmdty, Area, TrdID, ShortCode, Maturity,
// InstrumentType): un spread comparte TrdID entre patas (medición TR-01:
// 2025-11-20 NATGAS/THE, 341 TrdID únicos de 353 filas), así que TrdID solo no
// identifica la pata. Cuando varias filas New comparten identidad, el Delete
// las retira todas: es conservador y no inventa disponibilidad.

export const DELETE_TM_SEMANTICS = "deletion-time";

export function tradeEpochMs(tm) {
  if (tm === undefined || tm === null || tm === "") return null;
  const parsed = Date.parse(String(tm));
  return Number.isNaN(parsed) ? null : parsed;
}

export function tradeLegIdentity(row) {
  return [
    row?.TrdDate ?? "",
    row?.Cmdty ?? "",
    row?.Area ?? "",
    row?.TrdID ?? "",
    row?.ShortCode ?? "",
    row?.Maturity ?? "",
    row?.InstrumentType ?? "",
  ].join("\u0001");
}

// Índice de borrados por identidad de pata. Solo las filas Delete entran aquí;
// las filas New se resuelven contra este índice.
//
// Un Delete con `Tm` ilegible no se puede indexar (no se sabe desde cuándo
// retira el trade) pero NO se descarta en silencio: si el llamador pasa un
// objeto `stats`, se acumula en `unparsableDeleteTm` para que la medición lo
// muestre. Ocultarlo dejaría el trade elegible para siempre sin que se note.
export function buildDeleteIndex(rows, stats = null) {
  const index = new Map();
  for (const row of rows) {
    if (row?.UpdtAct !== "Delete") continue;
    const epoch = tradeEpochMs(row?.Tm);
    if (epoch === null) {
      if (stats !== null && stats !== undefined) {
        stats.unparsableDeleteTm = (stats.unparsableDeleteTm ?? 0) + 1;
      }
      continue;
    }
    const key = tradeLegIdentity(row);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(epoch);
  }
  for (const list of index.values()) list.sort((a, b) => a - b);
  return index;
}

export function isDeletedAt(row, decisionEpochMs, deleteIndex) {
  const deletes = deleteIndex.get(tradeLegIdentity(row));
  if (!deletes || deletes.length === 0) return false;
  // Un Delete visible en T (Delete.Tm <= T) retira el trade desde T.
  return deletes.some((deleteEpochMs) => deleteEpochMs <= decisionEpochMs);
}

export function isEligibleAt(row, decisionEpochMs, deleteIndex) {
  const availableAt = tradeEpochMs(row?.Tm);
  if (availableAt === null || availableAt > decisionEpochMs) return false;
  return !isDeletedAt(row, decisionEpochMs, deleteIndex);
}

// Aplica la regla PIT sobre filas ya filtradas por la regla de elegibilidad de
// mercado (eligibility.mjs). `rows` puede incluir filas Delete; se usan como
// índice y no como observaciones.
export function eligibleTradesAt(rows, decisionEpochMs, { deleteIndex = buildDeleteIndex(rows) } = {}) {
  return rows
    .filter((row) => row?.UpdtAct !== "Delete")
    .filter((row) => isEligibleAt(row, decisionEpochMs, deleteIndex))
    .sort((a, b) => tradeEpochMs(a.Tm) - tradeEpochMs(b.Tm));
}

// Medición que sostiene DELETE_TM_SEMANTICS. No decide elegibilidad: reporta si
// el Tm de la fila Delete es compatible con la hora del borrado (Delete.Tm >=
// New.Tm para la misma identidad) o si en cambio parece la hora original.
export function measureDeleteTmSemantics(rows) {
  const newsByIdentity = new Map();
  for (const row of rows) {
    if (row?.UpdtAct !== "New") continue;
    const key = tradeLegIdentity(row);
    if (!newsByIdentity.has(key)) newsByIdentity.set(key, []);
    newsByIdentity.get(key).push(tradeEpochMs(row.Tm));
  }
  const measurement = {
    deleteRows: 0,
    deletesWithNewSibling: 0,
    deleteAfterNew: 0,
    deleteEqualNew: 0,
    deleteBeforeNew: 0,
    deleteUnparsableTm: 0,
    newWithoutDelete: 0,
    pairs: [],
  };
  for (const row of rows) {
    if (row?.UpdtAct !== "Delete") continue;
    measurement.deleteRows += 1;
    const deleteEpoch = tradeEpochMs(row.Tm);
    const siblings = (newsByIdentity.get(tradeLegIdentity(row)) ?? []).filter((epoch) => epoch !== null);
    // Un Tm de Delete no parseable se cuenta aparte, tenga o no hermano New: no
    // es evidencia de "borrado antes del alta" y no debe negar deletionTimeObserved.
    if (deleteEpoch === null) {
      measurement.deleteUnparsableTm += 1;
      if (siblings.length > 0) measurement.deletesWithNewSibling += 1;
      continue;
    }
    if (siblings.length === 0) continue;
    measurement.deletesWithNewSibling += 1;
    const earliestNew = Math.min(...siblings);
    if (deleteEpoch > earliestNew) measurement.deleteAfterNew += 1;
    else if (deleteEpoch === earliestNew) measurement.deleteEqualNew += 1;
    else measurement.deleteBeforeNew += 1;
    measurement.pairs.push({
      identity: tradeLegIdentity(row),
      newTm: siblings.map((epoch) => new Date(epoch).toISOString()).sort(),
      deleteTm: new Date(deleteEpoch).toISOString(),
    });
  }
  const deleteIdentities = new Set(
    rows.filter((row) => row?.UpdtAct === "Delete").map((row) => tradeLegIdentity(row)),
  );
  for (const [identity, siblings] of newsByIdentity) {
    if (!deleteIdentities.has(identity)) measurement.newWithoutDelete += siblings.length;
  }
  measurement.deletionTimeObserved =
    measurement.deletesWithNewSibling > 0 && measurement.deleteBeforeNew === 0;
  return measurement;
}
