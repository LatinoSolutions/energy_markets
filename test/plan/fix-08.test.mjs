import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const plan = readFileSync(path.join(root, "PLAN_STATUS.md"), "utf8");
const semantics = readFileSync(path.join(root, "docs/product/SEM-1_BACKTESTING_SEMANTICS.md"), "utf8");
const validStatuses = new Set(["pendiente", "en_curso", "pausado", "aceptado"]);
const retiredTasks = new Set(["FIX-06"]);

function rows(source) {
  const active = source.split("## Tabla\n")[1]?.split("\n## Historial retirado del plan activo")[0];
  assert.ok(active, "active plan table and history boundary must exist");
  const entries = new Map();
  for (const line of active.split("\n")) {
    if (!/^\| [A-Z][A-Z0-9-]+ \|/.test(line) || line.startsWith("| IMP |")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    assert.equal(cells.length, 5, `malformed plan row: ${line}`);
    const [id, status, requires, objective, note] = cells;
    assert.ok(!entries.has(id), `duplicate active task ${id}`);
    entries.set(id, { status, requires: requires === "—" ? [] : requires.split(",").map((item) => item.trim()), objective, note });
  }
  return entries;
}

function validateGraph(tasks) {
  for (const [id, row] of tasks) {
    assert.ok(validStatuses.has(row.status), `${id} has invalid status ${row.status}`);
    assert.ok(!retiredTasks.has(id), `${id} is retired`);
    for (const prerequisite of row.requires) {
      assert.ok(!retiredTasks.has(prerequisite), `${id} references retired prerequisite ${prerequisite}`);
      assert.ok(tasks.has(prerequisite), `${id} has unknown prerequisite ${prerequisite}`);
    }
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
}

function requireDirectPrerequisites(tasks, id, prerequisites) {
  for (const prerequisite of prerequisites) {
    assert.ok(tasks.get(id)?.requires.includes(prerequisite), `${id} lacks direct prerequisite ${prerequisite}`);
  }
}

function validatePipeline(tasks) {
  validateGraph(tasks);
  requireDirectPrerequisites(tasks, "HYP-1", ["SEM-1"]);
  requireDirectPrerequisites(tasks, "FIX-07", ["SEM-1", "HYP-1", "FIX-09"]);
  requireDirectPrerequisites(tasks, "BT-08", ["HYP-1", "FIX-07", "BT-07"]);
  requireDirectPrerequisites(tasks, "UI-08", ["SEM-1", "HYP-1", "FIX-07", "BT-08"]);
}

function withRow(tasks, id, changes) {
  const copy = new Map(tasks);
  copy.set(id, { ...tasks.get(id), ...changes });
  return copy;
}

test("FIX-09: active plan accepts lifecycle progress and has no missing, retired or cyclic prerequisites", () => {
  const tasks = rows(plan);
  validatePipeline(tasks);
  assert.equal(tasks.get("SEM-1")?.status, "aceptado");
  assert.equal(tasks.get("FIX-08")?.status, "aceptado");
  assert.match(tasks.get("BT-08").note, /UI-08 consume este contrato/);
  assert.match(tasks.get("HYP-1").objective, /H-S1-01: Session-Anchored Rolling Reference/);
  assert.match(tasks.get("FIX-07").note, /H-S1-01.*precede/);
  assert.match(tasks.get("UI-08").note, /FIX-07.*Results con evidencia backend comparable/);
});

test("FIX-09: pending, in-progress and accepted states remain valid after later acceptance", () => {
  const tasks = rows(plan);
  for (const status of ["pendiente", "en_curso", "aceptado"]) {
    for (const id of ["FIX-08", "FIX-09", "FIX-07", "UI-08"]) {
      validatePipeline(withRow(tasks, id, { status }));
    }
  }
  validatePipeline(withRow(tasks, "FIX-07", {
    requires: [...tasks.get("FIX-07").requires, "FIX-08"],
  }));
  for (const status of ["done", "", "accepted", "en curso"]) {
    assert.throws(() => validateGraph(withRow(tasks, "FIX-08", { status })), /invalid status/);
  }
});

test("FIX-09: active Development integration path and graph failures are checked on fixtures", () => {
  const tasks = rows(plan);
  validatePipeline(tasks);
  assert.throws(() => validatePipeline(withRow(tasks, "UI-08", {
    requires: tasks.get("UI-08").requires.filter((id) => id !== "BT-08"),
  })), /UI-08 lacks direct prerequisite BT-08/);
  assert.throws(() => validatePipeline(withRow(tasks, "FIX-07", {
    requires: tasks.get("FIX-07").requires.filter((id) => id !== "FIX-09"),
  })), /FIX-07 lacks direct prerequisite FIX-09/);
  assert.throws(() => validateGraph(withRow(tasks, "UI-08", { requires: ["UNKNOWN"] })), /unknown prerequisite UNKNOWN/);
  assert.throws(() => validateGraph(withRow(tasks, "UI-08", { requires: ["FIX-06"] })), /retired prerequisite FIX-06/);
  assert.throws(() => validateGraph(withRow(tasks, "HYP-1", { requires: ["UI-08"] })), /dependency cycle/);
});

test("FIX-08: retired work and semantic handoff retain provenance without an acceptance claim", () => {
  assert.match(plan, /FIX-06 — retirado, no aceptado/);
  assert.match(plan, /D-20260928T122219-f84f\/task\.md/);
  assert.match(plan, /runs\/energy-markets-FIX-06-\*/);
  assert.match(plan, /FIX-06\.json/);
  assert.match(semantics, /FIX-06 is retired without an acceptance claim/);
  assert.match(semantics, /historical handoff is not an active work queue/);
  const worktrees = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: root, encoding: "utf8" });
  assert.doesNotMatch(worktrees, /^worktree .*energy-markets-FIX-06-/m);
});
