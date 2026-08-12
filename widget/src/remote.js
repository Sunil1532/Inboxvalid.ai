import { VERDICT } from '../../shared/verdict.js';
import { splitEmail } from '../../shared/syntax.js';


const DOMAIN_SCOPED = new Set([
  'deliverable', 'mx_found', 'domain_not_found', 'null_mx',
  'no_mail_server', 'implicit_mx', 'disposable',
]);

export function createTransport({ endpoint, timeoutMs, maxCacheEntries = 500 }) {
  const domainCache = new Map();
  let controller = null;

  function remember(domain, payload) {
    if (!domain || !DOMAIN_SCOPED.has(payload.code)) return;
    if (domainCache.size >= maxCacheEntries) {
      domainCache.delete(domainCache.keys().next().value);
    }
    domainCache.set(domain, {
      verdict: payload.verdict,
      code: payload.code,
      reason: payload.reason,
      checks: payload.checks,
    });
  }

  return {
    peek(email) {
      const { domain } = splitEmail(email);
      return domain ? domainCache.get(domain) ?? null : null;
    },

    
    async check(email) {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;

    
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const url = `${endpoint}?email=${encodeURIComponent(email)}`;
        const response = await fetch(url, {
          signal,
          method: 'GET',
          headers: { Accept: 'application/json' },
          credentials: 'omit', 
          mode: 'cors',
        });

        
        if (!response.ok) {
          return { verdict: VERDICT.UNKNOWN, code: `http_${response.status}`, reason: null };
        }

        const payload = await response.json();
        remember(splitEmail(email).domain, payload);
        return payload;
      } catch (error) {
       
        const code = error?.name === 'AbortError' ? 'aborted' : 'network_error';
        return { verdict: VERDICT.UNKNOWN, code, reason: null };
      } finally {
        clearTimeout(timer);
      }
    },

    cancel() {
      controller?.abort();
      controller = null;
    },
  };
}
