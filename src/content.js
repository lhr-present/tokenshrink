/**
 * @module content
 * Injects a floating ⚡ compress button inside a Shadow DOM container.
 *
 * Architecture (from deep-dive research):
 *   - Shadow DOM (Plasmo CSUI pattern): button lives in shadow root —
 *     no CSS bleed in or out, no event leakage to host page.
 *   - isEditable() (Vimium pattern): guarantees we never consume
 *     keyboard events meant for inputs or send buttons.
 *   - isTrusted gate (uBlock pattern): ignore synthetic events.
 *   - Cleanup registry (SponsorBlock pattern): all listeners torn down
 *     on SPA navigation.
 *   - NO stopPropagation on host-page events — shadow boundary handles it.
 */

import { getAdapter } from './adapters/index.js';
import { showToast } from './ui/toast.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const HOST_TAG = 'tokenshrink-root';
// Button position is set dynamically on the host element — no fixed coords in CSS
const BTN_CSS = `
  :host { all: initial; }
  #ts-btn {
    width: 32px;
    height: 32px;
    border-radius: 6px;
    border: 1px solid rgba(0,255,140,0.3);
    background: #111;
    color: #00ff8c;
    font-size: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: monospace;
    transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    padding: 0;
    line-height: 1;
  }
  #ts-btn:hover { background:#1a2a1a; border-color:#00ff8c; box-shadow:0 2px 12px rgba(0,255,140,0.2); }
  #ts-btn.compressing { cursor: wait; }
  #ts-btn.done { background: rgba(0,255,140,0.1); }
  .ts-spinner {
    display: inline-block;
    width: 12px; height: 12px;
    border: 2px solid #00ff8c;
    border-top-color: transparent;
    border-radius: 50%;
    animation: ts-spin 0.6s linear infinite;
  }
  @keyframes ts-spin { to { transform: rotate(360deg); } }
`;

// ── State ─────────────────────────────────────────────────────────────────────

let shadowHost      = null;   // <tokenshrink-root> in document.body
let shadowRoot      = null;   // The shadow root
let btn             = null;   // The ⚡ button inside shadow
let currentSettings = null;
let isCompressing   = false;
let cleanupFns      = [];     // SponsorBlock-style cleanup registry
let pollTimer       = null;
let observer        = null;
let lastPasteTime   = 0;      // Timestamp of most recent paste event

// ── isEditable (Vimium DomUtils pattern) ─────────────────────────────────────

/**
 * Returns true if the element is a text-input surface.
 * Vimium's unselectableTypes list — keyboard events here belong to typing, not shortcuts.
 */
function isEditable(el) {
  if (!el || !(el instanceof Element)) return false;
  const tag = el.nodeName.toLowerCase();
  const ce = el.getAttribute('contenteditable');
  if (ce === 'true' || ce === '' || el.isContentEditable) return true;
  if (tag === 'select' || tag === 'textarea') return true;
  if (tag === 'input') {
    const type = (el.type || 'text').toLowerCase();
    return !['button','checkbox','color','file','hidden','image','radio','reset','submit'].includes(type);
  }
  return false;
}

// ── Clipboard fallback (nuclear option) ──────────────────────────────────────

async function getTextFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    return text ? text.trim() : '';
  } catch (_) {
    return '';
  }
}

// ── Paste-aware text reader ───────────────────────────────────────────────────

/**
 * Polls adapter.getText() until content is non-empty or timeout.
 * Waits longer when a paste was detected recently — ProseMirror processes
 * paste asynchronously and DOM may lag by 200–800ms after a paste event.
 */
async function getTextWithRetry(adapter, ta) {
  const msSincePaste = Date.now() - lastPasteTime;
  const waitMs = msSincePaste < 1000 ? 800 : 300;
  const interval = 50;
  const maxTries = Math.ceil(waitMs / interval);
  let text = '';
  for (let i = 0; i < maxTries; i++) {
    text = adapter.getText(ta);
    if (text && text.trim().length >= 10) return text.trim();
    await new Promise((r) => setTimeout(r, interval));
  }
  return text.trim();
}

// ── Settings ──────────────────────────────────────────────────────────────────

function getSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'GET_SETTINGS' }, (r) => resolve(r || {}));
  });
}

// ── Shadow DOM creation (Plasmo CSUI pattern) ─────────────────────────────────

function createShadowButton() {
  if (document.querySelector(HOST_TAG)) return; // already mounted

  shadowHost = document.createElement(HOST_TAG);
  shadowHost.style.display = 'contents';
  shadowRoot = shadowHost.attachShadow({ mode: 'open' });

  // Inject scoped CSS — prepend so styles resolve before elements
  const style = document.createElement('style');
  style.textContent = BTN_CSS;
  shadowRoot.prepend(style);

  // Build the button inside shadow root
  btn = document.createElement('button');
  btn.id = 'ts-btn';
  btn.title = 'TokenShrink: compress prompt';
  btn.setAttribute('aria-label', 'Compress with TokenShrink');
  btn.setAttribute('type', 'button');
  btn.innerHTML = '⚡';

  // Click handler — no stopPropagation (shadow boundary handles isolation)
  btn.addEventListener('click', handleCompress);
  shadowRoot.appendChild(btn);

  document.body.appendChild(shadowHost);
  requestAnimationFrame(() => positionButton());
}

// ── Dynamic button positioning ────────────────────────────────────────────────

function positionButton() {
  if (!shadowHost) return;
  const adapter = getAdapter();
  const sendBtn = adapter?.getSendButton();
  if (sendBtn) {
    const rect = sendBtn.getBoundingClientRect();
    const top   = rect.top + (rect.height / 2) - 16;
    const right = window.innerWidth - rect.left + 6;
    shadowHost.style.cssText = `position:fixed;top:${top}px;right:${right}px;z-index:2147483645;display:block;`;
  } else {
    // Fallback: bottom-right corner
    shadowHost.style.cssText = `position:fixed;bottom:90px;right:72px;z-index:2147483645;display:block;`;
  }
}

function destroyShadowButton() {
  if (shadowHost && shadowHost.parentNode) {
    shadowHost.parentNode.removeChild(shadowHost);
  }
  shadowHost = null;
  shadowRoot = null;
  btn = null;
}

// ── Compress handler ──────────────────────────────────────────────────────────

async function handleCompress(e) {
  // isTrusted gate (uBlock pattern) — ignore synthetic events
  if (!e.isTrusted) return;
  if (isCompressing) return;

  const adapter = getAdapter();
  if (!adapter) return;
  const ta = adapter.getTextarea();
  if (!ta) return;

  // Wait for ProseMirror to settle (especially after paste — async transaction)
  isCompressing = true;
  btn.classList.add('compressing');
  btn.innerHTML = '<span class="ts-spinner"></span>';

  let text = await getTextWithRetry(adapter, ta);

  // Nuclear fallback: DOM strategies all returned empty — read clipboard directly
  // (covers cases where ProseMirror state is obfuscated and innerText lags)
  if (!text || text.length < 10) {
    console.log('[TokenShrink] DOM getText empty — trying clipboard fallback');
    text = await getTextFromClipboard();
  }

  if (!text || text.length < 10) {
    btn.innerHTML = '<span style="color:#ff6b6b;font-size:10px">empty</span>';
    setTimeout(() => { if (btn) btn.innerHTML = '⚡'; }, 1500);
    isCompressing = false;
    btn.classList.remove('compressing');
    return;
  }
  console.log('[TokenShrink] Read text (' + text.length + ' chars):', text.slice(0, 60) + (text.length > 60 ? '...' : ''));
  btn.classList.add('compressing');
  btn.innerHTML = '<span class="ts-spinner"></span>';

  try {
    const result = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'COMPRESS',
        text: text.trim(),
        mode: currentSettings?.aggressiveness || 'balanced',
      }, resolve);
    });

    if (result?.success && result.compressed && result.compressed !== text.trim()) {
      adapter.setText(ta, result.compressed);
      ta.focus();

      // Verify setText worked — wait for ProseMirror to process transaction
      await new Promise((r) => setTimeout(r, 100));
      const actualText = adapter.getText(ta);
      const setTextOk = actualText.trim() === result.compressed.trim();
      console.log('[TokenShrink] Compressed:', result.source, (result.stats?.pct || 0) + '% saved', setTextOk ? '✓ setText ok' : '✗ setText failed');
      if (!setTextOk) {
        console.warn('[TokenShrink] Expected:', result.compressed.slice(0, 80));
        console.warn('[TokenShrink] Got:     ', actualText.slice(0, 80));
      }

      if (currentSettings?.showToast !== false) {
        showToast({
          source: result.source || 'local',
          savedPct: result.stats?.pct || 0,
          savedTokens: result.stats?.saved || 0,
          // If setText failed, pass compressed text so user gets a Copy button
          compressedText: setTextOk ? undefined : result.compressed,
        });
      }

      if (result.stats) {
        chrome.runtime.sendMessage({ action: 'SAVE_STATS', stats: result.stats });
      }

      // Flash ✓
      btn.classList.remove('compressing');
      btn.classList.add('done');
      btn.innerHTML = '✓';
      setTimeout(() => {
        if (btn) { btn.innerHTML = '⚡'; btn.classList.remove('done'); }
      }, 1200);
    } else {
      btn.innerHTML = result?.error ? '<span style="color:#ff6b6b">⚡</span>' : '⚡';
      setTimeout(() => { if (btn) btn.innerHTML = '⚡'; }, 1000);
    }
  } catch (_) {
    if (btn) btn.innerHTML = '⚡';
  } finally {
    isCompressing = false;
    if (btn) btn.classList.remove('compressing');
  }
}

// ── Init / teardown ───────────────────────────────────────────────────────────

function teardown() {
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (observer)  { observer.disconnect(); observer = null; }
  destroyShadowButton();
}

async function init() {
  teardown(); // clean slate on every SPA navigation

  const adapter = getAdapter();
  if (!adapter) return;

  currentSettings = await getSettings();
  if (!currentSettings?.enabled) return;

  const host = window.location.hostname;
  const platformEnabled = currentSettings.platforms?.some((p) => host.includes(p));
  if (!platformEnabled) return;

  // Track paste timing — capture phase fires before ProseMirror processes it
  const pasteHandler = () => { lastPasteTime = Date.now(); };
  document.addEventListener('paste', pasteHandler, true);
  cleanupFns.push(() => document.removeEventListener('paste', pasteHandler, true));

  // Poll until adapter.isReady() — textarea visible in DOM
  pollTimer = setInterval(() => {
    if (adapter.isReady()) {
      clearInterval(pollTimer);
      pollTimer = null;
      createShadowButton();
    }
  }, 500);

  // MutationObserver: re-inject if shadow host disappears (SPA rebuild)
  // childList+subtree only — uBlock minimal observer config
  observer = new MutationObserver(() => {
    if (adapter.isReady() && !document.querySelector(HOST_TAG)) {
      createShadowButton();
    } else {
      positionButton(); // send button may have moved
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  cleanupFns.push(() => observer.disconnect());

  // ResizeObserver: reposition on layout changes (zoom, sidebar open/close)
  const ro = new ResizeObserver(() => positionButton());
  ro.observe(document.body);
  cleanupFns.push(() => ro.disconnect());
}

// ── SPA navigation (History API patch) ───────────────────────────────────────

const _push    = history.pushState.bind(history);
const _replace = history.replaceState.bind(history);
history.pushState    = (...args) => { _push(...args);    setTimeout(init, 800); };
history.replaceState = (...args) => { _replace(...args); setTimeout(init, 800); };
window.addEventListener('popstate', () => setTimeout(init, 800));

// ── Live settings updates ─────────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) {
    currentSettings = { ...currentSettings, ...(changes.settings.newValue || {}) };
    if (!currentSettings.enabled) destroyShadowButton();
    else if (!document.querySelector(HOST_TAG)) init();
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
