export const VERDICT = {
  VALID: 'valid',      
  RISKY: 'risky',       
  UNKNOWN: 'unknown',   
};


const SEVERITY = {
  [VERDICT.INVALID]: 3,
  [VERDICT.RISKY]: 2,
  [VERDICT.UNKNOWN]: 1,
  [VERDICT.VALID]: 0,
};

export function mergeVerdicts(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  if (remote.verdict === VERDICT.UNKNOWN && local.verdict === VERDICT.VALID) return local;
  return SEVERITY[remote.verdict] >= SEVERITY[local.verdict] ? remote : local;
}

export function result(verdict, code, reason, extra = {}) {
  return { verdict, code, reason, ...extra };
}
