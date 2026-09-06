// Dispatcher A adapter — authorization required for all endpoints
// Approval, task query, and result reconciliation
import {equal,clock,boundedBody} from './intake-candidate/intake.mjs';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});

// Strict bearer auth for Dispatcher A operations
function requireDispatcherAuth(request, dispatcherToken) {
  if (!dispatcherToken || !equal(request.headers.get('authorization'), `Bearer ${dispatcherToken}`)) {
    throw new Error('DISPATCHER_UNAUTHORIZED');
  }
}

/**
 * POST /dispatcher/approval
 * Set approval decision for a task.
 * Body: { receiptRef: string, kind: 'feature'|'fix'|'diagnostic',
 *         visualApproval: 'approved'|'rejected'|'revise'|'pending',
 *         dispatcherOrder: boolean, deadline?: number, budgetApproved?: boolean }
 */
export async function setApproval(request, ledger, dispatcherToken, now=Date.now()) {
  requireDispatcherAuth(request, dispatcherToken);
  if (request.method !== 'POST') return json({error:'METHOD'},405);

  const body = JSON.parse(await boundedBody(request, 4096));
  const key = body.receiptRef;
  if (!/^[a-f0-9]{64}$/.test(key)) return json({error:'INVALID_RECEIPT_REF'},400);

  // Validate approval fields
  if (!['feature','fix','diagnostic'].includes(body.kind)) return json({error:'INVALID_KIND'},400);
  if (!['approved','rejected','revise','pending'].includes(body.visualApproval)) return json({error:'INVALID_VISUAL_APPROVAL'},400);
  if (typeof body.dispatcherOrder !== 'boolean') return json({error:'INVALID_DISPATCHER_ORDER'},400);

  const approval = {
    kind: body.kind,
    visualApproval: body.visualApproval,
    dispatcherOrder: body.dispatcherOrder,
    deadline: typeof body.deadline === 'number' ? body.deadline : undefined,
    budgetApproved: typeof body.budgetApproved === 'boolean' ? body.budgetApproved : false,
    approvedAt: clock(now),
    dispatcherIdentity: 'Dispatcher A'
  };

  try {
    await ledger.setApproval(key, approval);
    return json({reference:key, accepted:true}, 200);
  } catch (e) {
    const code = e.message;
    return json({error:code}, code === 'TASK_NOT_FOUND' ? 404 : 400);
  }
}

/**
 * GET/POST /dispatcher/query/:receiptRef
 * Query task state, acceptance, and routing status.
 */
export async function queryTask(request, ledger, dispatcherToken, now=Date.now()) {
  requireDispatcherAuth(request, dispatcherToken);
  if (request.method !== 'POST' && request.method !== 'GET') return json({error:'METHOD'},405);

  const path = new URL(request.url).pathname;
  const key = path.split('/').pop();
  if (!/^[a-f0-9]{64}$/.test(key)) return json({error:'INVALID_RECEIPT_REF'},400);

  try {
    const found = await ledger.lookup(key);
    // Dispatcher sees reference, acceptance, task state, but NOT private content
    return json({
      reference: found.reference,
      acceptance: found.acceptance ? {acceptedAt: found.acceptance.acceptedAt} : null,
      task: {
        key: found.task.key,
        state: found.task.state,
        reason: found.task.reason,
        owner: found.task.owner,
        deadline: found.task.state === 'accepted' ? undefined : null,
        updatedAt: found.task.updatedAt,
        dispatchEvidence: found.task.dispatchEvidence ? {
          worker: found.task.dispatchEvidence.worker,
          destination: found.task.dispatchEvidence.destination,
          mode: found.task.dispatchEvidence.mode
        } : null
      }
    }, 200);
  } catch (e) {
    const code = e.message;
    return json({error:code}, code === 'RECEIPT_NOT_FOUND' ? 404 : 400);
  }
}

/**
 * POST /dispatcher/result
 * Record worker result and reconciliation evidence.
 * Body: { receiptRef: string, correlationId: string,
 *         worker: string, reviewer: string, artifactRef: string,
 *         contributors: string[], status: 'completed'|'failed'|'timed_out' }
 */
export async function recordResult(request, ledger, dispatcherToken, now=Date.now()) {
  requireDispatcherAuth(request, dispatcherToken);
  if (request.method !== 'POST') return json({error:'METHOD'},405);

  const body = JSON.parse(await boundedBody(request, 8192));
  const key = body.receiptRef;
  if (!/^[a-f0-9]{64}$/.test(key)) return json({error:'INVALID_RECEIPT_REF'},400);

  // Validate result fields
  if (!body.correlationId || typeof body.correlationId !== 'string') return json({error:'INVALID_CORRELATION_ID'},400);
  if (!body.worker || typeof body.worker !== 'string') return json({error:'INVALID_WORKER'},400);
  if (!body.reviewer || typeof body.reviewer !== 'string') return json({error:'INVALID_REVIEWER'},400);
  if (!body.artifactRef || typeof body.artifactRef !== 'string') return json({error:'INVALID_ARTIFACT_REF'},400);
  if (!Array.isArray(body.contributors)) return json({error:'INVALID_CONTRIBUTORS'},400);
  if (!['completed','failed','timed_out'].includes(body.status)) return json({error:'INVALID_STATUS'},400);

  const evidence = {
    correlationId: body.correlationId,
    mode: body.mode ?? 'synthetic-local-test', // Must match recorded execution mode.
    worker: body.worker,
    reviewer: body.reviewer,
    artifactRef: body.artifactRef,
    contributors: body.contributors,
    status: body.status,
    recordedAt: clock(now)
  };

  try {
    const result = await ledger.reconcile(key, evidence, clock(now));
    return json({reference:key, task:result, recorded:true}, 200);
  } catch (e) {
    const code = e.message;
    const status = ['RESULT_MISMATCH','TASK_NOT_FOUND'].includes(code) ? 409 : 400;
    return json({error:code}, status);
  }
}

/**
 * Route dispatcher requests to appropriate handler
 */
export async function handleDispatcher(request, ledger, dispatcherToken, now=Date.now()) {
  try {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === '/dispatcher/approval') return await setApproval(request, ledger, dispatcherToken, now);
    if (pathname.startsWith('/dispatcher/query/') || pathname === '/dispatcher/query') return await queryTask(request, ledger, dispatcherToken, now);
    if (pathname === '/dispatcher/result') return await recordResult(request, ledger, dispatcherToken, now);

    return json({error:'NOT_FOUND'}, 404);
  } catch (e) {
    const code = e.message;
    const known = ['DISPATCHER_UNAUTHORIZED','EMPTY_BODY','BODY_TOO_LARGE','INVALID_UTF8','INVALID_JSON'];
    if (code === 'DISPATCHER_UNAUTHORIZED') return json({error:code}, 401);
    return json({error:known.includes(code)?code:'DISPATCHER_ERROR'}, known.includes(code)?400:500);
  }
}
