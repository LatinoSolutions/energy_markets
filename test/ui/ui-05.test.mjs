// UI-05 (owner request 25-sep-2026, PLAN_STATUS UI-05): fidelidad con el mockup
// DES-01 sobre las superficies exploratorias con data real de UI-04. Cada test fija una
// pieza de diseño del mockup y comprueba que su dato sale del artifact verificado, o
// que queda UNKNOWN cuando el artifact no lo trae.

import test from "node:test";
import assert from "node:assert/strict";

import { buildUiViewModels } from "../../src/ui/server.mjs";
import { loadCanonicalUiInputs } from "../../src/ui/canonical-inputs.mjs";
import { renderSurfacePage } from "../../src/ui/render.mjs";

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
  assert.equal(count(html, /<a class="it" href="#cmp-/g), results.campaigns.length);
  assert.equal(count(html, /<div class="card clist">/g), 1);
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

test("UI-05: ningún dato demo del mockup entra en las páginas exploratorias", () => {
  for (const surface of ["replay", "backtests", "research", "campaigns"]) {
    const html = renderSurfacePage(surface, vms[surface]);
    assert.doesNotMatch(html, /SYN-|Cal-27|Tranche-trigger|Procurement committee|T₀\s*\+\s*84|Budget 92|Trigger 89/, surface);
  }
});
