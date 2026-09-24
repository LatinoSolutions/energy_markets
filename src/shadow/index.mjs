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
} from "./capture.mjs";
export {
  verifyShadowNonInterference,
} from "./non-interference.mjs";
export {
  closeShadowSession,
  applyShadowCorrection,
  SHADOW_EVIDENCE_RECEIPT_KIND,
} from "./close.mjs";
