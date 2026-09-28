// SEM2-07 LangScan helper (T-26): renders the four production surfaces plus
// the canonical blocked/unavailable state of each surface (renderErrorState,
// reachable without exploratory data — SEM2-T16) and reports Spanish-looking
// text the reviewer can inspect. Spanish IS the conversation/scheduler
// language, so this is a reviewer aid with an explicit allowlist, not a
// machine verdict; the normative check lives in the SEM-2 tests
// (test/ui/sem2-integration.test.mjs).
import { loadCanonicalUiInputs } from "../../src/ui/canonical-inputs.mjs";
import { buildUiViewModels } from "../../src/ui/server.mjs";
import { renderSurfacePage } from "../../src/ui/render.mjs";

const SURFACES = ["replay", "backtests", "research", "campaigns"];

const ALLOWLIST = [
  "de fill", // technical term kept from the domain vocabulary
];

function stripMarkup(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/g, " ");
}

function scanText(surface, state, html, report) {
  const text = stripMarkup(html);
  const lines = text.split(/\s+/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.length < 3) continue;
    if (/\b(de|la|el|los|las|un|una|para|por|con|sin|se|no|ha|que|del|al|es|en)\b/.test(line) && /[ñáéíóú]/i.test(line)) {
      report.push({ surface, state, token: line });
    }
  }
}

export function langScanProductionPages() {
  const vms = buildUiViewModels(loadCanonicalUiInputs().inputs);
  const report = [];
  for (const surface of SURFACES) {
    scanText(surface, "production", renderSurfacePage(surface, vms[surface]), report);
    // SEM2-T16: the blocked/unavailable state paints §26.2 primary labels too.
    scanText(surface, "blocked", renderSurfacePage(surface, { ok: false, errors: [{ field: "lang-scan", code: "BLOCKED", message: "blocked state" }] }), report);
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = langScanProductionPages();
  if (report.length === 0) {
    console.log("LANGSCAN: no Spanish-looking tokens in the four surfaces (production and blocked states).");
  } else {
    for (const entry of report) {
      console.log(`LANGSCAN ${entry.surface}/${entry.state}: ${entry.token}`);
    }
  }
}
