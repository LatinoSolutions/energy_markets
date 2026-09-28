// Repo mínimo para los tests de BT-08. Copia el src/ REAL (el child corre el
// HYP-1 real desde el commit staged) y deja, bajo
// operations/hypothesis/H-S1-01/development/<MISSION>/, fixtures pequeñas en
// el formato de los productores Development (artifactKind + provenance por
// documento, filas propias, evidencia TOB en observaciones) atadas por sha256
// en el inputManifest de la petición. Nunca corre un run real.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createTempDir } from "../helpers/tmpdir.mjs";
import { predeclareHS1SearchSpace, createHS1Candidate, H_S1_01 } from "../../src/s1-strategy/h-s1-01.mjs";
import { contentHashOf } from "../../src/sizing-controller/versioning.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

export const MISSION_TARGETS_MW = Object.freeze({
  GAS_QUARTERLY: 60,
  GAS_MONTHLY: 10,
  POWER_QUARTERLY: 10,
  POWER_MONTHLY: 10,
});

export const MISSION_LABELS = Object.freeze({
  GAS_QUARTERLY: "Gas Quarterly",
  GAS_MONTHLY: "Gas Monthly",
  POWER_QUARTERLY: "Power Quarterly",
  POWER_MONTHLY: "Power Monthly",
});

const MISSION_WINDOWS = Object.freeze({
  GAS_QUARTERLY: "3-1-3",
  GAS_MONTHLY: "1-0-1",
  POWER_QUARTERLY: "3-1-3",
  POWER_MONTHLY: "1-0-1",
});

const DATA_ROOT = "operations/hypothesis/H-S1-01/development";
export const ANCHOR = "10:00";
export const ZONE = "UTC";
const ROW_HASH = "b".repeat(64);
const DOC_PROVENANCE = Object.freeze({ authority: "SYNTHETIC_FIXTURE (BT-01-style reference)", locator: "test/backtest-jobs/hypothesis-fixture-repo.mjs" });

// Cinco días hábiles: los tres primeros alimentan la referencia y warm-up de
// N=3; los dos últimos son días de decisión con señal identificable.
export const TRADING_DATES = ["2025-03-03", "2025-03-04", "2025-03-05", "2025-03-06", "2025-03-07"];
const DEVELOPMENT_END = "2025-03-10T00:00:00Z";

// Precios al ancla: day4 40 < media(35,30,40)=35 → no; ajustamos para tener
// BUY y WAIT explícitos en los días con señal.
export const OBSERVED_PRICES = { "2025-03-03": 35, "2025-03-04": 30, "2025-03-05": 40, "2025-03-06": 20, "2025-03-07": 45 };

// Evidencia TOB por defecto del fixture: el best ask ejecutable del ancla es
// el propio precio observado con volumen holgado (fills completos).
const OBSERVED_ASKS = { "2025-03-03": 35, "2025-03-04": 30, "2025-03-05": 40, "2025-03-06": 20, "2025-03-07": 45 };
const DEFAULT_ASK_VOLUME_MW = 50;

const write = (root, relativePath, content) => {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
  return readFileSync(target);
};

function availabilityFile(missionId, { rows = 5, corruptRow = false, futurePit = false } = {}) {
  const label = MISSION_LABELS[missionId];
  const availability = TRADING_DATES.slice(0, rows).map((day) => ({
    mission: label,
    atUtc: `${day}T${ANCHOR}:00Z`,
    sessionDate: day,
    anchor: ANCHOR,
    available: true,
    pitAvailableAtUtc: futurePit ? `${day}T${ANCHOR}:30Z` : `${day}T${ANCHOR}:00Z`,
    sourceHash: ROW_HASH,
  }));
  if (corruptRow) availability.push({ mission: label, note: "row without provenance" });
  return {
    artifactKind: "HYPOTHESIS_DEVELOPMENT_AVAILABILITY",
    mission: label,
    // El session es exactamente el input de predeclareHS1SearchSpace (HYP-1:
    // own-keys estrictos); el hash de fuente lo ata el propio objeto.
    session: { mission: label, zone: ZONE, anchors: [ANCHOR], sourceHash: "a".repeat(64) },
    availability,
    sourceHash: "a".repeat(64),
    provenance: DOC_PROVENANCE,
  };
}

function observationsFile({ prices = {}, askVolumes = {}, noAskDates = [] } = {}) {
  const rows = TRADING_DATES.map((day) => {
    const price = prices[day] ?? OBSERVED_PRICES[day];
    if (noAskDates.includes(day)) {
      // Sin best ask ejecutable: día no ejecutable (no-fill), no dato corrupto.
      return { date: day, price, bestAskEurMwh: null, bestAskVolumeMw: null, availableAtUtc: `${day}T${ANCHOR}:00Z`, sourceHash: ROW_HASH };
    }
    return {
      date: day,
      price,
      bestAskEurMwh: price,
      bestAskVolumeMw: askVolumes[day] ?? DEFAULT_ASK_VOLUME_MW,
      availableAtUtc: `${day}T${ANCHOR}:00Z`,
      sourceHash: ROW_HASH,
    };
  });
  return {
    artifactKind: "HYPOTHESIS_DEVELOPMENT_OBSERVATIONS",
    observations: rows,
    sourceHash: "f".repeat(64),
    provenance: DOC_PROVENANCE,
  };
}

function benchmarkFile(missionId, { status = "BENCHMARK_PROVISIONAL", value = 34, unit = "EUR/MWh", version = null, campaignId = null, obligationId = null } = {}) {
  return {
    artifactKind: "HYPOTHESIS_DEVELOPMENT_BENCHMARK",
    identity: "BENCHMARK",
    version: version ?? "B-FIXTURE-v1",
    status,
    value,
    unit,
    artifactSha256: "c".repeat(64),
    sourceHash: "d".repeat(64),
    campaignId: campaignId ?? `FIXTURE-${missionId}`,
    obligationId: obligationId ?? `OBL-${missionId}`,
    window: MISSION_WINDOWS[missionId],
    provenance: { authority: "SYNTHETIC_FIXTURE (BT-01-style reference)", locator: "test/backtest-jobs/hypothesis-fixture-repo.mjs" },
  };
}

function deliveryHoursFile({ mode = "FIXED", hours = 24, requiresFreeze = false, oosReservation = null, perDayGap = false, perDay = null } = {}) {
  const file = { artifactKind: "HYPOTHESIS_DEVELOPMENT_DELIVERY_HOURS", mode, sourceHash: "e".repeat(64), provenance: DOC_PROVENANCE };
  if (mode === "FIXED") file.hours = hours;
  if (mode === "PER_TRADING_DAY") {
    file.perDay = perDay ?? Object.fromEntries(TRADING_DATES.slice(0, perDayGap ? TRADING_DATES.length - 1 : TRADING_DATES.length).map((day) => [day, 24]));
  }
  if (requiresFreeze) file.requiresFreeze = true;
  if (oosReservation !== null) file.oosReservation = oosReservation;
  return file;
}

// Espacio predeclarado y candidato reales de HYP-1 sobre las filas del fixture.
export function fixtureSearchSpace(missionId, { rows = 5 } = {}) {
  const file = availabilityFile(missionId, { rows });
  const outcome = predeclareHS1SearchSpace({
    mission: MISSION_LABELS[missionId],
    developmentEndUtc: DEVELOPMENT_END,
    session: file.session,
    availability: file.availability,
    provenance: { authority: "SYNTHETIC_FIXTURE", locator: "test/backtest-jobs/hypothesis-fixture-repo.mjs", sourceHash: "f".repeat(64) },
  });
  if (!outcome.ok) throw new Error(`fixture search space inválido: ${outcome.code}`);
  return outcome.searchSpace;
}

export function fixtureCandidate(missionId, { N = 3, rows = 5 } = {}) {
  const space = fixtureSearchSpace(missionId, { rows });
  const outcome = createHS1Candidate({ searchSpace: space, tau: { zone: ZONE, localTime: ANCHOR }, N });
  if (!outcome.ok) throw new Error(`fixture candidate inválido: ${outcome.code}`);
  return outcome.candidate;
}

// Configuración de misión íntegra (hallazgo BT08-T08): las peticiones la
// generan con su configurationHash real; los tests de integridad lo alteran.
export function fixtureMissionConfiguration(missionId, candidate, searchSpace, overrides = {}) {
  const core = {
    artifactKind: "HYPOTHESIS_MISSION_CONFIGURATION",
    hypothesisId: candidate.hypothesisId,
    hypothesisVersion: H_S1_01.version,
    missionId,
    dataMode: "TOB",
    candidateMission: MISSION_LABELS[missionId],
    searchSpaceMission: MISSION_LABELS[missionId],
    candidateHash: candidate.contentHash,
    searchSpaceHash: searchSpace.contentHash,
    candidateTau: candidate.tau.localTime,
    candidateN: candidate.N,
    ...overrides,
  };
  return { ...core, configurationHash: contentHashOf(core) };
}

// Petición canónica de job de hipótesis para una misión del fixture.
export function hypothesisJobRequest(repo, {
  missionId = "GAS_MONTHLY",
  N = 3,
  search = false,
  capMw = 12,
  fees = { status: "KNOWN", costs: [{ label: "exchange-fee", valueEurMwh: 0.1 }] },
  benchmark: benchmarkOverrides = {},
  deliveryHours: deliveryOverrides = {},
  jobOverrides = {},
} = {}) {
  const candidate = fixtureCandidate(missionId, { N });
  const space = fixtureSearchSpace(missionId);
  const dataDir = `${DATA_ROOT}/${missionId}`;
  const manifest = {
    availability: { path: `${dataDir}/availability.json`, sha256: sha(readFileSync(path.join(repo.root, `${dataDir}/availability.json`))) },
    observations: { path: `${dataDir}/observations.json`, sha256: sha(readFileSync(path.join(repo.root, `${dataDir}/observations.json`))) },
    benchmark: { path: `${dataDir}/benchmark.json`, sha256: sha(readFileSync(path.join(repo.root, `${dataDir}/benchmark.json`))) },
    deliveryHours: { path: `${dataDir}/delivery-hours.json`, sha256: sha(readFileSync(path.join(repo.root, `${dataDir}/delivery-hours.json`))) },
  };
  const base = {
    hypothesisId: "H-S1-01",
    hypothesisVersion: H_S1_01.version,
    missionId,
    phase: "DEVELOPMENT",
    dataMode: "TOB",
    searchSpace: space,
    candidate,
    campaign: {
      campaignId: `FIXTURE-${missionId}`,
      populationId: `POP-${missionId}`,
      obligationId: `OBL-${missionId}`,
      targetVolumeMw: MISSION_TARGETS_MW[missionId],
      tradingDates: [...TRADING_DATES],
      provenance: { authority: "SYNTHETIC_FIXTURE", locator: "test/backtest-jobs/hypothesis-fixture-repo.mjs" },
    },
    sizing: {
      lotSizeMw: 1,
      dailyCapMw: capMw,
      provenance: { authority: "SYNTHETIC_FIXTURE (IMP-10 shared controller)", locator: "test/backtest-jobs/hypothesis-fixture-repo.mjs" },
    },
    execution: {
      model: "TOB_ASK_SLIPPAGE_V1",
      slippageEurMwh: 0.15,
      provenance: { authority: "SYNTHETIC_FIXTURE (owner provisional execution)", locator: "test/backtest-jobs/hypothesis-fixture-repo.mjs" },
    },
    fees: {
      ...fees,
      provenance: { authority: "SYNTHETIC_FIXTURE", locator: "test/backtest-jobs/hypothesis-fixture-repo.mjs" },
    },
    evaluation: {
      benchmark: { ...benchmarkFile(missionId), ...benchmarkOverrides },
      // Las horas de entrega viven en el archivo hash-bound; el request sólo
      // lo referencia (una sola verdad).
      deliveryHours: manifest.deliveryHours,
    },
    search,
    inputManifest: manifest,
  };
  return { ...base, ...jobOverrides };
}

export function makeHypothesisFixtureRepo({
  missions = ["GAS_MONTHLY"],
  availabilityOptions = {},
  deliveryOptions = {},
  benchmarkOptions = {},
  observationOptions = {},
} = {}) {
  const root = createTempDir("bt08-repo-");
  cpSync(path.join(REPO_ROOT, "src"), path.join(root, "src"), { recursive: true });
  write(root, ".gitignore", "operations/backtest-runs/\n");
  for (const missionId of missions) {
    const dataDir = `${DATA_ROOT}/${missionId}`;
    const availability = availabilityFile(missionId, availabilityOptions[missionId] ?? {});
    write(root, `${dataDir}/availability.json`, `${JSON.stringify(availability, null, 1)}\n`);
    write(root, `${dataDir}/observations.json`, `${JSON.stringify(observationsFile(observationOptions[missionId] ?? {}), null, 1)}\n`);
    write(root, `${dataDir}/benchmark.json`, `${JSON.stringify(benchmarkFile(missionId, benchmarkOptions[missionId] ?? {}), null, 1)}\n`);
    write(root, `${dataDir}/delivery-hours.json`, `${JSON.stringify(deliveryHoursFile(deliveryOptions[missionId] ?? {}), null, 1)}\n`);
  }
  const git = (...args) => execFileSync("git", ["-c", "user.name=bt08", "-c", "user.email=bt08@test", ...args], { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  git("init", "-q", "-b", "main");
  const commitAll = (message) => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  commitAll("fixture");
  const writeFile = (relativePath, content) => {
    write(root, relativePath, content);
    return content;
  };
  return { root, write: writeFile, commitAll, git, head: () => git("rev-parse", "HEAD") };
}
