import { Resolver } from 'node:dns/promises';
import { VERDICT, result } from '../../shared/verdict.js';
import { config } from './config.js';



const resolver = new Resolver({ timeout: config.dns.timeoutMs, tries: 1 });
if (config.dns.servers.length) resolver.setServers(config.dns.servers);


function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('dns_timeout'), { code: 'ETIMEOUT' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function checkMx(domain) {
  const startedAt = performance.now();

  try {
    const records = await withTimeout(resolver.resolveMx(domain), config.dns.timeoutMs);
    const usable = (records || []).filter((r) => r.exchange && r.exchange !== '.');

  
    if (records?.length && !usable.length) {
      return finish(VERDICT.INVALID, 'null_mx', 'This domain does not accept email.', startedAt);
    }

    if (usable.length) {
      usable.sort((a, b) => a.priority - b.priority);
      return finish(VERDICT.VALID, 'mx_found', null, startedAt, {
        mx: usable.slice(0, 3).map((r) => r.exchange),
      });
    }

    return await fallbackToAddressRecord(domain, startedAt);
  } catch (error) {
   

    if (error.code === 'ENOTFOUND' || error.code === 'NXDOMAIN') {
      return finish(VERDICT.INVALID, 'domain_not_found', 'That domain does not exist.', startedAt);
    }
    
    if (error.code === 'ENODATA') {
      return fallbackToAddressRecord(domain, startedAt);
    }
  
    return finish(VERDICT.UNKNOWN, 'dns_error', null, startedAt, { error: error.code || 'unknown' });
  }
}

async function fallbackToAddressRecord(domain, startedAt) {
  try {
    const addresses = await withTimeout(resolver.resolve4(domain), config.dns.timeoutMs);
    if (addresses?.length) {
      return finish(VERDICT.RISKY, 'implicit_mx', 'This domain has no mail server configured.', startedAt);
    }
  } catch (error) {
    if (error.code === 'ENOTFOUND' || error.code === 'NXDOMAIN') {
      return finish(VERDICT.INVALID, 'domain_not_found', 'That domain does not exist.', startedAt);
    }
    if (error.code !== 'ENODATA') {
      return finish(VERDICT.UNKNOWN, 'dns_error', null, startedAt, { error: error.code || 'unknown' });
    }
  }
  return finish(VERDICT.INVALID, 'no_mail_server', 'This domain cannot receive email.', startedAt);
}

function finish(verdict, code, reason, startedAt, extra = {}) {
  return {
    ...result(verdict, code, reason, extra),
    durationMs: Math.round(performance.now() - startedAt),
  };
}


export function ttlFor(mxResult) {
  return mxResult.verdict === VERDICT.VALID
    ? config.cache.positiveTtlSec
    : config.cache.negativeTtlSec;
}
