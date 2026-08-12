import { createValidator, STATE, DEFAULTS } from './core.js';
import { attachUI } from './ui.js';
import { runLocalChecks } from '../../shared/local.js';
import { VERDICT } from '../../shared/verdict.js';

/**
 * Public surface. Two ways in, on purpose:
 *
 *   1. A script tag with data attributes -- for the marketing site or a
 *      no-code form where nobody is going to write JavaScript.
 *   2. InboxValid.attach(input, options) -- for an app that wants control.
 *
 * The second is the real API; the first is a thin wrapper over it that reads
 * config off the DOM. There is no separate code path.
 */

function attach(target, options = {}) {
  const input = typeof target === 'string' ? document.querySelector(target) : target;
  if (!input) throw new Error(`[InboxValid] no element matched ${target}`);
  if (input.dataset.ivAttached === 'true') return input.__inboxvalid;

  const validator = createValidator(input, options);
  const destroyUI = options.headless ? null : attachUI(input, validator);

  // Bridge to the host page: a CustomEvent means they can react to verdicts
  // without importing anything or reaching into our internals.
  validator.on((state) => {
    input.dispatchEvent(new CustomEvent('inboxvalid:change', { detail: state, bubbles: true }));
    options.onChange?.(state);
  });

  const instance = {
    ...validator,
    get state() {
      return validator.state;
    },
    destroy() {
      destroyUI?.();
      validator.destroy();
      delete input.dataset.ivAttached;
      delete input.__inboxvalid;
    },
  };

  input.dataset.ivAttached = 'true';
  input.__inboxvalid = instance;
  return instance;
}

/** Read config from data-* attributes on the script tag or the input itself. */
function readConfig(element) {
  const d = element.dataset;
  const config = {};
  if (d.ivEndpoint) config.endpoint = d.ivEndpoint;
  if (d.ivDebounce) config.debounceMs = Number(d.ivDebounce);
  if (d.ivTimeout) config.timeoutMs = Number(d.ivTimeout);
  if (d.ivBlockSubmit) config.blockSubmit = d.ivBlockSubmit;
  if (d.ivBlockRisky) config.blockRisky = d.ivBlockRisky === 'true';
  return config;
}

/**
 * Auto-init. Attaches to every input matching the selector, and keeps watching
 * the document so inputs added later (modals, SPA route changes, a signup form
 * inside a lightbox) get picked up without the host calling anything.
 */
function autoInit() {
  const script = document.currentScript
    || document.querySelector('script[data-iv-auto]')
    || document.querySelector('script[src*="inboxvalid"]');
  if (!script) return;

  const scriptConfig = readConfig(script);
  const selector = script.dataset.ivSelector || 'input[type="email"], input[data-inboxvalid]';

  const attachAll = () => {
    for (const input of document.querySelectorAll(selector)) {
      if (input.dataset.ivAttached === 'true') continue;
      try {
        attach(input, { ...scriptConfig, ...readConfig(input) });
      } catch (error) {
        // A widget must never break the page it is embedded in.
        console.warn('[InboxValid]', error);
      }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachAll, { once: true });
  } else {
    attachAll();
  }

  if (script.dataset.ivWatch !== 'false' && typeof MutationObserver !== 'undefined') {
    new MutationObserver(attachAll).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
}

/** Offline-only check. Useful for server-rendered forms and unit tests. */
function checkLocally(email) {
  const local = runLocalChecks(email);
  return {
    verdict: local.verdict,
    code: local.code,
    reason: local.reason,
    suggestion: local.suggestion ?? null,
    checks: local.checks,
  };
}

const InboxValid = { attach, checkLocally, STATE, VERDICT, DEFAULTS, version: '1.0.0' };

if (typeof window !== 'undefined') {
  window.InboxValid = InboxValid;
  autoInit();
}

export default InboxValid;
export { attach, checkLocally, STATE, VERDICT, DEFAULTS };
