import { VERDICT, result } from './verdict.js';
import { checkSyntax, splitEmail } from './syntax.js';
import { suggestDomain } from './typo.js';
import { TOP_DISPOSABLE, ROLE_ACCOUNTS, FREE_PROVIDERS } from './domains.js';

/**
 * Everything we can decide without touching the network.
 *
 * This module is the reason the widget feels instant: it runs in the input
 * handler, synchronously, and it resolves the overwhelming majority of real
 * mistakes (typos, obvious garbage, burner domains) before a request exists.
 * The server imports the exact same file, so the browser is never guessing at
 * what the backend will say -- it is running the same code with a smaller
 * dataset.
 */

export function checkDisposable(domain) {
  if (!domain) return null;
  return TOP_DISPOSABLE.has(domain)
    ? result(VERDICT.RISKY, 'disposable', 'This looks like a temporary inbox.')
    : null;
}

export function checkRole(local) {
  if (!local) return null;
  return ROLE_ACCOUNTS.has(local.toLowerCase())
    ? result(VERDICT.RISKY, 'role_account', 'This is a shared mailbox, not a personal one.')
    : null;
}

export function checkTypo(local, domain) {
  const suggestion = domain && suggestDomain(domain);
  if (!suggestion) return null;
  return result(VERDICT.INVALID, 'typo_suspected', `Did you mean ${suggestion}?`, {
    suggestion: `${local}@${suggestion}`,
  });
}

/**
 * Run the offline checks in order and return the first thing worth saying.
 *
 * Order is deliberate and it is a product decision, not a technical one:
 *
 *   syntax     -> nothing else is meaningful if this fails
 *   typo       -> BEFORE disposable/role, because a correctable mistake is the
 *                 most actionable message we have. "Did you mean gmail.com?"
 *                 beats any warning we could show about gmial.com.
 *   disposable -> a real signal, but only a warning
 *   role       -> weakest signal, so it speaks last
 *
 * Returns a result plus a `checks` map, so callers (and the demo's trace panel)
 * can see what ran rather than just the final answer.
 */
export function runLocalChecks(raw) {
  const checks = {};
  const { local, domain } = splitEmail(raw);

  const syntax = checkSyntax(raw);
  checks.syntax = syntax.verdict === VERDICT.VALID ? 'pass' : 'fail';
  if (syntax.verdict !== VERDICT.VALID) {
    return { ...syntax, checks, domain, local };
  }

  const typo = checkTypo(local, domain);
  checks.typo = typo ? 'fail' : 'pass';
  if (typo) return { ...typo, checks, domain, local };

  const disposable = checkDisposable(domain);
  checks.disposable = disposable ? 'fail' : 'pass';
  if (disposable) return { ...disposable, checks, domain, local };

  const role = checkRole(local);
  checks.role = role ? 'fail' : 'pass';
  if (role) return { ...role, checks, domain, local };

  return {
    ...result(VERDICT.VALID, 'local_ok', null),
    checks,
    domain,
    local,
    free: FREE_PROVIDERS.has(domain),
  };
}
