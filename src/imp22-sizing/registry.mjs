// Registro de diseños IMP-22. Un diseño se valida fail-closed al registrar;
// el registro conserva los diseños con su orden y registrado no equivale a
// ejecutado ni admitido (§20.2.3 RESOLVES/PRODUCES vs prerequisite; §0.3).

import { validateExperimentDesign } from "./experiment-design.mjs";

export function createImp22DesignRegistry() {
  const designs = new Map();
  const candidateOwners = new Map();
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
    // El sizingCandidateId es la identidad versionada del candidato: un
    // mismo ID en experimentos (o Mission) distintos es una colisión
    // detectable, no un alias seguro (Ref: hallazgo IMP22-H5).
    for (const candidate of Array.isArray(design.candidates) ? design.candidates : []) {
      const candidateId = candidate?.identity?.sizingCandidateId;
      if (typeof candidateId !== "string" || candidateId.trim() === "") continue;
      const owner = candidateOwners.get(candidateId);
      if (owner != null && owner !== experimentId) {
        trades.push({ rejected: true, code: "SIZING_CANDIDATE_ID_COLLISION", experimentId, candidateId });
        return {
          ok: false,
          code: "SIZING_CANDIDATE_ID_COLLISION",
          errors: [{
            field: "candidates[].identity.sizingCandidateId",
            code: "SIZING_CANDIDATE_ID_COLLISION",
            message: `sizingCandidateId ${candidateId} ya está registrado para el experimento ${owner}.`,
          }],
        };
      }
      candidateOwners.set(candidateId, experimentId);
    }
    designs.set(experimentId, design);
    trades.push({ rejected: false, experimentId });
    return { ok: true, code: "VALID" };
  }

  return {
    register,
    get: (experimentId) => designs.get(experimentId) ?? null,
    list: () => [...designs.values()],
    ownerOf: (sizingCandidateId) => candidateOwners.get(sizingCandidateId) ?? null,
    trades: () => [...trades],
  };
}
