// Interface del módulo Shadow (IMP-18): captura prospectiva (§15.3),
// verificación de non-interference (§15.1/§12.1/§11.5) y cierre con
// comparación vs baseline/closed benchmark y correcciones en receipts
// separados (§25.1).
export {
  openShadowSession,
  intactedSession,
  SHADOW_SESSION_KIND,
  SHADOW_DECLARED_AUTHORITY,
} from "./session.mjs";
export {
  openShadowProgress,
  captureShadowOpportunity,
  SHADOW_STEP_KIND,
  FORWARD_TRADES_REGISTRATION_KIND,
  FORWARD_TRADES_SOURCE_TOB,
  FORWARD_TRADES_OBSERVATION_SOURCES,
  FORWARD_TRADES_HYPOTHESIS_RULES,
  openForwardTradesState,
  registerForwardTradesHypotheses,
} from "./capture.mjs";
export {
  verifyShadowNonInterference,
  SHADOW_NON_INTERFERENCE_VERIFIED,
  SHADOW_NON_INTERFERENCE_BROKEN,
} from "./non-interference.mjs";
export {
  closeShadowSession,
  applyShadowCorrection,
  SHADOW_EVIDENCE_RECEIPT_KIND,
  SHADOW_RECEIPT_KIND,
} from "./close.mjs";
