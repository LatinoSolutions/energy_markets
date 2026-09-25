// UI-05 (owner request 25-sep-2026, PLAN_STATUS UI-05): fidelidad con el mockup
// DES-01 sobre las superficies exploratorias con data real de UI-04. Cada test fija una
// pieza de diseño del mockup y comprueba que su dato sale del artifact verificado, o
// que queda UNKNOWN cuando el artifact no lo trae.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildUiViewModels } from "../../src/ui/server.mjs";
import { EXPLORATORY_MANIFEST_PATH, loadCanonicalUiInputs } from "../../src/ui/canonical-inputs.mjs";
import { BT02_CURRENT_RELEASE, BT02_RELEASES } from "../../src/exploratory/reconciliation.mjs";
import { renderSurfacePage } from "../../src/ui/render.mjs";
import { projectExploratoryPages } from "../../src/ui/view-models.mjs";

const canonical = loadCanonicalUiInputs();
const results = canonical.inputs.exploratoryBacktest?.results;
const vms = buildUiViewModels(canonical.inputs);

function count(html, pattern) {
  return (html.match(pattern) ?? []).length;
}

// Sección por defecto de Replay: primer episodio Quarterly con compras, primera compra.
function defaultReplaySection(html) {
  const start = html.indexOf('class="xsel xdefault"');
  assert.ok(start > 0, "hay una sección por defecto");
  return html.slice(start, html.indexOf("</section>\n", html.indexOf('class="zone hind"', start)));
}

test("UI-05: el artifact exploratorio está cargado y verificado por hash", () => {
  assert.equal(canonical.backend.exploratory.loaded, true, JSON.stringify(canonical.backend.exploratory));
  assert.equal(results.status, "EXPLORATORY");
});

test("UI-05: la tira de decisiones y la serie de 11:00 del artifact están alineadas día a día", () => {
  for (const episode of results.replay) {
    const days = episode.decisions.ARM_A.map((decision) => decision.day);
    assert.deepEqual(days, episode.ask11.map((point) => point.day), `${episode.product} ${episode.maturity}`);
    for (const item of episode.inspector) {
      assert.equal(episode.decisions.ARM_A[item.index].status, "FILLED");
      assert.equal(episode.decisions.ARM_A[item.index].day, item.day);
    }
  }
});

test("UI-05 Replay: cadena de cuatro objetos, horizonte, zonas y leyenda del mockup", () => {
  const html = renderSurfacePage("replay", vms.replay);
  const purchases = results.replay.reduce((sum, episode) => sum + episode.inspector.length, 0);
  assert.equal(count(html, /<div class="chain">/g), purchases);
  assert.equal(count(html, /class="obj z-asof/g), purchases);
  assert.equal(count(html, /class="obj z-exec/g), 2 * purchases);
  assert.equal(count(html, /class="obj z-hind/g), purchases);
  assert.equal(count(html, /<span>EVALUATION · LATER<\/span>/g), purchases);
  assert.equal(count(html, /<span>KNOWLEDGE HORIZON<\/span>/g), purchases);
  assert.equal(count(html, /<div class="zones">/g), purchases);
  assert.equal(count(html, /<span class="zt asof">T₀ · decision-time<\/span><span class="zt exec">Execution<\/span><span class="zt hind">Later · evaluation<\/span>/g), purchases);
  assert.equal(count(html, /<th>Inputs in decision snapshot<\/th><th>Value at T₀<\/th><th>Observed at<\/th><th>Age at T₀<\/th><th>State<\/th>/g), purchases);
  assert.equal(count(html, /<button type="button" class="btn" data-hind-toggle/g), purchases);
});

test("UI-05 Replay: los valores de la decisión por defecto salen del artifact", () => {
  const html = renderSurfacePage("replay", vms.replay);
  const section = defaultReplaySection(html);
  const episode = results.replay.find((entry) => entry.product === "G0BQ" && entry.inspector.length > 0);
  const item = episode.inspector[0];
  assert.match(section, new RegExp(`data-decision="G0BQ-${episode.maturity}-${item.index}"`));
  assert.ok(section.includes(`BUY at ${item.day} 11:00 Berlin`));
  assert.ok(section.includes(`${item.ask.toFixed(2)} €/MWh`));
  assert.ok(section.includes(item.quoteTm));
  assert.ok(section.includes(`${item.filledMw} of ${item.requestedMw} MW`));
  assert.ok(section.includes(`evaluation closed ${episode.ask11.at(-1).day}`));
  assert.ok(section.includes(`Evaluation closed ${episode.ask11.at(-1).day}`));
  assert.ok(section.includes(`${episode.ask11[0].day} → ${episode.ask11.at(-1).day}`));
  assert.ok(section.includes(`Run timeline · ${episode.decisions.ARM_A.length} decisions`));
  // Una marca por día del brazo A; las compras con detalle son enlaces a su sección.
  const strip = section.slice(section.indexOf('<div class="tl">'), section.indexOf("</svg>", section.indexOf('<div class="tl">')));
  assert.equal(count(strip, /stroke="var\(--asof\)" stroke-width/g), episode.decisions.ARM_A.length);
  assert.equal(count(strip, /<a href="#rep-/g), episode.inspector.length);
});

test("UI-05 Replay: lo que el artifact no trae queda UNKNOWN y la UI no calcula el spread", () => {
  const section = defaultReplaySection(renderSurfacePage("replay", vms.replay));
  assert.match(section, /Trigger mean \(previous asks\)<\/td><td class="mono num"><span class="unkv">UNKNOWN<\/span>/);
  assert.match(section, /Execution fees<\/td><td class="mono num"><span class="unkv">UNKNOWN<\/span>/);
  assert.match(section, /Time in force<\/dt><dd><span class="unkv">UNKNOWN<\/span>/);
  assert.doesNotMatch(section, /spread/i);
});

test("UI-05 Replay: después de T₀ sólo se dibuja en la capa de hindsight, oculta por defecto", () => {
  const section = defaultReplaySection(renderSurfacePage("replay", vms.replay));
  const chart = section.slice(section.indexOf('<div class="chartwrap">'), section.indexOf("</svg>", section.indexOf('<div class="chartwrap">')));
  assert.match(chart, /<g class="sealed-layer">.*Sealed: after T₀/s);
  assert.match(chart, /<g class="hind-layer"><path d="M[^"]+" fill="none" stroke="var\(--hind\)"/);
  // La serie conocida (color as-of) termina en T₀: tantos puntos como días hasta la decisión.
  const known = chart.match(/<path d="([^"]+)" fill="none" stroke="var\(--asof\)"/)[1];
  const episode = results.replay.find((entry) => entry.product === "G0BQ" && entry.inspector.length > 0);
  assert.equal(count(known, /[ML]/g), episode.inspector[0].index + 1);
});

test("UI-05 Campaigns: rail en una tarjeta, tabla de runs de 7 columnas con barra y ledger de receipts", () => {
  const html = renderSurfacePage("campaigns", vms.campaigns);
  assert.equal(count(html, /<a class="it crow" href="#cmp-/g), results.campaigns.length);
  assert.equal(count(html, /<div class="card crail">/g), 1);
  const withRuns = results.campaigns.filter((campaign) => campaign.runs.length > 0);
  assert.equal(count(html, /<th>Run<\/th><th>Arm<\/th><th>Status<\/th><th>Decisions · evaluation<\/th><th>Determinism<\/th><th>Receipts<\/th><th>Drill down<\/th>/g), withRuns.length);
  const runs = withRuns.reduce((sum, campaign) => sum + campaign.runs.length, 0);
  assert.equal(count(html, /<div class="bar" title="closed \/ open \/ not run">/g), runs);
  assert.equal(count(html, /class="unk-item"/g), results.campaigns.length * results.campaignUnknowns.length);
  // Receipts solo respaldan runs: sin runs, NO RECEIPTS honesto (UI05-RCP-01).
  const withoutRuns = results.campaigns.length - withRuns.length;
  assert.ok(withoutRuns > 0);
  assert.equal(count(html, /<div class="receipt">/g), withRuns.length * 4);
  assert.equal(count(html, /<span class="withheld">NO RECEIPTS<\/span> <span class="small muted">no run exists for this campaign<\/span>/g), withoutRuns);
  for (const campaign of results.campaigns.filter((item) => item.runs.length === 0)) {
    const section = html.split(`id="cmp-${campaign.id}"`)[1].split("</section>")[0];
    assert.equal(count(section, /<div class="receipt">/g), 0);
    assert.match(section, /NO RUNS/);
  }
  assert.match(html, /decision not run \(unknown, not zero\)/);
  // La campaña por defecto es el primer Quarterly completo, como en Replay.
  const firstQuarterly = withRuns.find((campaign) => campaign.product === "G0BQ");
  assert.match(html, new RegExp(`class="xsel xdefault" id="cmp-${firstQuarterly.id}"`));
  // Cerradas sólo si el backend declara PASS en el gate de la ventana de evaluación.
  for (const campaign of withRuns) {
    assert.equal(campaign.gates.find((gate) => gate.label === "Evaluation window closed")?.status, "PASS");
  }
});

test("UI-05 Campaigns: el determinismo por run queda UNKNOWN (el artifact solo trae un check global)", () => {
  const html = renderSurfacePage("campaigns", vms.campaigns);
  const runs = results.campaigns.reduce((sum, campaign) => sum + campaign.runs.length, 0);
  assert.ok(runs > 0);
  assert.equal(count(html, /Deterministic/g), 0);
  assert.equal(count(html, /<td title="the artifact carries no per-run determinism[^"]*"><span class="st unk">/g), runs);
  for (const campaign of results.campaigns) {
    for (const run of campaign.runs) assert.equal(Object.keys(run).some((key) => /determin/i.test(key)), false, "si un productor por-run aparece, este test debe cambiar");
  }
});

test("UI-05 Research: la fecha de registro de la hipótesis no se inventa (el artifact no la trae)", () => {
  const html = renderSurfacePage("research", vms.research);
  for (const candidate of results.research.candidates) assert.equal(Object.keys(candidate).some((key) => /regist|date/i.test(key)), false);
  const hypothesisCards = count(html, /<h3>Hypothesis<\/h3>/g);
  assert.ok(hypothesisCards > 0);
  assert.equal(count(html, /registered 20\d\d-/g), 0);
  assert.equal(count(html, /registered <span[^>]*>not recorded<\/span> · exploratory phase \(EM-SPEC-OWNER-PATCH-2026-09-24-02\)/g), hypothesisCards);
});

test("UI-05 Research: pila en una tarjeta con recuento de evidencia, criterios, linaje con flecha y receipts de 5 columnas", () => {
  const html = renderSurfacePage("research", vms.research);
  const candidates = results.research.candidates;
  assert.equal(count(html, /<a class="it" href="#res-/g), candidates.length);
  assert.equal(count(html, /<div class="card stack">/g), 1);
  for (const candidate of candidates) {
    const expected = candidate.armId ? 4 : 0;
    assert.match(html, new RegExp(`href="#res-${candidate.id}">[\\s\\S]*?EVIDENCE ${expected}<`));
  }
  const criteria = candidates.reduce((sum, candidate) => sum + candidate.criteria.reduce((inner, group) => inner + group.items.length, 0), 0);
  assert.equal(count(html, /<div class="crit">/g), criteria);
  const exploratoryArms = candidates.filter((candidate) => candidate.armId && candidate.armId !== "BASELINE").length;
  assert.equal(count(html, /marker-end="url\(#emArr\)"/g), exploratoryArms);
  assert.match(html, /<marker id="emArr"/);
  assert.equal(count(html, /<th>Receipt<\/th><th>Kind<\/th><th>What<\/th><th>Recorded<\/th><th><\/th>/g), candidates.length);
  assert.equal(count(html, /NO VERSION RUN · hypothesis only/g), candidates.filter((candidate) => !candidate.armId).length);
});

test("UI-05 Backtests: leyenda de brazos, tabla de datos, histogramas con eje y forest plot por producto", () => {
  const html = renderSurfacePage("backtests", vms.backtests);
  const products = Object.keys(results.comparison);
  assert.match(html, /<div class="armhead"><span class="arm"><span class="sw" style="background:var\(--arm-base\)"><\/span>Baseline<\/span><span class="arm">[^]*?Arm A<\/span><span class="arm">[^]*?Arm B<\/span><\/div>/);
  assert.match(html, /Does another hour or a dip rule buy cheaper than the client's 11:00\?/);
  assert.equal(count(html, /<details class="tbl"><summary>Show data table/g), products.length);
  for (const product of products) {
    assert.ok(html.includes(`Show data table (${results.comparison[product].perEpisode.length} episodes, every arm)`));
  }
  assert.equal(count(html, /aria-label="ΔV per episode vs Baseline, k€"/g), products.length);
  assert.equal(count(html, /aria-label="H minus B\* per decision"><g class="axis">/g), 2 * products.length);
  // Las secciones nuevas de UI-04/BT-03 siguen presentes.
  assert.match(html, /data-kind="backend-measurements"/);
  assert.match(html, /Exploratory backtest · real EEX best ask/);
});

test("UI-05: el reloj del shell muestra el último día del snapshot EEX en las páginas exploratorias", () => {
  const lastDataDay = results.inputs.dataPeriod.lastDataDay;
  for (const surface of ["replay", "backtests", "research", "campaigns"]) {
    const html = renderSurfacePage(surface, vms[surface]);
    assert.ok(html.includes(`data as-of <b>${lastDataDay}</b>`), surface);
  }
  const failClosed = renderSurfacePage("replay", buildUiViewModels({}).replay);
  assert.match(failClosed, /data as-of <span class="unkv">UNAVAILABLE<\/span>/);
});

// UI05-CAP-01 (review 2026-09-25): las capturas del gate P-008 salieron del artifact v1
// superseded. Se fija que las páginas pintan el snapshot de la release vigente (BT-04).
test("UI-05: las páginas exploratorias pintan el snapshot del manifest de la release vigente", () => {
  assert.equal(EXPLORATORY_MANIFEST_PATH, BT02_RELEASES[BT02_CURRENT_RELEASE].exploratoryManifest);
  assert.equal(canonical.backend.exploratory.manifestPath, EXPLORATORY_MANIFEST_PATH);
  const manifest = JSON.parse(readFileSync(new URL(`../../${EXPLORATORY_MANIFEST_PATH}`, import.meta.url), "utf8"));
  assert.equal(canonical.backend.exploratory.slotsSha256, manifest.slots.sha256);
  assert.equal(canonical.backend.exploratory.resultsSha256, manifest.results.sha256);
  for (const surface of ["replay", "backtests", "research", "campaigns"]) {
    const html = renderSurfacePage(surface, vms[surface]);
    assert.ok(html.includes(`sha ${manifest.slots.sha256.slice(0, 12)}`), surface);
  }
});

test("UI-05: ningún dato demo del mockup entra en las páginas exploratorias", () => {
  for (const surface of ["replay", "backtests", "research", "campaigns"]) {
    const html = renderSurfacePage(surface, vms[surface]);
    assert.doesNotMatch(html, /SYN-|Cal-27|Tranche-trigger|Procurement committee|T₀\s*\+\s*84|Budget 92|Trigger 89/, surface);
  }
});

// Rail por misión: decisión de Bru 2026-09-25 (P-008), prototipo
// UI-05-prototipo-2026-09-25/prototipo-ui05.html (sha256 a79c8652…), pestaña Campaigns.

function railHtml(html) {
  const start = html.indexOf('<div class="card crail">');
  assert.ok(start > 0, "hay rail de campaigns");
  return html.slice(start, html.indexOf('<div class="clegend">', start));
}

function groupHtml(rail, mission) {
  const start = rail.indexOf(`data-mission="${mission}"`);
  assert.ok(start > 0, mission);
  return rail.slice(start, rail.indexOf("</details>", start));
}

test("UI-05 Campaigns rail: el view model agrupa por misión con recuentos, entrega y ventana del artifact", () => {
  const groups = vms.campaigns.exploratory.campaignGroups;
  assert.deepEqual(groups.map((group) => group.mission), ["Gas Quarterly", "Gas Monthly", "Power Quarterly", "Power Monthly"]);
  for (const group of groups) {
    const members = results.campaigns.filter((campaign) => group.product !== null && campaign.product === group.product);
    assert.equal(group.total, members.length, group.mission);
    assert.equal(group.complete, members.filter((campaign) => campaign.readiness === "EXPLORATORY_COMPLETE").length);
    assert.equal(group.insufficient, members.filter((campaign) => campaign.readiness === "INSUFFICIENT_DATA").length);
    assert.deepEqual(group.campaigns.map((row) => row.id), members.map((campaign) => campaign.id));
    for (const [index, row] of group.campaigns.entries()) {
      const campaign = members[index];
      assert.deepEqual(row.window, campaign.firstDay ? { firstDay: campaign.firstDay, lastDay: campaign.lastDay } : null, row.id);
    }
  }
  // Cada campaign del artifact aparece exactamente una vez.
  assert.equal(groups.reduce((sum, group) => sum + group.total, 0), results.campaigns.length);
  assert.equal(groups[2].total + groups[3].total, 0, "Power no tiene campaigns en el artifact");
  // Formato de entrega pedido por Bru: "Q1-2026" y "Oct 2025".
  const label = (id) => groups.flatMap((group) => group.campaigns).find((row) => row.id === id).deliveryLabel;
  assert.equal(label("GAS-Q-202601"), "Q1-2026");
  assert.equal(label("GAS-Q-202510"), "Q4-2025");
  assert.equal(label("GAS-M-202510"), "Oct 2025");
  assert.equal(label("GAS-M-202601"), "Jan 2026");
});

test("UI-05 Campaigns rail: grupos plegables, solo abierto el de la campaign por defecto, Power 'no data yet'", () => {
  const html = renderSurfacePage("campaigns", vms.campaigns);
  const rail = railHtml(html);
  assert.equal(count(rail, /<details class="cgrp"/g), 4);
  assert.equal(count(rail, /<details class="cgrp"[^>]* open>/g), 1);
  assert.match(groupHtml(rail, "Gas Quarterly"), /^data-mission="Gas Quarterly" open>/);
  assert.match(rail, new RegExp(`CAMPAIGNS · ${results.campaigns.length}`));
  for (const group of vms.campaigns.exploratory.campaignGroups) {
    const section = groupHtml(rail, group.mission);
    if (group.total === 0) {
      assert.match(section, /<span class="csum">no data yet<\/span>/, group.mission);
      assert.equal(count(section, /class="it crow"/g), 0);
      continue;
    }
    assert.ok(section.includes(`<span class="csum">${group.total} campaigns · ${group.complete} complete · ${group.insufficient} insufficient</span>`), group.mission);
    assert.equal(count(section, /class="it crow"/g), group.total);
  }
  // La campaign seleccionada por defecto vive en el grupo abierto.
  const selected = html.match(/class="xsel xdefault" id="cmp-([^"]+)"/)[1];
  assert.ok(groupHtml(rail, "Gas Quarterly").includes(`href="#cmp-${selected}"`));
  // Navegar a otra campaign abre su grupo y cierra el resto (script inline, sin red).
  assert.match(html, /group\.open = group\.contains\(row\)/);
});

test("UI-05 Campaigns rail: 1 línea por campaign con punto de estado, entrega y ventana; ventana ausente = UNAVAILABLE", () => {
  const rail = railHtml(renderSurfacePage("campaigns", vms.campaigns));
  const rows = vms.campaigns.exploratory.campaignGroups.flatMap((group) => group.campaigns);
  for (const row of rows) {
    const start = rail.indexOf(`data-campaign-row="${row.id}"`);
    const line = rail.slice(start, rail.indexOf("</a>", start));
    const dot = row.readiness === "EXPLORATORY_COMPLETE" ? "ok" : "insuf";
    assert.ok(line.includes(`<span class="cdot ${dot}" aria-label="${row.readinessLabel}"></span>`), row.id);
    assert.ok(line.includes(`<span class="cdel">${row.deliveryLabel}</span>`), row.id);
    const window = row.window ? `${row.window.firstDay} → ${row.window.lastDay}` : '<span class="unkv">UNAVAILABLE</span>';
    assert.ok(line.includes(`<span class="cwin">${window}</span>`), row.id);
  }
  const withoutWindow = results.campaigns.filter((campaign) => !campaign.firstDay);
  assert.ok(withoutWindow.length > 0);
  assert.equal(count(rail, /<span class="cwin"><span class="unkv">UNAVAILABLE<\/span><\/span>/g), withoutWindow.length);
  assert.doesNotMatch(rail, /undefined|NaN|null/);
});

test("UI-05 Campaigns rail: el render pinta lo que dice el view model, no recalcula recuentos ni etiquetas", () => {
  const exploratory = structuredClone(vms.campaigns.exploratory);
  exploratory.campaignGroups[0].complete = 99;
  exploratory.campaignGroups[0].campaigns[0].deliveryLabel = "VM-LABEL";
  const rail = railHtml(renderSurfacePage("campaigns", { ...vms.campaigns, exploratory }));
  assert.ok(rail.includes("· 99 complete ·"));
  assert.ok(rail.includes('<span class="cdel">VM-LABEL</span>'));
});

test("UI-05 Campaigns rail: maturity ilegible = UNAVAILABLE y un producto sin misión no desaparece", () => {
  const pages = projectExploratoryPages({
    provenance: {},
    results: {
      status: "EXPLORATORY",
      replay: [],
      campaigns: [
        { id: "GAS-Q-BAD", product: "G0BQ", maturity: "2026", readiness: "EXPLORATORY_COMPLETE", firstDay: "2025-09-01", lastDay: "2025-11-28" },
        { id: "X-1", product: "XPRD", maturity: "202603", readiness: "INSUFFICIENT_DATA", firstDay: null, lastDay: null },
      ],
    },
  });
  const quarterly = pages.campaignGroups.find((group) => group.mission === "Gas Quarterly");
  assert.equal(quarterly.campaigns[0].deliveryLabel, "UNAVAILABLE");
  const unmapped = pages.campaignGroups.find((group) => group.product === "XPRD");
  assert.equal(unmapped.mission, "Unmapped product XPRD");
  assert.equal(unmapped.total, 1);
  assert.equal(unmapped.insufficient, 1);
  assert.equal(unmapped.campaigns[0].window, null);
});
