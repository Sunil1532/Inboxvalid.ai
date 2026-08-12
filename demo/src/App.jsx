import { useEffect, useRef, useState } from 'react';
import { useInboxValid } from './useInboxValid.js';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/v1/validate';

const SAMPLES = [
  { email: 'priya@gmial.com', note: 'typo, caught offline' },
  { email: 'priya@tvaram.com', note: 'real domain' },
  { email: 'priya@mailinator.com', note: 'disposable' },
  { email: 'support@tvaram.com', note: 'role account' },
  { email: 'priya@nosuchdomain-4821.com', note: 'domain does not exist' },
  { email: 'priya@@gmail.com', note: 'malformed' },
];


const CHECK_META = {
  syntax: { label: 'Syntax', where: 'browser' },
  typo: { label: 'Typo', where: 'browser' },
  disposable: { label: 'Disposable', where: 'browser + server' },
  role: { label: 'Role account', where: 'browser' },
  mx: { label: 'MX records', where: 'server · DNS' },
};

const CHECK_ORDER = ['syntax', 'typo', 'disposable', 'role', 'mx'];

const VERDICT_COPY = {
  empty: 'Waiting for input',
  typing: 'Too early to judge',
  checking: 'Checking',
  valid: 'Deliverable',
  invalid: 'Rejected',
  risky: 'Accepted with a warning',
  unknown: 'Could not verify',
};

export default function App() {
  const { inputRef, state, acceptSuggestion } = useInboxValid({ endpoint: API });
  const [submitted, setSubmitted] = useState(null);
  const [elapsed, setElapsed] = useState(null);
  const startedAt = useRef(null);

 
  useEffect(() => {
    if (state.state === 'typing' || state.state === 'empty') {
      setElapsed(null);
      return;
    }
    if (state.state === 'checking') return;
    if (startedAt.current != null) {
      setElapsed(Math.round(performance.now() - startedAt.current));
    }
  }, [state]);

  const markKeystroke = () => {
    startedAt.current = performance.now();
  };

  const fillSample = (email) => {
    const input = inputRef.current;
    if (!input) return;
    markKeystroke();
    input.value = email;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    setSubmitted(inputRef.current?.value ?? '');
  };

  const status = state.state;
  const showMessage = status !== 'empty' && status !== 'typing';

  return (
    <div className="page">
      <header className="masthead">
        <p className="eyebrow">
          <span className="dot" aria-hidden="true" />
          InboxValid.ai · real-time validation widget
        </p>
        <h1>
          Catch the typo <em>before</em><br />the welcome email bounces.
        </h1>
        <p className="lede">
          Most bad signups are not attacks, they are <span className="mark">gmial.com</span>. This widget
          answers from the browser first and only asks the network the one question it cannot answer
          alone — so the field reacts on the keystroke, not on the round trip.
        </p>
      </header>

      <main className="split">
        {/* ---------------- the product ---------------- */}
        <section className="card" aria-label="Demo signup form">
          <h2 className="card__title">Create your account</h2>

          <form onSubmit={handleSubmit} noValidate>
            <label className="field">
              <span className="field__label">Work email</span>
              <input
                ref={inputRef}
                type="email"
                name="email"
                autoComplete="email"
                placeholder="you@company.com"
                spellCheck="false"
                className={`input input--${status}`}
                onChange={markKeystroke}
              />
              <span className={`msg msg--${status}`} role="status" aria-live="polite">
                {showMessage && (
                  state.code === 'typo_suspected' && state.suggestion ? (
                    <>
                      Did you mean{' '}
                      <button type="button" className="suggest" onClick={acceptSuggestion}>
                        {state.suggestion.split('@').pop()}
                      </button>
                      ?
                    </>
                  ) : (
                    state.reason || (status === 'valid' ? 'Looks good.' : status === 'checking' ? 'Checking…' : '')
                  )
                )}
              </span>
            </label>

            <label className="field">
              <span className="field__label">Password</span>
              <input type="password" name="password" className="input" autoComplete="new-password" placeholder="••••••••" />
            </label>

            <button type="submit" className="submit">Create account</button>

            {submitted && (
              <p className="receipt">Submitted <strong>{submitted}</strong> — the form only got this far because the address passed.</p>
            )}
          </form>

          <div className="samples">
            <p className="samples__title">Try one</p>
            <div className="samples__row">
              {SAMPLES.map((sample) => (
                <button key={sample.email} type="button" className="chip" onClick={() => fillSample(sample.email)}>
                  <span className="chip__email">{sample.email}</span>
                  <span className="chip__note">{sample.note}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- the engineering ---------------- */}
        <section className="trace" aria-label="Validation trace">
          <div className="trace__bar">
            <span className="trace__title">validation trace</span>
            <span className={`badge badge--${status}`}>{VERDICT_COPY[status]}</span>
          </div>

          <pre className="trace__input">{state.email ? `› ${state.email}` : '› _'}</pre>

          <ol className="checks">
            {CHECK_ORDER.map((key) => {
              const outcome = state.checks?.[key];
              const meta = CHECK_META[key];
              return (
                <li key={key} className={`check check--${outcome || 'idle'}`}>
                  <span className="check__glyph" aria-hidden="true">
                    {outcome === 'pass' ? '✓' : outcome === 'fail' ? '✕' : outcome === 'skip' ? '~' : '·'}
                  </span>
                  <span className="check__name">{meta.label}</span>
                  <span className="check__where">{meta.where}</span>
                  <span className="check__outcome">{outcome || 'not reached'}</span>
                </li>
              );
            })}
          </ol>

          <div className="trace__foot">
            <div>
              <span className="trace__key">answered by</span>
              <span className="trace__value">{state.source || '—'}</span>
            </div>
            <div>
              <span className="trace__key">perceived</span>
              <span className="trace__value">{elapsed == null ? '—' : `${elapsed} ms`}</span>
            </div>
            <div>
              <span className="trace__key">code</span>
              <span className="trace__value">{state.code || '—'}</span>
            </div>
          </div>

          <p className="trace__hint">
            Checks stop at the first failure — nothing runs after a verdict is decided, which is why a
            malformed address never costs a DNS lookup.
          </p>
        </section>
      </main>
    </div>
  );
}
