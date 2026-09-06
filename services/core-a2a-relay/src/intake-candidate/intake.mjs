const enc=new TextEncoder();
export const fail=(code)=>{throw new Error(code)};
export const clock=(n)=>{if(typeof n!=='number'||!Number.isSafeInteger(n)||n<0)fail('INVALID_CLOCK');return n;};
export const id=(s)=>typeof s==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(s);
export async function hash(s){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s))),x=>x.toString(16).padStart(2,'0')).join('');}
export function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
export async function signature(key,requestId,timestamp,raw){const k=await crypto.subtle.importKey('raw',enc.encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);return 'sha256='+Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',k,enc.encode(requestId+'.'+timestamp+'.'+raw))),x=>x.toString(16).padStart(2,'0')).join('');}
export async function boundedBody(request,max=262144){let size=0;const chunks=[];if(!request.body)fail('EMPTY_BODY');const reader=request.body.getReader();while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();fail('BODY_TOO_LARGE')}chunks.push(value)}const bytes=new Uint8Array(size);let o=0;for(const c of chunks){bytes.set(c,o);o+=c.length}try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{fail('INVALID_UTF8')}}
// Signing identity comes only from server configuration for this channel/resource.
export async function parseIntake(request,channel,config,now){
 clock(now);if(!['email','sms'].includes(channel)||!config||!id(config.identityRef)||typeof config.signingKey!=='string'||!config.signingKey||typeof config.resource!=='string'||!config.resource)fail('AUTH_NOT_CONFIGURED');
 if(config.bearer!==undefined&&(!config.bearer||!equal(request.headers.get('authorization'),`Bearer ${config.bearer}`)))fail('BAD_BEARER');
 const rid=request.headers.get('x-inkbox-request-id'),ts=request.headers.get('x-inkbox-timestamp'),sig=request.headers.get('x-inkbox-signature');
 if(!id(rid)||!/^\d{1,12}$/.test(ts||'')||Math.abs(now/1000-Number(ts))>300||!/^sha256=[a-f0-9]{64}$/.test(sig||''))fail('BAD_SIGNATURE_OR_TIMESTAMP');
 const raw=await boundedBody(request);if(!equal(sig,await signature(config.signingKey,rid,ts,raw)))fail('BAD_SIGNATURE');
 let body;try{body=JSON.parse(raw)}catch{fail('INVALID_JSON')}
 const eventType=channel==='email'?'message.received':'text.received';if(!body||body.event_type!==eventType)fail('WRONG_EVENT');
 const m=body.data?.[channel==='email'?'message':'text_message'];if(!m||!id(m.id)||m.direction!=='inbound')fail('INVALID_MESSAGE');
 // Text-only candidate: reject media before any receipt is committed. No partial-message ACK.
 const carriesMedia=['media','media_urls','attachments','attachment_metadata'].some(k=>m[k]!=null&&(!Array.isArray(m[k])||m[k].length>0));
 if(carriesMedia||m.type==='mms'||(channel==='email'&&m.has_attachments!==false))fail('UNSUPPORTED_MEDIA');
 let stable;
 if(channel==='email'){
  if(m.mailbox_id!==config.resource||typeof m.from_address!=='string'||!Array.isArray(m.to_addresses)||!m.to_addresses.every(x=>typeof x==='string')||(m.cc_addresses!=null&&(!Array.isArray(m.cc_addresses)||!m.cc_addresses.every(x=>typeof x==='string')))||!['subject','body_text','body_html','created_at'].every(k=>m[k]==null||typeof m[k]==='string'))fail('WRONG_RESOURCE_OR_SCHEMA');
  stable={id:m.id,mailbox_id:m.mailbox_id,from_address:m.from_address,to_addresses:[...m.to_addresses].sort(),cc_addresses:m.cc_addresses?[...m.cc_addresses].sort():null,subject:m.subject??null,body_text:m.body_text??null,body_html:m.body_html??null,created_at:m.created_at??null};
 }else{
  if(m.local_phone_number!==config.resource||!['sms','mms'].includes(m.type)||typeof m.remote_phone_number!=='string'||!(m.text===null||typeof m.text==='string'))fail('WRONG_RESOURCE_OR_SCHEMA');
  stable={id:m.id,local_phone_number:m.local_phone_number,remote_phone_number:m.remote_phone_number,text:m.text,type:m.type,created_at:m.created_at??null};
 }
 // Additive context, peer matches, read/status flags and delivery timestamps are not immutable business content.
 const key=await hash(JSON.stringify([config.identityRef,channel,eventType,m.id]));
 return {schema_version:1,key,channel,eventType,identityRef:config.identityRef,eventId:m.id,digest:await hash(JSON.stringify(stable)),privateContent:stable};
}
