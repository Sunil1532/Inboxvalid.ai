import test from 'node:test';
import assert from 'node:assert/strict';

import { checkSyntax, isIncomplete, splitEmail } from '../../shared/syntax.js';
import { suggestDomain, editDistance } from '../../shared/typo.js';
import { runLocalChecks } from '../../shared/local.js';
import { VERDICT, mergeVerdicts } from '../../shared/verdict.js';
import { validateEmail } from '../src/pipeline.js';

/** Minimal store double. The pipeline only knows this four-method interface. */
function fakeStore({ disposable = new Set(), cache = new Map() } = {}) {
  return {
    calls: { get: 0, set: 0 },
    async isDisposable(d) { return disposable.has(d); },
    async getCached(d) { this.calls.get += 1; return cache.get(d) ?? null; },
    async setCached(d, record) { this.calls.set += 1; cache.set(d, record); },
    async stats() { return {}; },
    async close() {},
  };
}

const mxOk = async () => ({ verdict: VERDICT.VALID, code: 'mx_found', reason: null, mx: ['mx.test'], durationMs: 1 });
const mxMissing = async () => ({ verdict: VERDICT.INVALID, code: 'domain_not_found', reason: 'That domain does not exist.', durationMs: 1 });
const mxDown = async () => ({ verdict: VERDICT.UNKNOWN, code: 'dns_error', reason: null, durationMs: 1 });

test('syntax: accepts addresses that are actually used in the wild', () => {
  const valid = [
    'john@example.com',
    'john.doe@example.com',
    'john+newsletter@example.com',       // plus addressing
    "o'brien@example.com",               // apostrophe is legal atext
    'j_d-1@sub.example.co.uk',           // subdomain + multi-label TLD
    'a@b.co',                            // shortest realistic address
    'user!#$%&*+-/=?^_`{|}~@example.com', // full atext set
  ];
  for (const email of valid) {
    assert.equal(checkSyntax(email).verdict, VERDICT.VALID, `expected valid: ${email}`);
  }
});

test('syntax: rejects with a specific, fixable reason', () => {
  const cases = [
    ['', 'empty'],
    ['plainaddress', 'missing_at'],
    ['a@@b.com', 'multiple_at'],
    ['@example.com', 'empty_local'],
    ['user@', 'empty_domain'],
    ['user @example.com', 'whitespace'],
    ['.user@example.com', 'local_dot_edge'],
    ['user.@example.com', 'local_dot_edge'],
    ['us..er@example.com', 'local_double_dot'],
    ['user@example', 'domain_no_dot'],
    ['user@example..com', 'domain_double_dot'],
    ['user@-example.com', 'domain_label_charset'],
    ['user@example-.com', 'domain_label_charset'],
    ['user@example.c', 'domain_bad_tld'],
    ['user@example.123', 'domain_bad_tld'],
    [`${'a'.repeat(65)}@example.com`, 'local_too_long'],
  ];
  for (const [email, code] of cases) {
    assert.equal(checkSyntax(email).code, code, `wrong code for ${JSON.stringify(email)}`);
  }
});

test('syntax: splits on the last @ so the error message stays useful', () => {
  assert.deepEqual(splitEmail('a@b@c.com').domain, 'c.com');
  assert.equal(checkSyntax('a@b@c.com').code, 'multiple_at');
});

test('syntax: domain is lowercased, local part is not', () => {
  const { local, domain } = splitEmail('John.Doe@EXAMPLE.COM');
  assert.equal(local, 'John.Doe');
  assert.equal(domain, 'example.com');
});

test('isIncomplete: stays quiet while the user is still typing', () => {
  for (const partial of ['j', 'john', 'john@', 'john@gm', 'john@gmail', 'john@gmail.', 'john@gmail.c']) {
    assert.equal(isIncomplete(partial), true, `should be incomplete: ${partial}`);
  }
  assert.equal(isIncomplete('john@gmail.com'), false);
  assert.equal(isIncomplete('john@gmail.co'), false);
});

test('editDistance: counts a transposition as one edit, not two', () => {
  assert.equal(editDistance('gmial', 'gmail'), 1);
  assert.equal(editDistance('gmail', 'gmail'), 0);
  assert.equal(editDistance('abc', 'abd'), 1);
});

test('editDistance: bails out once the budget is blown', () => {
  assert.ok(editDistance('completely', 'different', 2) > 2);
});

test('typo: corrects the mistakes people actually make', () => {
  assert.equal(suggestDomain('gmial.com'), 'gmail.com');   // transposition
  assert.equal(suggestDomain('gmai.com'), 'gmail.com');    // omission
  assert.equal(suggestDomain('gmail.con'), 'gmail.com');   // TLD typo
  assert.equal(suggestDomain('hotmial.com'), 'hotmail.com');
  assert.equal(suggestDomain('yahooo.com'), 'yahoo.com');
});

test('typo: TLD correction generalises to domains we have never seen', () => {
  assert.equal(suggestDomain('acmecorp.con'), 'acmecorp.com');
  assert.equal(suggestDomain('tvaram.cmo'), 'tvaram.com');
});

test('typo: leaves correct and unrelated domains alone', () => {
  assert.equal(suggestDomain('gmail.com'), null);
  assert.equal(suggestDomain('tvaram.com'), null);
  assert.equal(suggestDomain('inboxvalid.ai'), null);
  // The false-positive case that matters: a real company domain must not be
  // "corrected" into a mailbox provider.
  assert.equal(suggestDomain('stripe.com'), null);
});

test('local pipeline: typo outranks disposable, because it is actionable', () => {
  const out = runLocalChecks('user@gmial.com');
  assert.equal(out.verdict, VERDICT.INVALID);
  assert.equal(out.code, 'typo_suspected');
  assert.equal(out.suggestion, 'user@gmail.com');
});

test('local pipeline: disposable and role accounts warn but never block', () => {
  assert.equal(runLocalChecks('user@mailinator.com').verdict, VERDICT.RISKY);
  assert.equal(runLocalChecks('support@tvaram.com').verdict, VERDICT.RISKY);
});

test('mergeVerdicts: a remote unknown never downgrades a local valid (fail open)', () => {
  const local = { verdict: VERDICT.VALID };
  const remote = { verdict: VERDICT.UNKNOWN };
  assert.equal(mergeVerdicts(local, remote).verdict, VERDICT.VALID);
});

test('mergeVerdicts: the stricter verdict otherwise wins', () => {
  assert.equal(mergeVerdicts({ verdict: VERDICT.VALID }, { verdict: VERDICT.INVALID }).verdict, VERDICT.INVALID);
  assert.equal(mergeVerdicts({ verdict: VERDICT.RISKY }, { verdict: VERDICT.VALID }).verdict, VERDICT.RISKY);
});

test('pipeline: a syntax failure never reaches DNS', async () => {
  let called = false;
  const spy = async (d) => { called = true; return mxOk(d); };
  const out = await validateEmail('not-an-email', fakeStore(), { resolveMx: spy });
  assert.equal(out.verdict, VERDICT.INVALID);
  assert.equal(called, false, 'DNS was queried for a syntactically invalid address');
});

test('pipeline: a good address with MX is deliverable', async () => {
  const out = await validateEmail('john@example.com', fakeStore(), { resolveMx: mxOk });
  assert.equal(out.verdict, VERDICT.VALID);
  assert.equal(out.checks.mx, 'pass');
});

test('pipeline: a missing domain is invalid regardless of perfect syntax', async () => {
  const out = await validateEmail('john@example.com', fakeStore(), { resolveMx: mxMissing });
  assert.equal(out.verdict, VERDICT.INVALID);
  assert.equal(out.code, 'domain_not_found');
});

test('pipeline: DNS failure degrades to unknown, not to invalid', async () => {
  const out = await validateEmail('john@example.com', fakeStore(), { resolveMx: mxDown });
  assert.equal(out.verdict, VERDICT.UNKNOWN);
  assert.equal(out.checks.mx, 'skip');
});

test('pipeline: a role account survives a passing MX check', async () => {
  const out = await validateEmail('support@example.com', fakeStore(), { resolveMx: mxOk });
  assert.equal(out.verdict, VERDICT.RISKY);
  assert.equal(out.code, 'role_account');
  assert.equal(out.checks.mx, 'pass');
});

test('pipeline: server catches disposable domains the widget does not carry', async () => {
  const store = fakeStore({ disposable: new Set(['obscure-burner.example']) });
  const out = await validateEmail('a@obscure-burner.example', store, { resolveMx: mxOk });
  assert.equal(out.verdict, VERDICT.RISKY);
  assert.equal(out.code, 'disposable');
});

test('pipeline: unknown results are not cached', async () => {
  const store = fakeStore();
  await validateEmail('john@example.com', store, { resolveMx: mxDown });
  assert.equal(store.calls.set, 0, 'a transient DNS failure was written to the cache');
});

test('pipeline: repeat lookups hit the cache instead of DNS', async () => {
  const store = fakeStore();
  let lookups = 0;
  const counting = async (d) => { lookups += 1; return mxOk(d); };
  await validateEmail('a@example.com', store, { resolveMx: counting });
  await validateEmail('b@example.com', store, { resolveMx: counting });
  assert.equal(lookups, 1, 'second lookup on the same domain should be cached');
});

test('pipeline: concurrent misses on one domain collapse into a single lookup', async () => {
  const store = fakeStore();
  let lookups = 0;
  const slow = async (d) => {
    lookups += 1;
    await new Promise((r) => setTimeout(r, 25));
    return mxOk(d);
  };
  const results = await Promise.all(
    ['a', 'b', 'c', 'd', 'e'].map((u) => validateEmail(`${u}@herd.example`, store, { resolveMx: slow })),
  );
  assert.equal(lookups, 1, 'singleflight did not collapse the stampede');
  for (const r of results) assert.equal(r.verdict, VERDICT.VALID);
});
