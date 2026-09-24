// Evidencia de ejecución REAL del suite de fixtures manuales P6 (IMP-13) para
// el GATE-01 del closure gate IMP-15. Fuente: SPEC v1.1.1 §14.10 ítem 1
// ("todos los manual fixtures aprobados"), §14.8 (expected results calculados
// independientemente antes de codificar el test) y §25.2 fila IMP-13
// ("evidencia de ejecución real de tests").
//
// Ejecuta `node --test test/imp13/manual-fixtures.test.mjs` (reporter TAP,
// reporter json no disponible en esta build de node), parsea el resultado por
// test y lo agrega por fixture canónico usando el manifiest de abajo. Produce
// operations/audit/IMP-15/imp13-fixture-suite-run.json. La identidad del
// fixture en el TAP sale del prefijo del nombre del test; un nombre alterado
// deja el fixture sin match y la suite falla (fail-closed).
//
// La evidencia es bound por digest: si el artefacto se edita a mano, el
// suiteDigest deja de recomputar y el GATE-01 lo rechaza.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FIXTURE_SUITE_RUN_EVIDENCE_KIND, imp13FixtureSuiteDigest } from "../../../src/p6-evaluator/fixture-suite-evidence.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../..");
const SUITE_PATH = "test/imp13/manual-fixtures.test.mjs";
const SUITE_LOCATOR = `${SUITE_PATH} (node --test, rama de trabajo IMP-15)`;

// Imp13 test-name prefix → fixture canónico §14.8 (IDs canónicos del gate).
const FIXTURE_TEST_PREFIXES = {
  "FX-P6-01-CONSTANT-PRICE": [
    "F1 constant price:",
  ],
  "FX-P6-02-ASCENDING-PRICE": [
    "F2 ascending price:",
  ],
  "FX-P6-03-DESCENDING-PRICE": [
    "F3 descending price:",
  ],
  "FX-P6-04-WAIT-EVERY": [
    "F4a WAIT every decision:",
    "F4b WAIT every decision",
  ],
  "FX-P6-05-OVERLAPPING": [
    "F5 overlapping obligations:",
  ],
  "FX-P6-06-MISSING": [
    "F6a missing price:",
    "F6b missing critical input",
  ],
  "FX-P6-07-REVISED": [
    "F7 revised data:",
  ],
  "FX-P6-08-LOT-COSTS": [
    "F8 lot/rounding/costs:",
  ],
  "FX-P6-09-BENCHMARK-SUBSTITUTION": [
    "F9 sustitución oficial-sobre-proxy:",
  ],
  "FX-P6-10-NEUTRAL-UNDEFINED": [
    "F10 neutral/undefined:",
  ],
};

function parseTapTestResults(tapOutput) {
  const results = [];
  // Las filas TAP "ok N - name" / "not ok N - name" son tests top-level; los
  // subtests anidados del runner van indentados y empiezan con espacios.
  for (const line of tapOutput.split("\n")) {
    const match = line.match(/^(not ok|ok) \d+ - (.*)$/);
    if (match) {
      results.push({ ok: match[1] === "ok", name: match[2] });
    }
  }
  return results;
}

const command = `node --test ${SUITE_PATH}`;
const expectedCommandArr = [process.execPath, "--test", SUITE_PATH];
const run = spawnSync(process.execPath, ["--test", SUITE_PATH], { cwd: REPO_ROOT, encoding: "utf8" });
const testResults = parseTapTestResults(`${run.stdout ?? ""}\n${run.stderr ?? ""}`);

// Un test top-level válido de la suite no debe chocar con dos fixtures; el
// match es exacto por prefijo y solo top-level.
const fixtures = Object.entries(FIXTURE_TEST_PREFIXES).map(([fixtureId, prefixes]) => {
  const matched = testResults.filter((result) => prefixes.some((prefix) => result.name.startsWith(prefix)));
  return {
    fixtureId,
    ok: matched.length > 0 && matched.every((result) => result.ok === true),
    testNames: matched.map((result) => result.name),
  };
});

const allFixturesApproved = fixtures.every((fixture) => fixture.ok === true);
const evidence = {
  artifactKind: FIXTURE_SUITE_RUN_EVIDENCE_KIND,
  suiteLocator: SUITE_LOCATOR,
  command,
  commandArgv: expectedCommandArr,
  suiteStatus: allFixturesApproved ? "PASS" : "FAIL",
  suiteExitCode: run.status,
  generatedAtUtc: new Date().toISOString(),
  nodeVersion: process.version,
  fixtures,
  suiteDigest: null,
};
evidence.suiteDigest = imp13FixtureSuiteDigest(evidence);

const artifactPath = resolve(SCRIPT_DIR, "imp13-fixture-suite-run.json");
mkdirSync(dirname(artifactPath), { recursive: true });
writeFileSync(artifactPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`IMP-13 fixture suite evidence: ${evidence.suiteStatus} → ${artifactPath}`);
if (!allFixturesApproved) {
  for (const fixture of fixtures.filter((entry) => entry.ok !== true)) {
    console.error(`fixture ${fixture.fixtureId}: tests=${JSON.stringify(fixture.testNames)}`);
  }
  process.exitCode = 1;
}
