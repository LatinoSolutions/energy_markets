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
// consume un snapshot futuro.

import { contentHashOf } from "../execution-contract/execution-contract.mjs";
import { reconcileControlQuantity } from "../sizing-controller/sizing-controller.mjs";

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
// explícito, no look-ahead). El registro es el objeto plano devuelto por el
// registry ({sourceId, snapshots, contentHash}).
export function selectCausalSnapshot({ registry, decisionAtUtc } = {}) {
  if (!registry || typeof registry !== "object" || !Array.isArray(registry.snapshots)) {
    return { ok: false, code: "INVALID_REGISTRY" };
  }
  if (typeof decisionAtUtc !== "string") {
    return { ok: false, code: "INVALID_DECISION_AT" };
  }
  const causal = registry.snapshots.filter((snapshot) => snapshot.asOfUtc <= decisionAtUtc);
  const latest = causal[causal.length - 1] ?? null;
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
  let remaining = frozen.obligationBinding.openingObligationMw;

  for (let index = 0; index < opportunities.length; index += 1) {
    const date = opportunities[index].date;
    const remainingScheduled = opportunities.length - index;
    const reconciled = reconcileControlQuantity({
      remainingVolumeMw: remaining,
      remainingOpportunitiesCount: remainingScheduled,
      isLastScheduledOpportunity: remainingScheduled === 1,
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
    let fill = null;
    if (candidate.kind === "FIXED_HOUR_AND_MINUTES") {
      const decisionAtUtc = utcAt(date, candidate.hour, candidate.minutes);
      const causal = selectCausalSnapshot({ registry, decisionAtUtc });
      if (causal.snapshot) {
        fill = { ...causal.snapshot, decisionAtUtc };
      } else {
        fill = null;
        deniedFills.push({ date, hourId, code: FILL_DENIED_NO_CAUSAL_SNAPSHOT, decisionAtUtc, requestedQuantityMw: quantity });
      }
    } else {
      // DYNAMIC_WINDOW: primer snapshot causal cuya HORA cae dentro de la
      // ventana predeclarada; fuera de ventana no hay fill y no se mueve el
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
      continue;
    }
    const filledQuantity = quantity;
    remaining -= filledQuantity;
    fills.push({
      date,
      hourId,
      snapshotId: fill.snapshotId,
      asOfUtc: fill.asOfUtc,
      decisionAtUtc: fill.decisionAtUtc,
      filledQuantityMw: filledQuantity,
      priceEurPerMwh: fill.priceEurPerMwh,
      costEur: filledQuantity * fill.priceEurPerMwh,
    });
  }

  const H = fills.reduce((total, fill) => total + fill.costEur, 0);
  const filledVolumeMw = fills.reduce((total, fill) => total + fill.filledQuantityMw, 0);
  const coverage = frozen.obligationBinding.openingObligationMw > 0
    ? filledVolumeMw / frozen.obligationBinding.openingObligationMw
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
// (fechas, acciones y cantidades) y misma obligación + controller; difieren
// sólo en timing de ejecución (§25.1).
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
    if (JSON.stringify(arm.fills.map((fill) => ({ date: fill.date, quantity: fill.filledQuantityMw })))
      !== JSON.stringify(first.fills.map((fill) => ({ date: fill.date, quantity: fill.filledQuantityMw })))) {
      return { ok: false, code: "FILL_VOLUMES_NOT_SHARED", hourId: arm.hourId };
    }
  }
  return { ok: true, code: "HOUR_ARM_PARITY_HOLD" };
}
