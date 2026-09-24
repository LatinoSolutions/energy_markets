// src/ui — primera visual de Operator Interface (UI-01). No elige tecnología
// de charting (§26.6): render HTML + view models fail-closed sobre el boundary
// aceptado de IMP-29.

export {
  bindRecord,
} from "./binding.mjs";

export {
  EXPECTED_STRATEGY_STACK,
  SURFACES,
  SURFACES_LIST,
  buildBacktestsViewModel,
  buildCampaignsViewModel,
  buildReplayViewModel,
  buildResearchViewModel,
} from "./view-models.mjs";

export {
  renderBacktestsPage,
  renderCampaignsPage,
  renderNavigationPage,
  renderReplayPage,
  renderResearchPage,
  renderSurfacePage,
} from "./render.mjs";

// UI-03 — gramática visual Claude Blind (layout/interacción) separada del
// boundary: se exporta para que UI-02 pueda servirla y para su verificación.
export {
  PROVENANCE_INTERACTION_SCRIPT,
  UI_STYLESHEET,
  VISUAL_LANGUAGE_ID,
  renderProvenanceDrawerHtml,
  renderSemanticsKeyHtml,
} from "./visual-language.mjs";
