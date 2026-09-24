// Registro de diseños IMP-22. Un diseño se valida fail-closed al registrar;
// el registro conserva los diseños con su orden y registrado no equivale a
// ejecutado ni admitido (§20.2.3 RESOLVES/PRODUCES vs prerequisite; §0.3).

import { validateExperimentDesign } from "./experiment-design.mjs";

export function createImp22DesignRegistry() {
  const designs = new Map();
  const trades = [];

  function register(design) {
    const result = validateExperimentDesign(design);
    if (!result.ok) {
      const firstCode = result.errors[0]?.code ?? "UNKNOWN";
      trades.push({ rejected: true, code: firstCode, experimentId: design?.identity?.experimentId ?? null });
      return { ok: false, code: result.code, errors: result.errors };
    }
    const experimentId = design.identity.experimentId;
    if (designs.has(experimentId)) {
      trades.push({ rejected: true, code: "IDENTITY_COLLISION", experimentId });
      return {
        ok: false,
        code: "IDENTITY_COLLISION",
        errors: [{ field: "identity.experimentId", code: "IDENTITY_COLLISION", message: `Ya existe un diseño con experimentId ${experimentId}.` }],
      };
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
