// BT-06 (PLAN_STATUS, owner request 2026-09-26): backtest exploratorio TOB de
// Power DE. Fija que el registro de misiones parametriza mercado/producto/target,
// que el loader v3 lee el lago por lotes y aplica la misma regla de slots que v2,
// y que el runner v3 produce resultados Power con el mismo motor (target 10 MW).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CADENCE, EXPLORATORY_MISSIONS, POWER_MISSION_IDS, missionById, missionsByIds } from "../../src/exploratory/missions.mjs";
import { powerDeExchangeDaysBetween } from "../../src/trades-source/power-calendar.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const runner = path.join(repoRoot, "operations/exploratory/v3/run-exploratory-backtest.mjs");
const loader = path.join(repoRoot, "operations/exploratory/v3/build_tob_slots.py");

const SLOTS_BERLIN = [];
for (let hour = 8; hour < 18; hour += 1) for (const minute of [0, 30]) SLOTS_BERLIN.push(`${String(hour).padStart(2, "0")}:${minute === 0 ? "00" : "30"}`);

function slotsSeries(days) {
  const out = {};
  for (const day of days) {
    out[day] = SLOTS_BERLIN.map((_, index) => ({ ask: 30 + index * 0.1, askSz: 5, bid: null, quoteTm: `${day}T09:00:00Z` }));
  }
  return out;
}

function powerSlotsFixture() {
  const quarterlyDays = powerDeExchangeDaysBetween("2025-08-13", "2025-12-31");
  const monthlyDays = powerDeExchangeDaysBetween("2025-12-01", "2026-02-27");
  return { slotsBerlin: SLOTS_BERLIN, series: { "DEBQ|202601": slotsSeries(quarterlyDays), "DEBM|202602": slotsSeries(monthlyDays) } };
}

test("BT-06 misiones: Power Q y Power M existen con 10 MW y mapean al motor aceptado", () => {
  const quarterly = missionById("POWER_QUARTERLY");
  const monthly = missionById("POWER_MONTHLY");
  assert.equal(quarterly.market, "POWER_DE");
  assert.equal(quarterly.cmdty, "POWER");
  assert.equal(quarterly.area, "DE");
  assert.equal(quarterly.product, "DEBQ");
  assert.equal(quarterly.targetMw, 10);
  assert.equal(quarterly.cadence, CADENCE.QUARTERLY);
  assert.equal(monthly.product, "DEBM");
  assert.equal(monthly.targetMw, 10);
  assert.equal(monthly.cadence, CADENCE.MONTHLY);
  // El motor aceptado sólo ramifica por producto para calendario/horas; Power reusa esa rama.
  assert.equal(quarterly.engineProduct, "G0BQ");
  assert.equal(monthly.engineProduct, "G0BM");
  assert.deepEqual([...POWER_MISSION_IDS], ["POWER_QUARTERLY", "POWER_MONTHLY"]);
  assert.equal(Object.keys(EXPLORATORY_MISSIONS).length, 4);
  assert.throws(() => missionsByIds(["NOPE"]), /misión desconocida/);
});

test("BT-06 loader: parametrizado por mercado/producto, excluye gas y spreads, y aplica el best ask", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "bt06-loader-"));
  try {
    const lake = path.join(workspace, "lake");
    const fixture = `
import os, sys, pyarrow as pa, pyarrow.parquet as pq
lake = sys.argv[1]
folder = os.path.join(lake, "table=eex_derivative_top_of_book", "cmdty=POWER", "area=DE", "trd_date=2025-11-25", "pull_id=fixture")
os.makedirs(folder)
rows = [
    ("DEBQ", "202601", "2025-11-25T09:59:40.000000Z", "30.000", "9", "29.9", "Simple Instrument"),
    ("DEBQ", "202601", "2025-11-25T09:59:50.50498Z", "31.33", "1", "", "Simple Instrument"),
    ("DEBQ", "202601", "2025-11-25T09:59:50.50498Z", "31.475", "5", "31.255", "Simple Instrument"),
    ("DEBM", "202602", "2025-11-25T09:29:58.000000Z", "40.5", "2", "40.0", "Simple Instrument"),
    ("G0BQ", "202601", "2025-11-25T09:59:50.000000Z", "10.0", "1", "", "Simple Instrument"),
    ("DEBQ", "202601", "2025-11-25T09:59:50.000000Z", "-9.25", "1", "-9.71", "Futures Spread"),
]
table = pa.table({
    "ShortCode": [r[0] for r in rows], "Maturity": [r[1] for r in rows], "Tm": [r[2] for r in rows],
    "AskPx": [r[3] for r in rows], "AskSz": [r[4] for r in rows], "BidPx": [r[5] for r in rows],
    "InstrumentType": [r[6] for r in rows],
})
pq.write_table(table, os.path.join(folder, "part.parquet"))
`;
    assert.equal(spawnSync("python3", ["-c", fixture, lake], { encoding: "utf8" }).status, 0);
    const out = path.join(workspace, "tob.json");
    // Sólo una decisión definitiva de TR-01 (DECIDED_FALLBACK_LAKE / CANONICAL /
    // failClosed false) habilita la extracción. La decisión real de TR-01 hoy es
    // provisional y no acredita acceptance, así que la prueba usa el fixture.
    const decision = path.join(workspace, "DECIDED_FALLBACK_LAKE.json");
    writeFileSync(decision, JSON.stringify({
      status: "DECIDED_FALLBACK_LAKE",
      selectedSource: "EEX_LAKE",
      selectedSourceRole: "CANONICAL",
      failClosed: false,
    }));
    const run = spawnSync("python3", [loader, "--source", "lake", "--market", "POWER_DE", "--products", "DEBQ,DEBM", "--lake-root", lake, "--source-decision", decision, "--out", out], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const document = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(document.market, "POWER_DE");
    assert.equal(document.sourceDecision.selectedSource, "EEX_LAKE");
    assert.equal(document.sourceDecision.status, "DECIDED_FALLBACK_LAKE");
    assert.equal(document.sourceDecision.selectedSourceRole, "CANONICAL");
    assert.equal(document.sourceDecision.failClosed, false);
    assert.match(document.sourceDecision.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(document.products, ["DEBM", "DEBQ"]);
    assert.deepEqual(Object.keys(document.series).sort(), ["DEBM|202602", "DEBQ|202601"]);
    // El gas G0BQ y el spread no entran: la partición se filtra por producto real.
    assert.equal(Object.keys(document.series).some((key) => key.startsWith("G0BQ")), false);
    const at1100 = document.series["DEBQ|202601"]["2025-11-25"][document.slotsBerlin.indexOf("11:00")];
    assert.deepEqual([at1100.ask, at1100.askSz, at1100.quoteTm], [31.33, 1, "2025-11-25T09:59:50.50498Z"]);
    assert.equal(document.series["DEBQ|202601"]["2025-11-25"][document.slotsBerlin.indexOf("10:30")], null);
    const deMonthly = document.series["DEBM|202602"]["2025-11-25"][document.slotsBerlin.indexOf("10:30")];
    assert.deepEqual([deMonthly.ask, deMonthly.bid], [40.5, 40]);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("BT-06 loader: la agregación consume un iterable (no acumula las filas del día)", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "bt06-stream-"));
  try {
    const module = loader;
    const script = `
import importlib.util, sys, json
sys.dont_write_bytecode = True  # no dejar __pycache__ en el repo al importar el loader
from datetime import date
spec = importlib.util.spec_from_file_location("bt06", ${JSON.stringify(module)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
consumed = {"n": 0}
def rows():
    for row in [
        {"ShortCode": "DEBQ", "Maturity": "202601", "Tm": "2025-11-25T09:59:50Z", "AskPx": "31.33", "AskSz": "1", "BidPx": "", "InstrumentType": "Simple Instrument"},
        {"ShortCode": "DEBQ", "Maturity": "202601", "Tm": "2025-11-25T09:59:50Z", "AskPx": "31.475", "AskSz": "5", "BidPx": "31.255", "InstrumentType": "Simple Instrument"},
    ]:
        consumed["n"] += 1
        yield row
counts = mod.defaultdict(int)
series = mod.aggregate_day(rows(), date(2025, 11, 25), {"DEBQ"}, counts)
print(json.dumps({"consumed": consumed["n"], "series": list(series), "counts": dict(counts)}))
`;
    const run = spawnSync("python3", ["-c", script], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const parsed = JSON.parse(run.stdout.trim());
    assert.equal(parsed.consumed, 2);
    assert.deepEqual(parsed.series, ["DEBQ|202601"]);
    assert.equal(parsed.counts.slots_filled, 1);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("BT-06 loader: una decisión provisional de TR-01 no acredita la fuente y falla cerrada", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "bt06-source-"));
  try {
    const args = (decision, out) => [loader, "--source", "lake", "--market", "POWER_DE", "--products", "DEBQ", "--source-decision", decision, "--out", path.join(workspace, out)];

    // La decisión REAL de TR-01 hoy es PENDING_ARCHIVE_VERIFICATION /
    // PROVISIONAL_ONLY / failClosed: el job no arranca sobre una fuente provisional.
    const provisional = path.join(repoRoot, "operations/trades/TR-01/DATA_SOURCE_DECISION.json");
    const provisionalRun = spawnSync("python3", args(provisional, "provisional.json"), { encoding: "utf8" });
    assert.notEqual(provisionalRun.status, 0);
    assert.match(provisionalRun.stderr, /no cerró la decisión|provisional|fuente canónica/);

    // failClosed true aunque el status y la fuente parezcan definitivos.
    const failClosed = path.join(workspace, "fail-closed.json");
    writeFileSync(failClosed, JSON.stringify({ status: "DECIDED_FALLBACK_LAKE", selectedSource: "EEX_LAKE", selectedSourceRole: "CANONICAL", failClosed: true }));
    const failClosedRun = spawnSync("python3", args(failClosed, "fail-closed-out.json"), { encoding: "utf8" });
    assert.notEqual(failClosedRun.status, 0);
    assert.match(failClosedRun.stderr, /no cerró la decisión/);

    // Status provisional aunque failClosed ya esté en false.
    const pending = path.join(workspace, "pending.json");
    writeFileSync(pending, JSON.stringify({ status: "PENDING_ARCHIVE_VERIFICATION", selectedSource: "EEX_LAKE", selectedSourceRole: "PROVISIONAL_ONLY", failClosed: false }));
    const pendingRun = spawnSync("python3", args(pending, "pending-out.json"), { encoding: "utf8" });
    assert.notEqual(pendingRun.status, 0);
    assert.match(pendingRun.stderr, /decisión definitiva|PROVISIONAL_ONLY/);

    // Decisión definitiva pero de otra fuente: no se extrae del lago.
    const archive = path.join(workspace, "archive.json");
    writeFileSync(archive, JSON.stringify({ status: "DECIDED", selectedSource: "CLIENT_SEALED_ARCHIVE", selectedSourceRole: "CANONICAL", failClosed: false }));
    const archiveRun = spawnSync("python3", args(archive, "archive-out.json"), { encoding: "utf8" });
    assert.notEqual(archiveRun.status, 0);
    assert.match(archiveRun.stderr, /eligió 'CLIENT_SEALED_ARCHIVE'/);

    const noDecision = spawnSync("python3", [loader, "--source", "lake", "--market", "POWER_DE", "--products", "DEBQ", "--out", path.join(workspace, "out.json")], { encoding: "utf8" });
    assert.notEqual(noDecision.status, 0);
    assert.match(noDecision.stderr, /source-decision es obligatorio/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

const BUILD_TOB_ARCHIVE = String.raw`
import io, os, subprocess, sys, tarfile
import pyarrow as pa
import pyarrow.parquet as pq

outdir = sys.argv[1]

def parquet_bytes(rows):
    buf = io.BytesIO()
    pq.write_table(pa.Table.from_pylist(rows), buf)
    return buf.getvalue()

rows = [
    {"ShortCode": "DEBQ", "Maturity": "202601", "Tm": "2025-11-25T09:59:50.50498Z", "AskPx": "31.33", "AskSz": "1", "BidPx": "", "InstrumentType": "Simple Instrument"},
    {"ShortCode": "DEBM", "Maturity": "202602", "Tm": "2025-11-25T09:29:58Z", "AskPx": "40.5", "AskSz": "2", "BidPx": "40.0", "InstrumentType": "Simple Instrument"},
    {"ShortCode": "DEBQ", "Maturity": "202601", "Tm": "2025-11-25T09:59:50Z", "AskPx": "10.0", "AskSz": "1", "BidPx": "", "InstrumentType": "Futures Spread"},
]
members = {
    "data/lake/v1/table=eex_derivative_top_of_book/cmdty=POWER/area=DE/trd_date=2025-11-25/pull_id=fixture/part.parquet": parquet_bytes(rows),
}
tar_path = os.path.join(outdir, "tob.tar")
with tarfile.open(tar_path, "w") as tar:
    for name, data in members.items():
        info = tarfile.TarInfo(name)
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
zst = os.path.join(outdir, "tob.tar.zst")
subprocess.run(["zstd", "-q", "-f", "-o", zst, tar_path], check=True)
print(zst)
`;

test("BT-06 loader: con la decisión en el archivo sellado la extracción completa (no se detiene en el lago)", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "bt06-archive-"));
  try {
    const archivePath = execFileSync("python3", ["-c", BUILD_TOB_ARCHIVE, workspace], { encoding: "utf8" }).trim();
    const archiveBytes = readFileSync(archivePath);
    const sha256 = createHash("sha256").update(archiveBytes).digest("hex");
    const decision = path.join(workspace, "archive-decision.json");
    writeFileSync(decision, JSON.stringify({ status: "DECIDED", selectedSource: "CLIENT_SEALED_ARCHIVE", selectedSourceRole: "CANONICAL", failClosed: false }));
    const out = path.join(workspace, "tob-archive.json");
    const run = spawnSync("python3", [
      loader, "--source", "archive", "--archive", archivePath,
      "--expected-sha256", sha256, "--expected-bytes", String(archiveBytes.length),
      "--market", "POWER_DE", "--products", "DEBQ,DEBM",
      "--start", "2025-11-25", "--end", "2025-11-25",
      "--source-decision", decision, "--out", out,
    ], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const document = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(document.sourceDecision.selectedSource, "CLIENT_SEALED_ARCHIVE");
    assert.equal(document.sourceDecision.selectedSourceRole, "CANONICAL");
    assert.equal(document.archiveVerification.sha256, sha256);
    assert.deepEqual(Object.keys(document.series).sort(), ["DEBM|202602", "DEBQ|202601"]);
    const at1100 = document.series["DEBQ|202601"]["2025-11-25"][document.slotsBerlin.indexOf("11:00")];
    assert.deepEqual([at1100.ask, at1100.askSz], [31.33, 1]);
    // El spread no entra: misma regla de slots que la ruta del lago.
    assert.equal(document.series["DEBQ|202601"]["2025-11-25"].some((slot) => slot && slot.ask === 10.0), false);
    // El filtro en Arrow (miembro volcado a disco y leído por lotes) conserva los
    // conteos: 3 filas leídas, el spread cuenta como excluida.
    assert.equal(document.counts.rows_read, 3);
    assert.equal(document.counts.rows_excluded, 1);
    assert.equal(document.counts.rows_usable, 2);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("BT-06 loader: con el archivo sellado como fuente, un sha distinto falla cerrado", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "bt06-archive-sha-"));
  try {
    const archivePath = execFileSync("python3", ["-c", BUILD_TOB_ARCHIVE, workspace], { encoding: "utf8" }).trim();
    const decision = path.join(workspace, "archive-decision.json");
    writeFileSync(decision, JSON.stringify({ status: "DECIDED", selectedSource: "CLIENT_SEALED_ARCHIVE", selectedSourceRole: "CANONICAL", failClosed: false }));
    const out = path.join(workspace, "out.json");
    const run = spawnSync("python3", [
      loader, "--source", "archive", "--archive", archivePath,
      "--expected-sha256", "c".repeat(64), "--market", "POWER_DE", "--products", "DEBQ",
      "--source-decision", decision, "--out", out,
    ], { encoding: "utf8" });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /FAIL-CLOSED: sha256/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("BT-06 dispatch: el job de DATA-01 extrae del archivo cuando TR-01 lo declara canónico", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "bt06-dispatch-"));
  const repo = path.join(workspace, "repo");
  const v3 = path.join(repo, "operations/exploratory/v3");
  const tr01 = path.join(repo, "operations/trades/TR-01");
  try {
    mkdirSync(v3, { recursive: true });
    mkdirSync(tr01, { recursive: true });
    execFileSync("cp", [loader, path.join(v3, "build_tob_slots.py")]);
    const archivePath = execFileSync("python3", ["-c", BUILD_TOB_ARCHIVE, workspace], { encoding: "utf8" }).trim();
    const archiveBytes = readFileSync(archivePath);
    const sha256 = createHash("sha256").update(archiveBytes).digest("hex");
    writeFileSync(path.join(tr01, "DATA_SOURCE_DECISION.json"), JSON.stringify({ status: "DECIDED", selectedSource: "CLIENT_SEALED_ARCHIVE", selectedSourceRole: "CANONICAL", failClosed: false }));
    const out = path.join(workspace, "dispatch-out.json");
    const dispatch = path.join(repoRoot, "operations/data-jobs/jobs/bt06-extract.sh");
    const run = spawnSync("bash", [dispatch], {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        DATA_REPO_ROOT: repo,
        DATA_SCRATCH_DIR: path.join(workspace, "scratch"),
        DATA_WINDOW_START: "2025-11-25",
        DATA_WINDOW_END: "2025-11-25",
        DATA_BT06_SLOTS: out,
        DATA_ARCHIVE_PATH: archivePath,
        DATA_ARCHIVE_SHA256: sha256,
        DATA_ARCHIVE_BYTES: String(archiveBytes.length),
      },
    });
    assert.equal(run.status, 0, run.stderr);
    const document = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(document.sourceDecision.selectedSource, "CLIENT_SEALED_ARCHIVE");
    assert.deepEqual(Object.keys(document.series).sort(), ["DEBM|202602", "DEBQ|202601"]);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("BT-06 loader: si el archivo sellado no trae TOB en la ventana, falla cerrado (no publica vacío)", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "bt06-archive-empty-"));
  try {
    const archivePath = execFileSync("python3", ["-c", BUILD_TOB_ARCHIVE, workspace], { encoding: "utf8" }).trim();
    const archiveBytes = readFileSync(archivePath);
    const sha256 = createHash("sha256").update(archiveBytes).digest("hex");
    const decision = path.join(workspace, "archive-decision.json");
    writeFileSync(decision, JSON.stringify({ status: "DECIDED", selectedSource: "CLIENT_SEALED_ARCHIVE", selectedSourceRole: "CANONICAL", failClosed: false }));
    const out = path.join(workspace, "out.json");
    const run = spawnSync("python3", [
      loader, "--source", "archive", "--archive", archivePath,
      "--expected-sha256", sha256, "--expected-bytes", String(archiveBytes.length),
      "--market", "POWER_DE", "--products", "DEBQ,DEBM",
      "--start", "2025-01-01", "--end", "2025-01-02",
      "--source-decision", decision, "--out", out,
    ], { encoding: "utf8" });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /FAIL-CLOSED: el archivo .* no trae/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

function runPowerBacktest(workspace) {
  const slots = path.join(workspace, "slots.json");
  writeFileSync(slots, JSON.stringify(powerSlotsFixture()));
  const out = path.join(workspace, "results.json");
  const run = spawnSync(process.execPath, [runner, "--repo-root", repoRoot, "--slots", slots, "--out", out], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return { results: JSON.parse(readFileSync(out, "utf8")), manifest: JSON.parse(readFileSync(path.join(workspace, "MANIFEST.json"), "utf8")) };
}

test("BT-06 runner: produce Power Q y Power M con target 10 MW y el mismo esquema que gas", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "bt06-run-"));
  try {
    const { results, manifest } = runPowerBacktest(workspace);
    assert.equal(results.artifactKind, "EXPLORATORY_BACKTEST_RESULTS");
    assert.equal(results.status, "EXPLORATORY");
    assert.deepEqual(results.rules.targetsMw, { DEBQ: 10, DEBM: 10 });
    assert.deepEqual(Object.keys(results.comparison).sort(), ["DEBM", "DEBQ"]);
    assert.deepEqual(Object.keys(results.summary).sort(), ["DEBM", "DEBQ"]);
    for (const product of ["DEBQ", "DEBM"]) {
      const block = results.comparison[product];
      assert.equal(block.product, product);
      assert.deepEqual(block.table.map((row) => row.armId), ["BASELINE", "ARM_A", "ARM_B"]);
      assert.ok(block.perEpisode.length >= 1);
      assert.ok(typeof block.perEpisode[0].benchmark === "number");
    }
    const campaign = results.campaigns.find((item) => item.product === "DEBQ");
    assert.equal(campaign.targetMw, 10);
    assert.equal(campaign.readiness, "EXPLORATORY_COMPLETE");
    assert.match(campaign.id, /^POW-Q-/);
    assert.equal(results.episodesSkippedIncomplete.length, 0);
    // El manifest ata resultados, slots y generadores; el calendario Power entra por su manifest TR-01.
    assert.equal(manifest.artifactKind, "EXPLORATORY_BACKTEST_MANIFEST");
    assert.deepEqual(manifest.missions, ["POWER_QUARTERLY", "POWER_MONTHLY"]);
    const expectedSlots = path.relative(repoRoot, path.join(workspace, "slots.json")).split(path.sep).join("/");
    assert.equal(manifest.slots.path, expectedSlots);
    assert.equal(results.inputs.slots.path, expectedSlots);
    assert.ok(manifest.generators.some((entry) => entry.path === "operations/exploratory/v3/run-exploratory-backtest.mjs"));
    assert.equal(results.inputs.calendars[0].manifest, "operations/trades/TR-01/power-de-exchange-calendar.MANIFEST.json");
    assert.match(results.inputs.calendars[0].manifestSha256, /^[0-9a-f]{64}$/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("BT-06 runner: determinista y sin target gas (60 MW) colado en Power", () => {
  const first = mkdtempSync(path.join(tmpdir(), "bt06-det-a-"));
  const second = mkdtempSync(path.join(tmpdir(), "bt06-det-b-"));
  try {
    const a = runPowerBacktest(first);
    const b = runPowerBacktest(second);
    // El único campo que cambia con el workspace es la ruta del slots de entrada.
    const normalize = (results) => JSON.stringify({ ...results, inputs: { ...results.inputs, slots: { ...results.inputs.slots, path: null } } });
    assert.equal(normalize(a.results), normalize(b.results));
    // Power no arrastra el target gas de 60 MW ni los productos gas.
    assert.deepEqual(a.results.rules.targetsMw, { DEBQ: 10, DEBM: 10 });
    assert.equal(a.results.campaigns.every((campaign) => campaign.targetMw === 10), true);
    assert.equal(Object.keys(a.results.comparison).some((product) => product.startsWith("G0B")), false);
  } finally {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
});
