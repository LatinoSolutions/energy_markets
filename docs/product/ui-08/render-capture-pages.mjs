// Herramienta de captura visual de UI-08 (no es producto ni test). Renderiza
// la página Backtesting en sus dos estados de referencia — disponible (fixture
// sintético con resultado CURRENT comparable y ablation con efecto) y
// bloqueado (estado canónico sin resultados, UNAVAILABLE explícito) — para
// capturarla a las dos anchuras de referencia (escritorio 1440, iPad 820) y
// compararla con las referencias claras/editoriales aprobadas. Esos valores
// son datos de test, no hechos de producto (§26.5).
//
// Uso: node docs/product/ui-08/render-capture-pages.mjs <dir-salida>

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadCanonicalUiInputs } from "../../../src/ui/canonical-inputs.mjs";
import { buildUiViewModels } from "../../../src/ui/server.mjs";
import { buildBacktestsViewModel } from "../../../src/ui/view-models.mjs";
import { renderSurfacePage } from "../../../src/ui/render.mjs";
import { H_S1_01 } from "../../../src/s1-strategy/h-s1-01.mjs";

const sha = (value) => value.repeat(64 / value.length);

const outDir = process.argv[2];
if (typeof outDir !== "string" || outDir.length === 0) {
  console.error("usage: node docs/product/ui-08/render-capture-pages.mjs <dir-salida>");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const write = (name, html) => {
  writeFileSync(join(outDir, name), html);
  console.log(name);
};

// Estado bloqueado: el estado canónico real del repo (sin requests Development
// comprometidos ni resultados publicados) — UNAVAILABLE explícito y enlaces
// Development marcados bloqueados.
const canonical = loadCanonicalUiInputs();
const blocked = buildUiViewModels(canonical.inputs).backtests;
write("backtests-state-blocked.html", renderSurfacePage("backtests", blocked, {}));

// Estado disponible: fixture sintético con un resultado BT-08 CURRENT y
// comparación válida (evidencia de Development, nunca PASS científico),
// metadatos de benchmark provisionales (por campaña) y la referencia oficial
// del resultado — mismos slots, datos de test.
const availableResult = {
  hypothesisId: H_S1_01.hypothesisId,
  hypothesisVersion: H_S1_01.version,
  missionId: "GAS_MONTHLY",
  runId: `HYP-RUN-${sha("0")}`,
  status: "SUCCEEDED",
  validComparison: true,
  retention: { state: "CURRENT" },
  resultPath: "operations/backtest-runs/capture/output/hypothesis-development-results.json",
  resultSha256: sha("d"),
  phase: "DEVELOPMENT",
  dataMode: "TOB",
  ablation: { paired: true, ok: true, verdict: "HOLD", deltaV: 1.234, equivalentCostDifference: 1.234, absolutePass: false },
  comparison: {
    control: { benchmarkVersion: "B-PROV-v1", benchmarkStatus: "BENCHMARK_PROVISIONAL" },
    active: { benchmarkVersion: "B-OFFICIAL-v2", benchmarkStatus: "RECONCILED_OFFICIAL" },
  },
};
write("backtests-state-available.html", renderSurfacePage("backtests", buildBacktestsViewModel({ hypothesisResults: [availableResult] }), {}));

// Las otras tres superficies en su estado servido por defecto (navegación de
// cuatro pestañas compartida, misma tira canónica).
const vms = buildUiViewModels(canonical.inputs);
for (const surface of ["campaigns", "replay", "research"]) {
  write(`${surface}-served-default.html`, renderSurfacePage(surface, vms[surface], {}));
}
