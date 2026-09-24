// Superficie del alcance IMP-20: diseño posterior de experimentos S2–S5 y
// Z/drivers admitidos (§25.1 fila IMP-20; §§7–10, 19; DEP-15/16 §24).

export {
  EXPERIMENT_IDENTITY_FIELDS,
  IMP20_EXPERIMENT_ID_PATTERN,
  isValidExperimentId,
  validateExperimentIdentity,
} from "./identity.mjs";

export { CANDIDATE_LAYERS, DEP15_LANE, DEP16_LANE, LAYER_IDS, getLayer, isLayerId } from "./layers.mjs";

export { TOPOLOGIES, TOPOLOGY_IDS, getTopology, isTopologyId } from "./topologies.mjs";

export {
  ACCOUNTING_FIELDS,
  COMPARATOR_RULE,
  MARGINAL_VALUE_DECLARATION,
  REDUNDANCY_DECLARATION,
  validateAccountingParity,
} from "./accounting.mjs";

export { UNKNOWN_KINDS, HE_KIND, validateUnknownEntry, validateUnknownsRegistry } from "./unknowns.mjs";

export {
  assertLayersAreRegisteredAndFrozen,
  assertNoAutomaticAuthority,
  assertNoMandatory23Drivers,
  assertNoP5Ampliation,
} from "./constraints.mjs";

export { EXPERIMENT_DESIGN_FIELDS, validateExperimentDesign } from "./experiment-design.mjs";

export { DESIGN_IDS, EXPERIMENT_DESIGNS, SPEC_SHA256, getDesign } from "./designs.mjs";

export { createExperimentDesignRegistry } from "./registry.mjs";
