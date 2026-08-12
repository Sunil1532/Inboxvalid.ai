import { VERDICT, result } from './verdict.js';
const LOCAL_ATEXT = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;
const LABEL = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/;
const TLD = /^[A-Za-z]{2,63}$/;

export const MAX_LOCAL = 64;
export const MAX_DOMAIN = 255;
export const MAX_TOTAL = 320;

export function splitEmail(raw) {
  const value = String(raw ?? '').trim();
  const at = value.lastIndexOf('@');
  if (at === -1) return { value, local: value, domain: '', hasAt: false };
  return {
    value,
    local: value.slice(0, at),
    domain: value.slice(at + 1).toLowerCase(),
    hasAt: true,
  };
}


export function normalize(raw) {
  const { local, domain, hasAt } = splitEmail(raw);
  return hasAt ? `${local}@${domain}` : local;
}

export function checkSyntax(raw) {
  const { value, local, domain, hasAt } = splitEmail(raw);

  if (!value) return result(VERDICT.INVALID, 'empty', 'Enter an email address.');
  if (value.length > MAX_TOTAL) {
    return result(VERDICT.INVALID, 'too_long', 'This address is too long.');
  }
  if (/\s/.test(value)) {
    return result(VERDICT.INVALID, 'whitespace', 'Addresses cannot contain spaces.');
  }
  if (!hasAt) {
    return result(VERDICT.INVALID, 'missing_at', 'Add an @ and the domain, like @example.com.');
  }
  if (value.split('@').length > 2) {
    return result(VERDICT.INVALID, 'multiple_at', 'An address can only have one @.');
  }

 
  if (!local) return result(VERDICT.INVALID, 'empty_local', 'Add the part before the @.');
  if (local.length > MAX_LOCAL) {
    return result(VERDICT.INVALID, 'local_too_long', 'The part before the @ is too long.');
  }
  if (!LOCAL_ATEXT.test(local)) {
    return result(VERDICT.INVALID, 'local_charset', 'The part before the @ has an unsupported character.');
  }
  if (local.startsWith('.') || local.endsWith('.')) {
    return result(VERDICT.INVALID, 'local_dot_edge', 'The part before the @ cannot start or end with a dot.');
  }
  if (local.includes('..')) {
    return result(VERDICT.INVALID, 'local_double_dot', 'Remove the double dot before the @.');
  }


  if (!domain) return result(VERDICT.INVALID, 'empty_domain', 'Add a domain after the @.');
  if (domain.length > MAX_DOMAIN) {
    return result(VERDICT.INVALID, 'domain_too_long', 'The domain is too long.');
  }
  if (!domain.includes('.')) {
    return result(VERDICT.INVALID, 'domain_no_dot', 'The domain needs a dot, like example.com.');
  }
  if (domain.includes('..')) {
    return result(VERDICT.INVALID, 'domain_double_dot', 'Remove the double dot in the domain.');
  }

  const labels = domain.split('.');
  for (const label of labels) {
    if (!label) {
      return result(VERDICT.INVALID, 'domain_empty_label', 'The domain is incomplete.');
    }
    if (label.length > 63) {
      return result(VERDICT.INVALID, 'domain_label_too_long', 'Part of the domain is too long.');
    }
    if (!LABEL.test(label)) {
      return result(VERDICT.INVALID, 'domain_label_charset', 'The domain has an unsupported character.');
    }
  }
  if (!TLD.test(labels[labels.length - 1])) {
    return result(VERDICT.INVALID, 'domain_bad_tld', 'That domain ending does not look right.');
  }

  return result(VERDICT.VALID, 'syntax_ok', null, { local, domain });
}


export function isIncomplete(raw) {
  const { value, domain, hasAt } = splitEmail(raw);
  if (!value) return true;
  if (!hasAt) return true;                    
  if (!domain) return true;                  
  if (!domain.includes('.')) return true;     
  if (domain.endsWith('.')) return true;     
  const tld = domain.split('.').pop();
  if (tld.length < 2) return true;            
  return false;
}
