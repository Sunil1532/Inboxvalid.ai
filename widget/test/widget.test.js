import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/**
 * Behaviour tests for the widget, in a real DOM.
 *
 * These cover the things that are easy to get subtly wrong and impossible to
 * eyeball reliably: how many requests a burst of typing produces, whether a
 * stale response can overwrite a fresh one, and whether a dead API can block a
 * signup.
 */

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://host.example' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.AbortController = dom.window.AbortController;

const { createValidator, STATE } = await import('../src/core.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Builds a form + input and a controllable fake API. */
function harness({ respond, latency = 0 } = {}) {
  document.body.innerHTML = '<form><input type="email" name="email"><button type="submit">Go</button></form>';
  const form = document.querySelector('form');
  const input = document.querySelector('input');

  const calls = [];
  globalThis.fetch = async (url, init) => {
    const email = decodeURIComponent(new URL(url).searchParams.get('email'));
    calls.push(email);
    if (latency) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, latency);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    }
    const body = respond ? respond(email) : { verdict: 'valid', code: 'deliverable', reason: null, checks: {} };
    if (body instanceof Error) throw body;
    return { ok: body.__status ? false : true, status: body.__status ?? 200, json: async () => body };
  };

  return { form, input, calls };
}

function type(input, value) {
  input.value = value;
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

test('stays silent while the address is still being typed', async () => {
  const { input } = harness();
  const validator = createValidator(input, { debounceMs: 20 });

  for (const partial of ['j', 'jo', 'john', 'john@', 'john@gm', 'john@gmail.c']) {
    type(input, partial);
    assert.ok(
      [STATE.TYPING, STATE.EMPTY].includes(validator.state.state),
      `showed "${validator.state.state}" for partial input "${partial}"`,
    );
  }
  validator.destroy();
});

test('a burst of typing produces exactly one request', async () => {
  const { input, calls } = harness();
  const validator = createValidator(input, { debounceMs: 30 });

  for (const value of ['john@example.c', 'john@example.co', 'john@example.com']) {
    type(input, value);
    await sleep(5);
  }
  await sleep(80);

  assert.equal(calls.length, 1, `expected 1 request, got ${calls.length}: ${calls.join(', ')}`);
  assert.equal(calls[0], 'john@example.com');
  validator.destroy();
});

test('local checks resolve typos with no request at all', async () => {
  const { input, calls } = harness();
  const validator = createValidator(input, { debounceMs: 20 });

  type(input, 'john@gmial.com');
  await sleep(60);

  assert.equal(validator.state.state, STATE.INVALID);
  assert.equal(validator.state.code, 'typo_suspected');
  assert.equal(validator.state.suggestion, 'john@gmail.com');
  assert.equal(calls.length, 0, 'a typo should never cost a network round trip');
  validator.destroy();
});

test('accepting a suggestion rewrites the field and re-validates', async () => {
  const { input } = harness();
  const validator = createValidator(input, { debounceMs: 20 });

  type(input, 'john@gmial.com');
  await sleep(40);
  validator.accept();
  await sleep(60);

  assert.equal(input.value, 'john@gmail.com');
  assert.notEqual(validator.state.state, STATE.INVALID);
  validator.destroy();
});

test('a second domain at a known domain is answered from cache', async () => {
  const { input, calls } = harness();
  const validator = createValidator(input, { debounceMs: 20 });

  type(input, 'john@example.com');
  await sleep(60);
  assert.equal(calls.length, 1);

  type(input, 'jane@example.com');
  await sleep(60);
  assert.equal(calls.length, 1, 'same domain should not trigger a second request');
  assert.equal(validator.state.source, 'cache');
  validator.destroy();
});

test('a slow response that arrives after further typing is discarded', async () => {
  const { input } = harness({
    latency: 60,
    respond: (email) => (email === 'stale@example.com'
      ? { verdict: 'invalid', code: 'domain_not_found', reason: 'That domain does not exist.', checks: {} }
      : { verdict: 'valid', code: 'deliverable', reason: null, checks: {} }),
  });
  const validator = createValidator(input, { debounceMs: 10 });

  type(input, 'stale@example.com');
  await sleep(25);                 // request is in flight
  type(input, 'fresh@other.com');  // supersedes it
  await sleep(160);

  assert.equal(validator.state.email, 'fresh@other.com');
  assert.notEqual(validator.state.code, 'domain_not_found', 'a stale response overwrote the current one');
  validator.destroy();
});

test('a dead API leaves the address usable rather than invalid', async () => {
  const { input } = harness({ respond: () => new Error('connection refused') });
  const validator = createValidator(input, { debounceMs: 10 });

  type(input, 'john@example.com');
  await sleep(80);

  assert.notEqual(validator.state.state, STATE.INVALID);
  assert.equal(validator.state.state, STATE.VALID, 'should keep the locally-proven verdict');
  validator.destroy();
});

test('an HTTP error is not evidence against the address', async () => {
  const { input } = harness({ respond: () => ({ __status: 429 }) });
  const validator = createValidator(input, { debounceMs: 10 });

  type(input, 'john@example.com');
  await sleep(80);

  assert.notEqual(validator.state.state, STATE.INVALID);
  validator.destroy();
});

test('a timeout fails open inside the configured budget', async () => {
  const { input } = harness({ latency: 5000 });
  const validator = createValidator(input, { debounceMs: 10, timeoutMs: 40 });

  type(input, 'john@example.com');
  await sleep(120);

  assert.notEqual(validator.state.state, STATE.INVALID);
  validator.destroy();
});

test('submit is blocked for an invalid address', async () => {
  const { form, input } = harness();
  const validator = createValidator(input, { debounceMs: 10 });

  type(input, 'definitely-not-an-email');
  await sleep(40);

  const event = new dom.window.Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(event);

  assert.equal(event.defaultPrevented, true, 'invalid address should block submit');
  validator.destroy();
});

test('submit is allowed when the API could not be reached', async () => {
  const { form, input } = harness({ respond: () => new Error('offline') });
  const validator = createValidator(input, { debounceMs: 10 });

  type(input, 'john@example.com');
  await sleep(80);

  const event = new dom.window.Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(event);

  assert.equal(event.defaultPrevented, false, 'a failed check must never block signup');
  validator.destroy();
});

test('risky addresses warn but do not block by default', async () => {
  const { form, input } = harness();
  const validator = createValidator(input, { debounceMs: 10 });

  type(input, 'john@mailinator.com');
  await sleep(60);
  assert.equal(validator.state.state, STATE.RISKY);

  const event = new dom.window.Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false, 'risky should warn, not block');
  validator.destroy();
});

test('destroy removes every listener it added', async () => {
  const { input, calls } = harness();
  const validator = createValidator(input, { debounceMs: 10 });
  validator.destroy();

  type(input, 'john@example.com');
  await sleep(60);

  assert.equal(calls.length, 0, 'destroyed validator still reacted to input');
});
