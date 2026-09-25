// TR-07 — prototipo visual del gate. NO es la implementación: la composición
// productiva (src/ui/render.mjs) espera la aprobación de Bru sobre esta captura
// (TRADES_MODE_PLAN.md TR-07: "captura aprobada por Bru antes de implementar").
//
// El prototipo usa la composición visual ya aprobada (UI-03/UI-05) y sustituye
// los datos por el view model backend real (src/ui/trades-panels.mjs): cada panel
// muestra su estado real (cobertura PENDING_SCAN_JOB, OOS sellado, calibración
// pendiente, TR-04/TR-06 UNAVAILABLE). Cero datos demo.
//
// Uso: node operations/trades/TR-07/build-tr07-prototype.mjs

import { writeFileSync } from "node:fs";
import path from "node:path";

import { loadCanonicalUiInputs } from "../../../src/ui/canonical-inputs.mjs";
import { buildUiViewModels } from "../../../src/ui/server.mjs";
import { renderSurfacePage } from "../../../src/ui/render.mjs";
import { DEFAULT_REPO_ROOT } from "../../../src/pit-views/index.mjs";
import { loadTradesPanels } from "../../../src/ui/trades-panels.mjs";

const OUT = "operations/trades/TR-07/prototipo-tr07.html";

const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const chip = (kind, glyph, label) => `<span class="st ${kind}"><span class="g">${glyph}</span>${esc(label)}</span>`;

function selectorHtml(panels) {
  const options = panels.selector.marketMissions
    .map((mission) => `<option value="${esc(mission.missionId)}">${esc(mission.market)} · ${esc(mission.missionId)}</option>`)
    .join("");
  const modes = panels.selector.modes
    .map((mode, index) => `<span class="btn${index === 0 ? " on" : ""}" data-mode="${esc(mode)}">${esc(mode)}</span>`)
    .join("");
  return `<div class="card" style="margin-top:14px" data-tr07="selector">
    <div class="hd"><h3>Backtest scope</h3><span class="small muted">market / mission · observation mode · zone shown per result</span></div>
    <div class="bd row" style="gap:12px;align-items:center">
      <label class="small muted">Market · mission <select data-market-mission>${options}</select></label>
      <div class="row" style="gap:0" data-mode-toggle>${modes}</div>
      <span class="grow"></span>${chip("unk", "?", "visual proposal · awaiting Bru")}
    </div>
  </div>`;
}

function coverageHtml(panels) {
  const coverage = panels.coverage;
  const missionBlocks = (coverage.missions ?? []).map((mission) => {
    const zones = mission.zones.map((zone) => {
      const rows = zone.campaigns.slice(0, 3).map((campaign) => {
        // Cifra medida vs pendiente: un cero no medido no se muestra como dato.
        const days = campaign.coverage.daysWithTrades;
        const daysText = days === null || days === undefined ? "—" : String(days);
        return `<tr><td class="mono small">${esc(campaign.campaignId)}</td><td>${esc(zone.zone)}</td><td class="mono small">${esc(campaign.windowStart)} → ${esc(campaign.windowEnd)}</td><td>${chip("unk", "?", campaign.coverage.status)}</td><td class="right mono">${esc(daysText)} / ${esc(campaign.coverage.windowDays)} d</td></tr>`;
      }).join("");
      return `<div class="small muted" style="margin-top:6px">${esc(zone.zone)} · ${zone.campaigns.length} campaign(s)</div><table class="t"><thead><tr><th>Campaign</th><th>Zone</th><th>Window</th><th>Coverage</th><th class="right">Days w/ trades</th></tr></thead><tbody>${rows}</tbody></table>`;
    }).join("");
    return `<div style="margin-top:10px"><div class="mono small">${esc(mission.missionId)} · ${esc(mission.market)} · ${esc(mission.shortCode)}</div>${zones}</div>`;
  }).join("");
  return `<div class="card" style="margin-top:14px" data-tr07="coverage">
    <div class="hd"><h3>Data coverage</h3><span class="small muted">TR-01 · per instrument, per day</span><span class="grow"></span>${chip("unk", "?", coverage.status)}</div>
    <div class="bd"><div class="small muted">${esc(coverage.reason)}</div>
      <div class="small muted" style="margin-top:6px">TR-01 source decision: ${chip("warn", "!", coverage.sourceDecisionStatus)}</div>${missionBlocks}</div>
  </div>`;
}

function zonesHtml(panels) {
  const zones = panels.zones;
  const missionRows = zones.missions.map((mission) => `<tr><td class="mono small">${esc(mission.missionId)}</td><td>${esc(mission.market)}</td>${mission.zones.map((zone) => `<td class="right">${esc(zone.count)} <span class="small muted">${esc(zone.zone)}</span></td>`).join("")}</tr>`).join("");
  const oos = zones.accessRegistry;
  return `<div class="card" style="margin-top:14px" data-tr07="zones">
    <div class="hd"><h3>Evidence zones &amp; OOS access</h3><span class="small muted">TR-02 · reservation ${esc(zones.reservationId)}</span><span class="grow"></span>${chip("run", "◆", oos.oosStatus)}</div>
    <div class="bd">
      <table class="t"><thead><tr><th>Mission</th><th>Market</th><th class="right">Development</th><th class="right">OOS hist.</th><th class="right">Embargo</th><th class="right">Bridge</th><th class="right">Post-bridge</th><th class="right">Forward</th></tr></thead><tbody>${missionRows}</tbody></table>
      <div class="row small muted" style="gap:16px;margin-top:8px"><span>OOS status ${esc(oos.oosStatus)}</span><span>openings ${esc(JSON.stringify(oos.oosOpeningsByMission))}</span><span>purge ${esc(zones.purge.length)} campaign(s)</span><span>forward ${esc(zones.forward.status)} · from ${esc(zones.forward.fromIso ?? "UNAVAILABLE")}</span></div>
    </div>
  </div>`;
}

function calibrationHtml(panels) {
  const calibration = panels.calibration;
  return `<div class="card" style="margin-top:14px" data-tr07="calibration">
    <div class="hd"><h3>Calibration TOB vs TRADES</h3><span class="small muted">TR-03 · bridge ${esc(calibration.window.startIso)} → ${esc(calibration.window.endIso)}</span><span class="grow"></span>${chip("unk", "?", calibration.status)}</div>
    <div class="bd"><div class="small muted">${esc(calibration.reason)}</div>
    <div class="row small muted" style="gap:16px;margin-top:8px"><span>freshness limits (s): ${esc(calibration.freshnessLimitsSeconds.join(", "))}</span><span>observation rules: ${esc(calibration.observationRules.join(", "))}</span><span>bridge campaigns: ${esc(calibration.bridgeCampaigns.count)}</span></div></div>
  </div>`;
}

function unavailableCard(kind, title, subtitle, panels) {
  const panel = panels[kind];
  return `<div class="card" style="margin-top:14px" data-tr07="${esc(kind)}">
    <div class="hd"><h3>${esc(title)}</h3><span class="small muted">${esc(subtitle)}</span><span class="grow"></span>${chip("unk", "?", panel.status)}</div>
    <div class="bd"><div class="small muted">${esc(panel.reason)}</div></div>
  </div>`;
}

const canonical = loadCanonicalUiInputs();
const vms = buildUiViewModels(canonical.inputs);
const basePage = renderSurfacePage("backtests", vms.backtests);
const panels = loadTradesPanels(DEFAULT_REPO_ROOT);

const tr07 = `
  <div class="errbar" data-state="GATE" data-tr07="gate" style="border-color:var(--warn)"><b>TR-07 · visual gate</b> · this is a proposal, not the implementation. The productive composition waits for Bru's approval of this capture (TRADES_MODE_PLAN.md TR-07). No demo data, no calculation in the UI.</div>
  ${selectorHtml(panels)}
  ${coverageHtml(panels)}
  ${zonesHtml(panels)}
  ${calibrationHtml(panels)}
  ${unavailableCard("frozenContract", "Frozen contract", "TR-04 · TRADES-v1 execution contract", panels)}
  ${unavailableCard("results", "Results", "TR-06 · runs of the 4 missions", panels)}
`;

const marker = '<section class="surface backtests"';
const insertAt = basePage.indexOf(marker);
if (insertAt < 0) {
  throw new Error("no se encontró la sección backtests en la composición base");
}
const openTagEnd = basePage.indexOf(">", insertAt) + 1;
const html = `${basePage.slice(0, openTagEnd)}\n${tr07}${basePage.slice(openTagEnd)}`;
const outPath = path.join(DEFAULT_REPO_ROOT, OUT);
writeFileSync(outPath, html);
console.log(`prototipo TR-07 escrito en ${outPath}`);
console.log(`paneles: cobertura=${panels.coverage.status} zonas=${panels.zones.status} calibración=${panels.calibration.status} contrato=${panels.frozenContract.status} resultados=${panels.results.status}`);
