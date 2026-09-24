// Registro de diseños de experimentos IMP-20. Un diseño se valida
// fail-closed al registrar; el registro conserva los diseños con su orden y
// expone su estado. Registrar un diseño NO lo ejecuta ni lo admite.

import { validateExperimentDesign } from "./experiment-design.mjs";

export function createExperimentDesignRegistry() {
  const designs = new Map();
  const trades = [];

  function register(design) {
    const result = validateExperimentDesign(design);
    if (!result.ok) {
      trades.push({ rejected: true, code: result.code, experimentId: design?.identity?.experimentId ?? null });
      return { ok: false, code: result.code, errors: result.errors };
    }
    const experimentId = design.identity.experimentId;
    if (designs.has(experimentId)) {
      const collision = { ok: false, code: "IDENTITY_COLLISION", errors: [{ field: "identity.experimentId", code: "IDENTITY_COLLISION", message: `Ya existe un diseño con experimentId ${experimentId}.` }] };
      trades.push({ rejected: true, code: "IDENTITY_COLLISION", experimentId });
      return collision;
    }
    designs.set(experimentId, design);
    trades.push({ rejected: false, experimentId });
    return { ok: true, code: "VALID" };
  }

  return {
    register,
    get: (experimentId) => designs.get(experimentId) ?? null,
    list: () => [...designs.values()],
    trades: () => [...trades],
  };
}
