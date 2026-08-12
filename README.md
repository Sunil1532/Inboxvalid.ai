# InboxValid — real-time email validation widget

A small embeddable widget that checks an email address as someone types it, catches the mistakes that
actually cost you customers, and blocks the obviously broken ones before the form submits.

The rule I built everything around: it should never make a signup form slower or less reliable than
it was without the widget.

**Live demo:** _add your Vercel URL_
**API:** _add your Render URL_

---

## Running it

```bash
npm run install:all
npm run build        # bundles the widget
npm start            # API on :4000        (terminal 1)
npm run dev:demo     # demo on :5173       (terminal 2)
npm test             # 36 tests
```

You don't need MongoDB. Leave `MONGO_URL` unset and the same storage interface runs from memory.

For the script-tag version, run `npm run build` and open `widget/example/index.html`.

---

## What's in here

```
shared/    the validation rules — imported by BOTH the browser and the server
widget/    the embeddable widget (6.8 kB gzipped, no dependencies)
server/    Express API — DNS lookups, full disposable list, caching
demo/      React signup form with a live trace panel
```

There's a much longer file-by-file walkthrough in `WALKTHROUGH.md` if you want the reasoning behind
each decision.

---

## The one decision everything else follows from

**The browser and the server run the same validation code.**

`shared/` is imported directly by Node and inlined into the browser bundle by esbuild. The widget
isn't a rough client-side guess that the server later corrects — it's the same functions with a
smaller dataset. The only two things the server can do that the browser can't are carry the full
disposable list and resolve DNS.

That's what makes the latency target possible. Most addresses never need the network at all.

---

## Why four verdicts instead of two

`valid` · `invalid` · `risky` · `unknown`

Only `invalid` blocks submission. `risky` (disposable inbox, role account) warns but lets people
through, and `unknown` — which is how every failure gets represented — never blocks anyone.

The reasoning is an asymmetry: blocking a real customer costs you a customer, while accepting a bad
address costs you one bounce. Those aren't close, so I only block what's provable. A binary
valid/invalid would have forced the system to lie about everything in the middle.

---

## How validation works

Checks run cheapest-first and stop at the first failure, so a malformed address never costs a DNS
lookup.

```
1. syntax       browser + server
2. typo         browser + server
3. disposable   browser (top ~150) + server (full list)
4. role         browser + server
5. MX           server only
```

**Syntax is parsed, not regex-matched.** The RFC-correct email regex is ~6 KB, unreadable, and only
returns a boolean. The field's job is to help someone fix a mistake, so every failure carries a
specific message — "Remove the double dot before the @" instead of "invalid email".

**Typo detection runs before the disposable and role checks.** That's a product call, not a technical
one. "Did you mean gmail.com?" is the most useful thing we can say, so it goes first. I used
Damerau-Levenshtein rather than plain Levenshtein because transposition is the most common typing
error — `gmial`→`gmail` is one swap, but plain Levenshtein scores it 2, the same as an unrelated
domain. TLD typos are handled separately, which means `acmecorp.con` gets fixed even though
`acmecorp.com` isn't in any list.

**MX stops at DNS — no SMTP probe.** Three reasons: it takes seconds rather than milliseconds so it
can't sit in a keystroke path, Gmail and Outlook accept every recipient and bounce later so the
answer is often wrong anyway, and it gets your IP blocklisted. DNS answers the question that's
actually useful at signup: can mail for this domain be delivered at all.

Two details stop us rejecting real people: a null MX record (RFC 7505) is a genuine negative, but *no*
MX record falls back to the A record, because RFC 5321 says senders do that and plenty of small
domains rely on it.

---

## How I kept it fast

The target was under 200 ms *perceived* — which really means "don't be on the network." You can't hit
200 ms with a round trip plus DNS from India to a US host, so the answer is to mostly not make one.

- Local checks run synchronously in the input handler, so typos and malformed addresses resolve in
  the same frame with no request at all.
- The client caches by **domain**. Once `gmail.com` is known, every other `@gmail.com` address is
  free — and on a signup form the domain repeats constantly while the local part changes.
- 250 ms debounce measured from the last keystroke, so a typed burst is one request, not sixteen.
- The spinner waits 120 ms before appearing. Most answers land inside that, and a spinner that
  flashes for 40 ms feels worse than no spinner.
- Every new check aborts the previous one, and a generation counter throws away any stale response
  that lands anyway. That's the bug that makes naive inline validation flicker.
- On the server, repeat domains hit the cache, and concurrent misses on the same domain collapse into
  a single DNS lookup instead of a stampede.

**The thing that matters most isn't in that list:** the widget shows nothing while you're still
typing. `j` → `jo` → `john@` aren't errors, they're someone mid-word. It stays quiet until the
mistake can no longer be typed away, or until you leave the field.

---

## Failing open

The brief asked not to block on network errors. I enforced that inside the widget rather than leaving
it to whoever embeds it:

- Timeouts, 4xx, 5xx, aborts and network errors all become `unknown` — never `invalid`.
- The submit guard only blocks on `invalid`.
- A remote `unknown` never overrides a locally-proven `valid`.
- Even an unhandled 500 returns `verdict: "unknown"`.
- Auto-init is wrapped in try/catch, because a broken widget must never break someone's page.

Four tests cover this, including one that kills the API and asserts the form still submits.



## Trade-offs

**Vanilla core with a React wrapper, not a React component.** A React-only widget can't embed on a
WordPress signup form, which is most of the market. So the core is framework-free and React
integration is a 30-line hook. *Cost:* React users write a hook instead of importing a component.

**Duplicated data, shared logic.** The browser carries the top ~150 disposable domains and the server
carries the rest. Deliberate duplication of data to avoid a round trip; the logic still has one
implementation. *Cost:* ~3 kB, and the two lists can drift.

**Rate limiting is in-process and fixed-window.** Per-instance, so N instances allow N × the limit.
It's abuse control, not a quota system, and it didn't justify a Redis dependency yet. *Cost:* not a
real quota.

**GET with the address in the query string.** Idempotent, CDN-cacheable, and no CORS preflight per
keystroke. *Cost:* addresses end up in access logs. POST works on the same route for callers who care.

**Submit blocking uses the capture phase**, so it runs before the host's own handler. That's
intrusive, so it's configurable — `hard`, `soft`, or `off`.

**MongoDB is optional.** Both stores sit behind one interface. In-memory isn't a test stub, it's a
supported deployment and the right fit for cheap single-node hosting. Mongo earns its place once you
run more than one node and want a shared warm cache.

---

## Tests

36 tests, no network, no Mongo, no browser.

The ones worth pointing at: `stripe.com` must *not* get "corrected" into a mailbox provider; a syntax
failure never reaches DNS; a DNS failure becomes `unknown` and isn't cached; five concurrent requests
for one domain produce a single lookup; a dead API still lets the form submit.

---

## Wiring it to a real API

Change one attribute — `data-iv-endpoint` — and keep the response shape
(`{ verdict, code, reason, suggestion, checks }`). Unknown `code` values degrade to generic copy
rather than breaking.

For auth, a public widget can't hold a secret, so it'd want a publishable key scoped by `Origin` and
rate-limited per key, the way Stripe.js works. The GET route is already idempotent and cookie-free,
so a short edge cache absorbs most keystroke traffic before it reaches origin.

