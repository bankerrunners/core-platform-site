import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SQLiteStorage} from './sqlite-storage.mjs';
import {Ledger,WORKFLOW} from './src/intake-candidate/ledger.mjs';
import policy from './src/policy-source.cjs';
import {createWorkerDStatusAdapter,validateWorkerDStatus,LIVE_MODE} from './src/worker-d-status-adapter.mjs';
import {intakeFetch} from './src/intake-bridge.ts';

const status={status:'READY_FOR_BOUNDED_TEST',transport:'stdio',network_listener:false,evidence_root_configured:true,
 app_control:{enabled:false,send_or_submit:false,credential_fields:false},read_tools:['worker_d_pilot_status'],
 disabled:['shell','screen_control','credentials','workflow_transition','deploy']};
const result=()=>({content:[{type:'text',text:JSON.stringify(status)}]});
function fixture(t){const file=join(mkdtempSync(join(tmpdir(),'worker-d-route-')),'test.sqlite');let s=new SQLiteStorage(file);
 t.after(()=>s.close());let now=Date.now();return {get s(){return s},now:()=>now,advance:n=>now+=n,restart:()=>{s.close();s=new SQLiteStorage(file)}};}
async function prepared(f,channel='email',kind='diagnostic'){
 const l=new Ledger(f.s,{clock:f.now});const ref=await l.intake({key:'a'.repeat(64),digest:'b'.repeat(64),channel,identityRef:'test',eventId:'test',privateContent:{text:'fixture'}},f.now());
 await l.accept(ref,WORKFLOW,f.now());let c=await l.claim(ref.receiptRef,'routing',f.now());await l.route(ref.receiptRef,c.generation,f.now(),policy,null);
 await l.setApproval(ref.receiptRef,{kind,visualApproval:'approved',dispatcherOrder:true,budgetApproved:true,deadline:f.now()+60000});
 return {l,ref,c:await l.claim(ref.receiptRef,'routing',f.now())};
}
const order=f=>({key:'c'.repeat(64),correlationId:'correlation-test',kind:'diagnostic',dispatcher:'dispatcher-a',destination:'worker-d',mode:LIVE_MODE,deadline:f.now()+60000});

for(const channel of ['email','sms'])test(channel+' resumes once; real-mode fixture requires matching separate review',async t=>{
 const f=fixture(t),{l,ref,c}=await prepared(f,channel);let calls=0;
 const a=createWorkerDStatusAdapter({storage:f.s,now:f.now,invoke:async m=>{calls++;assert.equal(m.tool,'worker_d_pilot_status');assert.deepEqual(m.arguments,{});assert.equal(m.request_id,ref.correlationId);return result()}});
 const task=await l.route(ref.receiptRef,c.generation,f.now(),policy,a);assert.equal(task.state,'accepted');assert.equal(task.executionMode,LIVE_MODE);
 const evidence={mode:LIVE_MODE,worker:'worker-d',reviewer:'hq-review',artifactRef:task.dispatchEvidence.artifactRef,correlationId:ref.correlationId,contributors:['worker-d'],status:'completed'};
 await assert.rejects(l.reconcile(ref.receiptRef,{...evidence,reviewer:'worker-d'},f.now()),/RESULT_MISMATCH/);
 await assert.rejects(l.reconcile(ref.receiptRef,{...evidence,mode:'synthetic-local-test'},f.now()),/RESULT_MISMATCH/);
 await assert.rejects(l.reconcile(ref.receiptRef,{...evidence,artifactRef:'wrong'},f.now()),/RESULT_MISMATCH/);
 assert.equal((await l.reconcile(ref.receiptRef,evidence,f.now())).state,'completed');assert.equal(calls,1);
 await assert.rejects(l.setApproval(ref.receiptRef,{}),/APPROVAL_STATE_CONFLICT/);assert.equal(await l.claim(ref.receiptRef,'routing',f.now()),null);
});
test('feature approval cannot run the status-only worker',async t=>{const f=fixture(t),{l,ref,c}=await prepared(f,'email','feature');let calls=0;
 const a=createWorkerDStatusAdapter({storage:f.s,now:f.now,invoke:async()=>{calls++;return result()}});
 assert.equal((await l.route(ref.receiptRef,c.generation,f.now(),policy,a)).reason,'WORKER_D_DIAGNOSTIC_ONLY');assert.equal(calls,0);
});
test('concurrent duplicate and restart reuse one completed receipt',async t=>{const f=fixture(t);let calls=0;const invoke=async()=>{calls++;return result()};
 let a=createWorkerDStatusAdapter({storage:f.s,now:f.now,invoke});const o=order(f);const replies=await Promise.allSettled([a.deliverTask(o),a.deliverTask(o)]);
 assert(replies.some(x=>x.status==='fulfilled'));assert.equal(calls,1);f.restart();a=createWorkerDStatusAdapter({storage:f.s,now:f.now,invoke});
 assert.equal((await a.deliverTask(o)).accepted,true);assert.equal(calls,1);
});
test('lost reply remains held through restart and cannot be reapproved',async t=>{const f=fixture(t),{l,ref,c}=await prepared(f);let calls=0;
 const invoke=async()=>{calls++;throw Error('lost reply')};let a=createWorkerDStatusAdapter({storage:f.s,now:f.now,invoke});
 assert.equal((await l.route(ref.receiptRef,c.generation,f.now(),policy,a)).reason,'UNKNOWN_DISPATCH_OUTCOME');
 // An old unrelated routing reason must never mask the task's unknown outcome.
 await f.s.transaction(async tx=>{const r=await tx.get('routing:'+ref.receiptRef);r.reason='OLD_HOLD';await tx.put('routing:'+ref.receiptRef,r)});
 await assert.rejects(l.setApproval(ref.receiptRef,{}),/DELIVERY_RECONCILIATION_REQUIRED/);
 f.restart();a=createWorkerDStatusAdapter({storage:f.s,now:f.now,invoke});
 await assert.rejects(a.deliverTask({...order(f),key:ref.receiptRef,correlationId:ref.correlationId}),/WORKER_D_OUTCOME_UNKNOWN/);assert.equal(calls,1);
});
test('disk failure before receipt prevents any call',async t=>{const f=fixture(t);f.s.failAfter=0;let calls=0;
 const a=createWorkerDStatusAdapter({storage:f.s,now:f.now,invoke:async()=>{calls++;return result()}});
 await assert.rejects(a.deliverTask(order(f)),/SYNTHETIC_DISK_FAILURE/);assert.equal(calls,0);
});
test('bad or unexpectedly privileged status cannot become accepted',()=>{
 for(const bad of [{isError:true,content:[]},{content:[]},{content:[{type:'text',text:JSON.stringify({...status,app_control:{enabled:true}})}]}])assert.throws(()=>validateWorkerDStatus(bad),/WORKER_D_RESULT_INVALID/);
});
test('expired order does not call worker',async t=>{const f=fixture(t);let calls=0;const a=createWorkerDStatusAdapter({storage:f.s,now:f.now,invoke:async()=>{calls++;return result()}});
 await assert.rejects(a.deliverTask({...order(f),deadline:f.now()}),/WORKER_D_ORDER_INVALID/);assert.equal(calls,0);
});
test('untrusted serialized adapter cannot enable a route',async t=>{const f=fixture(t),{ref,c}=await prepared(f);let calls=0;
 const env={INTAKE_CANDIDATE_CONFIG:JSON.stringify({consumerToken:'fixture-token',workerDAdapter:{verified:true,mode:LIVE_MODE,identity:'Dispatcher A',destination:'worker-d'}}),MCP_PIPE:{get(){calls++;throw Error('unexpected pipe')},idFromName(){return 'worker-d'}}};
 const response=await intakeFetch(new Request('https://example.test/candidate-intake/consumer/route',{method:'POST',headers:{authorization:'Bearer fixture-token','content-type':'application/json'},body:JSON.stringify({workflow:WORKFLOW,reference:ref,claim:c})}),f.s,env);
 assert.equal(response.status,200);assert.equal((await response.json()).task.reason,'EXACT_DISPATCHER_ROUTE_UNAVAILABLE');assert.equal(calls,0);
});
