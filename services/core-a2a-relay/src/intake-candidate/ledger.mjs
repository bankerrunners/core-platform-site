import {clock,id,fail} from './intake.mjs';
import {LIVE_MODE} from '../worker-d-status-adapter.mjs';
export const WORKFLOW='core-worker-dispatch-r4';
export class Ledger {
 constructor(storage,config={}){this.s=storage;this.now=config.clock??Date.now;this.retention=config.retentionMs??86400000;this.tombstone=config.tombstoneMs??2592000000;if(!Number.isSafeInteger(this.retention)||this.retention<60000||!Number.isSafeInteger(this.tombstone)||this.tombstone<this.retention)fail('INVALID_RETENTION');}
 async intake(e,now){clock(now);if(!e||!/^[a-f0-9]{64}$/.test(e.key)||!/^[a-f0-9]{64}$/.test(e.digest)||!['email','sms'].includes(e.channel)||!id(e.identityRef)||!id(e.eventId))fail('INVALID_NORMALIZED_EVENT');return this.s.transaction(async tx=>{
  const old=await tx.get('receipt:'+e.key);if(old){if(old.digest!==e.digest)fail('IDEMPOTENCY_CONFLICT');return this.reference(old)}
  const receipt={...e,privateContent:undefined,correlationId:crypto.randomUUID(),createdAt:now,contentExpires:now+this.retention,tombstoneExpires:now+this.tombstone};
  await tx.put('intake-owned',true);await tx.put('receipt:'+e.key,receipt);await tx.put('content:'+e.key,e.privateContent);
  await tx.put('task:'+e.key,{key:e.key,correlationId:receipt.correlationId,channel:e.channel,state:'held',reason:'DISPATCHER_ORDER_REQUIRED',owner:'Dispatcher A',resumeCondition:'Approved scope, deadline, budget decision and verified exact ingress',createdAt:now,updatedAt:now});
  await tx.put('outbox:'+e.key,{key:e.key,state:'pending',attempts:0,nextDue:now,deadline:now+120000,generation:0,leaseUntil:0});
  await tx.setAlarm(now);return this.reference(receipt);
 });}
 reference(r){return {contract:'core.intake-reference.v1',identityRef:r.identityRef,eventId:r.eventId,receiptRef:r.key,correlationId:r.correlationId,channel:r.channel};}
 async lookup(key){if(!/^[a-f0-9]{64}$/.test(key||''))fail('INVALID_KEY');return this.s.transaction(async tx=>{const r=await tx.get('receipt:'+key);if(!r)fail('RECEIPT_NOT_FOUND');return {reference:this.reference(r),acceptance:await tx.get('accept:'+key)??null,task:await tx.get('task:'+key)};});}
 async accept(ref,workflow,now){clock(now);if(workflow!==WORKFLOW)fail('WRONG_WORKFLOW');return this.s.transaction(async tx=>{const r=await tx.get('receipt:'+ref.receiptRef);if(!r||r.identityRef!==ref.identityRef||r.eventId!==ref.eventId||r.correlationId!==ref.correlationId||r.channel!==ref.channel||ref.contract!=='core.intake-reference.v1')fail('RECEIPT_MISMATCH');let a=await tx.get('accept:'+r.key);if(!a){a={key:r.key,correlationId:r.correlationId,workflow,acceptedAt:now};await tx.put('accept:'+r.key,a);await tx.put('routing:'+r.key,{key:r.key,state:'pending',generation:0,leaseUntil:0,createdAt:now});await tx.setAlarm(now)}return a;});}
 async claim(key,lane,now){clock(now);if(!['routing','outbox'].includes(lane))fail('INVALID_LANE');return this.s.transaction(async tx=>{const r=await tx.get(lane+':'+key);if(!r||['delivered','held','completed','failed'].includes(r.state))return null;if(r.leaseUntil>now)return null;if(lane==='outbox'&&r.nextDue>now)return null;
  if(lane==='routing'&&r.state==='sending'){r.state='held';r.reason='UNKNOWN_DELIVERY_QUERY_REQUIRED';await tx.put(lane+':'+key,r);const t=await tx.get('task:'+key);await tx.put('task:'+key,{...t,state:'held',reason:r.reason,updatedAt:now});return null}
  if(lane==='outbox'){if(r.attempts>=3||now>=r.deadline){r.state='held';r.reason='ATTEMPTS_EXHAUSTED';await tx.put(lane+':'+key,r);return null}r.attempts++;}
  r.generation++;r.leaseUntil=now+30000;r.state='leased';await tx.put(lane+':'+key,r);await tx.setAlarm(now+30000);return r;});}
 async settleOutbox(key,generation,result,now,retryDelay=0){clock(now);if(!Number.isFinite(retryDelay)||retryDelay<0||retryDelay>120000)fail('INVALID_RETRY_DELAY');return this.s.transaction(async tx=>{const o=await tx.get('outbox:'+key);if(!o||o.generation!==generation||o.state!=='leased'||o.leaseUntil<=now)fail('STALE_LEASE');const a=await tx.get('accept:'+key);if(a){o.state='delivered';o.deliveredAt=now}else{
   if(!['absent','unknown','permanent'].includes(result))fail('INVALID_NOTIFY_RESULT');const delay=Math.max(o.attempts===1?5000:20000,retryDelay);
   if(result!=='absent'||o.attempts>=3||now+delay>=o.deadline){o.state='held';o.reason=result==='unknown'?'UNKNOWN_NOTIFY_OUTCOME':'DELIVERY_EXHAUSTED_OR_REJECTED';const t=await tx.get('task:'+key);await tx.put('task:'+key,{...t,state:'held',reason:o.reason,updatedAt:now})}else{o.state='pending';o.nextDue=now+delay;await tx.setAlarm(o.nextDue)}
  }o.leaseUntil=0;await tx.put('outbox:'+key,o);return o;});}
 async route(key,generation,now,policy,adapter){clock(now);
  const order=await this.s.transaction(async tx=>{const r=await tx.get('routing:'+key),t=await tx.get('task:'+key);if(!r||r.generation!==generation||r.state!=='leased'||r.leaseUntil<=now)fail('STALE_LEASE');const approval=await tx.get('approval:'+key);let reason='DISPATCHER_ORDER_REQUIRED';
   if(approval){const d=policy.approvalDecision(approval);reason=d.state==='eligible_for_route_check'?null:d.reason;
    if(!reason&&(!Number.isSafeInteger(approval.deadline)||approval.deadline<=now))reason='TASK_DEADLINE_REQUIRED';
    if(!reason&&approval.budgetApproved!==true)reason='BUDGET_DECISION_REQUIRED';
   }
   if(!reason&&(!adapter||adapter.verified!==true||!['synthetic-local-test',LIVE_MODE].includes(adapter.mode)||!id(adapter.identity)||!id(adapter.destination)))reason='EXACT_DISPATCHER_ROUTE_UNAVAILABLE';
   if(!reason&&adapter.mode===LIVE_MODE&&(approval.kind!=='diagnostic'||adapter.identity!=='dispatcher-a'||adapter.destination!=='worker-d'))reason='WORKER_D_DIAGNOSTIC_ONLY';
   if(reason){r.state='held';r.reason=reason;t.state='held';t.reason=reason;t.updatedAt=now;await tx.put('routing:'+key,r);await tx.put('task:'+key,t);return null}
   r.state='sending';delete r.reason;await tx.put('routing:'+key,r);return {kind:approval.kind,key,correlationId:t.correlationId,dispatcher:adapter.identity,destination:adapter.destination,mode:adapter.mode,deadline:approval.deadline};
  });
  if(!order)return (await this.lookup(key)).task;
  // Outside transaction. Live status adapter persists a separate receipt before the bounded call.
  let evidence;try{evidence=await adapter.deliverTask(order)}catch{try{evidence=await adapter.lookupReceipt(order)}catch{evidence=null}}
  const settledAt=clock(this.now());
  return this.s.transaction(async tx=>{const r=await tx.get('routing:'+key),t=await tx.get('task:'+key);if(!r||r.generation!==generation||r.state!=='sending'||r.leaseUntil<=settledAt)fail('STALE_LEASE');
   if(!evidence||evidence.key!==key||evidence.correlationId!==order.correlationId||evidence.dispatcher!==order.dispatcher||evidence.destination!==order.destination||evidence.accepted!==true||evidence.mode!==order.mode||!id(evidence.worker)){r.state='held';t.state='held';t.reason='UNKNOWN_DISPATCH_OUTCOME'}else{r.state='completed';t.state='accepted';t.reason=null;t.dispatchEvidence=evidence;t.executionMode=order.mode}t.updatedAt=settledAt;await tx.put('routing:'+key,r);await tx.put('task:'+key,t);return t;
  });
 }
 // Called by the authenticated Dispatcher endpoint or isolated tests.
 async setApproval(key,approval){const now=clock(this.now());return this.s.transaction(async tx=>{
 const t=await tx.get('task:'+key);if(!t)fail('TASK_NOT_FOUND');
 const r=await tx.get('routing:'+key);
 if(t.state!=='held'||r&&['sending','completed'].includes(r.state))fail('APPROVAL_STATE_CONFLICT');
 if([r?.reason,t.reason].some(reason=>['UNKNOWN_DELIVERY_QUERY_REQUIRED','UNKNOWN_DISPATCH_OUTCOME'].includes(reason)))fail('DELIVERY_RECONCILIATION_REQUIRED');
 await tx.put('approval:'+key,approval);
 if(r&&['held','pending','leased'].includes(r.state)){
  r.generation++;r.state='pending';r.leaseUntil=0;delete r.reason;
  await tx.put('routing:'+key,r);await tx.setAlarm(now);
 }
 await tx.put('task:'+key,{...t,reason:'APPROVAL_RECHECK_PENDING',updatedAt:now});
 });}
 async reconcile(key,e,now){clock(now);return this.s.transaction(async tx=>{const t=await tx.get('task:'+key);if(!t||t.state!=='accepted'||e.correlationId!==t.correlationId||e.mode!==t.executionMode||e.worker!==t.dispatchEvidence.worker||!id(e.worker)||!id(e.reviewer)||!id(e.artifactRef)||!Array.isArray(e.contributors)||!e.contributors.every(id)||!e.contributors.includes(e.worker)||e.contributors.includes(e.reviewer)||!['completed','failed','timed_out'].includes(e.status))fail('RESULT_MISMATCH');if(t.executionMode===LIVE_MODE&&(e.artifactRef!==t.dispatchEvidence.artifactRef||t.dispatchEvidence.observation?.status!=='READY_FOR_BOUNDED_TEST'))fail('RESULT_MISMATCH');t.state=e.status==='completed'?'completed':'failed';t.result=e;t.updatedAt=now;await tx.put('task:'+key,t);return t;});}
 async recover(now){clock(now);return this.s.transaction(async tx=>{const due=[];for(const [k,r]of await tx.list({prefix:'outbox:'})){if(r.state==='delivered'||r.state==='held')continue;const a=await tx.get('accept:'+r.key);if(a){r.state='delivered';r.leaseUntil=0;await tx.put(k,r)}else if(r.deadline<=now){r.state='held';r.reason='DELIVERY_WINDOW_EXPIRED';await tx.put(k,r);const t=await tx.get('task:'+r.key);await tx.put('task:'+r.key,{...t,state:'held',reason:r.reason,updatedAt:now})}else if(r.leaseUntil<=now&&r.nextDue<=now)due.push({lane:'outbox',key:r.key});}
  for(const [k,r]of await tx.list({prefix:'routing:'})){if(r.state==='sending'&&r.leaseUntil<=now){r.state='held';r.reason='UNKNOWN_DELIVERY_QUERY_REQUIRED';await tx.put(k,r);const t=await tx.get('task:'+r.key);await tx.put('task:'+r.key,{...t,state:'held',reason:r.reason,updatedAt:now})}else if(['pending','leased'].includes(r.state)&&r.leaseUntil<=now)due.push({lane:'routing',key:r.key});}
  for(const [k,r]of await tx.list({prefix:'receipt:'})){if(r.contentExpires<=now)await tx.delete('content:'+r.key);if(r.tombstoneExpires<=now){const t=await tx.get('task:'+r.key);if(['completed','failed','held'].includes(t?.state)){for(const prefix of ['receipt:','task:','outbox:','routing:','accept:','approval:','content:'])await tx.delete(prefix+r.key)}}}
  const receipts=await tx.list({prefix:'receipt:'});if(receipts.size){const expiry=Math.min(...[...receipts.values()].map(r=>r.contentExpires>now?r.contentExpires:r.tombstoneExpires>now?r.tombstoneExpires:now+86400000));const pending=[...(await tx.list({prefix:'outbox:'})).values(),...(await tx.list({prefix:'routing:'})).values()].filter(r=>['pending','leased','sending'].includes(r.state));await tx.setAlarm(pending.length?Math.min(now+30000,expiry):expiry)}else await tx.deleteAlarm();return due;});}
 async projection(){return this.s.transaction(async tx=>[...(await tx.list({prefix:'task:'})).values()].map(t=>({key:t.key,correlationId:t.correlationId,channel:t.channel,assignmentState:t.state,reason:t.reason,owner:t.owner,updatedAt:t.updatedAt,evidence:t.result?.artifactRef??null,executionMode:t.executionMode??'not-executed'})));}
}
