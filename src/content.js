/**
 * @module content
 * Entry point injected into supported pages.
 * Initializes the interceptor after the platform adapter is ready.
 * Handles SPA navigation via History API patch.
 * Listens for compression events to show the toast notification.
 */

import { getAdapter } from './adapters/index.js';
import { Interceptor } from './core/interceptor.js';
import { showToast } from './ui/toast.js';

let interceptor = null;
let currentAdapter = null;
let pollTimer = null;
let currentSettings = null;

function getSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'GET_SETTINGS' }, resolve);
  });
}

async function init() {
  const adapter = getAdapter();
  if (!adapter) return;
  currentAdapter = adapter;

  const settings = await getSettings();
  if (!settings) return;
  currentSettings = settings;

  const host = window.location.hostname;
  const platformEnabled = settings.enabled && settings.platforms.some((p) => host.includes(p));

  if (interceptor) {
    interceptor.uninstall();
    interceptor = null;
  }

  if (!platformEnabled) return;

  // Poll until adapter is ready
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (adapter.isReady()) {
      clearInterval(pollTimer);
      pollTimer = null;
      interceptor = new Interceptor(adapter, settings);
      interceptor.install();
    }
  }, 500);
}

// Listen for compression events dispatched by the interceptor
window.addEventListener('tokenshrink:compressed', (e) => {
  if (!currentSettings?.showToast) return;
  const { source, stats } = e.detail || {};
  if (stats && stats.saved > 0) {
    showToast({
      source: source || 'local',
      savedPct: stats.pct || 0,
      savedTokens: stats.saved || 0,
    });
  }
});

// Patch History API to detect SPA navigation
const _pushState = history.pushState.bind(history);
const _replaceState = history.replaceState.bind(history);

history.pushState = (...args) => {
  _pushState(...args);
  setTimeout(init, 300);
};
history.replaceState = (...args) => {
  _replaceState(...args);
  setTimeout(init, 300);
};

window.addEventListener('popstate', () => setTimeout(init, 300));

// React to settings changes in real time
chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) init();
});

// Initial boot
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
