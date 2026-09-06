import {parseIntake,equal,boundedBody,clock} from './intake.mjs';
import {Ledger,WORKFLOW} from './ledger.mjs';
import policy from '../policy-source.cjs';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function handle(request,ledger,config,now=Date.now()){
 try{
  const url=new URL(request.url),channel=url.pathname==='/intake/email'?'email':url.pathname==='/intake/sms'?'sms':null;
  if(channel){if(request.method!=='POST')return json({error:'METHOD'},405);const e=await parseIntake(request,channel,config[channel],now);const reference=await ledger.intake(e,now);return json({reference,committed:true},202)}
  if(!config.consumerToken||!equal(request.headers.get('authorization'),`Bearer ${config.consumerToken}`))return json({error:'UNAUTHORIZED'},401);
  if(request.method!=='POST')return json({error:'METHOD'},405);
  const b=JSON.parse(await boundedBody(request,16384));if(b.workflow!==WORKFLOW)return json({error:'WRONG_WORKFLOW'},403);
  const key=b.reference?.receiptRef;const found=await ledger.lookup(key);
  if(!b.reference||Object.keys(found.reference).some(k=>found.reference[k]!==b.reference[k]))return json({error:'REFERENCE_MISMATCH'},409);
  if(url.pathname==='/consumer/lookup')return json({...found});
  if(url.pathname==='/consumer/accept')return json({reference:found.reference,acceptance:await ledger.accept(found.reference,b.workflow,now)});
  if(url.pathname==='/consumer/claim')return json({reference:found.reference,claim:await ledger.claim(key,'routing',now)});
  if(url.pathname==='/consumer/route'){
   if(!b.claim)return json({reference:found.reference,task:found.task});
   return json({reference:found.reference,task:await ledger.route(key,b.claim.generation,now,policy,(config.workerDAdapter??config.syntheticAdapter))});
  }
  if(url.pathname==='/consumer/result')return json({reference:found.reference,task:found.task,durable:true});
  return json({error:'NOT_FOUND'},404);
 }catch(e){const code=e.message;const known=['UNSUPPORTED_MEDIA','INVALID_CLOCK','AUTH_NOT_CONFIGURED','BAD_BEARER','BAD_SIGNATURE_OR_TIMESTAMP','BAD_SIGNATURE','INVALID_JSON','WRONG_EVENT','INVALID_MESSAGE','WRONG_RESOURCE_OR_SCHEMA','BODY_TOO_LARGE','INVALID_UTF8','INVALID_NORMALIZED_EVENT','IDEMPOTENCY_CONFLICT','RECEIPT_MISMATCH','INVALID_KEY','RECEIPT_NOT_FOUND','STALE_LEASE','WRONG_WORKFLOW'];return json({error:known.includes(code)?code:'STORAGE_OR_ADAPTER_UNAVAILABLE'},known.includes(code)?400:503)}
}
// Alarm work remains bounded. Only notify a configured n8n endpoint; a HTTP 2xx alone is never accepted as delivery evidence.
export async function recoverAndNotify(ledger,config,now=Date.now(),fetcher=fetch){
 const readClock=()=>clock((config.clock??Date.now)());
 const due=await ledger.recover(clock(now));
 for(const d of due.slice(0,20)){
  const lease=await ledger.claim(d.key,d.lane,readClock());if(!lease)continue;
  if(d.lane==='routing'){await ledger.route(d.key,lease.generation,readClock(),policy,(config.workerDAdapter??config.syntheticAdapter));continue}
  if(!config.notifyUrl||!config.notifyToken){await ledger.settleOutbox(d.key,lease.generation,'permanent',readClock());continue}
  const ref=(await ledger.lookup(d.key)).reference;let result='unknown',retryDelay=0;
  try{const r=await fetcher(config.notifyUrl,{method:'POST',headers:{authorization:`Bearer ${config.notifyToken}`,'content-type':'application/json'},body:JSON.stringify(ref),redirect:'manual',signal:AbortSignal.timeout(10000)});result=r.status===401||r.status===403||r.status===400?'permanent':'absent';const retry=r.headers.get('retry-after');if(retry){retryDelay=Number(retry)*1000;if(!/^\d+$/.test(retry)||!Number.isFinite(retryDelay)||retryDelay>120000){result='permanent';retryDelay=0}}if(r.status>=300&&r.status<500&&![408,429].includes(r.status))result='permanent';}catch{result='unknown'}
  // Shared authoritative ledger is the query: existence proves acceptance even when notification ACK was lost.
  if((await ledger.lookup(d.key)).acceptance)result='absent';
  await ledger.settleOutbox(d.key,lease.generation,result,readClock(),retryDelay);
 }
 return due;
}
