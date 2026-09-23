// Independent review assertions over explicit synthetic fixtures; no real evaluation.
import assert from 'node:assert/strict';
import { createRoleEvaluationRegistry } from '../../../src/role-evaluation/registry.mjs';
import { makeEvaluation } from '../../../test/role-evaluation/fixtures.mjs';
const results = [];
for (const format of ['semver', 'content-hash']) {
  const version = n => format === 'semver' ? `${n}.0.0` : {contentHash: String(n).repeat(64)};
  const registry = createRoleEvaluationRegistry();
  const initial = makeEvaluation({ componentId: `SYN-PROTOCOL-IDENTITY-${format}`, componentVersion:version(1), protocolId:'SYN-P1' });
  const id=initial.componentId, role=initial.roleClass;
  const ready = () => registry.markEvaluationReady(id, role, {prerequisitesSatisfied:['SYN-ready'], readinessEvidence:[{kind:'synthetic',ref:'SYN-ready'}]});
  const reject = ref => registry.recordOutcome(id, role, 'REJECT', {evidenceRefs:[{kind:'synthetic',ref}]});
  const change = (n, protocolId) => registry.createNewEvaluationVersion(id, role, {
    newVersion:version(n), materialChange:true, changeSummary:'Synthetic declared change',
    protocolChange:true, protocolChangeSummary:'Synthetic separately declared protocol',
    contract:{...initial,componentVersion:version(n),protocolId},
  });
  assert.equal(registry.registerComponent(initial).ok,true);
  assert.equal(ready().ok,true); assert.equal(reject('SYN-P1-REJECT').ok,true);
  assert.equal(change(2,'SYN-P1').ok,true);
  // Reusing the component version under a distinct declared protocol is a new full identity.
  assert.equal(change(1,'SYN-P2').ok,true);
  assert.equal(ready().ok,true); assert.equal(reject('SYN-P2-REJECT').ok,true);
  const priorBefore=registry.get(id,role).priorFindings;
  assert.equal(priorBefore.length,2);
  const next=change(3,'SYN-P2'); assert.equal(next.ok,true);
  const after=next.record.priorFindings;
  results.push({format,expected:'Both distinct protocol identities retain REJECT findings',
    pass:after.length===2 && after.some(f=>f.protocolId==='SYN-P1') && after.some(f=>f.protocolId==='SYN-P2'),
    before:priorBefore.map(f=>({protocolId:f.protocolId,refs:f.evidenceRefs})),
    after:after.map(f=>({protocolId:f.protocolId,refs:f.evidenceRefs})),
    outcomeHistory:next.record.outcomeHistory.map(f=>({protocolId:f.protocolId,refs:f.evidenceRefs})),
  });
}
console.log(JSON.stringify({synthetic:true,results},null,2));
process.exitCode=results.every(r=>r.pass)?0:1;
