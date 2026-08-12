import { VERDICT, result } from '../../shared/verdict.js';
import { runLocalChecks } from '../../shared/local.js';
import { splitEmail } from '../../shared/syntax.js';
import { checkMx, ttlFor } from './mx.js';

/**
 * The server pipeline. Same offline checks as the browser, plus the full
 * disposable list and the DNS layer, plus caching.
 *
 * Ordering principle: cheapest and most conclusive first. A syntax failure
 * costs microseconds and ends the request, so it must never sit behind a DNS
 * lookup that costs 40ms. Every stage is a guard clause that can end the run.
 */

/**
 * In-flight request coalescing ("singleflight").
 *
 * Ten people signing up with @gmail.com in the same 40ms window is one DNS
 * question, not ten. Without this, a cold cache under load turns into a DNS
 * stampede against a single domain -- the classic cache-miss thundering herd.
 * Keyed by domain because that is the granularity DNS actually works at.
 */
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
    // Re-check the cache inside the flight: a request that queued behind
    // another one may find the answer already written by the time it runs.
    const fresh = await store.getCached(domain);
    if (fresh) return { ...fresh, cached: true };

    const mx = await resolveMx(domain);
    // Never cache UNKNOWN. It is a statement about our own failure, not about
    // the domain, and caching it would keep serving a transient outage.
    if (mx.verdict !== VERDICT.UNKNOWN) {
      await store.setCached(domain, mx, ttlFor(mx));
    }
    return { ...mx, cached: false };
  });
}

/**
 * `resolveMx` is injected rather than imported so the DNS layer can be swapped
 * without touching this file: a fake in tests, a DNS-over-HTTPS client at the
 * edge, or a paid SMTP-probe provider later. It is the only part of the
 * pipeline that talks to the outside world, so it is the part worth isolating.
 */
export async function validateEmail(raw, store, { resolveMx = checkMx } = {}) {
  const startedAt = performance.now();
  const checks = {};

  // Stage 1: offline. Identical code to the widget.
  const local = runLocalChecks(raw);
  Object.assign(checks, local.checks);

  if (local.verdict === VERDICT.INVALID) {
    return respond(raw, local, checks, startedAt, { suggestion: local.suggestion });
  }

  const { domain } = splitEmail(raw);

  // Stage 2: the full disposable list, which only the server has.
  // The widget already cleared the top ~150; this catches the long tail.
  if (checks.disposable === 'pass' && (await store.isDisposable(domain))) {
    checks.disposable = 'fail';
    return respond(
      raw,
      result(VERDICT.RISKY, 'disposable', 'This looks like a temporary inbox.'),
      checks,
      startedAt,
    );
  }

  // Stage 3: DNS. The only stage that can be slow, so it runs last and only
  // for addresses that survived everything cheaper.
  const mx = await resolveDomain(domain, store, resolveMx);
  checks.mx = mx.verdict === VERDICT.VALID ? 'pass' : mx.verdict === VERDICT.UNKNOWN ? 'skip' : 'fail';

  // A domain-level negative outranks a local positive. A local RISKY (role
  // account) survives a domain-level positive -- both facts are true and the
  // stricter one is the one worth reporting.
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

/** One response shape for every path through the pipeline. */
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