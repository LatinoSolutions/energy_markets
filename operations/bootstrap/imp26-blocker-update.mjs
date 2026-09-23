import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {api} from '/home/op/office-continuity/bin/pcapi.mjs';
const base='/srv/hot-data/energy-markets/app';
const ids=JSON.parse(fs.readFileSync(base+'/operations/bootstrap/paperclip-ids.json','utf8'));
const marker='OWNER-IMP26-BLOCKER-20260919';
const note=`# ${marker}

Latest owner instruction supersedes older shared-edit holds and timer-restoration instructions only to the extent stated here. Claude has completed the North Star cutover. The resource policy baseline is controller commit 3a02669 and is READ-ONLY for IMP-26. Project binding work may proceed only when the existing canonical eligibility gates pass; no budget, reserve, routing, autonomy or North Star policy modifications are authorized. A demonstrated frozen-decision contradiction requires a scoped SPEC_CHANGE_REQUEST, not silent changes.

Exact blocker: office-continuity imports fixed ROOT from pcapi.mjs; gatherBacklog filters issue.parentId === ROOT. ROOT refers to LAT-20 while Energy Markets is ON under LAT-91. Owner reports that a dry-run attempted an Energy refill under LAT-20. This report is evidence of the blocker, not evidence that a fix or live acceptance test passed.

Mandatory IMP-26 acceptance requirements:
1. The controller resolves the currently ON project.
2. It resolves that project's corresponding root/goal without hardcoding LAT-20.
3. Backlog, READY, replenisher, command-question, reviews, final acceptance, handoff, dead-execution and autonomy operate only within the ON project's scope.
4. Alexandria OFF produces zero new work.
5. Energy Markets ON uses only its canonical tree/graph.
6. A Project Switch changes controller scope dynamically without code changes or architectural restart.
7. An issue without a project remains non-executable.
8. Replenisher never creates a ticket below another project's root.
9. Previous OFF-project state cannot contaminate READY, pending acceptance, recovery claims or starvation for the ON project. Preserve prior history and state; isolate it rather than deleting it.
10. Reactivate the timer only AFTER all this validation passes.

Required observed acceptance sequence:
Energy Markets ON + Alexandria OFF -> bounded controller tick -> scope/root Energy Markets / LAT-91 -> no LAT-20 child enters executable backlog -> refill, if warranted by existing policy, belongs to Energy Markets and LAT-91 -> worker executes -> independent review -> continuation -> Astra stays idle except a bounded Command event.

Use an explicitly bounded live validation with the recurring timer OFF; do not turn the timer on in order to obtain acceptance evidence. No interactive watching or polling of workers/reviews: preserve the continuation checkpoint, use native events, return idle. Fixture tests and dry-runs alone cannot satisfy the observed live sequence. Dynamic switch isolation may be tested with injected test state; this instruction does not authorize activating Alexandria's real work. If safe live validation is technically unavailable, record the precise gap and remain blocked with timer OFF.

Timer safety state verified after this update: latinosolutions-continuity.timer inactive/dead and disabled. It was previously inactive but enabled; disabled to preserve OFF across restart until the gate passes. Only an eligible bounded Command action after the complete acceptance evidence and independent review may re-enable/start it. This supersedes prior packet wording that allowed restoring the timer after code review but before live validation.

Existing dependencies are unchanged: separately ACCEPTED IMP-01 and IMP-25, scoped canonical receipts and independent reviews, sufficient DEP-27 audit scope, Project ON, no unresolved applicable SPEC_CHANGE_REQUEST. Child completion/native done does not accept the IMP parent. No new scheduler, agents, worktrees, purchases or continuous Command monitoring. NORTH STAR POLICY FROZEN; integration seams must preserve its behavior and values. All other existing packet path restrictions remain; if a prohibited policy surface seems necessary, provide precise evidence and scoped change request before modifying it.
`;
const localPath=base+'/operations/bootstrap/IMP-26-BLOCKER-EVIDENCE-UPDATE.md';
fs.writeFileSync(localPath,note);
async function doc(id,key,body){let prev;try{prev=await api('GET',`/issues/${id}/documents/${key}`);}catch(e){if(!e.message.includes('404'))throw e;}const rev=prev?.latestRevisionId??prev?.currentRevisionId??prev?.revisionId??prev?.document?.latestRevisionId;return api('PUT',`/issues/${id}/documents/${key}`,{format:'markdown',body,changeSummary:'Owner blocker evidence: frozen North Star 3a02669; project scope gate before timer activation.',...(rev?{baseRevisionId:rev}:{})});}
function appendOnce(path,text){const old=fs.readFileSync(path,'utf8');if(!old.includes(marker))fs.appendFileSync(path,'\n'+text);}
const short=`## ${marker}\nRead ${localPath}. Claude's cutover is complete; North Star resource policy at 3a02669 remains READ-ONLY. IMP-26 project binding is eligible only after canonical prerequisites. Timer must stay OFF until all ten scope/isolation requirements AND the observed Energy-only worker/review/continuation sequence pass. Earlier permission to restore before live validation is superseded. Command remains event-driven and bounded.\n`;
for(const file of ['AGENTS.md','operations/bootstrap/COMMAND_HANDOFF.md','operations/bootstrap/CONCURRENT_OWNER_WORK.md','operations/packets/IMP-26-ST-1.md'])appendOnce(base+'/'+file,short);
const conditionPath=base+'/operations/bootstrap/IMP-26-dependency-condition.json';
const c=JSON.parse(fs.readFileSync(conditionPath,'utf8'));
c.additionalGates.sharedSurfaceOwnership='Claude cutover complete. North Star policy at 3a02669 read-only; only eligible, scoped IMP-26 binding work allowed. Other packet restrictions remain.';
c.additionalGates.timerReactivation={requiredEvidence:localPath,requiredObservedSequence:['Energy ON, Alexandria OFF','bounded tick scopes Energy / LAT-91','LAT-20 children excluded','eligible refill only below Energy root','worker executes','independent review','continuation','Astra idle except Command event'],allTenOwnerRequirementsMustPass:true,timerMustRemainOffDuringValidation:true,fixtureOrDryRunAloneSufficient:false};
c.ownerBlockerUpdateAt=new Date().toISOString();
fs.writeFileSync(conditionPath,JSON.stringify(c,null,2)+'\n');
for(const id of [ids.root.id,ids.parents['IMP-26'].id,ids.children['IMP-26'].id]){
 await doc(id,'imp26-blocker-evidence-update',note);
 for(const key of ['event-driven-command-handoff','director-continuation-handoff','concurrent-owner-work']){
  let old;try{old=await api('GET',`/issues/${id}/documents/${key}`);}catch(e){if(e.message.includes('404'))continue;throw e;}
  const body=old.body??old.document?.body;
  if(typeof body!=='string')throw Error('Missing document body: '+key);
  if(!body.includes(marker))await doc(id,key,body+'\n'+short);
 }
}
await doc(ids.children['IMP-26'].id,'canonical-dependency-condition','```json\n'+JSON.stringify(c,null,2)+'\n```');
const packet=await api('GET','/issues/'+ids.children['IMP-26'].id);
if(!(packet.description??'').includes(marker))await api('PATCH','/issues/'+packet.id,{description:(packet.description??'')+'\n'+note});
const agentRoot='/home/op/.paperclip/instances/default/companies/0cd3e396-2505-4349-af4f-09dd608047d2/agents';
for(const id of ['2b6bf987-6800-4d4c-a23a-d470a4bb0ea6','0af74a08-cb39-4cf5-a94f-117b242ea08c','2f30b8dd-306b-4735-a135-f8d3127c8c0e','6c548bcb-e6aa-43ea-9c6c-319497cbe6a9','684f6bf6-1a87-4c1e-becf-c39bdabf1cfc','3930ac4b-632e-4edb-b178-3e53021c4be5'])appendOnce(agentRoot+'/'+id+'/instructions/AGENTS.md',short);
const proof=[];
for(const id of [ids.root.id,ids.parents['IMP-26'].id,ids.children['IMP-26'].id]){const d=await api('GET',`/issues/${id}/documents/imp26-blocker-evidence-update`);const body=d.body??d.document?.body;if(body!==note)throw Error('Document verification mismatch '+id);proof.push(id);}
const repo='/home/op/.paperclip/integrations/office-continuity';
const head=execFileSync('git',['-C',repo,'rev-parse','--short','HEAD'],{encoding:'utf8'}).trim();
const dirty=execFileSync('git',['-C',repo,'status','--porcelain'],{encoding:'utf8'}).trim();
const timer=execFileSync('systemctl',['--user','show','latinosolutions-continuity.timer','-p','ActiveState','-p','SubState','-p','UnitFileState'],{encoding:'utf8'}).trim();
const result={recordedAt:new Date().toISOString(),verifiedNativeDocs:proof,controllerHead:head,controllerWorkingTreeClean:dirty==='',timer,policyModified:false,acceptanceGatePassed:false,continuousMonitoring:false};
fs.writeFileSync(base+'/operations/bootstrap/IMP-26-blocker-update-receipt.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
