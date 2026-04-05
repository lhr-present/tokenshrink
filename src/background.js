/**
 * @module background
 * MV3 service worker. Handles API calls, stats persistence, badge updates.
 * Imported modules must be ES modules — no DOM access.
 */

import { compress } from './core/compressor.js';

const BADGE_COLOR = '#00ff8c';

chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });

/**
 * Format a token count for the badge (e.g. 12400 → "12K")
 * @param {number} n
 * @returns {string}
 */
function formatBadge(n) {
  if (n >= 1000000) return `${Math.round(n / 100000) / 10}M`;
  if (n >= 1000) return `${Math.round(n / 100) / 10}K`;
  return String(n);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message.action) {
      case 'COMPRESS': {
        const settings = await getSettings();
        if (!settings.apiKey) {
          sendResponse({ success: false, error: 'No API key. Set it in extension options.' });
          return;
        }
        const result = await compress(message.text, {
          apiKey: settings.apiKey,
          mode: message.mode || settings.aggressiveness,
          timeoutMs: settings.timeoutMs,
        });
        sendResponse({
          success: !result.error,
          compressed: result.compressed,
          stats: result.stats,
          error: result.error,
        });
        break;
      }

      case 'GET_STATS': {
        const stats = await getStoredStats();
        sendResponse(stats);
        break;
      }

      case 'SAVE_STATS': {
        if (message.stats) {
          await mergeStats(message.stats);
        }
        sendResponse({ ok: true });
        break;
      }

      case 'GET_SETTINGS': {
        const s = await getSettings();
        sendResponse(s);
        break;
      }

      case 'SAVE_SETTINGS': {
        await saveSettings(message.settings);
        sendResponse({ ok: true });
        break;
      }

      case 'TEST_CONNECTION': {
        const settings = await getSettings();
        if (!settings.apiKey) {
          sendResponse({ ok: false, error: 'No API key' });
          return;
        }
        const start = Date.now();
        const result = await compress('Hello, please compress this short test message for me.', {
          apiKey: settings.apiKey,
          mode: 'balanced',
          timeoutMs: 10000,
        });
        const latencyMs = Date.now() - start;
        sendResponse({ ok: !result.error, latencyMs, error: result.error });
        break;
      }

      default:
        sendResponse({ error: `Unknown action: ${message.action}` });
    }
  })();
  return true; // Keep channel open for async response
});

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get('settings', (r) => {
      const defaults = {
        apiKey: '',
        enabled: true,
        aggressiveness: 'balanced',
        timeoutMs: 8000,
        showIndicator: true,
        showToast: true,
        platforms: ['claude.ai'],
      };
      resolve({ ...defaults, ...(r.settings || {}) });
    });
  });
}

async function saveSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.local.get('settings', (r) => {
      const merged = { ...(r.settings || {}), ...settings };
      chrome.storage.local.set({ settings: merged }, resolve);
    });
  });
}

async function getStoredStats() {
  return new Promise((resolve) => {
    chrome.storage.local.get('stats', (r) => {
      resolve(r.stats || { totalOriginalTokens: 0, totalCompressedTokens: 0, totalSaved: 0, compressionCount: 0 });
    });
  });
}

async function mergeStats(newStats) {
  return new Promise((resolve) => {
    chrome.storage.local.get('stats', (r) => {
      const existing = r.stats || { totalOriginalTokens: 0, totalCompressedTokens: 0, totalSaved: 0, compressionCount: 0 };
      const merged = {
        totalOriginalTokens: existing.totalOriginalTokens + (newStats.originalTokens || 0),
        totalCompressedTokens: existing.totalCompressedTokens + (newStats.compressedTokens || 0),
        totalSaved: existing.totalSaved + (newStats.saved || 0),
        compressionCount: existing.compressionCount + 1,
      };
      chrome.storage.local.set({ stats: merged }, () => {
        // Update badge
        chrome.action.setBadgeText({ text: formatBadge(merged.totalSaved) });
        resolve(merged);
      });
    });
  });
}
