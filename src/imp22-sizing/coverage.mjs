// Cobertura válida de la obligación (§4.3) — criterio de aceptación IMP-22
// "Atribuye timing vs tamaño; cobertura válida". La identidad contable es
// Opening = Executed + Remaining; ningún paso de cobertura puede recontar
// volumen ya ejecutado ni consumir más del Opening vigente. Es el artefacto
// que faltaba: el guard del candidato (clamp a q_t en [0, RemainingVolume])
// respeta la obligación restante, pero la identidad global y el no-doble-
// conteo se verifican aquí sobre el trace del run.
//
// Ref: hallazgo IMP22-H7. Fail-closed: un trace incoherente invalida la
// "cobertura válida" del criterio, no se reconstruye ni se explica.

export const COVERAGE_IDENTITY = "OPENING = EXECUTED + REMAINING (§4.3)";

// Declaraciones ex-ante del diseño (antes de que exista trace): el diseño
// declara qué identidad usará y que el doble conteo está prohibido por
// estructura. Es lo que el gate freeze verifica.
export function validateCoverageDeclarations(coverage) {
  const errors = [];

  if (coverage == null || typeof coverage !== "object") {
    return [
      {
        field: "coverage",
        code: "COVERAGE_DECLARED_REQUIRED",
        message: "El diseño debe declarar su cobertura (§4.3): identidad Opening = Executed + Remaining y prohibición de doble conteo.",
      },
    ];
  }

  if (coverage.identity !== COVERAGE_IDENTITY) {
    errors.push({
      field: "coverage.identity",
      code: "COVERAGE_IDENTITY_REQUIRED",
      message: `coverage.identity debe fijar "${COVERAGE_IDENTITY}" (§4.3).`,
    });
  }
  if (coverage.doubleCountForbidden !== true) {
    errors.push({
      field: "coverage.doubleCountForbidden",
      code: "DOUBLE_COUNT_FORBIDDEN_UNDECLARED",
      message: "coverage.doubleCountForbidden debe declararse true: cada q_t se consume una sola vez del remaining (§4.3).",
    });
  }

  return errors;
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// Trace del run. Forma esperada:
// {
//   obligationId: string,
//   openingVolume: number,
//   steps: [{ executedVolume: number, remainingVolume: number, source: string }]
// }
// Cada step: opening step = remaining del step anterior (o Opening inicial);
// executed empieza en 0 y no se pueden recontar volúmenes ya ejecutados.
export function validateCoverageTrace(trace) {
  const errors = [];

  if (trace == null || typeof trace !== "object") {
    return { ok: false, errors: [{ field: "coverageTrace", code: "COVERAGE_TRACE_REQUIRED", message: "El trace de cobertura es requerido para acreditar cobertura válida (§4.3)." }] };
  }

  if (typeof trace.obligationId !== "string" || trace.obligationId.trim() === "") {
    errors.push({ field: "coverageTrace.obligationId", code: "OBLIGATION_ID_REQUIRED", message: "El trace debe portar la obligationId del experimento." });
  }
  if (!finiteNumber(trace.openingVolume) || trace.openingVolume < 0) {
    errors.push({ field: "coverageTrace.openingVolume", code: "OPENING_VOLUME_REQUIRED", message: "openingVolume debe ser un número no negativo (§4.3 Opening)." });
  }
  if (!Array.isArray(trace.steps) || trace.steps.length === 0) {
    errors.push({ field: "coverageTrace.steps", code: "COVERAGE_STEPS_REQUIRED", message: "Al menos un step de cobertura debe registrarse; sin steps no hay acreditable." });
    return { ok: false, errors };
  }

  const openingVolume = trace.openingVolume;
  let currentOpening = finiteNumber(openingVolume) ? openingVolume : null;
  let accumulatedExecuted = 0;

  for (const [index, step] of trace.steps.entries()) {
    const prefix = `coverageTrace.steps[${index}]`;

    if (step == null || typeof step !== "object") {
      errors.push({ field: `${prefix}`, code: "COVERAGE_STEP_INVALID", message: "Cada step de cobertura debe ser un objeto." });
      continue;
    }

    if (!finiteNumber(currentOpening)) {
      errors.push({ field: "coverageTrace.openingVolume", code: "OPENING_VOLUME_REQUIRED", message: "El Opening no es finito y la cadena de cobertura no puede verificarse." });
      currentOpening = null;
      break;
    }

    // No-doble-conteo: el volumen ejecutado en este step no puede ser
    // material ya consumido en un step previo (§4.3).
    const executed = step.executedVolume;
    if (!finiteNumber(executed) || executed < 0) {
      errors.push({ field: `${prefix}.executedVolume`, code: "EXECUTED_VOLUME_REQUIRED", message: "executedVolume debe ser un número no negativo." });
      break;
    }

    const remaining = step.remainingVolume;
    if (!finiteNumber(remaining) || remaining < 0) {
      errors.push({ field: `${prefix}.remainingVolume`, code: "REMAINING_VOLUME_REQUIRED", message: "remainingVolume debe ser un número no negativo (§4.3 Remaining)." });
      continue;
    }

    // Identidad por step: remaining = Opening vigente − executed.
    if (remaining > currentOpening) {
      errors.push({ field: `${prefix}.remainingVolume`, code: "COVERAGE_IDENTITY_VIOLATION", message: "Remaining > Opening vigente: volumen que no se ejecutó reaparece contado de nuevo (§4.3 Opening = Executed + Remaining)." });
      continue;
    }

    const identityOk = Math.abs(remaining - (currentOpening - executed)) < 1e-9;
    if (!identityOk) {
      errors.push({ field: `${prefix}`, code: "COVERAGE_IDENTITY_VIOLATION", message: "Identidad violada: Remaining ≠ Opening − Executed en este step (§4.3)." });
      continue;
    }

    accumulatedExecuted += executed;
    if (accumulatedExecuted > openingVolume + 1e-9) {
      errors.push({ field: `${prefix}.executedVolume`, code: "DOUBLE_COUNT_DETECTED", message: "El ejecutado acumulado rebasa el Opening: volumen ya ejecutado se reconsume (no-doble-conteo §4.3)." });
      continue;
    }

    currentOpening = remaining;
  }

  return { ok: errors.length === 0, errors, finalRemaining: currentOpening };
}

// La cobertura del guard no se limita al clamp de q_t: el guard que aspira a
// regirse por las obligaciones de la Mission debe declarar sus reglas de
// lotes/redondeo/deadline versionadas cuando existan auditadas (§4.2).
export function validateGuardCoverage(contract) {
  const errors = [];
  const fields = ["lotSizeRuleVersion", "roundingRuleVersion", "deadlineRuleVersion"];

  if (contract == null || typeof contract !== "object") {
    return [{ field: "coverage.guardContract", code: "GUARD_CONTRACT_REQUIRED", message: "La cobertura de restricciones del guard es requerida (§4.2)." }];
  }

  for (const field of fields) {
    if (typeof contract[field] !== "string" || contract[field].trim() === "") {
      errors.push({
        field: `coverage.guardContract.${field}`,
        code: "GUARD_COVERAGE_UNDECLARED",
        message: `La cobertura del guard debe declarar ${field} versionado cuando la regla esté auditada (§4.2 sostiene de obrigação: lotes/deadline/redondeo).`,
      });
    }
  }

  return errors;
}
