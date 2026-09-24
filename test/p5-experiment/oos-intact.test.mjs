// Tests IMP-16 parte 1: confirmar reserva OOS intacta. Fuente: SPEC v1.1.1
// §25.1 fila IMP-16 ("Confirmar reserva OOS intacta") y §25.2 DEP-12. La
// confirmación no es la etiqueta del manifest: re-verifica la frontera
// sellada y, con input de derivación, re-deriva la reserva y compara hash y
// población sellada. Fixtures sintéticos declarados (no son datos reales).

import test from "node:test";
import assert from "node:assert/strict";

import { confirmOosReservationIntact } from "../../src/p5-experiment/index.mjs";
import { sealedReservationFixture } from "./fixtures.mjs";

test("§25.1/DEP-12: la reserva sellada y re-derivable se confirma intacta", () => {
  const { manifest, derivationInput } = sealedReservationFixture();
  assert.equal(manifest.decision, "RESERVED");
  assert.equal(manifest.sealedOosCount, 8);

  const confirmed = confirmOosReservationIntact({ reservation: manifest, derivationInput });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.intact, true);
  assert.equal(confirmed.code, "OOS_RESERVATION_CONFIRMED_INTACT");
  assert.equal(confirmed.reservationHash, manifest.contentHash);
  assert.equal(confirmed.protectedFromIso, manifest.chronologicalSplit.protectedFromIso);
  assert.equal(confirmed.sealedOosCount, 8);
  // La confirmación incluye el sello ex-ante (frontera protegida y ligazón).
  assert.ok(confirmed.protectedFromIso);
  assert.ok(confirmed.reservationHash);
});

test("§25.1/DEP-12: sin input de derivación la confirmación sigue verificando forma", () => {
  const { manifest } = sealedReservationFixture();
  const confirmed = confirmOosReservationIntact({ reservation: manifest, derivationInput: null });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.intact, true);
  // La derivación no se ejecutó: se declara explícitamente.
  assert.equal(confirmed.derivation, null);
});

test("fail-closed: una reserva HOLD no se confirma intacta", () => {
  const hold = {
    decision: "HOLD",
    blockedBy: ["INSUFFICIENT_ELIGIBLE_COMPLETE_CAMPAIGNS"],
  };
  const confirmed = confirmOosReservationIntact({ reservation: hold, derivationInput: null });
  assert.equal(confirmed.ok, false);
  assert.equal(confirmed.intact, false);
  assert.equal(confirmed.code, "OOS_RESERVATION_NOT_INTACT");
  assert.ok(confirmed.reasons.includes("RESERVATION_NOT_SEALED"));
});

test("fail-closed: acceso que consume el OOS → NO intacta", () => {
  const { manifest, derivationInput } = sealedReservationFixture();
  // Un acceso que modifica el diseño consume el OOS (§13.8/§15.2): la
  // confirmación posterior deja de ser posible, incluso con la derivación.
  const consumed = {
    ...manifest,
    accessRegistry: {
      oosStatus: "CONSUMED",
      entries: [{ atUtc: "2026-09-24T00:00:00Z", purpose: "FEATURE_SELECTION", consumesOos: true, modifiesDesign: true, actor: null, section: "§13.8" }],
    },
  };
  const confirmed = confirmOosReservationIntact({ reservation: consumed, derivationInput });
  assert.equal(confirmed.ok, false);
  assert.equal(confirmed.code, "OOS_RESERVATION_NOT_INTACT");
  assert.ok(confirmed.reasons.includes("OOS_CONSUMED"));
});

test("fail-closed: contentHash del manifest alterado → OOS_RESERVATION_HASH_MISMATCH", () => {
  const { manifest, derivationInput } = sealedReservationFixture();
  const tampered = { ...manifest, contentHash: "0".repeat(64) };
  const confirmed = confirmOosReservationIntact({ reservation: tampered, derivationInput });
  assert.equal(confirmed.ok, false);
  assert.equal(confirmed.code, "OOS_RESERVATION_HASH_MISMATCH");
  assert.equal(confirmed.derivedHash, manifest.contentHash);
  assert.equal(confirmed.reservationHash, "0".repeat(64));
});

test("fail-closed: población sellada alterada con el hash original → OOS_SEALED_POPULATION_MISMATCH", () => {
  const { manifest, derivationInput } = sealedReservationFixture();
  const mutated = { ...manifest, sealedOosCampaignIds: ["GAS-Q-9999Q1", ...manifest.sealedOosCampaignIds.slice(1)] };
  const confirmed = confirmOosReservationIntact({ reservation: mutated, derivationInput });
  // El hash del manifestCore no incluye la lista alterable del objeto
  // residente: la comparación de poblaciones lo detecta.
  assert.equal(confirmed.ok, false);
  assert.equal(confirmed.code, "OOS_SEALED_POPULATION_MISMATCH");
});

test("fail-closed: frontera protegida alterada con el hash original → OOS_PROTECTED_BOUNDARY_MISMATCH", () => {
  const { manifest, derivationInput } = sealedReservationFixture();
  const mutated = {
    ...manifest,
    chronologicalSplit: { ...manifest.chronologicalSplit, protectedFromIso: "2025-01-01" },
  };
  const confirmed = confirmOosReservationIntact({ reservation: mutated, derivationInput });
  assert.equal(confirmed.ok, false);
  assert.equal(confirmed.code, "OOS_PROTECTED_BOUNDARY_MISMATCH");
});

test("fail-closed: reserva re-derivable que ya no sella → OOS_DERIVATION_NOT_SEALED", () => {
  const { manifest, derivationInput } = sealedReservationFixture();
  // El registro derivado cambia: el audit retira una campaña de la elegibilidad
  // (PROXY) → la re-derivación no produce RESERVED y la confirmación aborta.
  const mutatedDerivation = {
    ...derivationInput,
    campaigns: derivationInput.campaigns.map((campaign, index) => (
      index === derivingCampaignIndex(derivationInput) ? { ...campaign, eligibilityBasis: "PROXY" } : campaign)),
  };
  const confirmed = confirmOosReservationIntact({ reservation: manifest, derivationInput: mutatedDerivation });
  assert.equal(confirmed.ok, false);
  assert.equal(confirmed.code, "OOS_DERIVATION_NOT_SEALED");
});

function derivingCampaignIndex(derivationInput) {
  // índice de una campaña sellada (la primera sellada del registro derivado)
  return derivationInput.campaigns.length - 8;
}
