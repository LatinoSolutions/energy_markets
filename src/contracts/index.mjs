// Surface del contrato de identidad/versiones/namespaces de IMP-01 (ST-01.1).
// Fuente: SPEC v1.1 §§0,3,13,14,20.2.7–20.2.10,25.1.

export {
  NAMESPACE_SEPARATOR,
  MULTI_SCOPE_SYMBOLS,
  resolveSymbol,
  scopesForLabel,
} from "./namespaces.mjs";

export {
  STATE_NAMESPACES,
  resolveState,
  namespacesForLabel,
  validateStateClaims,
} from "./states.mjs";

export {
  isVersionString,
  isVersionLike,
  isSha256,
  validateSpecIdentity,
  validateWorkPacket,
  validateStReceipt,
  validateImpReceipt,
  linkStReceiptToPacket,
} from "./identities.mjs";

export {
  REQUIRED_BUNDLE_INPUTS,
  validateEconomicBundle,
} from "./economic-bundle.mjs";