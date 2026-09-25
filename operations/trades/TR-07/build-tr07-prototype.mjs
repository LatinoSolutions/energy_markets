// TR-07 — composición productiva de la pantalla de Backtests con los paneles TRADES.
//
// El gate visual de TR-07 quedó cerrado el 2026-09-25 (P-010, opción B): Bru aprobó
// el diseño sobre el prototipo navegable de design-selections. La UI productiva vive
// ya en src/ui/render.mjs (selector mercado/misión + modo TOB·TRADES, barra de zonas,
// paneles de cobertura/zonas/calibración/contrato congelado/resultados y panel de
// contraste) sobre el view model real de src/ui/trades-panels.mjs.
//
// Este script sólo materializa esa composición a un HTML para inspección: no calcula
// nada ni inyecta datos. Cada panel muestra su estado real del backend (cobertura
// PENDING_SCAN_JOB, fuente TR-01 PENDING_ARCHIVE_VERIFICATION, OOS sellado, TR-04/TR-06
// UNAVAILABLE) y nunca un cero como medición.
//
// Uso: node operations/trades/TR-07/build-tr07-prototype.mjs

import { writeFileSync } from "node:fs";
import path from "node:path";

import { loadCanonicalUiInputs } from "../../../src/ui/canonical-inputs.mjs";
import { buildUiViewModels } from "../../../src/ui/server.mjs";
import { renderSurfacePage } from "../../../src/ui/render.mjs";
import { DEFAULT_REPO_ROOT } from "../../../src/pit-views/index.mjs";

const OUT = "operations/trades/TR-07/prototipo-tr07.html";

const canonical = loadCanonicalUiInputs();
const vms = buildUiViewModels(canonical.inputs);
const panels = vms.backtests.tradesPanels;
const html = renderSurfacePage("backtests", vms.backtests);

const outPath = path.join(DEFAULT_REPO_ROOT, OUT);
writeFileSync(outPath, html);
console.log(`composición TR-07 escrita en ${outPath}`);
console.log(`paneles: cobertura=${panels.coverage.status} zonas=${panels.zones.status} calibración=${panels.calibration.status} contrato=${panels.frozenContract.status} resultados=${panels.results.status}`);
