// Evidencia de la suite de fixtures manuales §14.8 (IMP-13) que consume el
// GATE-01 del closure gate IMP-15. Fuente: SPEC v1.1.1 §14.10 ítem 1 ("todos
// los manual fixtures aprobados"), §14.8 (expected results calculados
// independientemente antes de codificar el test) y §25.2 fila IMP-13
// ("evidencia de ejecución real de tests").
//
// La evidencia no se auto-atestúa: es el artefacto materializado por
// operations/audit/IMP-15/run-imp13-fixture-suite.mjs, que ejecuta de verdad
// `node --test test/imp13/manual-fixtures.test.mjs` y vuelca el resultado por
// fixture canónico. El digest liga el contenido declarado del artefacto; un
// artefacto editado a mano deja de cuadrar con su propio suiteDigest.

import { contentHashOf } from "../execution-contract/execution-contract.mjs";

export const FIXTURE_SUITE_RUN_EVIDENCE_KIND = "IMP13_FIXTURE_SUITE_RUN_EVIDENCE";

// Digest canónico del artefacto: sólo los campos deterministas de contenido
// (kind, locator de la suite, comando, estado y filas por fixture). Los datos
// volátiles de la ejecución (timestamps, versión de node) no entran, para que
// el digest pueda recomputarse y compararse en el gate.
export function imp13FixtureSuiteDigest(evidence) {
  if (!evidence || typeof evidence !== "object") return null;
  return contentHashOf({
    artifactKind: evidence.artifactKind,
    suiteLocator: evidence.suiteLocator,
    command: evidence.command,
    suiteStatus: evidence.suiteStatus,
    fixtures: (evidence.fixtures ?? []).map((fixture) => ({
      fixtureId: fixture.fixtureId,
      ok: fixture.ok === true,
      testNames: Array.isArray(fixture.testNames) ? fixture.testNames : [],
    })),
  });
}

// Validación estructural + de contenido del artefacto. La consume GATE-01 y la
// materialización del receipt: exactamente el set canónico de §14.8, todos
// aprobados, suite ejecutada en estado PASS y digest consistente con el
// contenido declarado. Fail-closed ante artefacto ausente, alterado o incompleto.
export function validateFixtureSuiteRunEvidence(evidence, canonicalFixtureIds) {
  if (!evidence || typeof evidence !== "object") {
    return { ok: false, code: "MISSING_FIXTURE_EVIDENCE", message: "Sin artefacto de ejecución real del suite §14.8 no hay closure (§14.10 ítem 1)." };
  }
  if (evidence.artifactKind !== FIXTURE_SUITE_RUN_EVIDENCE_KIND) {
    return { ok: false, code: "MALFORMED_FIXTURE_EVIDENCE", message: `El artefacto no es de kind ${FIXTURE_SUITE_RUN_EVIDENCE_KIND}.` };
  }
  if (!Array.isArray(evidence.fixtures) || !Array.isArray(canonicalFixtureIds) || canonicalFixtureIds.length === 0) {
    return { ok: false, code: "MALFORMED_FIXTURE_EVIDENCE", message: "El artefacto no declara filas de fixture o el set canónico está vacío." };
  }
  if (evidence.suiteStatus !== "PASS") {
    const failed = (evidence.fixtures ?? []).filter((fixture) => fixture?.ok !== true).map((fixture) => fixture?.fixtureId);
    return { ok: false, code: "FIXTURE_NOT_APPROVED", message: "La suite IMP-13 no se ejecutó en estado PASS.", failedFixtureIds: failed };
  }
  const byId = new Map();
  for (const fixture of evidence.fixtures) {
    if (!fixture || typeof fixture.fixtureId !== "string" || !fixture.fixtureId.trim()) {
      return { ok: false, code: "MALFORMED_FIXTURE_EVIDENCE", message: "Cada fila del artefacto debe declarar fixtureId, ok y testNames." };
    }
    if (fixture.ok !== true && fixture.ok !== false) {
      return { ok: false, code: "MALFORMED_FIXTURE_EVIDENCE", message: `El fixture ${fixture.fixtureId} no declara un estado binario ok.` };
    }
    if (fixture.ok !== true) {
      return { ok: false, code: "FIXTURE_NOT_APPROVED", message: `El fixture ${fixture.fixtureId} se ejecutó sin aprobación en la suite real.`, failedFixtureIds: [fixture.fixtureId] };
    }
    if (!Array.isArray(fixture.testNames) || fixture.testNames.length === 0
      || fixture.testNames.some((name) => typeof name !== "string" || !name.trim())) {
      return { ok: false, code: "MALFORMED_FIXTURE_EVIDENCE", message: `El fixture ${fixture.fixtureId} no declara los nombres de tests reales que lo verificaron.` };
    }
    if (byId.has(fixture.fixtureId)) {
      return { ok: false, code: "MALFORMED_FIXTURE_EVIDENCE", message: `El fixture ${fixture.fixtureId} aparece más de una vez en el artefacto.` };
    }
    byId.set(fixture.fixtureId, fixture);
  }
  for (const expected of canonicalFixtureIds) {
    if (!byId.has(expected)) {
      return { ok: false, code: "MISSING_FIXTURE_ID", message: `El fixture canónico ${expected} (§14.8) no aparece aprobado en la evidencia del suite real.` };
    }
  }
  if (byId.size !== canonicalFixtureIds.length) {
    return { ok: false, code: "UNEXPECTED_FIXTURE_ID", message: "El artefacto declara fixtures fuera del set canónico §14.8." };
  }
  const digest = imp13FixtureSuiteDigest(evidence);
  if (evidence.suiteDigest !== digest) {
    return { ok: false, code: "FIXTURE_EVIDENCE_DIGEST_MISMATCH", message: "El suiteDigest declarado no recomputa sobre el contenido del artefacto: la evidencia fue alterada (fail-closed)." };
  }
  return { ok: true, code: "OK", digest, suiteLocator: evidence.suiteLocator };
}
