import assert from 'node:assert/strict';import os from 'node:os';import path from 'node:path';import fs from 'node:fs';
import {SQLiteStorage} from './sqlite-storage.mjs';import {Ledger,WORKFLOW} from './src/intake-candidate/ledger.mjs';import policy from './src/policy-source.cjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hq-resume-'));const s=new SQLiteStorage(path.join(dir,'test.sqlite'));let now=1800000000000;let calls=0;const l=new Ledger(s,{clock:()=>now});
try {
const ref=await l.intake({key:'a'.repeat(64),digest:'b'.repeat(64),channel:'email',identityRef:'fixture',eventId:'fixture',privateContent:{text:'synthetic'}},now);
await l.accept(ref,WORKFLOW,now);let claim=await l.claim(ref.receiptRef,'routing',now);await l.route(ref.receiptRef,claim.generation,now,policy,null);assert.equal((await l.lookup(ref.receiptRef)).task.state,'held');
await l.setApproval(ref.receiptRef,{kind:'fix',visualApproval:'approved',dispatcherOrder:true,budgetApproved:true,deadline:now+60000});
claim=await l.claim(ref.receiptRef,'routing',now);assert(claim,'approval must resume held routing');
const adapter={verified:true,mode:'synthetic-local-test',identity:'dispatcher',destination:'fixture-worker',deliverTask:async o=>{calls++;return {...o,worker:'fixture-worker',accepted:true}}};
await l.route(ref.receiptRef,claim.generation,now,policy,adapter);assert.equal(calls,1);
await assert.rejects(l.setApproval(ref.receiptRef,{}),/APPROVAL_STATE_CONFLICT/);
await assert.rejects(l.reconcile(ref.receiptRef,{correlationId:ref.correlationId,mode:'synthetic-local-test',worker:'fixture-worker',reviewer:'fixture-worker',artifactRef:'artifact',contributors:['fixture-worker'],status:'completed'},now),/RESULT_MISMATCH/);
await l.reconcile(ref.receiptRef,{correlationId:ref.correlationId,mode:'synthetic-local-test',worker:'fixture-worker',reviewer:'reviewer',artifactRef:'artifact',contributors:['fixture-worker'],status:'completed'},now);
assert.equal((await l.lookup(ref.receiptRef)).task.state,'completed');assert.equal(await l.claim(ref.receiptRef,'routing',now),null);
console.log('PASS: persisted held → approval → one synthetic delivery → independent result → completed; reapproval and self-review rejected');
}finally{s.close();}
