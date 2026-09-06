function hold(reason){return {state:'held',reason};}
function finite(x){return typeof x==='number'&&Number.isFinite(x)&&x>=0;}
function validateEnvelope(body){
 if(!body||typeof body!=='object'||Array.isArray(body))return 'INVALID_ENVELOPE';
 for(const field of ['identityRef','eventId','receiptRef','correlationId'])if(typeof body[field]!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(body[field]))return 'INVALID_'+field.toUpperCase();
 if(!/^[a-f0-9]{64}$/.test(body.receiptRef)||!['email','sms'].includes(body.channel))return 'INVALID_RECEIPT_OR_CHANNEL';
 return body.contract==='core.intake-reference.v1'?null:'INTERNAL_CONTRACT_REQUIRED';
}
function deliveryDecision(x){
 if(!x||!['now','startedAt','deadline'].every(k=>finite(x[k]))||x.now<x.startedAt||x.deadline<=x.startedAt||x.now>=x.deadline)return hold('INVALID_CLOCK_OR_DEADLINE');
 if(!Number.isInteger(x.attempts)||x.attempts<0||x.attempts>=3)return hold('ATTEMPTS_EXHAUSTED_OR_INVALID');
 if(!finite(x.retryAfterMs)||x.retryAfterMs>120000)return hold('INVALID_RETRY_DELAY');
 if(!['identityVerified','authorized','transportVerified','durableIdempotency'].every(k=>x[k]===true))return hold('ROUTE_PREREQUISITE_MISSING');
 if(typeof x.unknownOutcome!=='boolean')return hold('INVALID_OUTCOME_FLAG');
 if(x.unknownOutcome)return hold('QUERY_EXISTING_RECEIPT_BEFORE_RETRY');
 if(!['none','transient','timeout','auth','schema','identity','permanent'].includes(x.error))return hold('INVALID_ERROR_CLASS');
 if(['auth','schema','identity','permanent'].includes(x.error))return hold('PERMANENT_DELIVERY_REJECTION');
 const delay=Math.max([0,5000,20000][x.attempts],x.retryAfterMs);
 if(x.now+delay>=Math.min(x.deadline,x.startedAt+120000))return hold('DELIVERY_WINDOW_EXHAUSTED');
 return {state:'eligible_for_verified_adapter',delayMs:delay,nextAttempt:x.attempts+1};
}
function approvalDecision(x){
 if(!x||!['feature','fix','diagnostic'].includes(x.kind)||!['approved','rejected','revise','pending'].includes(x.visualApproval)||typeof x.dispatcherOrder!=='boolean')return hold('INVALID_APPROVAL');
 if(x.kind==='feature'&&x.visualApproval!=='approved')return {state:x.visualApproval==='rejected'?'cancelled':'held',reason:x.visualApproval==='revise'?'REVISE_PROPOSAL':'VISUAL_APPROVAL_REQUIRED'};
 return x.dispatcherOrder===true?{state:'eligible_for_route_check'}:hold('DISPATCHER_ORDER_REQUIRED');
}
function reviewDecision(x){
 if(!x||typeof x.reviewer!=='string'||!x.reviewer||!Array.isArray(x.contributors)||!x.contributors.every(c=>typeof c==='string')||!['pass','fail','pending'].includes(x.verdict)||typeof x.releaseRequired!=='boolean'||typeof x.releaseAuthorized!=='boolean')return 'INVALID_REVIEW';
 if(x.contributors.includes(x.reviewer))return 'INDEPENDENT_REVIEW_REQUIRED';
 if(x.verdict!=='pass')return 'REVIEW_FAILED_OR_PENDING';
 return x.releaseRequired&&!x.releaseAuthorized?'RELEASE_HELD':'ACCEPTED_WITHIN_SCOPE';
}
module.exports={validateEnvelope,deliveryDecision,approvalDecision,reviewDecision,finite};
