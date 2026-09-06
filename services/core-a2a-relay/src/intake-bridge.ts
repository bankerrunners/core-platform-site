// Candidate-only prefix; preserve existing production Inkbox receiver unchanged.
import { Ledger } from './intake-candidate/ledger.mjs';
import { handle, recoverAndNotify } from './intake-candidate/adapter.mjs';
import { createBoundWorkerDStatusAdapter } from './worker-d-status-adapter.mjs';
type IntakeEnv = {INTAKE_CANDIDATE_CONFIG?: string; WORKER_D_STATUS_ENABLED?: string; MCP_PIPE?: DurableObjectNamespace};
function configuration(env: IntakeEnv, storage: DurableObjectStorage) {
  // Future server-secret JSON reference; never configure through the n8n body.
  const config = JSON.parse(env.INTAKE_CANDIDATE_CONFIG || '{}');
  delete config.syntheticAdapter; delete config.workerDAdapter; delete config.clock;
  if(env.WORKER_D_STATUS_ENABLED==='true' && env.MCP_PIPE) config.workerDAdapter=createBoundWorkerDStatusAdapter(storage,env.MCP_PIPE.get(env.MCP_PIPE.idFromName('worker-d')));
  return config;
}
export async function intakeFetch(request: Request, storage: DurableObjectStorage, env: IntakeEnv) {
  const config=configuration(env,storage);
  const url=new URL(request.url);url.pathname=url.pathname.slice('/candidate-intake'.length);
  const response=await handle(new Request(url,request),new Ledger(storage,config),config);
  return response;
}
export async function intakeAlarm(storage: DurableObjectStorage,env: IntakeEnv) {
 const config=configuration(env,storage);await recoverAndNotify(new Ledger(storage,config),config);
}
