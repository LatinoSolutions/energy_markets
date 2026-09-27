import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const python = `import importlib.util, json, sys
sys.dont_write_bytecode = True
s = importlib.util.spec_from_file_location("bt01_extract", "operations/audit/BT-01/extract-campaign-proxy-rows.py")
m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
payload = json.load(sys.stdin)
try:
    plan = m.source_plan(payload["campaigns"], payload["coverage"], payload["calendar"])
    print(json.dumps({"ok": True, "plan": sorted([[key, day, source] for (key, day), source in plan.items()])}))
except ValueError as error:
    print(json.dumps({"ok": False, "error": str(error)}))`;

function run(payload) {
  return JSON.parse(execFileSync("python3", ["-c", python], { input: JSON.stringify(payload), encoding: "utf8" }));
}

const base = () => ({
  campaigns: [{ campaignKey: "G0BM-202601", product: "G0BM", windowStart: "2025-12-01", windowEnd: "2026-01-01" }],
  calendar: ["2025-12-01", "2025-12-02"],
  coverage: {
    ownerDecision: { verificationStatus: "RULE_APPLIED" },
    campaigns: [{ market: "GAS_THE", shortCode: "G0BM", windowStart: "2025-12-01", windowEnd: "2025-12-31", patch: { days: [
      { day: "2025-12-01", source: "CLIENT_SEALED_ARCHIVE" },
      { day: "2025-12-02", source: "DATA_INCOMPLETE" },
    ] } }],
  },
});

test("FIX-03: DATA-02 binds complete archive days and missing days without mixing", () => {
  assert.deepEqual(run(base()), { ok: true, plan: [
    ["G0BM-202601", "2025-12-01", "CLIENT_SEALED_ARCHIVE"],
    ["G0BM-202601", "2025-12-02", "DATA_INCOMPLETE"],
  ] });
});

test("FIX-03: source plan refuses pending measurement and missing calendar dates", () => {
  const pending = base();
  pending.coverage.ownerDecision.verificationStatus = "PENDING_LAKE_MEASUREMENT";
  assert.match(run(pending).error, /measurement is pending/);
  const incomplete = base();
  incomplete.coverage.campaigns[0].patch.days.pop();
  assert.match(run(incomplete).error, /dates differ/);
  const unknown = base();
  unknown.coverage.campaigns[0].patch.days[1].source = "EEX_LAKE";
  assert.match(run(unknown).error, /Unverified/);
});

test("FIX-03: sealed archive allowlist excludes a client-rejected parquet", () => {
  const script = `import hashlib, json, os, sys, tempfile
sys.dont_write_bytecode = True
sys.path.insert(0, "operations/trades/DATA-02")
from sealed_archive_files import verified_gas_file_index
with tempfile.TemporaryDirectory() as root:
    prefix = "data/lake/v1/table=eex_derivative_trade/cmdty=NATGAS/area=THE/trd_date=2025-01-02/"
    first, second = prefix + "pull_id=one/part.parquet", prefix + "pull_id=two/part.parquet"
    refs = {}
    for name, records in (("files", [first]), ("exclusions", [second])):
        path = os.path.join(root, name + ".jsonl")
        with open(path, "w") as stream:
            for entry in records:
                item = {"archive_path": entry} if name == "files" else {"source_path": "/var/lib/askfi/fundamental-live/datasets/eex/lake/v1/" + entry.split("data/lake/v1/", 1)[1]}
                stream.write(json.dumps(item) + "\\n")
        refs[name] = {"path": path, "sha256": hashlib.sha256(open(path, "rb").read()).hexdigest()}
    partitions = {"sources": {"CLIENT_SEALED_ARCHIVE": {"inputs": refs}}}
    included, excluded = verified_gas_file_index(partitions, "a" * 64, {"inputs": {"sourcePartitions": {"sha256": "a" * 64}}}, root)
    print(json.dumps({"included": sorted(included), "excluded": sorted(excluded)}))`;
  const result = JSON.parse(execFileSync("python3", ["-c", script], { encoding: "utf8" }));
  assert.equal(result.included.length, 1);
  assert.equal(result.excluded.length, 1);
  assert.match(result.included[0], /pull_id=one/);
  assert.match(result.excluded[0], /pull_id=two/);
});
