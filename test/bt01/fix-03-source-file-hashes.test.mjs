import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("FIX-03: release verifier checks source bytes and rejects a mixed day", () => {
  const script = `import hashlib, importlib.util, json, os, sys, tempfile
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("verify_fix03", "operations/audit/FIX-03/verify-source-files.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as root:
    relative = "data/lake/v1/table=eex_derivative_trade/cmdty=NATGAS/area=THE/trd_date=2025-01-02/part.parquet"
    file = os.path.join(root, relative)
    os.makedirs(os.path.dirname(file))
    with open(file, "wb") as stream: stream.write(b"market bytes")
    ref = {"path": "CLIENT_SEALED_ARCHIVE/" + relative, "sha256": hashlib.sha256(b"market bytes").hexdigest()}
    roots = {"CLIENT_SEALED_ARCHIVE": root, "EEX_LAKE_PATCH": root}
    rows = {"artifactKind": "BT-01_CAMPAIGN_PROXY_ROWS", "sourceFileHashes": {ref["path"]: ref["sha256"]},
            "campaigns": [{"perDate": [{"selectedSource": "CLIENT_SEALED_ARCHIVE", "sourceFiles": [ref]}]}]}
    imp = {"artifactKind": "IMP-05_SOURCE_PROXY_ROWS", "perDate": [{"selectedSource": "DATA_INCOMPLETE", "sourceFiles": []}]}
    good = len(m.verify_release(rows, imp, roots))
    with open(file, "wb") as stream: stream.write(b"changed bytes")
    try: m.verify_release(rows, imp, roots); bad_hash = False
    except ValueError: bad_hash = True
    rows["campaigns"][0]["perDate"][0]["selectedSource"] = "EEX_LAKE_PATCH"
    try: m.verify_release(rows, imp, roots); mixed = False
    except ValueError: mixed = True
    print(json.dumps({"good": good, "bad_hash": bad_hash, "mixed": mixed}))`;
  const result = JSON.parse(execFileSync("python3", ["-c", script], { encoding: "utf8" }));
  assert.deepEqual(result, { good: 1, bad_hash: true, mixed: true });
});
