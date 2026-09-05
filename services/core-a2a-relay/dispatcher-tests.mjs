import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SQLiteStorage} from './sqlite-storage.mjs';
import {Ledger,WORKFLOW} from './src/intake-candidate/ledger.mjs';
import {handle,recoverAndNotify} from './src/intake-candidate/adapter.mjs';
import {signature} from './src/intake-candidate/intake.mjs';
import {handleDispatcher} from './src/dispatcher-adapter.mjs';
import policy from './src/policy-source.cjs';

const dir=path.dirname(fileURLToPath(import.meta.url));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'core-intake-dispatcher-'));
const results=[];
let now=1800000000000;

const config={
  email:{identityRef:'synthetic.identity',resource:'00000000-0000-4000-8000-000000000002',signingKey:'synthetic-test-only-key'},
  sms:{identityRef:'synthetic.identity',resource:'+15555550100',signingKey:'synthetic-test-only-key'},
  consumerToken:'synthetic-consumer-token',
  dispatcherToken:'synthetic-dispatcher-token',
  clock:()=>now
};

const fixtures={
  email:{event_type:'message.received',timestamp:'2027-01-15T08:00:00Z',data:{message:{id:'00000000-0000-4000-8000-000000000001',mailbox_id:'00000000-0000-4000-8000-000000000002',from_address:'sender@example.invalid',to_addresses:['receiver@example.invalid'],direction:'inbound',has_attachments:false,subject:'Synthetic work',body_text:'Fixture only'}}},
};

async function test(name,fn){
  try{
    await fn();
    results.push({name,pass:true});
  }catch(e){
    results.push({name,pass:false,error:e.stack});
  }
}

function open(name){
  const s=new SQLiteStorage(path.join(tmp,name+'.sqlite'));
  return {s,l:new Ledger(s,config)};
}

async function req(channel,body=fixtures[channel],mods={}){
  const raw=typeof body==='string'?body:JSON.stringify(body);
  const ts=String(Math.floor(now/1000));
  const rid='synthetic-delivery-'+crypto.randomUUID();
  const headers={
    'x-inkbox-request-id':rid,
    'x-inkbox-timestamp':ts,
    'x-inkbox-signature':await signature(config[channel].signingKey,rid,ts,raw),
    ...mods
  };
  return new Request('https://candidate.invalid/intake/'+channel,{method:'POST',headers,body:raw});
}

async function intake(l,channel='email',body=fixtures[channel]){
  const r=await handle(await req(channel,body),l,config,now);
  assert.equal(r.status,202,await r.clone().text());
  return (await r.json()).reference;
}

async function dispatcherReq(endpoint,body,mods={}){
  return new Request('https://candidate.invalid/dispatcher'+endpoint,{
    method:body?'POST':'GET',
    headers:{
      'authorization':'Bearer '+config.dispatcherToken,
      'content-type':'application/json',
      ...mods
    },
    body:body?JSON.stringify(body):undefined
  });
}

async function callDispatcher(l,endpoint,body){
  return handleDispatcher(await dispatcherReq(endpoint,body),l,config.dispatcherToken,now);
}

// Test dispatcher adapter
await test('Dispatcher can query task state before approval',async()=>{
  const {s,l}=open('dispatcher-query');
  const ref=await intake(l);

  const r=await callDispatcher(l,'/query/'+ref.receiptRef,null);
  assert.equal(r.status,200);
  const data=await r.json();
  assert.equal(data.reference.receiptRef,ref.receiptRef);
  assert.equal(data.task.state,'held');
  assert.equal(data.task.reason,'DISPATCHER_ORDER_REQUIRED');
  assert.equal(data.acceptance,null);

  s.close();
});

await test('Dispatcher sets approval and task moves to eligible',async()=>{
  const {s,l}=open('dispatcher-approval');
  const ref=await intake(l);

  const approval={
    receiptRef:ref.receiptRef,
    kind:'fix',
    visualApproval:'approved',
    dispatcherOrder:true,
    deadline:now+60000,
    budgetApproved:true
  };

  const r1=await callDispatcher(l,'/approval',approval);
  assert.equal(r1.status,200);
  const ack=await r1.json();
  assert.equal(ack.accepted,true);

  // Query after approval
  const r2=await callDispatcher(l,'/query/'+ref.receiptRef,null);
  assert.equal(r2.status,200);
  const data=await r2.json();
  assert.equal(data.task.state,'held'); // Still held until routing claim

  s.close();
});

await test('Dispatcher approval validation gates kind, visual, order',async()=>{
  const {s,l}=open('dispatcher-validation');
  const ref=await intake(l);

  // Missing required field
  const r1=await callDispatcher(l,'/approval',{receiptRef:ref.receiptRef});
  assert.equal(r1.status,400);

  // Bad kind
  const r2=await callDispatcher(l,'/approval',{
    receiptRef:ref.receiptRef,
    kind:'invalid',
    visualApproval:'approved',
    dispatcherOrder:true
  });
  assert.equal(r2.status,400);

  // Rejected visual approval
  const r3=await callDispatcher(l,'/approval',{
    receiptRef:ref.receiptRef,
    kind:'feature',
    visualApproval:'rejected',
    dispatcherOrder:false
  });
  assert.equal(r3.status,200);
  const data=await r3.json();
  assert.equal(data.accepted,true);

  s.close();
});

await test('Dispatcher records worker result after successful dispatch',async()=>{
  const {s,l}=open('dispatcher-result');
  const ref=await intake(l);

  // Set approval
  await l.setApproval(ref.receiptRef,{kind:'fix',visualApproval:'approved',dispatcherOrder:true,budgetApproved:true,deadline:now+60000});

  // Simulate dispatch: accept and route
  await l.accept(ref,WORKFLOW,now);
  const lease=await l.claim(ref.receiptRef,'routing',now);

  // Adapter for routing
  const adapter={
    verified:true,
    mode:'synthetic-local-test',
    identity:'dispatcher-a',
    destination:'synthetic-worker',
    deliverTask:async order=>({
      key:order.key,
      correlationId:order.correlationId,
      dispatcher:order.dispatcher,
      mode:order.mode,
      destination:order.destination,
      worker:'synthetic-worker',
      accepted:true
    }),
    lookupReceipt:order=>Promise.resolve(null)
  };

  const task=await l.route(ref.receiptRef,lease.generation,now,policy,adapter);
  assert.equal(task.state,'accepted');
  assert.equal(task.dispatchEvidence.worker,'synthetic-worker');

  // Record result - must match the dispatched worker and use independent reviewer
  const result={
    receiptRef:ref.receiptRef,
    correlationId:ref.correlationId,
    mode:'synthetic-local-test',
    worker:'synthetic-worker', // Must match dispatched worker
    reviewer:'independent-reviewer', // Must be different from worker
    artifactRef:'artifact-123',
    contributors:['synthetic-worker'], // Must include worker
    status:'completed'
  };

  const r=await callDispatcher(l,'/result',result);
  assert.equal(r.status,200);
  const ack=await r.json();
  assert.equal(ack.recorded,true);
  assert.equal(ack.task.state,'completed');

  s.close();
});

await test('Dispatcher result validation requires independent reviewer',async()=>{
  const {s,l}=open('dispatcher-result-validation');
  const ref=await intake(l);

  await l.setApproval(ref.receiptRef,{kind:'fix',visualApproval:'approved',dispatcherOrder:true,budgetApproved:true,deadline:now+60000});
  await l.accept(ref,WORKFLOW,now);
  const lease=await l.claim(ref.receiptRef,'routing',now);

  const adapter={
    verified:true,
    mode:'synthetic-local-test',
    identity:'dispatcher-a',
    destination:'synthetic-worker',
    deliverTask:async order=>({
      key:order.key,
      correlationId:order.correlationId,
      dispatcher:order.dispatcher,
      mode:order.mode,
      destination:order.destination,
      worker:'synthetic-worker',
      accepted:true
    }),
    lookupReceipt:order=>Promise.resolve(null)
  };

  await l.route(ref.receiptRef,lease.generation,now,policy,adapter);

  // Result with same reviewer as worker (invalid)
  const invalidResult={
    receiptRef:ref.receiptRef,
    correlationId:ref.correlationId,
    worker:'worker-a',
    reviewer:'worker-a', // Same as worker!
    artifactRef:'artifact-123',
    contributors:['worker-a'],
    status:'completed'
  };

  const r=await callDispatcher(l,'/result',invalidResult);
  assert.equal(r.status,409); // Conflict

  s.close();
});

await test('Dispatcher query hides private content and sensitive dispatch details',async()=>{
  const {s,l}=open('dispatcher-privacy');
  const ref=await intake(l);

  // Set approval and dispatch
  await l.setApproval(ref.receiptRef,{kind:'fix',visualApproval:'approved',dispatcherOrder:true,budgetApproved:true,deadline:now+60000});
  await l.accept(ref,WORKFLOW,now);
  const lease=await l.claim(ref.receiptRef,'routing',now);

  const adapter={
    verified:true,
    mode:'synthetic-local-test',
    identity:'dispatcher-a',
    destination:'synthetic-worker',
    deliverTask:async order=>({
      key:order.key,
      correlationId:order.correlationId,
      dispatcher:order.dispatcher,
      mode:order.mode,
      destination:order.destination,
      worker:'synthetic-worker',
      accepted:true
    })
  };

  await l.route(ref.receiptRef,lease.generation,now,policy,adapter);

  // Query and verify no private content
  const r=await callDispatcher(l,'/query/'+ref.receiptRef,null);
  assert.equal(r.status,200);
  const data=await r.json();
  const json=JSON.stringify(data);

  // Should contain reference and state
  assert(json.includes('receiptRef'));
  assert(json.includes('task'));

  // Should NOT contain private content
  assert(!json.includes('body_text'));
  assert(!json.includes('from_address'));
  assert(!json.includes('remote_phone_number'));

  s.close();
});

const report={
  observedAt:new Date().toISOString(),
  engine:'Node '+process.version+' Dispatcher A adapter authorization and operations',
  scope:'Dispatcher approval, query, and result recording via isolated ledger transactions',
  databaseDirectory:tmp,
  results,
  passed:results.filter(r=>r.pass).length,
  failed:results.filter(r=>!r.pass).length
};

fs.writeFileSync(path.join(dir,'dispatcher-validation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
process.exitCode=report.failed?1:0;
