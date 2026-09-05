import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}));
const {build}=require(require.resolve('esbuild',{paths:[require.resolve('wrangler')]}));

for (const [name,status,accepted,expected] of [
  ['accepted notification',200,true,'absent'],
  ['redirect is rejected without forwarding credentials',302,false,'permanent'],
  ['successful HTTP without durable acceptance is not delivery proof',200,false,'absent']
]) test(name,async()=>{
  const bundle=await build({stdin:{contents:`
    import {recoverAndNotify} from './src/intake-candidate/adapter.mjs';
    export default {async fetch(){
      let settled=null,lookups=0;
      const ledger={recover:async()=>[{key:'test',lane:'outbox'}],claim:async()=>({generation:1}),
        lookup:async()=>({reference:{contract:'test'},acceptance:++lookups>1&&${accepted}?{}:null}),
        settleOutbox:async(key,generation,result)=>{settled=result;}};
      await recoverAndNotify(ledger,{notifyUrl:'https://notify.test/event',notifyToken:'fixture-only'},Date.now());
      return Response.json({settled});
    }};`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser'});
  let requests=0;
  const mf=new Miniflare({modules:true,compatibilityDate:'2025-09-17',script:bundle.outputFiles[0].text,
    outboundService:async request=>{
      requests++;assert.equal(request.url,'https://notify.test/event');
      assert.equal(request.headers.get('authorization'),'Bearer fixture-only');
      return new Response('',{status,headers:status===302?{location:'https://other.test/'}:{}});
    }});
  try {
    const actual=await (await mf.dispatchFetch('http://test.local')).json();
    assert.equal(requests,1);assert.equal(actual.settled,expected);
  } finally {await mf.dispose();}
});
