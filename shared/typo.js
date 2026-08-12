import { POPULAR_DOMAINS, TLD_TYPOS } from './domains.js';
import { splitEmail } from './syntax.js';

export function editDistance(a, b, maxDistance = 2) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  const width = b.length + 1;
  let twoAgo = new Array(width).fill(0);
  let oneAgo = new Array(width);
  let current = new Array(width);
  for (let j = 0; j < width; j++) oneAgo[j] = j; 

  for (let i = 1; i <= a.length; i++) {
    current[0] = i; 
    let rowMin = i;

    for (let j = 1; j < width; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        current[j - 1] + 1,    
        oneAgo[j] + 1,         
        oneAgo[j - 1] + cost,  
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, twoAgo[j - 2] + 1); 
      }
      current[j] = value;
      if (value < rowMin) rowMin = value;
    }

  
    if (rowMin > maxDistance) return maxDistance + 1;

    const recycled = twoAgo;
    twoAgo = oneAgo;
    oneAgo = current;
    current = recycled;
  }

  return oneAgo[b.length];
}


export function suggestDomain(domain) {
  if (!domain) return null;
  const lower = domain.toLowerCase();
  if (POPULAR_DOMAINS.includes(lower)) return null;


  const parts = lower.split('.');
  const tld = parts[parts.length - 1];
  if (TLD_TYPOS[tld]) {
    const corrected = [...parts.slice(0, -1), TLD_TYPOS[tld]].join('.');
    return corrected === lower ? null : corrected;
  }


  let best = null;
  let bestDistance = Infinity;
  for (const candidate of POPULAR_DOMAINS) {
    const budget = Math.min(2, Math.floor(candidate.length / 4));
    const distance = editDistance(lower, candidate, budget);
    if (distance <= budget && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
      if (distance === 1) break; 
    }
  }
  return best;
}


export function suggestEmail(raw) {
  const { local, domain, hasAt } = splitEmail(raw);
  if (!hasAt || !local || !domain) return null;
  const suggestion = suggestDomain(domain);
  return suggestion ? `${local}@${suggestion}` : null;
}
