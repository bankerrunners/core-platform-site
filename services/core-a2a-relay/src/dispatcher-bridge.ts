// Dispatcher A integration for approval, query, and result recording
import { Ledger } from './intake-candidate/ledger.mjs';
import { handleDispatcher } from './dispatcher-adapter.mjs';

export async function dispatcherFetch(
  request: Request,
  storage: DurableObjectStorage,
  env: { DISPATCHER_TOKEN?: string; INTAKE_CANDIDATE_CONFIG?: string }
) {
  if (!env.DISPATCHER_TOKEN) {
    return new Response(JSON.stringify({error:'DISPATCHER_NOT_CONFIGURED'}),
      {status:503, headers:{'content-type':'application/json','cache-control':'no-store'}});
  }

  const config = JSON.parse(env.INTAKE_CANDIDATE_CONFIG || '{}');
  const ledger = new Ledger(storage, config);
  const url = new URL(request.url);


  return handleDispatcher(
    new Request(url, request),
    ledger,
    env.DISPATCHER_TOKEN
  );
}
