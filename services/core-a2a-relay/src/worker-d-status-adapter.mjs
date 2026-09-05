// Server-owned capability: one read-only status tool on the existing Worker D pipe.
// No URL, tool, arguments, or code is accepted from an intake message.
export const LIVE_MODE = 'live-worker-d-status';
export function validateWorkerDStatus(result) {
  if (result?.isError || !Array.isArray(result?.content)) throw new Error('WORKER_D_RESULT_INVALID');
  const records = result.content.filter(x => x.type === 'text').flatMap(x => {
    try { return [JSON.parse(x.text)]; } catch { return []; }
  });
  const value = records.find(x => x?.status === 'READY_FOR_BOUNDED_TEST');
  if (!value || value.transport !== 'stdio' || value.network_listener !== false ||
      value.evidence_root_configured !== true || value.app_control?.enabled !== false ||
      value.app_control?.send_or_submit !== false || value.app_control?.credential_fields !== false ||
      !Array.isArray(value.read_tools) || !value.read_tools.includes('worker_d_pilot_status') ||
      !Array.isArray(value.disabled) || !['shell','screen_control','credentials','workflow_transition','deploy'].every(x => value.disabled.includes(x))) {
    throw new Error('WORKER_D_RESULT_INVALID');
  }
  return {status:value.status, transport:'stdio', network_listener:false, desktop_control:false,
    capability:'worker_d_pilot_status', evidence_root_configured:true};
}

export function createWorkerDStatusAdapter({storage, invoke, now = Date.now}) {
  if (!storage || typeof invoke !== 'function') throw new Error('WORKER_D_NOT_CONFIGURED');
  const identity='dispatcher-a', destination='worker-d', mode=LIVE_MODE;
  async function lookupReceipt(order) {
    const row = await storage.transaction(tx => tx.get('worker-d-receipt:' + order.key));
    if (!row || row.correlationId !== order.correlationId) return null;
    return row.state === 'completed' ? row.evidence : null;
  }
  return {verified:true, identity, destination, mode, lookupReceipt,
    async deliverTask(order) {
      if (!/^[a-f0-9]{64}$/.test(order.key ?? '') || !/^[A-Za-z0-9_.:-]{1,128}$/.test(order.correlationId ?? '') ||
          order.kind !== 'diagnostic' || order.dispatcher !== identity || order.destination !== destination ||
          order.mode !== mode || !Number.isSafeInteger(order.deadline) || order.deadline <= now()) {
        throw new Error('WORKER_D_ORDER_INVALID');
      }
      const claim = await storage.transaction(async tx => {
        const key = 'worker-d-receipt:' + order.key;
        const old = await tx.get(key);
        if (old) {
          if (old.correlationId !== order.correlationId) throw new Error('WORKER_D_RECEIPT_CONFLICT');
          if (old.state !== 'completed') throw new Error('WORKER_D_OUTCOME_UNKNOWN');
          return {existing:old.evidence};
        }
        await tx.put(key, {state:'sending', correlationId:order.correlationId, startedAt:now()});
        return {existing:null};
      });
      if (claim.existing) return claim.existing;
      // Persist before invoking. Any ambiguous failure remains non-retryable.
      const response = await invoke({version:1, request_id:order.correlationId,
        tool:'worker_d_pilot_status', arguments:{}, deadline:Math.min(order.deadline,now()+20000)});
      if (now() >= order.deadline) throw new Error('WORKER_D_DEADLINE_EXPIRED');
      const observation = validateWorkerDStatus(response);
      const evidence = {...order, accepted:true, worker:destination, observation,
        artifactRef:'worker-d-status:' + order.key, observedAt:now()};
      await storage.transaction(tx => tx.put('worker-d-receipt:' + order.key,
        {state:'completed',correlationId:order.correlationId,evidence}));
      return evidence;
    }
  };
}

export function createBoundWorkerDStatusAdapter(storage, pipe, now = Date.now) {
  return createWorkerDStatusAdapter({storage, now, invoke:async message => {
    const response = await pipe.fetch(new Request('https://pipe/invoke', {
      method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(message)
    }));
    if (!response.ok) throw new Error('WORKER_D_UNAVAILABLE');
    return response.json();
  }});
}
