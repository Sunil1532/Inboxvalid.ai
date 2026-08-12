import { STATE } from './core.js';

/**
 * The visible half. Kept deliberately plain: this renders inside somebody
 * else's signup form, so it inherits their font and exposes every colour as a
 * CSS variable rather than imposing a look. The one thing it will not
 * compromise on is accessibility, because a validation message that only exists
 * visually is not a validation message.
 */

const STYLE_ID = 'inboxvalid-styles';

const CSS = `
.iv-field { position: relative; }

.iv-message {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 6px;
  font-size: var(--iv-font-size, 0.8125rem);
  line-height: 1.4;
  font-family: inherit;
  color: var(--iv-color-muted, #64748b);
  min-height: 1.15em;               /* reserve the line so nothing jumps */
}
.iv-message[hidden] { display: none; }

.iv-message--valid   { color: var(--iv-color-valid, #047857); }
.iv-message--invalid { color: var(--iv-color-invalid, #b91c1c); }
.iv-message--risky   { color: var(--iv-color-risky, #b45309); }
.iv-message--unknown { color: var(--iv-color-muted, #64748b); }

.iv-icon { flex: none; width: 1em; height: 1em; margin-top: 0.15em; }

.iv-suggest {
  appearance: none;
  background: none;
  border: 0;
  padding: 0;
  margin: 0;
  font: inherit;
  color: inherit;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.iv-suggest:hover { opacity: 0.75; }

/* Host inputs vary wildly, so we only touch the border colour and never the
   box model -- no layout shift when a state changes. */
.iv-input--valid   { border-color: var(--iv-color-valid, #047857) !important; }
.iv-input--invalid { border-color: var(--iv-color-invalid, #b91c1c) !important; }
.iv-input--risky   { border-color: var(--iv-color-risky, #b45309) !important; }

.iv-spinner {
  flex: none;
  width: 0.85em;
  height: 0.85em;
  margin-top: 0.2em;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: iv-spin 0.6s linear infinite;
}
@keyframes iv-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .iv-spinner { animation-duration: 2s; }
}
`;

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

const ICONS = {
  valid: '<svg class="iv-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M6.2 11.6 3 8.4l1.1-1.1 2.1 2.1 5.7-5.7L13 4.8z"/></svg>',
  invalid: '<svg class="iv-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1.5A6.5 6.5 0 1 0 8 14.5 6.5 6.5 0 0 0 8 1.5m.75 9.75h-1.5v-1.5h1.5zm0-2.75h-1.5v-4h1.5z"/></svg>',
  risky: '<svg class="iv-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1.7 15 14H1zm-.75 4.55v3.5h1.5v-3.5zm0 4.5v1.5h1.5v-1.5z"/></svg>',
};

/** Messages for states that have no server-supplied reason. */
const FALLBACK = {
  [STATE.VALID]: 'Looks good.',
  [STATE.CHECKING]: 'Checking\u2026',
  [STATE.UNKNOWN]: "Couldn't verify this right now \u2014 you can continue.",
};

export function attachUI(input, validator) {
  injectStyles();

  const message = document.createElement('p');
  message.className = 'iv-message';
  message.hidden = true;

  /**
   * polite, not assertive: this updates on a debounce while someone is typing,
   * and an assertive region would interrupt a screen reader mid-word on every
   * change.
   */
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  message.id = `iv-msg-${Math.random().toString(36).slice(2, 8)}`;

  input.insertAdjacentElement('afterend', message);
  // Ties the message to the field, so the reason is announced when the input
  // receives focus rather than only when it changes.
  input.setAttribute('aria-describedby',
    [input.getAttribute('aria-describedby'), message.id].filter(Boolean).join(' '));

  const unsubscribe = validator.on((state) => render(state));

  function render(state) {
    const { state: status, reason, suggestion, code } = state;

    input.classList.remove('iv-input--valid', 'iv-input--invalid', 'iv-input--risky');
    message.classList.remove(
      'iv-message--valid', 'iv-message--invalid', 'iv-message--risky', 'iv-message--unknown',
    );

    if (status === STATE.EMPTY || status === STATE.TYPING) {
      message.hidden = true;
      message.textContent = '';
      input.removeAttribute('aria-invalid');
      return;
    }

    message.hidden = false;

    if (status === STATE.CHECKING) {
      message.innerHTML = `<span class="iv-spinner"></span><span>${FALLBACK[STATE.CHECKING]}</span>`;
      return;
    }

    // aria-invalid ONLY for a real failure. Marking a risky-but-real address
    // invalid would tell assistive tech the field is broken when it is not.
    input.setAttribute('aria-invalid', status === STATE.INVALID ? 'true' : 'false');

    const text = reason || FALLBACK[status] || '';
    const icon = ICONS[status] || '';
    message.classList.add(`iv-message--${status}`);
    if (status !== STATE.UNKNOWN) input.classList.add(`iv-input--${status}`);

    // The suggestion is a button, not a sentence. Telling someone they made a
    // typo and making them retype it by hand is doing half a job.
    if (code === 'typo_suspected' && suggestion) {
      const domain = suggestion.split('@').pop();
      message.innerHTML = `${icon}<span>Did you mean <button type="button" class="iv-suggest">${escapeHtml(domain)}</button>?</span>`;
      message.querySelector('.iv-suggest').addEventListener('click', () => validator.accept(suggestion));
      return;
    }

    message.innerHTML = `${icon}<span>${escapeHtml(text)}</span>`;
  }

  return function destroyUI() {
    unsubscribe();
    message.remove();
    input.classList.remove('iv-input--valid', 'iv-input--invalid', 'iv-input--risky');
    input.removeAttribute('aria-invalid');
  };
}

/** Server text is ours, but it lands in innerHTML, so it gets escaped anyway. */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
