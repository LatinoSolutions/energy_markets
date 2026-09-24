// Ejecución intradía causal por hora del protocolo Q07 (IMP-21). Fuente:
// SPEC v1.1.1 §25.1 fila IMP-21 ("misma lógica/parámetros/obligación; cambia
// sólo timing permitido; execution causal por hora"), §13.4/§13.5 (A0 decide
// BUY/WAIT por calendario; los precios sólo para ejecución/contabilidad),
// §6 (semánticas de consumibilidad: un dato aún no consumible no entra).
//
// Por cada candidato de hora se re-corre la MISMA secuencia de decisiones A0
// sobre el calendario del protocolo; cambia únicamente el instante intra-día
// de ejecución del fill. El precio consumido para cada fill debe existir con
// asOf <= instante de decisión (causalidad por hora, fail-closed): si no hay
// snapshot causal, el fill se deniega y el volumen sigue pendiente — nunca se
// consume un snapshot futuro. La causalidad es además INTRADÍA: la ejecución
// del día D consume snapshots del día D; un snapshot de D−1 (u otro día
// anterior) no es el precio de la ejecución declarada de D y no es consumible
// (política de staleza predeclarada: sin snapshot intradía del día → deny,
// mismo criterio día-scoped que DYNAMIC_WINDOW aplica vía daySnapshots).
//
// La secuencia de decisión es calendar-only/price-blind (§13.4/§13.5: A0 decide
// BUY/WAIT por calendario; §25.1 "misma lógica/parámetros/obligación; cambia
// sólo timing permitido"): el controller dimensiona sobre el volumen PROGRAMADO
// (obligación − solicitudes previas), nunca sobre el volumen LLENADO. Si el
// sizing reaccionara al resultado del fill, el timing — única variable permitida
// — alteraría la lógica de decisión y la paridad entre brazos sería imposible
// en escenarios con denegaciones causales. El faltante por fill denegado se
// conserva explícito como cobertura no cubierta (§25.1 IMP-12 "partial/no-fill
// no cubre cantidad solicitada"; §14.5 "coverage cambia por filled quantity,
// nunca por requested quantity"), sin re-programación posterior: re-agendar
// tras observar el deny sería ajustar tras outcome (§13.9 no rescue).
//
// Divergencia clasificada con el replay P6 (§14.5), no silenciosa: P6
// dimensiona el remaining del controller sobre el volumen EJECUTADO
// (obligación − filled); este protocolo Q07 lo hace sobre el volumen
// SOLICITADO programado (obligación − requests) para que la secuencia de
// decisión sea invariante al outcome de fill y quede una única variable —el
// timing— entre brazos (§25.1 IMP-21 acepta "cambia sólo timing permitido").
// Q07 queda fuera de P5 (§13.4:1252); la comparación con cifras P5 conserva
// ese límite y no reescribe el ledger de P6.

import { contentHashOf } from "../execution-contract/execution-contract.mjs";
import { reconcileControlQuantity } from "../sizing-controller/sizing-controller.mjs";
import { verifyFrozenQ07Protocol } from "./protocol.mjs";

export const FILL_DENIED_NO_CAUSAL_SNAPSHOT = "FILL_DENIED_NO_CAUSAL_SNAPSHOT";

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isDateKey(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// Registro de snapshots intradía con su metadata de consumibilidad. Sólo
// acepta snapshots de fuentes con audit intradía declarado (artefacto
// AUDIT_GATED, ver gates.mjs): la construcción del registro no simulate
// disponibilidad que nadie audite.
export function createIntradaySnapshotRegistry(sourceId, snapshots = []) {
  if (typeof sourceId !== "string" || sourceId.length === 0) {
    return { ok: false, code: "INVALID_SOURCE_ID" };
  }
  if (!Array.isArray(snapshots)) {
    return { ok: false, code: "INVALID_SNAPSHOTS" };
  }
  const valid = [];
  for (const snapshot of snapshots) {
    if (!snapshot || typeof snapshot !== "object"
      || typeof snapshot.asOfUtc !== "string"
      || !(isFiniteNumber(snapshot.priceEurPerMwh))) {
      return { ok: false, code: "INVALID_SNAPSHOT", snapshotId: snapshot?.snapshotId ?? null };
    }
    valid.push({
      snapshotId: snapshot.snapshotId ?? null,
      asOfUtc: snapshot.asOfUtc,
      priceEurPerMwh: snapshot.priceEurPerMwh,
    });
  }
  valid.sort((a, b) => a.asOfUtc.localeCompare(b.asOfUtc));
  for (let i = 1; i < valid.length; i += 1) {
    if (valid[i].asOfUtc === valid[i - 1].asOfUtc) {
      return { ok: false, code: "DUPLICATED_AS_OF_UTC", asOfUtc: valid[i].asOfUtc };
    }
  }
  return { ok: true, registry: { sourceId, snapshots: valid, contentHash: contentHashOf({ sourceId, snapshots: valid }) } };
}

// Último snapshot con asOf <= decisionAtUtc: un snapshot posterior existe en
// el registro pero no es consumible en el momento de decisión (§6 unavailable
// explícito, no look-ahead). Si se declara decisionDayKey, la selección se
// acota además a snapshots del MISMO día de decisión (causalidad intradía;
// ver encabezado del módulo). El registro es el objeto plano devuelto por el
// registry ({sourceId, snapshots, contentHash}).
export function selectCausalSnapshot({ registry, decisionAtUtc, decisionDayKey } = {}) {
  if (!registry || typeof registry !== "object" || !Array.isArray(registry.snapshots)) {
    return { ok: false, code: "INVALID_REGISTRY" };
  }
  if (typeof decisionAtUtc !== "string") {
    return { ok: false, code: "INVALID_DECISION_AT" };
  }
  let eligible = registry.snapshots.filter((snapshot) => snapshot.asOfUtc <= decisionAtUtc);
  if (decisionDayKey !== undefined) {
    if (typeof decisionDayKey !== "string" || !isDateKey(decisionDayKey)) {
      return { ok: false, code: "INVALID_DECISION_DAY_KEY" };
    }
    eligible = eligible.filter((snapshot) => snapshot.asOfUtc.startsWith(decisionDayKey));
  }
  const latest = eligible[eligible.length - 1] ?? null;
  if (!latest) {
    return { ok: true, snapshot: null, code: "NO_CAUSAL_SNAPSHOT" };
  }
  return { ok: true, snapshot: latest, code: "OK" };
}

function hourCandidatesOf(protocol) {
  return protocol.candidates.map((candidate) => {
    if (candidate.kind === "FIXED_HOUR_AND_MINUTES") {
      return { hourId: candidate.hourId, kind: candidate.kind, hour: candidate.hour, minutes: candidate.minutes ?? 0 };
    }
    // DYNAMIC_WINDOW: la ventana declara el rango admisible; el fill toma el
    // último snapshot causal DENTRO de la ventana, si existe.
    return { hourId: candidate.hourId, kind: candidate.kind, windowStartHour: candidate.windowStartHour, windowEndHour: candidate.windowEndHour };
  });
}

function utcAt(dateKey, hour, minutes) {
  return `${dateKey}T${String(hour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00Z`;
}

// Corre el brazo de un candidato de hora: la secuencia de decisión es
// siempre la del calendario predeclarado (mismo remaining/obligación/deadline,
// §13.9); lo único que cambia es la hora de ejecución de cada BUY.
export function runQ07HourArm({ frozen, hourId, snapshotRegistry } = {}) {
  if (!frozen || frozen.artifactKind !== "IMP-21_Q07_PROTOCOL"
    || frozen.status !== "FROZEN_PRE_EXPERIMENT") {
    return { ok: false, code: "PROTOCOL_NOT_FROZEN" };
  }
  // Anti-mutación (§14.9): un brazo sólo corre sobre el protocolo congelado
  // cuyo hash coincide con su contenido; un protocolo alterado post-freeze no
  // alimenta evaluación.
  const verification = verifyFrozenQ07Protocol(frozen);
  if (!verification.ok) {
    return { ok: false, code: verification.code ?? "PROTOCOL_NOT_VERIFIED" };
  }
  const registry = snapshotRegistry?.registry ? snapshotRegistry.registry : snapshotRegistry;
  if (!registry || typeof registry !== "object" || !Array.isArray(registry.snapshots)) {
    return { ok: false, code: "INVALID_REGISTRY" };
  }
  const candidate = hourCandidatesOf(frozen).find((entry) => entry.hourId === hourId);
  if (!candidate) {
    return { ok: false, code: "CANDIDATE_NOT_IN_FROZEN_PROTOCOL", hourId };
  }

  const opportunities = frozen.decisionDates.map((date) => ({ date }));
  const fills = [];
  const deniedFills = [];
  const decisionSequence = [];
  const openingObligationMw = frozen.obligationBinding.openingObligationMw;
  // Volume PROGRAMADO (obligación − solicitudes previas), independiente del
  // resultado de los fills: base de la secuencia de decisión compartida.
  let scheduledRemaining = openingObligationMw;
  // Volume LLENADO real, sólo para métricas de cobertura; nunca dimensiona.
  let filledTotalMw = 0;

  for (let index = 0; index < opportunities.length; index += 1) {
    const date = opportunities[index].date;
    const opportunitiesLeft = opportunities.length - index;
    const reconciled = reconcileControlQuantity({
      remainingVolumeMw: scheduledRemaining,
      remainingOpportunitiesCount: opportunitiesLeft,
      isLastScheduledOpportunity: opportunitiesLeft === 1,
      controller: { lotSizeMw: frozen.controllerBinding.lotSizeMw, dailyCapMw: frozen.controllerBinding.dailyCapMw ?? null },
    });
    if (!reconciled.ok) {
      return { ok: false, code: reconciled.code ?? "CONTROLLER_RECONCILIATION_FAILED", hourId, atDate: date };
    }
    if (reconciled.action === "NO_ACTION" || reconciled.requestedQuantityMw === 0) {
      decisionSequence.push({ date, action: "WAIT", requestedQuantityMw: 0 });
      continue;
    }
    decisionSequence.push({
      date,
      action: reconciled.action,
      requestedQuantityMw: reconciled.requestedQuantityMw,
    });

    // Causalidad por hora: el precio disponible SÓLO con asOf <= momento de
    // ejecución declarado del candidato (§25.1 "execution causal por hora";
    // §6 unavailable explícito).
    const quantity = reconciled.requestedQuantityMw;
    // El BUY programado consume la oportunidad: el remaining PROGRAMADO baja
    // por la cantidad solicitada, exista o no fill. Un fill denegado conserva
    // su volumen como cobertura faltante (§25.1 IMP-12; §14.5), NO se re-agenda:
    // re-agendar tras observar el deny haría que el timing —única variable
    // permitida— alterara las decisiones y rompería la paridad (§13.9 no rescue).
    scheduledRemaining -= quantity;
    let fill = null;
    if (candidate.kind === "FIXED_HOUR_AND_MINUTES") {
      const decisionAtUtc = utcAt(date, candidate.hour, candidate.minutes);
      // Causalidad scoped al día de decisión: el snapshot de un día anterior
      // no es el precio de la ejecución declarada de hoy → deny (ver
      // encabezado; mismo criterio día-scoped que DYNAMIC_WINDOW).
      const causal = selectCausalSnapshot({ registry, decisionAtUtc, decisionDayKey: date });
      if (causal.snapshot) {
        fill = { ...causal.snapshot, decisionAtUtc };
      } else {
        fill = null;
        deniedFills.push({ date, hourId, code: FILL_DENIED_NO_CAUSAL_SNAPSHOT, decisionAtUtc, requestedQuantityMw: quantity });
      }
    } else {
      // DYNAMIC_WINDOW: último snapshot causal del día cuya HORA cae dentro de
      // la ventana predeclarada; fuera de ventana no hay fill y no se mueve el
      // tiempo (fail-closed).
      const daySnapshots = registry.snapshots.filter((snapshot) => snapshot.asOfUtc.startsWith(date));
      const inWindow = daySnapshots.filter((snapshot) => {
        const hourPart = Number(snapshot.asOfUtc.slice(11, 13));
        return hourPart >= candidate.windowStartHour && hourPart <= candidate.windowEndHour;
      });
      const latest = inWindow[inWindow.length - 1] ?? null;
      if (latest) {
        fill = { ...latest, decisionAtUtc: latest.asOfUtc };
      } else {
        deniedFills.push({ date, hourId, code: FILL_DENIED_NO_CAUSAL_SNAPSHOT, decisionAtUtc: null, requestedQuantityMw: quantity });
      }
    }

    if (!fill) {
      // El fill denegado NO re-programa el remaining: el faltante queda
      // conservado como cobertura no cubierta (§25.1 IMP-12; §14.5).
      continue;
    }
    filledTotalMw += quantity;
    fills.push({
      date,
      hourId,
      snapshotId: fill.snapshotId,
      asOfUtc: fill.asOfUtc,
      decisionAtUtc: fill.decisionAtUtc,
      filledQuantityMw: quantity,
      priceEurPerMwh: fill.priceEurPerMwh,
      costEur: quantity * fill.priceEurPerMwh,
    });
  }

  const H = fills.reduce((total, fill) => total + fill.costEur, 0);
  const filledVolumeMw = filledTotalMw;
  const coverage = openingObligationMw > 0
    ? filledVolumeMw / openingObligationMw
    : null;

  return {
    ok: true,
    hourId,
    kind: candidate.kind,
    arm: { artifactKind: "IMP-21_Q07_ARM", hourId, decisionSequence },
    decisionSequence,
    fills,
    deniedFills,
    H,
    filledVolumeMw,
    coverageFraction: coverage,
    noLookAheadNote: "Cada fill consume sólo snapshots asOf <= instante de ejecución del candidato; snapshot futuro no disponible (§6, §25.1).",
  };
}

// Paridad operacional entre brazos de hora: misma secuencia de decisión
// (fechas, acciones y cantidades solicitadas programadas por el controller
// calendar-only) y misma obligación + controller; difieren sólo en timing de
// ejecución (§25.1). La paridad NO exige resultados de fill idénticos: dos
// horas con distinta cobertura causal (snapshot ausente en una ventana)
// difieren legítimamente en fills y cobertura, y el perfil debe poder
// reportarlo con coverageFraction/distinct fills. Exigir volúmenes iguales
// abortaría el caso que el propio diseño describe con FILL_DENIED_NO_CAUSAL_SNAPSHOT.
export function assertHourArmsParity(arms = []) {
  if (!Array.isArray(arms) || arms.length < 2) {
    return { ok: false, code: "INVALID_PARITY_INPUT" };
  }
  const first = arms[0];
  for (const arm of arms.slice(1)) {
    if (!first.ok || !arm.ok) {
      // La comparación exige brazos válidos; un brazo invalidado no se
      // "repara" al comparar (§25.1 no hay convenience fills).
      return { ok: false, code: "ARM_INVALID_BEFORE_PARITY", hourId: !arm.ok ? arm.hourId : first.hourId };
    }
    if (JSON.stringify(arm.decisionSequence) !== JSON.stringify(first.decisionSequence)) {
      return { ok: false, code: "DECISION_SEQUENCE_NOT_SHARED", hourId: arm.hourId };
    }
  }
  return { ok: true, code: "HOUR_ARM_PARITY_HOLD" };
}
