import { VERDICT, result } from '../../shared/verdict.js';
import { runLocalChecks } from '../../shared/local.js';
import { splitEmail } from '../../shared/syntax.js';
import { checkMx, ttlFor } from './mx.js';


const inFlight = new Map();

function singleflight(key, work) {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = work().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

async function resolveDomain(domain, store, resolveMx) {
  const cached = await store.getCached(domain);
  if (cached) return { ...cached, cached: true };

  return singleflight(domain, async () => {
   
    const fresh = await store.getCached(domain);
    if (fresh) return { ...fresh, cached: true };

    const mx = await resolveMx(domain);
   .
    if (mx.verdict !== VERDICT.UNKNOWN) {
      await store.setCached(domain, mx, ttlFor(mx));
    }
    return { ...mx, cached: false };
  });
}


export async function validateEmail(raw, store, { resolveMx = checkMx } = {}) {
  const startedAt = performance.now();
  const checks = {};


  const local = runLocalChecks(raw);
  Object.assign(checks, local.checks);

  if (local.verdict === VERDICT.INVALID) {
    return respond(raw, local, checks, startedAt, { suggestion: local.suggestion });
  }

  const { domain } = splitEmail(raw);

  if (checks.disposable === 'pass' && (await store.isDisposable(domain))) {
    checks.disposable = 'fail';
    return respond(
      raw,
      result(VERDICT.RISKY, 'disposable', 'This looks like a temporary inbox.'),
      checks,
      startedAt,
    );
  }

 
  const mx = await resolveDomain(domain, store, resolveMx);
  checks.mx = mx.verdict === VERDICT.VALID ? 'pass' : mx.verdict === VERDICT.UNKNOWN ? 'skip' : 'fail';

  if (mx.verdict === VERDICT.INVALID) {
    return respond(raw, mx, checks, startedAt, { mxCached: mx.cached, mxMs: mx.durationMs });
  }
  if (local.verdict === VERDICT.RISKY) {
    return respond(raw, local, checks, startedAt, { mxCached: mx.cached, mxMs: mx.durationMs });
  }
  if (mx.verdict !== VERDICT.VALID) {
    return respond(raw, mx, checks, startedAt, { mxCached: mx.cached, mxMs: mx.durationMs });
  }

  return respond(
    raw,
    result(VERDICT.VALID, 'deliverable', null, { free: local.free }),
    checks,
    startedAt,
    { mx: mx.mx, mxCached: mx.cached, mxMs: mx.durationMs },
  );
}


function respond(raw, verdictResult, checks, startedAt, extra = {}) {
  const clean = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined));
  return {
    email: String(raw ?? '').trim(),
    verdict: verdictResult.verdict,
    code: verdictResult.code,
    reason: verdictResult.reason ?? null,
    suggestion: verdictResult.suggestion ?? null,
    checks,
    ...clean,
    durationMs: Math.round(performance.now() - startedAt),
  };
}
