// Confirmación de reserva OOS intacta (IMP-16, parte 1). Fuente: SPEC v1.1.1
// §25.1 fila IMP-16 ("Confirmar reserva OOS intacta…") y §25.2 DEP-12
// ("campañas reservadas, frontera intacta y evidencia mínima"). La
// confirmación NO es la etiqueta del manifest: IMP-16 re-verifica la frontera
// (isReservationIntact, §13.8/§15.2) y, cuando el caller entrega el input de
// derivación, RE-DERIVA la reserva sellada y compara su contentHash con el
// manifest residente. Una reserva mutada, consumida o no re-derivable queda
// fail-closed: no se ejecuta ningún experimento sobre ella.

import { reserveSealedOos, isReservationIntact } from "../oos-reservation/reservation.mjs";

const campaignsEqual = (left, right) =>
  JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());

export function confirmOosReservationIntact({ reservation = null, derivationInput = null } = {}) {
  if (!reservation || typeof reservation !== "object" || Array.isArray(reservation)) {
    return {
      ok: false, intact: false, code: "MISSING_OOS_RESERVATION",
      reasons: ["MISSING_OOS_RESERVATION"], reservation: reservation ?? null, derivation: null,
    };
  }

  // 1. Forma: sellada, frontera protegida y sin consumo registrado.
  const formCheck = isReservationIntact(reservation);
  if (!formCheck.intact) {
    return {
      ok: false, intact: false, code: "OOS_RESERVATION_NOT_INTACT",
      reasons: formCheck.reasons, reservation, derivation: null,
    };
  }

  // 2. Contenido: re-derivación y comparación de contentHash. El manifest
  // residente (IMP-09) se produce determinísticamente desde su registro
  // auditado; si la re-derivación no reproduce el mismo hash y la misma
  // población sellada, el manifest fue alterado después de sellarse.
  let derivation = null;
  if (derivationInput !== null) {
    const derived = reserveSealedOos(derivationInput);
    derivation = { decision: derived.decision, blockedBy: derived.blockedBy ?? [], contentHash: derived.contentHash };
    if (derived.decision !== "RESERVED") {
      return {
        ok: false, intact: false, code: "OOS_DERIVATION_NOT_SEALED",
        reasons: derived.blockedBy ?? ["OOS_DERIVATION_NOT_SEALED"],
        reservation, derivation,
      };
    }
    if (typeof reservation.contentHash !== "string" || derived.contentHash !== reservation.contentHash) {
      return {
        ok: false, intact: false, code: "OOS_RESERVATION_HASH_MISMATCH",
        reasons: ["OOS_RESERVATION_HASH_MISMATCH"],
        reservationHash: reservation.contentHash ?? null,
        derivedHash: derived.contentHash,
        reservation, derivation,
      };
    }
    if (!campaignsEqual(reservation.sealedOosCampaignIds ?? [], derived.sealedOosCampaignIds)) {
      return {
        ok: false, intact: false, code: "OOS_SEALED_POPULATION_MISMATCH",
        reasons: ["OOS_SEALED_POPULATION_MISMATCH"],
        reservation, derivation,
      };
    }
    if (derived.chronologicalSplit?.protectedFromIso !== reservation.chronologicalSplit?.protectedFromIso) {
      return {
        ok: false, intact: false, code: "OOS_PROTECTED_BOUNDARY_MISMATCH",
        reasons: ["OOS_PROTECTED_BOUNDARY_MISMATCH"],
        reservation, derivation,
      };
    }
  }

  return {
    ok: true,
    intact: true,
    code: "OOS_RESERVATION_CONFIRMED_INTACT",
    reasons: [],
    reservationHash: reservation.contentHash,
    protectedFromIso: reservation.chronologicalSplit?.protectedFromIso ?? null,
    sealedOosCount: reservation.sealedOosCount,
    sealedOosCampaignIds: [...(reservation.sealedOosCampaignIds ?? [])],
    reservation,
    derivation,
  };
}
