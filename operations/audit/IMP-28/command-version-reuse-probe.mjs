// Independent Command review probe. Synthetic data only; no office mutations.
import assert from 'node:assert/strict';
import { createRoleEvaluationRegistry } from '../../../src/role-evaluation/registry.mjs';
const roleClass = 'ENGINEERING_ORCHESTRATION';
const results = [];
for (const kind of ['semantic-version', 'content-hash']) {
  const v1 = kind === 'semantic-version' ? '1.0.0' : { contentHash: 'a'.repeat(64) };
  const v2 = kind === 'semantic-version' ? '2.0.0' : { contentHash: 'b'.repeat(64) };
  const componentId = `SYN-COMMAND-${kind}`;
  const registry = createRoleEvaluationRegistry();
  const contract = {
    componentId, componentVersion: v1, roleClass,
    protocolId: 'SYN-COMMAND-PROTOCOL', protocolVersion: '1.0.0',
    exactRole: 'Synthetic software validation helper', problemToImprove: 'Synthetic missed validation cases',
    currentComparator: 'Synthetic existing test runner', valueHypothesis: 'Synthetic fewer missed cases',
    requiredInputs: ['Synthetic cases'], outputs: ['Synthetic report'], authorityRequested: [],
    integrationBoundary: 'Synthetic isolated memory registry', failureModes: ['Synthetic false acceptance'],
    reproducibilityRequirements: ['Same synthetic inputs and protocol'],
    costLatencyBurden: { unknown: true, reason: 'No real component evaluated' },
    overlapAssessment: 'Synthetic overlap with existing runner', evidenceRequiredForAdmission: ['Synthetic comparison'],
    removalRollbackPath: 'Discard synthetic instance',
  };
  const ready = () => registry.markEvaluationReady(componentId, roleClass, {
    prerequisitesSatisfied: ['SYN protocol declared'], readinessEvidence: [{ kind: 'synthetic', ref: 'SYN-READY' }],
  });
  const outcome = value => registry.recordOutcome(componentId, roleClass, value, {
    evidenceRefs: [{ kind: 'synthetic', ref: `SYN-${value}` }],
  });
  assert.equal(registry.registerComponent(contract).ok, true);
  assert.equal(ready().ok, true);
  assert.equal(outcome('REJECT').ok, true);
  assert.equal(registry.createNewEvaluationVersion(componentId, roleClass, {
    materialChange: true, changeSummary: 'Synthetic second version', newVersion: v2,
  }).ok, true);
  assert.equal(ready().ok, true);
  assert.equal(outcome('HOLD').ok, true);
  const reuse = registry.createNewEvaluationVersion(componentId, roleClass, {
    materialChange: true, changeSummary: 'Synthetic attempt to reuse rejected identity', newVersion: v1,
  });
  let readyAgain = null, admitted = null;
  if (reuse.ok) { readyAgain = ready(); admitted = outcome('ADMIT'); }
  results.push({ kind, expected: 'Previously evaluated component/role/protocol/version identity rejected',
    pass: reuse.ok === false, reuseAccepted: reuse.ok, readinessAccepted: readyAgain?.ok,
    admitAccepted: admitted?.ok, integration: registry.evaluateIntegration(componentId),
    history: registry.history(componentId, roleClass).map(r => ({componentVersion:r.componentVersion,
      protocolId:r.protocolId, protocolVersion:r.protocolVersion, outcome:r.outcome?.value})),
  });
}
console.log(JSON.stringify({ synthetic: true, results }, null, 2));
process.exitCode = results.every(r => r.pass) ? 0 : 1;
