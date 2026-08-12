import { VERDICT, mergeVerdicts } from '../../shared/verdict.js';
import { runLocalChecks } from '../../shared/local.js';
import { isIncomplete, normalize, splitEmail } from '../../shared/syntax.js';
import { createTransport } from './remote.js';

/**
 * The controller. Owns the state machine; knows nothing about the DOM beyond
 * the input element it was handed. Rendering is a callback, which is what lets
 * the same core drive the plain-DOM widget and the React wrapper without a
 * second implementation.
 */

export const STATE = {
  EMPTY: 'empty',           // nothing typed
  TYPING: 'typing',         // mid-address, too early to judge
  CHECKING: 'checking',     // network in flight
  VALID: 'valid',
  INVALID: 'invalid',
  RISKY: 'risky',
  UNKNOWN: 'unknown',       // we could not check; treated as passable
};

export const DEFAULTS = {
  endpoint: 'http://localhost:4000/v1/validate',
  // Long enough that a normal typist does not fire a request per character,
  // short enough to feel like a reaction rather than a delay. Measured from
  // the LAST keystroke, so a fast typist fires exactly one request.
  debounceMs: 250,
  // Network deadline. Beyond this we fail open.
  timeoutMs: 2000,
  // Grace period before the spinner appears. Most answers arrive from cache or
  // a warm server well inside this, and showing a spinner for 40ms reads as a
  // flicker -- worse than showing nothing.
  spinnerDelayMs: 120,
  // 'hard'  - block submit on invalid
  // 'soft'  - warn once, allow a second submit through
  // 'off'   - never interfere with the form
  blockSubmit: 'hard',
  // Should a risky address (disposable/role) block submission too?
  blockRisky: false,
};

export function createValidator(input, options = {}) {
  const config = { ...DEFAULTS, ...options };
  const transport = createTransport({
    endpoint: config.endpoint,
    timeoutMs: config.timeoutMs,
  });

  const listeners = new Set();
  let state = { state: STATE.EMPTY, email: '', reason: null, code: null, suggestion: null, checks: {}, source: null };
  let debounceTimer = null;
  let spinnerTimer = null;
  let touched = false;      // has the field ever been blurred?
  let softWarned = false;   // for blockSubmit: 'soft'
  let generation = 0;       // guards against out-of-order async results

  function emit(next) {
    state = { ...state, ...next };
    for (const listener of listeners) listener(state);
  }

  function clearTimers() {
    clearTimeout(debounceTimer);
    clearTimeout(spinnerTimer);
  }

  /**
   * The core decision: what do we show right now?
   *
   * Runs synchronously on every keystroke. The critical rule is the
   * `isIncomplete` gate -- while someone is mid-address we show nothing at all.
   * Inline validation gets a bad name almost entirely from tools that paint the
   * field red on the first character and only turn green at the last one.
   */
  function evaluate({ force = false } = {}) {
    const email = input.value;
    generation += 1;
    const run = generation;

    if (!email.trim()) {
      clearTimers();
      transport.cancel();
      return emit({ state: STATE.EMPTY, email, reason: null, code: null, suggestion: null, checks: {}, source: 'local' });
    }

    // Not finished typing, and they have not left the field yet: stay silent.
    if (!force && !touched && isIncomplete(email)) {
      clearTimers();
      return emit({ state: STATE.TYPING, email, reason: null, code: null, suggestion: null, checks: {}, source: 'local' });
    }

    // ---- Layer 1: offline. Always synchronous, always first. ----
    const local = runLocalChecks(email);
    const localState = {
      email,
      reason: local.reason,
      code: local.code,
      suggestion: local.suggestion ?? null,
      checks: local.checks,
      source: 'local',
    };

    // A local INVALID is conclusive. There is no point asking the server
    // whether "not-an-email" has an MX record.
    if (local.verdict === VERDICT.INVALID) {
      clearTimers();
      transport.cancel();
      return emit({ ...localState, state: STATE.INVALID });
    }

    // ---- Layer 2: cached domain answer. Also synchronous. ----
    const cached = transport.peek(email);
    if (cached) {
      clearTimers();
      const merged = mergeVerdicts(local, cached);
      return emit({
        ...localState,
        state: toState(merged.verdict),
        reason: merged.reason ?? local.reason,
        code: merged.code,
        checks: { ...local.checks, ...(cached.checks || {}) },
        source: 'cache',
      });
    }

    // ---- Layer 3: network. Debounced, and it only ever upgrades what we
    // already decided offline -- so the user is never staring at a blank field
    // waiting for us. ----
    emit({ ...localState, state: toState(local.verdict) });

    clearTimers();
    debounceTimer = setTimeout(() => {
      spinnerTimer = setTimeout(() => {
        if (run === generation) emit({ state: STATE.CHECKING });
      }, config.spinnerDelayMs);

      transport.check(normalize(email)).then((remote) => {
        clearTimeout(spinnerTimer);
        // A newer keystroke has superseded this request. Drop it silently:
        // rendering it would show a verdict for text that is no longer in the
        // box. This is the bug that makes naive implementations flicker.
        if (run !== generation) return;

        const merged = mergeVerdicts(local, remote);
        emit({
          ...localState,
          state: toState(merged.verdict),
          reason: merged.reason ?? null,
          code: merged.code,
          suggestion: remote.suggestion ?? local.suggestion ?? null,
          checks: { ...local.checks, ...(remote.checks || {}) },
          source: remote.code === 'aborted' || remote.verdict === VERDICT.UNKNOWN ? 'local' : 'remote',
        });
      });
    }, config.debounceMs);
  }

  function toState(verdict) {
    if (verdict === VERDICT.VALID) return STATE.VALID;
    if (verdict === VERDICT.INVALID) return STATE.INVALID;
    if (verdict === VERDICT.RISKY) return STATE.RISKY;
    return STATE.UNKNOWN;
  }

  // ---- event wiring ----

  const onInput = () => evaluate();

  const onBlur = () => {
    touched = true;           // from now on, partial addresses are fair game
    softWarned = false;
    evaluate({ force: true });
  };

  const onFocus = () => {
    // Re-entering the field to fix something should clear the red immediately
    // if the address is now only "incomplete" again.
    if (state.state === STATE.INVALID && isIncomplete(input.value)) {
      touched = false;
      evaluate();
    }
  };

  /** Pasting is a completed action, not a partial one. Skip the debounce. */
  const onPaste = () => {
    setTimeout(() => {
      touched = true;
      clearTimers();
      evaluate({ force: true });
      // Fire the network check now rather than waiting out the debounce.
      const email = input.value;
      if (email.trim() && runLocalChecks(email).verdict !== VERDICT.INVALID && !transport.peek(email)) {
        const run = generation;
        transport.check(normalize(email)).then((remote) => {
          if (run !== generation) return;
          const local = runLocalChecks(email);
          const merged = mergeVerdicts(local, remote);
          emit({ state: toState(merged.verdict), reason: merged.reason ?? null, code: merged.code, source: 'remote' });
        });
      }
    }, 0); // let the paste land in input.value first
  };

  input.addEventListener('input', onInput);
  input.addEventListener('blur', onBlur);
  input.addEventListener('focus', onFocus);
  input.addEventListener('paste', onPaste);

  /**
   * Submit guarding.
   *
   * Capture phase, so we run before the site's own submit handler. We only
   * ever block on INVALID -- never on UNKNOWN. If our API is down, the signup
   * form still works. That is the whole fail-open promise, and it is enforced
   * here rather than left to the host page to get right.
   */
  const form = input.form;
  const onSubmit = (event) => {
    if (config.blockSubmit === 'off') return;
    touched = true;
    evaluate({ force: true });

    const blocking =
      state.state === STATE.INVALID ||
      (config.blockRisky && state.state === STATE.RISKY);

    if (!blocking) return;
    if (config.blockSubmit === 'soft' && softWarned) return; // let them insist
    softWarned = true;

    event.preventDefault();
    event.stopPropagation();
    input.focus();
  };
  form?.addEventListener('submit', onSubmit, true);

  return {
    get state() {
      return state;
    },
    /** Subscribe to state changes. Returns an unsubscribe function. */
    on(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    /** Apply a "did you mean" suggestion and re-validate. */
    accept(suggestion) {
      const value = suggestion ?? state.suggestion;
      if (!value) return;
      input.value = value;
      // Notify any framework (React, Vue) that owns this input's value.
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      evaluate({ force: true });
    },
    /** Force a full check, e.g. before a programmatic submit. */
    revalidate() {
      touched = true;
      evaluate({ force: true });
      return state;
    },
    destroy() {
      clearTimers();
      transport.cancel();
      listeners.clear();
      input.removeEventListener('input', onInput);
      input.removeEventListener('blur', onBlur);
      input.removeEventListener('focus', onFocus);
      input.removeEventListener('paste', onPaste);
      form?.removeEventListener('submit', onSubmit, true);
    },
  };
}

export { splitEmail };
