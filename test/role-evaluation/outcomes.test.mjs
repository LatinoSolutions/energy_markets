import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveState } from "../../src/contracts/states.mjs";
import {
  ROLE_ADMISSION,
  ROLE_ADMISSION_AUTHORITY,
  ROLE_ADMISSION_NAMESPACE,
  ROLE_ADMISSION_VALUES,
  hasProductiveAuthority,
  initialAuthorityGrant,
  isRoleAdmissionLabel,
  namespacesClaimingRoleLabel,
  resolveRoleAdmissionValue,
  roleAdmissionAuthority,
} from "../../src/role-evaluation/outcomes.mjs";

test("los outcomes de admisión por rol son ADMIT/HOLD/REJECT", () => {
  assert.deepEqual(ROLE_ADMISSION_VALUES, ["ADMIT", "HOLD", "REJECT"]);
  assert.equal(resolveRoleAdmissionValue("ADMIT").canonicalId, "role_admission:ADMIT");
  assert.equal(resolveRoleAdmissionValue("MAYBE").code, "UNKNOWN_STATE_VALUE");
  assert.equal(isRoleAdmissionLabel("ADMIT"), true);
  assert.equal(isRoleAdmissionLabel("PASS"), false);
});

test("HOLD se resuelve por namespace y no se confunde con research verdict", () => {
  const roleHold = resolveRoleAdmissionValue("HOLD");
  const researchHold = resolveState("research_verdict", "HOLD");
  assert.equal(roleHold.ok, true);
  assert.equal(researchHold.ok, true);
  assert.notEqual(roleHold.canonicalId, researchHold.canonicalId);

  const claimingNamespaces = namespacesClaimingRoleLabel("HOLD").map((entry) => entry.namespace);
  assert.equal(claimingNamespaces.includes("role_admission"), true);
  assert.equal(claimingNamespaces.includes("research_verdict"), true);

  // Un veredicto de research no es un outcome de rol.
  assert.equal(resolveRoleAdmissionValue("PASS").ok, false);
});

test("ningún outcome concede autoridad productiva", () => {
  assert.deepEqual(initialAuthorityGrant(), []);
  assert.equal(hasProductiveAuthority(), false);

  for (const value of ROLE_ADMISSION_VALUES) {
    const authority = roleAdmissionAuthority(value);
    assert.equal(authority.ok, true);
    for (const denied of ROLE_ADMISSION_AUTHORITY.denies) {
      assert.equal(authority.grants.includes(denied), false);
    }
  }

  assert.deepEqual(roleAdmissionAuthority(ROLE_ADMISSION.ADMIT).grants, ["ROLE_SCOPED_ADMISSION"]);
  assert.deepEqual(roleAdmissionAuthority(ROLE_ADMISSION.HOLD).grants, []);
  assert.deepEqual(roleAdmissionAuthority(ROLE_ADMISSION.REJECT).grants, []);
  assert.equal(roleAdmissionAuthority("PASS").ok, false);
});