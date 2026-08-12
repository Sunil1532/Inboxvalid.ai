# InboxValid — real-time email validation widget

Tvaram internship assignment, **Task 1**. MERN stack (React demo, Express + Node API, MongoDB-backed
cache with an in-memory fallback).

An embeddable widget that validates an email address as it is typed and blocks obviously invalid
addresses before submission — without ever making the signup form slower or less reliable than it was
without the widget.

---

## Run it

```bash
npm run install:all     # server, widget, demo
npm run build           # bundles the widget -> widget/dist
npm start               # API on :4000       (terminal 1)
npm run dev:demo        # React demo on :5173 (terminal 2)
npm test                # 36 tests
```

No MongoDB needed to run it. Set `MONGO_URL` to use Mongo; leave it blank and the same interface is
served from memory (see [Storage](#storage-why-mongo-is-optional)).

The script-tag embed is a static file: open `widget/example/index.html` after `npm run build`.

---

## What I built

| Piece | What it is |
|---|---|
| `shared/` | The validation rules. Plain ESM, no dependencies. **Imported by both the browser bundle and the Node server.** |
| `widget/` | The embeddable widget: state machine, transport, DOM UI, `<script>` auto-init. 6.8 kB gzipped, zero runtime dependencies. |
| `server/` | Express API: `/v1/validate`, `/v1/validate/batch`, `/health`. DNS/MX layer, disposable list, caching, rate limiting. |
| `demo/` | React signup form with a live trace panel showing which layer answered and how fast. |

Two ways to embed:

```html
<!-- 1. no build step -->
<script src="inboxvalid.min.js" data-iv-auto
        data-iv-endpoint="https://api.inboxvalid.ai/v1/validate"></script>
```

```js
// 2. programmatic
InboxValid.attach('#email', { endpoint, blockSubmit: 'hard', onChange: (s) => {} });
```

---

## The core design decision

**The browser and the server run the same validation code.**

`shared/` is imported directly by Node and inlined into the browser bundle by esbuild. The widget is
not a simplified client-side approximation that the server later contradicts — it is the same
functions with a smaller dataset. The only thing the server can do that the browser cannot is (a)
carry the full disposable-domain list and (b) resolve DNS.

That single decision is what makes the latency budget achievable, because it means **most addresses
never need the network at all.**

### The verdict vocabulary

Four verdicts, not two:

| Verdict | Meaning | Widget behaviour |
|---|---|---|
| `valid` | Deliverable as far as we can tell | green, submit allowed |
| `invalid` | Provably wrong | red, **submit blocked** |
| `risky` | Real, but you may not want it (disposable, role account) | amber, submit allowed |
| `unknown` | We could not finish checking | neutral, submit allowed |

A binary valid/invalid forces the system to lie about the large middle ground. `unknown` is the one
that matters most: it is how a dead API, a DNS timeout, or a rate limit gets represented, and it is
never a reason to block a signup.

---

## Validation logic

Checks run cheapest-first, and **the first failure ends the run** — a malformed address never costs a
DNS lookup.

```
1. syntax      browser + server   parsed, not regex-matched
2. typo        browser + server   Damerau-Levenshtein vs known providers
3. disposable  browser (top ~150) + server (full list)
4. role        browser + server   admin@, support@, info@ ...
5. MX          server only        DNS, cached
```

**Syntax** is parsed rather than matched against one large regex, because the field's job is to help
someone fix a mistake. Every failure carries a specific code and a sentence the user can act on —
`local_double_dot` → "Remove the double dot before the @" — instead of a generic "invalid email".

**Typo detection is ordered before disposable and role checks**, which is a product decision, not a
technical one. `Did you mean gmail.com?` is the most actionable thing we can say, so it outranks any
warning we could show about the wrong domain. It uses Damerau-Levenshtein rather than plain
Levenshtein because transposition is the dominant keyboard error: `gmial`→`gmail` is one swap, and
plain Levenshtein scores it the same as a genuinely different domain. TLD typos are handled
separately (`.con`→`.com`), which means they generalise to domains we have never seen —
`acmecorp.con` gets corrected without `acmecorp.com` being in any list.

**MX stops at DNS.** No SMTP `RCPT TO` probe, deliberately: it takes seconds rather than
milliseconds, so it cannot live in a keystroke path; Gmail and Outlook accept every recipient at
`RCPT` and bounce later, so the answer is often a lie; and it gets your IP blocklisted quickly. DNS
answers the question that is actually useful at signup: can mail for this domain be delivered at all.

Two details that stop us rejecting real people: **RFC 7505 null MX** (a single `.` record) is treated
as a real negative, while **no MX at all** falls back to the A record, because RFC 5321 says senders
do — plenty of small domains rely on exactly that.

---

## How I kept it fast

The target was under 200 ms *perceived*. The strategy is to make the common path have no network on
it at all, and to make the uncommon path invisible.

| Technique | Effect |
|---|---|
| **Local checks run synchronously in the input handler** | Typos, malformed addresses and known burner domains resolve in the same frame — ~0 ms, no request. |
| **Domain-level client cache** | The remote answer is a property of the *domain*. Once `gmail.com` is known, every other `@gmail.com` address is answered from memory. On a signup form the domain repeats constantly while the local part churns. |
| **Debounce (250 ms) measured from the last keystroke** | A typed burst produces exactly one request, not one per character. Verified in tests. |
| **Spinner delayed 120 ms** | Most answers arrive inside that window. Showing a spinner for 40 ms reads as a flicker — worse than showing nothing. |
| **`AbortController` on every new check** | A superseded request is cancelled. Its answer is stale and would flash an outdated verdict. |
| **Generation counter** | Even if a stale response lands, it is discarded rather than rendered. This is the bug that makes naive inline validation flicker. |
| **Immediate check on paste and blur** | Both are completed actions, so they skip the debounce entirely. |
| **Server-side: domain cache + singleflight** | Repeat domains never hit DNS. Concurrent misses on one domain collapse into a single lookup instead of a stampede. |
| **`GET` for the single-address route** | Idempotent, CDN-cacheable, and no CORS preflight on every burst. |

The trace panel in the demo shows the real measurement — keystroke to on-screen verdict — plus
whether the answer came from `local`, `cache` or `remote`.

### The UX rule that matters more than any of the above

**The widget shows nothing while the address is still being typed.**

`j` → `jo` → `john@` → `john@gmail.c` are not errors, they are someone mid-word. `isIncomplete()`
keeps the field neutral until the mistake can no longer be typed away, or until the field is blurred.
Inline validation gets a bad name almost entirely from tools that turn the box red on the first
character and only green on the last one.

---

## Failing open

The brief asks not to block on network errors. This is enforced in the widget, not left to the host
page:

- Network error, timeout, `4xx`, `5xx`, abort → `unknown`, never `invalid`.
- The submit guard blocks on `invalid` only. `unknown` and `risky` always pass.
- A remote `unknown` never downgrades a locally-proven `valid` (`mergeVerdicts`).
- The server returns `verdict: "unknown"` even on its own unhandled 500.
- `autoInit` wraps attachment in try/catch — a broken widget must never break the host page.

Four tests cover this directly, including *"submit is allowed when the API could not be reached"*.

---

## Storage (why Mongo is optional)

Two things need persistence: the disposable list (read-heavy, rarely written) and the MX cache
(write-heavy, expiring). Both sit behind one four-method interface, so the pipeline never learns which
implementation is running.

- **Mongo**: TTL index on `expiresAt` expires cache rows with no cron and no sweeper. Positive results
  live 24 h, negatives 1 h — a domain that just failed may be mid-propagation, and caching that for a
  day punishes real customers. A small in-process layer sits *in front* of Mongo so a hot domain
  doesn't pay even a 1 ms round trip.
- **Memory**: bounded LRU. 10 k domains costs a few MB and answers in nanoseconds.

The in-memory store is not a test stub, it is a supported deployment — it is the right shape for the
"efficient on low-cost hardware" case in the brief. Mongo earns its place when you run more than one
node and want them to share a warm cache and a mutable domain list. If `MONGO_URL` is set but
unreachable, the server logs and degrades to memory rather than refusing to boot.

---

## Assumptions

1. **Quoted local parts and IP-literal domains are rejected.** Both are legal per RFC 5322 and neither
   appears in real signups. Supporting them would roughly double the parser for zero users.
2. **No IDN/punycode conversion.** The widget must stay dependency-free; adding a punycode library for
   this is not worth the bytes. Unicode domains are accepted syntactically and left to DNS.
3. **The shipped disposable list is illustrative (~450 domains).** Production would ingest a maintained
   list (~120 k) into Mongo on a schedule; `server/src/data/disposable-tail.js` is the seam.
4. **Role accounts are `risky`, not `invalid`.** `support@company.com` is real and deliverable. Whether
   to accept it is a business rule, so the widget surfaces it and lets the host decide via `blockRisky`.
5. **Free-provider detection is reported, not judged.** `free: true` is returned for lead scoring;
   the widget does nothing with it.
6. **DNS is real, not mocked.** The brief allowed a mock backend, but `node:dns` costs nothing and
   makes the demo honest. The resolver is injected into the pipeline, so it is one line to swap.
7. **Rate limiting is per-instance.** Honest limits below.

---

## Trade-offs I made

**Vanilla core, React wrapper — not a React component.**
A React-only widget cannot be embedded on a WordPress signup form, and that is most of the market for
this product. So the core is framework-free and DOM-driven, and React integration is one 30-line hook
(`useInboxValid`) that attaches in `headless: true` mode and mirrors state into React. This also
avoids the classic failure of a vanilla library and React fighting over the same subtree. **Cost:** a
React-first user writes a hook instead of importing a component.

**Duplicated data, single source of code.**
The browser carries the head of the disposable distribution (~150 domains) and the server carries the
tail. This is deliberate duplication of *data* to avoid a network round trip on the common case, while
the *logic* has exactly one implementation. **Cost:** ~3 kB of the bundle, and the two lists can drift
if only one is updated.

**Fixed-window rate limiting, in process.**
Per-instance, so N instances allow N × max, and a boundary burst can pass 2× max. Both are acceptable
for abuse control on a public widget endpoint and neither justifies a Redis dependency yet. Swapping in
a shared counter means changing one function. **Cost:** not a real quota system.

**No SMTP verification.** Covered above — accuracy traded for latency, deliverability and honesty.

**`GET` with the address in the query string.**
Cheaper and CDN-cacheable, but it puts addresses in access logs. `POST` is accepted on the same route
for callers who care; production should log the domain only.

**Blocking submit in the capture phase.**
Guarantees we run before the host's own handler, which is the only way to reliably block. **Cost:** it
is intrusive, so it is configurable (`hard` / `soft` / `off`), and `soft` lets a user who insists
through on the second attempt.

---

## Tests

36 tests, no network, no Mongo, no browser (`npm test`).

**Server (23)** — syntax accepts what real people use (plus-addressing, apostrophes, multi-label TLDs)
and rejects with the *specific* code; typo correction fires on real mistakes and, critically, **does
not** "correct" `stripe.com` into a provider; a syntax failure never reaches DNS; DNS failure degrades
to `unknown` and is **not cached**; five concurrent misses on one domain collapse into one lookup.

**Widget (13, jsdom)** — silence while typing; a typed burst produces exactly one request; a typo costs
zero requests; a stale response cannot overwrite a fresh one; a dead API, a 429 and a timeout all leave
the address submittable; invalid blocks submit; risky does not; `destroy()` removes every listener.

---

## Wiring it to a real API

The widget already speaks the production shape. To point it at the real InboxValid backend:

1. **Change one attribute:** `data-iv-endpoint="https://api.inboxvalid.ai/v1/validate"`.
2. **Auth.** The current endpoint is unauthenticated. A public widget cannot hold a secret, so it
   should use a *publishable* key (`data-iv-key="pk_live_..."`) that the API scopes by `Origin` and
   rate-limits per key — the same model Stripe.js uses. Secret keys stay on the server-to-server
   routes.
3. **Keep the response contract.** `{ verdict, code, reason, suggestion, checks }`. As long as
   `verdict` is one of the four, unknown `code` values degrade gracefully — the widget falls back to
   generic copy rather than breaking.
4. **Put it behind a CDN.** The `GET` route is idempotent and already sets no cookies; a 60 s edge
   cache keyed on the query string absorbs most keystroke traffic before it reaches origin.

---

## What I'd do next

1. **Ingest job for the disposable list** — scheduled pull into Mongo, with the browser's head-of-list
   regenerated from the same source at build time so the two cannot drift.
2. **Shared rate limiting** (Redis or the gateway) to make the quota real across instances.
3. **Metrics** — verdict distribution, cache hit rate, p50/p95/p99 for DNS. The one number that matters
   is *false-invalid rate*: blocking a real customer is far more expensive than accepting a bad address,
   and right now I have no measurement of it.
4. **Bounce feedback loop** — feed real bounces back so `risky` becomes an evidence-based score rather
   than a list-membership check. That is the only way this becomes a moat rather than a regex.
5. **A/B the submit-blocking policy.** `hard` blocking is the brief's ask, but the honest question is
   whether it converts better than a warning. That is measurable and I would want the number.
6. **Shadow-mode SMTP probing** off the request path — a background worker that verifies a sample and
   reports how often DNS-only was wrong, without ever putting an SMTP round trip in front of a user.
