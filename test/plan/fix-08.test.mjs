import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const plan = readFileSync(path.join(root, "PLAN_STATUS.md"), "utf8");
const semantics = readFileSync(path.join(root, "docs/product/SEM-1_BACKTESTING_SEMANTICS.md"), "utf8");
const active = plan.split("## Tabla\n")[1]?.split("\n## Historial retirado del plan activo")[0];

function rows() {
  assert.ok(active, "active plan table and history boundary must exist");
  const entries = new Map();
  for (const line of active.split("\n")) {
    if (!/^\| [A-Z][A-Z0-9-]+ \|/.test(line) || line.startsWith("| IMP |")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    assert.equal(cells.length, 5, `malformed plan row: ${line}`);
    const [id, status, requires, objective, note] = cells;
    assert.ok(!entries.has(id), `duplicate active task ${id}`);
    entries.set(id, { status, requires: requires === "—" ? [] : requires.split(",").map((id) => id.trim()), objective, note });
  }
  return entries;
}

test("FIX-08: active plan has the SEM-1 → HYP-1 → FIX-07 → UI-08 chain without FIX-06", () => {
  const tasks = rows();
  assert.equal(tasks.get("SEM-1")?.status, "aceptado");
  assert.equal(tasks.has("FIX-06"), false);
  assert.deepEqual(tasks.get("HYP-1")?.requires, ["SEM-1"]);
  assert.deepEqual(tasks.get("FIX-07")?.requires, ["SEM-1", "HYP-1"]);
  assert.deepEqual(tasks.get("UI-08")?.requires, ["SEM-1", "FIX-07", "HYP-1"]);
  for (const id of ["HYP-1", "FIX-07", "UI-08"]) {
    assert.equal(tasks.get(id)?.status, "pendiente", `${id} must not remain temporarily paused`);
    assert.equal(tasks.get(id).requires.includes("FIX-06"), false);
  }
  assert.match(tasks.get("HYP-1").objective, /H-S1-01: Session-Anchored Rolling Reference/);
  assert.match(tasks.get("FIX-07").note, /H-S1-01.*precede/);
  assert.match(tasks.get("UI-08").note, /FIX-07.*Results con evidencia backend comparable/);

  for (const [id, row] of tasks) {
    for (const prerequisite of row.requires) assert.ok(tasks.has(prerequisite), `${id} has unknown prerequisite ${prerequisite}`);
  }
  const visited = new Set();
  const inPath = new Set();
  function visit(id) {
    assert.ok(!inPath.has(id), `dependency cycle through ${id}`);
    if (visited.has(id)) return;
    inPath.add(id);
    for (const prerequisite of tasks.get(id).requires) visit(prerequisite);
    inPath.delete(id);
    visited.add(id);
  }
  for (const id of tasks.keys()) visit(id);
});

test("FIX-08: retired work and semantic handoff retain provenance without an acceptance claim", () => {
  const tasks = rows();
  assert.equal(tasks.get("FIX-08")?.status, "pendiente");
  assert.match(plan, /FIX-06 — retirado, no aceptado/);
  assert.match(plan, /D-20260928T122219-f84f\/task\.md/);
  assert.match(plan, /runs\/energy-markets-FIX-06-\*/);
  assert.match(plan, /FIX-06\.json/);
  assert.match(semantics, /FIX-06 is retired without an acceptance claim/);
  assert.match(semantics, /historical handoff is not an active work queue/);
  const worktrees = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: root, encoding: "utf8" });
  assert.doesNotMatch(worktrees, /^worktree .*energy-markets-FIX-06-/m);
});
