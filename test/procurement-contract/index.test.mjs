import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COVERAGE_OWNERSHIP_MAP_STATES,
  COVERAGE_STATUSES,
  MONTHLY_QUARTERLY_RELATION_STATES,
  reconcileOwnershipWithExecutedVolume,
  validateOwnershipAssignments,
  validateRelationDeclaration,
} from "../../src/procurement-contract/index.mjs";

test("el índice exporta la taxonomía y validadores de coverage ownership", () => {
  // §24 DEP-02: consumidor del índice no debe saltarse el índice para producir
  // un bloque coverageOwnership compatible con validateCampaignContract.
  assert.deepEqual(MONTHLY_QUARTERLY_RELATION_STATES, ["ADDITIONAL", "OVERLAPPING", "ALTERNATIVE", "DOCUMENTED_ABSENCE"]);
  assert.deepEqual(COVERAGE_OWNERSHIP_MAP_STATES, ["UNAVAILABLE", "MATERIALIZED"]);
  assert.ok(Array.isArray(COVERAGE_STATUSES) && COVERAGE_STATUSES.includes("RESIDUAL_CANCELLED"));
  assert.equal(typeof validateRelationDeclaration, "function");
  assert.equal(typeof validateOwnershipAssignments, "function");
  assert.equal(typeof reconcileOwnershipWithExecutedVolume, "function");
});
