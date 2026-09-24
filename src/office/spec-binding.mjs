// Binding de identidad de la SPEC canónica. Fuente: SPEC v1.1.1 §20.2.15
// ("el binding debe contrastarse con la Oficina canónica actual antes de
// declarar cumplimiento") y owner patch EM-SPEC-OWNER-PATCH-2026-09-24-01
// (Bru, 24-sep-2026: el runtime se rebindea a la Oficina canónica propia).
//
// Una sola verdad para el hash de la SPEC vigente. El owner patch del 24-sep
// editó el doc v1.1.1; los consumidores que fijaban el hash anterior quedaron
// stale. Este módulo es la fuente única: los consumidores lo importan y el test
// de binding comprueba el valor contra los bytes reales del doc canónico.

import { createHash } from "node:crypto";
import { isSha256, isVersionString } from "../contracts/identities.mjs";

export const CANONICAL_SPEC_PATH = "docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md";

// Hash de los bytes del doc canónico v1.1.1 con el owner patch aplicado
// (SHA256SUMS del 24-sep-2026). Verificado por test/office/spec-binding.test.mjs.
export const CANONICAL_SPEC_IDENTITY = Object.freeze({
  id: "PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md",
  version: "1.1.1",
  sha256: "d1bb4172a494a8900f782ecd4256d90bbaddd547b098b034be2867ab7884ed8b",
});

export function hashSpecBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// Campos declarados que divergen de la identidad canónica. Sólo se comparan los
// campos presentes: un consumidor puede omitir la identidad y se trata aparte.
export function specIdentityMismatches(declared, canonical = CANONICAL_SPEC_IDENTITY) {
  if (!declared || typeof declared !== "object" || Array.isArray(declared)) {
    return ["identity"];
  }
  const mismatches = [];
  for (const field of ["id", "version", "sha256"]) {
    if (declared[field] !== undefined && declared[field] !== canonical[field]) {
      mismatches.push(field);
    }
  }
  return mismatches;
}

// Un hash fijado en cualquier consumidor sólo es válido si coincide con los
// bytes del doc canónico que dice gobernar. Fail-closed: una SPEC mutada no
// sella nada.
export function verifyCanonicalSpec({ bytes, identity = CANONICAL_SPEC_IDENTITY } = {}) {
  if (bytes === undefined || bytes === null) {
    return { ok: false, code: "SPEC_BYTES_MISSING", message: "No hay bytes de la SPEC para verificar el binding." };
  }
  if (!isSha256(identity?.sha256) || !isVersionString(identity?.version) || typeof identity?.id !== "string") {
    return { ok: false, code: "SPEC_IDENTITY_INVALID", message: "La identidad canónica declarada no tiene forma válida." };
  }
  const actual = hashSpecBytes(bytes);
  if (actual !== identity.sha256) {
    return { ok: false, code: "SPEC_SOURCE_MISMATCH", actual, declared: identity.sha256 };
  }
  return { ok: true, actual };
}
