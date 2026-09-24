// Diseños predeclarados de IMP-22 (§25.1 fila IMP-22: "experimentos
// Power/Monthly separados"). Los datos reales de esas Mission son
// AUDIT-DEPENDENT (DEP-01–08 + DEP-12 del nuevo experimento): los diseños se
// entregan validables y fail-closed, sin declarar datos ni resultados
// inventados. Su estado de ejecución es HOLD hasta que la reserva de la
// Mission esté RESERVED y las restricciones del candidato AUDITED (P5.6
// regla 5 aplicada al sizing).

import { makeDesign } from "./builder.mjs";

export const DESIGN_IDS = { GAS_MONTHLY: "IMP22-EX-SZ01-01", POWER_MONTHLY: "IMP22-EX-SZ02-01" };

export const EXPERIMENT_DESIGNS = [makeGasMonthlyDesign(), makePowerMonthlyDesign()];

export function getDesign(designId) {
  const found = EXPERIMENT_DESIGNS.find((design) => design.identity.experimentId === designId) ?? null;
  if (found == null) return null;

  // Copia profunda de datos conservando funciones (guardFunction es código
  // versionado, no estado) para que los consumidores no muten los diseños
  // compartidos del registro.
  const deepCopy = (value) => {
    if (Array.isArray(value)) return value.map(deepCopy);
    if (value !== null && typeof value === "object") {
      const clone = {};
      for (const [key, item] of Object.entries(value)) {
        clone[key] = typeof item === "function" ? item : deepCopy(item);
      }
      return clone;
    }
    return value;
  };
  return deepCopy(found);
}

// Guard determinista de cantidad: clampa q proyectada a [0, RemainingVolume]
// (§4.2: las cantidades respetan la obligación restante). Fixtures de prueba
// estándar en test/imp22-sizing encajan sondeos análogos.
function guardClampToRemaining(projectedQuantity, remainingVolume) {
  if (projectedQuantity <= 0) return 0;
  return Math.min(projectedQuantity, remainingVolume);
}

function homogeneousCandidate(missionId) {
  return {
    identity: {
      sizingCandidateId: "IMP22-SZ-01-01",
      parametrizationVersion: "v1-rule-homogeneous",
      missionId,
    },
    family: "RULE",
    constraintStatus: "AUDIT_PENDING",
    constraints: {
      lotSizeAvailable: false,
      roundingRuleAvailable: false,
      feasibilityGuardsInstalled: true,
      guardFunction: guardClampToRemaining,
      unknownsDeclared: ["lotSize", "roundingRule"],
    },
    evaluationBinding: { sizeOnlyArm: true, executedStandalone: false },
  };
}

// Versión histórica del mold: homogeneous controller de la propia Mission
// (§13.2 aplicado por Mission) como brazo size-only único de arranque.
function makeGasMonthlyDesign() {
  const design = makeDesign("IMP22-EX-SZ01-01", "GAS-MONTHLY", "IMP22-RSV-01-01");
  design.candidates = [homogeneousCandidate("GAS-MONTHLY")];
  return design;
}

function makePowerMonthlyDesign() {
  const design = makeDesign("IMP22-EX-SZ02-01", "POWER-MONTHLY", "IMP22-RSV-01-02");
  design.candidates = [homogeneousCandidate("POWER-MONTHLY")];
  return design;
}
