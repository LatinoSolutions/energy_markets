// UI-06 (owner request 25-sep-2026, PLAN_STATUS UI-06): tooltip del chart "Paired
// effect over the campaigns". Cada campo del tooltip sale del artifact exploratorio
// verificado por hash; lo que el artifact no trae queda UNAVAILABLE.

import test from "node:test";
import assert from "node:assert/strict";

import { buildUiViewModels } from "../../src/ui/server.mjs";
import { loadCanonicalUiInputs } from "../../src/ui/canonical-inputs.mjs";
import { renderSurfacePage } from "../../src/ui/render.mjs";
import { projectPairedPoints } from "../../src/ui/view-models.mjs";

const canonical = loadCanonicalUiInputs();
const results = canonical.inputs.exploratoryBacktest?.results;
const vms = buildUiViewModels(canonical.inputs);
const pairedPoints = vms.backtests.exploratory.pairedPoints;

function tipModels(html) {
  const blocks = [...html.matchAll(/<div class="ppwrap" data-paired-product="([^"]+)">[\s\S]*?<script type="application\/json" class="ppdata">([\s\S]*?)<\/script>/g)];
  return Object.fromEntries(blocks.map(([, product, json]) => [product, JSON.parse(json)]));
}

function replayOf(product, maturity) {
  return results.replay.find((entry) => entry.product === product && entry.maturity === maturity);
}

test("UI-06: hay un detalle por cada punto del efecto emparejado, en los dos productos", () => {
  assert.equal(canonical.backend.exploratory.loaded, true);
  for (const [product, block] of Object.entries(results.comparison)) {
    const details = pairedPoints[product];
    assert.equal(details.length, block.paired.ARM_A.points.length, product);
    details.forEach((detail, index) => {
      assert.equal(detail.index, index);
      assert.equal(detail.ledgerAvailable, true, `${product} punto ${index}`);
    });
  }
});

test("UI-06: fecha, campaña, target y ledger salen del replay del mismo episodio", () => {
  for (const [product, details] of Object.entries(pairedPoints)) {
    for (const detail of details) {
      const replay = replayOf(product, detail.maturity);
      const offset = detail.decisionNumber - 1;
      const baseline = replay.decisions.BASELINE[offset];
      const armA = replay.decisions.ARM_A[offset];
      const campaign = results.campaigns.find((entry) => entry.product === product && entry.maturity === detail.maturity);
      assert.equal(detail.decisionsInCampaign, replay.decisions.ARM_A.length);
      assert.equal(detail.day, armA.day);
      assert.equal(detail.day, baseline.day);
      assert.equal(detail.campaignId, campaign.id);
      assert.equal(detail.targetMw, campaign.targetMw);
      assert.equal(detail.bestAsk.eurMwh, armA.ask);
      assert.equal(detail.bestAsk.quoteTm, armA.quoteTm);
      for (const [armId, ledger] of [["BASELINE", baseline], ["ARM_A", armA]]) {
        const row = detail.arms[armId];
        assert.equal(row.status, ledger.status);
        assert.equal(row.filledMw, ledger.filledMw);
        // Sin fill no hay precio obtenido: el ledger trae un precio hipotético que no se muestra.
        assert.equal(row.fillPriceEurMwh, ledger.filledMw > 0 ? ledger.priceEurMwh : null);
      }
    }
  }
});

test("UI-06: 'bought so far' coincide con la suma independiente de los fills del ledger", () => {
  for (const [product, details] of Object.entries(pairedPoints)) {
    for (const detail of details) {
      const replay = replayOf(product, detail.maturity);
      const offset = detail.decisionNumber - 1;
      for (const armId of ["BASELINE", "ARM_A"]) {
        const filledSoFar = replay.decisions[armId].slice(0, offset + 1).reduce((sum, decision) => sum + decision.filledMw, 0);
        assert.equal(detail.arms[armId].boughtSoFarMw, filledSoFar, `${product} ${detail.day} ${armId}`);
      }
    }
  }
});

test("UI-06: ΔV acumulado es el punto del artifact y ΔV por decisión solo existe donde lo emite el inspector", () => {
  let emitted = 0;
  for (const [product, details] of Object.entries(pairedPoints)) {
    const paired = results.comparison[product].paired;
    for (const detail of details) {
      assert.equal(detail.cumulativeKeur.ARM_A, paired.ARM_A.points[detail.index]);
      assert.equal(detail.cumulativeKeur.ARM_B, paired.ARM_B.points[detail.index]);
      assert.equal(detail.decisionDeltaVEur.ARM_B, null);
      const inspected = replayOf(product, detail.maturity).inspector.find((item) => item.index === detail.decisionNumber - 1);
      if (!inspected) {
        assert.equal(detail.decisionDeltaVEur.ARM_A, null);
        continue;
      }
      emitted += 1;
      assert.equal(detail.decisionDeltaVEur.ARM_A, inspected.deltaVEur);
      // Control cruzado del índice: el salto del acumulado en ese punto es el ΔV del inspector.
      const previous = detail.index === 0 ? 0 : paired.ARM_A.points[detail.index - 1];
      const step = paired.ARM_A.points[detail.index] - previous;
      assert.ok(Math.abs(step * 1000 - inspected.deltaVEur) < 1e-6, `${product} ${detail.day}`);
    }
  }
  const purchases = results.replay.filter((entry) => pairedPoints[entry.product].some((detail) => detail.maturity === entry.maturity)).reduce((sum, entry) => sum + entry.inspector.length, 0);
  assert.equal(emitted, purchases);
});

test("UI-06: Arm B sin ledger diario queda UNAVAILABLE en el tooltip, con su slot", () => {
  const html = renderSurfacePage("backtests", vms.backtests);
  const models = tipModels(html);
  for (const [product, list] of Object.entries(models)) {
    assert.equal(list.length, pairedPoints[product].length);
    list.forEach((model, index) => {
      const armB = model.rows.find((row) => row.arm === "ARM_B");
      assert.match(armB.unavailable, /per-day ledger UNAVAILABLE/);
      assert.ok(armB.unavailable.includes(`slot ${pairedPoints[product][index].armBSlot}`));
      assert.equal(armB.cells, undefined);
      assert.match(model.facts[1][1], /B UNAVAILABLE$/);
    });
  }
});

test("UI-06: el tooltip pinta los valores del artifact sin aritmética nueva", () => {
  const html = renderSurfacePage("backtests", vms.backtests);
  const models = tipModels(html);
  const detail = pairedPoints.G0BQ.find((item) => item.day === "2025-12-08" && item.maturity === "202604");
  const model = models.G0BQ[detail.index];
  assert.equal(model.head, `2025-12-08 · decision ${detail.decisionNumber} of ${detail.decisionsInCampaign}`);
  assert.equal(model.sub, "GAS-Q-202604 · Gas Quarterly (THE) · delivery Q2-2026 · target 60 MW");
  const armA = model.rows.find((row) => row.arm === "ARM_A");
  assert.deepEqual(armA.cells, [detail.arms.ARM_A.status, `${detail.arms.ARM_A.filledMw} MW`, `${detail.arms.ARM_A.fillPriceEurMwh.toFixed(3)} €/MWh`, `${detail.arms.ARM_A.boughtSoFarMw} of 60 MW`]);
  assert.equal(model.facts[0][0], "best ask 11:00 Berlin");
  assert.ok(model.facts[0][1].startsWith(`${detail.bestAsk.eurMwh.toFixed(3)} €/MWh`));
  assert.ok(model.foot.includes(vms.backtests.exploratory.provenance.resultsSha256.slice(0, 12)));
  // Día sin compra de Arm A: sin precio y sin ΔV por decisión inventado.
  const waitDay = pairedPoints.G0BQ.find((item) => item.arms.ARM_A.status === "WAIT");
  const waitModel = models.G0BQ[waitDay.index];
  assert.equal(waitModel.rows.find((row) => row.arm === "ARM_A").cells[2], "— (no fill)");
  assert.match(waitModel.facts[1][1], /^A UNAVAILABLE \(emitted only on Arm A buy days\)/);
});

test("UI-06: una franja de hover por decisión, marcadores y script de click persistente", () => {
  const html = renderSurfacePage("backtests", vms.backtests);
  const total = Object.values(pairedPoints).reduce((sum, list) => sum + list.length, 0);
  assert.equal((html.match(/<rect class="pphit" data-pp="\d+"/g) ?? []).length, total);
  assert.equal((html.match(/<line class="ppcursor"/g) ?? []).length, 2);
  assert.equal((html.match(/<div class="pptip"/g) ?? []).length, 2);
  assert.match(html, /Click or tap to pin the tooltip; click again to release\./);
  assert.match(html, /tip\.classList\.add\("pinned"\)/);
  // El script solo inserta texto: nada de innerHTML con datos.
  const script = html.slice(html.indexOf('var SWATCH = { BASELINE'), html.indexOf("})();", html.indexOf('var SWATCH = { BASELINE')));
  assert.equal(script.includes("innerHTML"), false);
});

test("UI-06 fail-closed: sin ledger alineado el punto no inventa fecha, fills ni precio", () => {
  const product = "G0BQ";
  const block = results.comparison[product];
  const firstMaturity = block.paired.ARM_A.boundaries[0].maturity;
  const tampered = {
    ...results,
    replay: results.replay.map((entry) => (entry.product === product && entry.maturity === firstMaturity
      ? { ...entry, decisions: { ...entry.decisions, BASELINE: entry.decisions.BASELINE.slice(1) } }
      : entry)),
  };
  const details = projectPairedPoints(tampered)[product];
  const span = block.paired.ARM_A.boundaries[1].index;
  for (const detail of details.slice(0, span)) {
    assert.equal(detail.ledgerAvailable, false);
    assert.equal(detail.day, null);
    assert.equal(detail.arms, null);
    assert.equal(detail.bestAsk, null);
    assert.equal(detail.decisionDeltaVEur.ARM_A, null);
    // El acumulado sí es del artifact y se conserva.
    assert.equal(detail.cumulativeKeur.ARM_A, block.paired.ARM_A.points[detail.index]);
  }
  assert.equal(details[span].ledgerAvailable, true);

  const missing = { ...results, replay: results.replay.filter((entry) => !(entry.product === product && entry.maturity === firstMaturity)) };
  assert.equal(projectPairedPoints(missing)[product][0].ledgerAvailable, false);

  const shifted = {
    ...results,
    replay: results.replay.map((entry) => (entry.product === product && entry.maturity === firstMaturity
      ? { ...entry, decisions: { ...entry.decisions, ARM_A: entry.decisions.ARM_A.map((decision, index) => (index === 3 ? { ...decision, day: "1999-01-01" } : decision)) } }
      : entry)),
  };
  assert.equal(projectPairedPoints(shifted)[product][0].ledgerAvailable, false);

  const vm = { ...vms.backtests, exploratory: { ...vms.backtests.exploratory, pairedPoints: projectPairedPoints(tampered) } };
  const model = tipModels(renderSurfacePage("backtests", vm))[product][0];
  assert.equal(model.head.startsWith("UNAVAILABLE · decision 1 of"), true);
  assert.deepEqual(model.rows.map((row) => row.arm), ["ALL"]);
  assert.match(model.rows[0].unavailable, /daily ledger UNAVAILABLE/);
  assert.equal(model.facts[0][1], "UNAVAILABLE");
});

test("UI-06 fail-closed: sin detalle por punto el chart dice UNAVAILABLE y no pinta hover", () => {
  const vm = { ...vms.backtests, exploratory: { ...vms.backtests.exploratory, pairedPoints: null } };
  const html = renderSurfacePage("backtests", vm);
  assert.equal((html.match(/class="pphit"/g) ?? []).length, 0);
  assert.equal((html.match(/data-paired-detail="UNAVAILABLE"/g) ?? []).length, 2);
});

test("UI-06: el JSON del tooltip no puede cerrar su <script>", () => {
  const html = renderSurfacePage("backtests", vms.backtests);
  for (const [, json] of html.matchAll(/<script type="application\/json" class="ppdata">([\s\S]*?)<\/script>/g)) {
    assert.equal(json.includes("<"), false);
  }
});
