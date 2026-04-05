/**
 * @module content
 * Injects a floating ⚡ compress button next to claude.ai's send button.
 * No send interception — user compresses then sends manually.
 * Resilient to SPA navigation via MutationObserver.
 */

import { getAdapter } from './adapters/index.js';
import { showToast } from './ui/toast.js';

const BTN_ID = 'tokenshrink-btn';
let currentSettings = null;
let isCompressing = false;

function getSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'GET_SETTINGS' }, (r) => {
      resolve(r || {});
    });
  });
}

function removeButton() {
  document.getElementById(BTN_ID)?.remove();
}

function injectButton(adapter) {
  if (document.getElementById(BTN_ID)) return;

  const btn = document.createElement('button');
  btn.id = BTN_ID;
  btn.title = 'TokenShrink: compress prompt';
  btn.innerHTML = '⚡';
  btn.setAttribute('aria-label', 'Compress with TokenShrink');
  btn.setAttribute('type', 'button');

  Object.assign(btn.style, {
    position: 'fixed',
    bottom: '82px',
    right: '68px',
    zIndex: '2147483645',
    width: '32px',
    height: '32px',
    borderRadius: '6px',
    border: '1px solid rgba(0,255,140,0.3)',
    background: '#111',
    color: '#00ff8c',
    fontSize: '16px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'monospace',
    transition: 'all 0.15s',
    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
    padding: '0',
    lineHeight: '1',
  });

  btn.addEventListener('mouseenter', () => {
    if (!isCompressing) {
      btn.style.background = '#1a2a1a';
      btn.style.borderColor = '#00ff8c';
      btn.style.boxShadow = '0 2px 12px rgba(0,255,140,0.2)';
    }
  });

  btn.addEventListener('mouseleave', () => {
    if (!isCompressing) {
      btn.style.background = '#111';
      btn.style.borderColor = 'rgba(0,255,140,0.3)';
      btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.4)';
    }
  });

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isCompressing) return;

    const ta = adapter.getTextarea();
    if (!ta) return;

    const text = adapter.getText(ta);
    if (!text || text.trim().length < 10) return;

    // Visual: compressing state
    isCompressing = true;
    btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid #00ff8c;border-top-color:transparent;border-radius:50%;animation:ts-spin2 0.6s linear infinite"></span>';
    btn.style.cursor = 'wait';

    // Inject keyframe if not present
    if (!document.getElementById('ts-spin-style')) {
      const style = document.createElement('style');
      style.id = 'ts-spin-style';
      style.textContent = '@keyframes ts-spin2{to{transform:rotate(360deg)}}';
      document.head.appendChild(style);
    }

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

        if (currentSettings?.showToast && result.stats?.saved > 0) {
          showToast({
            source: result.source || 'local',
            savedPct: result.stats.pct || 0,
            savedTokens: result.stats.saved || 0,
          });
        }

        if (result.stats) {
          chrome.runtime.sendMessage({ action: 'SAVE_STATS', stats: result.stats });
        }

        // Flash green ✓
        btn.innerHTML = '✓';
        btn.style.color = '#00ff8c';
        btn.style.background = 'rgba(0,255,140,0.1)';
        setTimeout(() => {
          btn.innerHTML = '⚡';
          btn.style.color = '#00ff8c';
          btn.style.background = '#111';
        }, 1200);
      } else {
        btn.innerHTML = '⚡';
        btn.style.color = result?.error ? '#ff6b6b' : '#00ff8c';
        setTimeout(() => { btn.style.color = '#00ff8c'; }, 1000);
      }
    } catch (err) {
      btn.innerHTML = '⚡';
    } finally {
      isCompressing = false;
      btn.style.cursor = 'pointer';
    }
  });

  document.body.appendChild(btn);
}

async function init() {
  const adapter = getAdapter();
  if (!adapter) return;

  currentSettings = await getSettings();
  if (!currentSettings?.enabled) return;

  const host = window.location.hostname;
  const platformEnabled = currentSettings.platforms?.some(p => host.includes(p));
  if (!platformEnabled) return;

  // Poll until textarea is ready
  const poll = setInterval(() => {
    if (adapter.isReady()) {
      clearInterval(poll);
      injectButton(adapter);
    }
  }, 500);

  // Watch for DOM changes (SPA navigation rebuilds)
  const observer = new MutationObserver(() => {
    if (adapter.isReady() && !document.getElementById(BTN_ID)) {
      injectButton(adapter);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// Re-init on SPA navigation
const _push = history.pushState.bind(history);
const _replace = history.replaceState.bind(history);
history.pushState = (...args) => { _push(...args); setTimeout(init, 800); };
history.replaceState = (...args) => { _replace(...args); setTimeout(init, 800); };
window.addEventListener('popstate', () => setTimeout(init, 800));

// Live settings updates
chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) {
    currentSettings = { ...currentSettings, ...(changes.settings.newValue || {}) };
    if (!currentSettings.enabled) removeButton();
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
