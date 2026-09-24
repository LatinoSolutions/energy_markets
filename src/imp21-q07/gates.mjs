// Gate del REQUIRES_AUDIT de IMP-21: DEP-17 [data audit intradía] de las
// fuentes utilizadas, realizado por IMP-03 en scope Q07 o audit factual
// aceptado equivalente. Fuente: SPEC v1.1.1 §25.2.2 fila IMP-21 y §25.2.3
// IMP-21 ("Si no existe audit intradía suficiente, se bloquea la evaluación
// dependiente y se conserva el faltante"), §25.3 y §25.2.1
// (de auditoría realizada ≠ datos disponibles ≠ puerta (gate) satisfecho).

export const INTRADAY_AUDIT_SCOPE = "DEP-17_INTRA_DAY_DATA_AUDIT";

export function evaluateIntradayAuditGate({ intradayAudit = null } = {}) {
  if (!intradayAudit || typeof intradayAudit !== "object" || Array.isArray(intradayAudit)) {
    return {
      ok: false,
      code: "MISSING_INTRADAY_AUDIT",
      blocker: "DEP-17 [data audit por horas (intradía)]: no hay artefacto de auditaría intradía Q07 presentado (auditoría de IMP-03 en scope Q07 o equivalente factual aceptado).",
      missing: { reason: "El audit de IMP-03 aceptado registra R-16 UNAVAILABLE fuera de su alcance; no cubre Q07." },
      actingDownstream: "La evaluación de horas y el perfil quedan bloqueados; el soporte (protocolo/fijaciones (fixtures)) no fabrica el faltante (§25.2.3 IMP-21).",
    };
  }
  if (intradayAudit.auditScope !== INTRADAY_AUDIT_SCOPE) {
    return {
      ok: false,
      code: "INTRADAY_SCOPE_MISMATCH",
      blocker: `El audit presentado no declara el alcance ${INTRADAY_AUDIT_SCOPE} (§25.2.2 IMP-21).`,
    };
  }
  if (intradayAudit.status !== "ACCEPTED") {
    return {
      ok: false,
      code: "INTRADAY_AUDIT_NOT_ACCEPTED",
      blocker: "El artefacto de audit intradía esta presente pero no aceptado por la Oficina: no se consume como REQUIRES_AUDIT satisfecho (§25.2: un ST aceptado no cierra el IMP padre).",
    };
  }
  if (!intradayAudit.sourcesAreCovered || typeof intradayAudit.producedByImp !== "string") {
    return {
      ok: false,
      code: "INTRADAY_AUDIT_SOURCE_COVERAGE_INCOMPLETE",
      blocker: "Deben declararse las fuentes auditadas cubiertas y el IMP/revisión que produjo el artefacto.",
    };
  }
  if (intradayAudit.producedByImp !== "IMP-03" && typeof intradayAudit.contentHash !== "string") {
    return {
      ok: false,
      code: "INTRADAY_AUDIT_EQUIVALENT_NOT_SOURCED",
      blocker: "Un audit factual equivalente exige trazabilidad de origen (hash/identidad verificable).",
    };
  }
  return { ok: true, code: "INTRADAY_AUDIT_GATE_HOLD", intradayAudit };
}

// Consumo declarado: el audit intradía consumido NO se reclama como evidencia
// generada al evaluar horas (§25.2.2 IMP-21: "el audit intradía consumido no
// se reclama como evidencia generada por evaluar horas").
export function consumeIntradayAuditBinding({ gate } = {}) {
  if (!gate.ok) {
    return { ok: false, consumed: null };
  }
  return {
    ok: true,
    consumed: {
      auditScope: gate.intradayAudit.auditScope,
      producedByImp: gate.intradayAudit.producedByImp,
      evidenceRole: "DEPENDencia CONSUMIDA (REQUIRES_AUDIT), no evidencia del experimento Q07",
    },
  };
}
