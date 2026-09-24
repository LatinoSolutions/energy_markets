// Verificador de la reconciliación append-only R-01/R-17 de IMP-09 (H7).
//
// Fuente: SPEC v1.1.1 §6.3 (Data Sufficiency Matrix por requisito) y guardrail
// 15 del scope (un artefacto stale miente). La matriz IMP-03 aceptada NO se
// edita; la contribución posterior debe: (a) citar su SHA-256 y coincidir con
// la matriz real, (b) ser append-only, (c) declarar cada fuente nueva con hash
// o identidad auditable, y (d) no convertir la contribución en cierre de la
// matriz por encima de lo registrado.

import { createHash } from "node:crypto";

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export function sha256OfRaw(raw) {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function isSha256Hex(value) {
  return typeof value === "string" && SHA256_HEX_PATTERN.test(value);
}

// Comprueba que la matriz aceptada sigue intacta: el SHA-256 citado por la
// reconciliación coincide con el contenido real del archivo.
export function verifyMatrixIntegrity({ matrixRaw, declaredSha256 }) {
  if (typeof matrixRaw !== "string" || matrixRaw.trim().length === 0) {
    return { ok: false, errors: [{ code: "MATRIX_NOT_PROVIDED", message: "La matriz aceptada no está disponible para verificación." }] };
  }
  if (!isSha256Hex(declaredSha256)) {
    return { ok: false, errors: [{ code: "MATRIX_SHA256_NOT_DECLARED", message: "La reconciliación no cita el SHA-256 de la matriz aceptada." }] };
  }
  const actual = sha256OfRaw(matrixRaw);
  if (actual !== declaredSha256) {
    return {
      ok: false,
      errors: [{ code: "MATRIX_SHA256_MISMATCH", message: `La matriz citada cambió respecto a su línea base (declarado ${declaredSha256}, real ${actual}); un artefacto editado no puede sostener la reconciliación.` }],
    };
  }
  return { ok: true, errors: [], sha256: actual };
}

function pushError(errors, code, message) {
  errors.push({ code, message });
}

// Verificación completa de la contribución contra la matriz parseada.
export function verifyR01R17Reconciliation({ matrixRaw, matrix, reconciliation }) {
  const errors = [];
  const integrity = verifyMatrixIntegrity({ matrixRaw, declaredSha256: reconciliation?.acceptedMatrix?.sha256 });
  if (!integrity.ok) {
    errors.push(...integrity.errors);
  }

  if (!reconciliation?.appendOnly || reconciliation.appendOnly.isAppendOnly !== true) {
    pushError(errors, "NOT_APPEND_ONLY", "La contribución no declara append-only; una edición de la matriz stale no puede reconciliar.");
  }

  if (matrix && typeof matrix === "object" && Array.isArray(matrix.rows)) {
    for (const requirementId of ["R-01", "R-17"]) {
      const row = matrix.rows.find((item) => item.requirementId === requirementId);
      if (!row) {
        pushError(errors, "MATRIX_ROW_MISSING", `La matriz aceptada ya no contiene la fila ${requirementId}; la contribución cites una fila que existe.`);
        continue;
      }
      if (row.availabilityStatus !== "UNAVAILABLE") {
        pushError(errors, "MATRIX_ROW_MODIFIED", `La fila ${requirementId} dejó de ser UNAVAILABLE en el archivo: la matriz aceptada se editó, no se reconcilió por añadido.`);
      }
    }
  }

  const rows = Array.isArray(reconciliation?.reconciledRows) ? reconciliation.reconciledRows : [];
  for (const requirementId of ["R-01", "R-17"]) {
    const entry = rows.find((item) => item?.requirementId === requirementId);
    if (!entry) {
      pushError(errors, "RECONCILIATION_ROW_MISSING", `La reconciliación no registra una contribución para ${requirementId}.`);
      continue;
    }
    const contribution = entry.contribution;
    if (!contribution || typeof contribution !== "object") {
      pushError(errors, "CONTRIBUTION_INVALID", `La contribución de ${requirementId} no declara un objeto de contribución.`);
      continue;
    }
    if (!Array.isArray(contribution.sources)) {
      pushError(errors, "SOURCES_WITHOUT_HASH", `La contribución de ${requirementId} no cita fuentes.`);
      continue;
    }
    const withoutBinding = contribution.sources.filter((source) => source === null || typeof source !== "object" || (!isSha256Hex(source.sha256) && !isNonEmptyString(source.identity)));
    if (withoutBinding.length > 0) {
      pushError(errors, "SOURCES_WITHOUT_HASH", `La contribución de ${requirementId} cita fuentes sin SHA-256 ni identidad de foto; las fuentes deben citarse con hash (guardrail 15).`);
    }
  }

  return { ok: errors.length === 0, errors, matrixSha256: integrity.sha256 ?? null };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
