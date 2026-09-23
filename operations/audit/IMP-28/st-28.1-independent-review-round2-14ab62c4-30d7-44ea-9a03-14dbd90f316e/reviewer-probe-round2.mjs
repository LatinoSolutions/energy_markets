// Probe independiente del revisor, ronda 2 (ST-28.1). Ataca exclusivamente los
// caminos de código introducidos o tocados por las correcciones de la ronda 1
// (A, A2, B, C), buscando refutarlas con casos que la suite del autor no cubre.
// Todo el material es sintético: no evalúa componentes reales, no integra nada
// y no concede autoridad. Sólo lee el framework bajo revisión.

import { createRoleEvaluationRegistry } from "../../../src/role-evaluation/registry.mjs";
import { makeEvaluation, SYNTHETIC_READINESS, evidence } from "../../../test/role-evaluation/fixtures.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

let failed = 0;
function check(id, title, expected, observed, ok) {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${id} ${title}`);
  console.log(`        esperado: ${expected}`);
  console.log(`        observado: ${observed}`);
  if (!ok) failed += 1;
}

// R2-A: ¿la guarda de identidad de versión (fix A) sigue en pie cuando la
// versión es un content-hash, la forma que isVersionLike() admite además del
// semver textual?
{
  const registry = createRoleEvaluationRegistry();
  const evaluation = makeEvaluation({ componentVersion: { contentHash: HASH_A } });
  registry.registerComponent(evaluation);
  const result = registry.createNewEvaluationVersion(evaluation.componentId, evaluation.roleClass, {
    materialChange: true,
    changeSummary: "SYN: salto de versión por content-hash con contrato divergente.",
    newVersion: { contentHash: HASH_B },
    contract: { ...evaluation, componentVersion: { contentHash: HASH_C } },
  });
  check(
    "R2-A",
    "el fix A también rechaza la divergencia cuando la versión es content-hash",
    "ok=false con VERSION_IDENTITY_MISMATCH",
    `ok=${result.ok}, code=${result.code}`,
    result.ok === false && result.code === "VERSION_IDENTITY_MISMATCH",
  );
}

// R2-B: dedup de hallazgos previos en createNewEvaluationVersion. La clave se
// construye por interpolación de plantilla sobre componentVersion/protocolVersion.
// Con versiones content-hash (objetos), ambas interpolan a "[object Object]".
// Dos HOLD de versiones distintas deberían conservarse los dos.
{
  const registry = createRoleEvaluationRegistry();
  const evaluation = makeEvaluation({ componentVersion: { contentHash: HASH_A } });
  const { componentId, roleClass } = evaluation;

  registry.registerComponent(evaluation);
  registry.markEvaluationReady(componentId, roleClass, SYNTHETIC_READINESS);
  registry.recordOutcome(componentId, roleClass, "HOLD", { evidenceRefs: [evidence("SYN-HOLD-V1")] });

  // Salto a una segunda versión (content-hash B) y segundo HOLD.
  registry.createNewEvaluationVersion(componentId, roleClass, {
    materialChange: true,
    changeSummary: "SYN: primer salto material.",
    newVersion: { contentHash: HASH_B },
    contract: { ...evaluation, componentVersion: { contentHash: HASH_B } },
  });
  registry.markEvaluationReady(componentId, roleClass, SYNTHETIC_READINESS);
  registry.recordOutcome(componentId, roleClass, "HOLD", { evidenceRefs: [evidence("SYN-HOLD-V2")] });

  // Tercer salto: aquí se recalculan priorFindings y actúa el dedup.
  const third = registry.createNewEvaluationVersion(componentId, roleClass, {
    materialChange: true,
    changeSummary: "SYN: segundo salto material.",
    newVersion: { contentHash: HASH_C },
    contract: { ...evaluation, componentVersion: { contentHash: HASH_C } },
  });

  const priorRefs = third.record.priorFindings.flatMap((f) => f.evidenceRefs.map((e) => e.ref));
  check(
    "R2-B",
    "dos HOLD de versiones content-hash distintas se conservan ambos como hallazgos previos",
    "priorFindings incluye SYN-HOLD-V1 y SYN-HOLD-V2 (2 hallazgos)",
    `priorFindings=${third.record.priorFindings.length}, refs=${JSON.stringify(priorRefs)}`,
    third.record.priorFindings.length === 2 &&
      priorRefs.includes("SYN-HOLD-V1") &&
      priorRefs.includes("SYN-HOLD-V2"),
  );

  // Control: con versiones textuales el mismo escenario sí conserva los dos.
  const control = createRoleEvaluationRegistry();
  const textual = makeEvaluation({ componentId: "SYN-TEXTUAL-COMP", componentVersion: "0.1.0" });
  control.registerComponent(textual);
  control.markEvaluationReady(textual.componentId, textual.roleClass, SYNTHETIC_READINESS);
  control.recordOutcome(textual.componentId, textual.roleClass, "HOLD", { evidenceRefs: [evidence("SYN-HOLD-T1")] });
  control.createNewEvaluationVersion(textual.componentId, textual.roleClass, {
    materialChange: true,
    changeSummary: "SYN: salto textual 1.",
    newVersion: "0.2.0",
    contract: { ...textual, componentVersion: "0.2.0" },
  });
  control.markEvaluationReady(textual.componentId, textual.roleClass, SYNTHETIC_READINESS);
  control.recordOutcome(textual.componentId, textual.roleClass, "HOLD", { evidenceRefs: [evidence("SYN-HOLD-T2")] });
  const controlThird = control.createNewEvaluationVersion(textual.componentId, textual.roleClass, {
    materialChange: true,
    changeSummary: "SYN: salto textual 2.",
    newVersion: "0.3.0",
    contract: { ...textual, componentVersion: "0.3.0" },
  });
  check(
    "R2-B-control",
    "(delimitación) con versiones textuales el dedup conserva los dos HOLD",
    "priorFindings=2",
    `priorFindings=${controlThird.record.priorFindings.length}`,
    controlThird.record.priorFindings.length === 2,
  );
}

// R2-C: el fix C clona la evidencia. ¿Quedan objetos del llamante que el
// registro siga congelando por la misma vía (gate §8.7, versión-objeto)?
{
  const registry = createRoleEvaluationRegistry();
  const callerVersion = { contentHash: HASH_A };
  const evaluation = makeEvaluation({ componentVersion: callerVersion });
  registry.registerComponent(evaluation);
  check(
    "R2-C1",
    "registerComponent no congela el objeto de versión del llamante",
    "Object.isFrozen(callerVersion) === false",
    `frozen=${Object.isFrozen(callerVersion)}`,
    Object.isFrozen(callerVersion) === false,
  );

  const registry2 = createRoleEvaluationRegistry();
  const strategy = makeEvaluation({ componentId: "SYN-STRAT-2", roleClass: "strategy_evidence" });
  const callerGate = { accepted: true, frameworkRef: "operations/receipts/IMP-27-ST-1.json", section: "§8.7" };
  registry2.registerComponent(strategy);
  registry2.markEvaluationReady(strategy.componentId, strategy.roleClass, {
    ...SYNTHETIC_READINESS,
    strategyAdmissionGate: callerGate,
  });
  check(
    "R2-C2",
    "markEvaluationReady no congela el objeto de gate §8.7 del llamante",
    "Object.isFrozen(callerGate) === false",
    `frozen=${Object.isFrozen(callerGate)}`,
    Object.isFrozen(callerGate) === false,
  );
}

// R2-D: el fix B expuso history() como cadena por versión. Comprobar que una
// entrada histórica ya resuelta no se altera al avanzar la versión vigente.
{
  const registry = createRoleEvaluationRegistry();
  const evaluation = makeEvaluation({ componentId: "SYN-HIST-COMP" });
  const { componentId, roleClass } = evaluation;
  registry.registerComponent(evaluation);
  registry.markEvaluationReady(componentId, roleClass, SYNTHETIC_READINESS);
  registry.recordOutcome(componentId, roleClass, "REJECT", { evidenceRefs: [evidence("SYN-REJECT-V1")] });
  registry.createNewEvaluationVersion(componentId, roleClass, {
    materialChange: true,
    changeSummary: "SYN: salto tras REJECT.",
    newVersion: "0.2.0",
  });
  registry.markEvaluationReady(componentId, roleClass, SYNTHETIC_READINESS);
  registry.recordOutcome(componentId, roleClass, "ADMIT", { evidenceRefs: [evidence("SYN-ADMIT-V2")] });

  const history = registry.history(componentId, roleClass);
  check(
    "R2-D",
    "la entrada histórica de una versión resuelta conserva su propio outcome",
    "history[0].outcome.value === 'REJECT' y history[1].outcome.value === 'ADMIT'",
    `len=${history.length}, [0]=${history[0]?.outcome?.value}, [1]=${history[1]?.outcome?.value}`,
    history.length === 2 && history[0]?.outcome?.value === "REJECT" && history[1]?.outcome?.value === "ADMIT",
  );
}

console.log(`\nreviewer-probe ronda 2: ${failed} comprobación(es) fallida(s).`);
