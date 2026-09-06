import assert from 'node:assert/strict';
import {handleDispatcher} from './src/dispatcher-adapter.mjs';
import {dispatcherFetch} from './src/dispatcher-bridge.ts';
let reads=0,writes=0;
const ledger={lookup:async()=>{reads++;return {reference:{receiptRef:'a'.repeat(64)},task:{state:'held'}}},setApproval:async()=>{writes++}};
for(const endpoint of ['approval','query/'+ 'a'.repeat(64),'result']) {
 const r=await handleDispatcher(new Request('https://test.invalid/dispatcher/'+endpoint,{method:'POST'}),ledger,'test');
 assert.equal(r.status,401);
}
assert.equal(reads+writes,0);
const storage={transaction:async fn=>fn({get:async key=>key.startsWith('receipt:')?{key:'a'.repeat(64),identityRef:'test',eventId:'event',correlationId:'correlation',channel:'email'}:key.startsWith('task:')?{state:'held'}:null})};
const r=await dispatcherFetch(new Request('https://test.invalid/dispatcher/query/'+'a'.repeat(64),{headers:{authorization:'Bearer test'}}),storage,{DISPATCHER_TOKEN:'test'});
assert.equal(r.status,200);
assert.equal((await r.json()).task.state,'held');
assert.equal((await handleDispatcher(new Request('https://test.invalid/dispatcher/approval-extra'),ledger,'test')).status,404);
console.log('PASS: three auth rejection paths, zero unauthorized storage operations, bridge route, exact endpoint matching');
