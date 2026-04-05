/**
 * @module background
 * MV3 service worker. Handles API calls, stats persistence, badge updates.
 * Imported modules must be ES modules — no DOM access.
 */

import { compress } from './core/compressor.js';
import { RequestQueue } from './core/requestQueue.js';
import { getCacheStats } from './core/compressionCache.js';

const queue = new RequestQueue({ concurrency: 1, debounceMs: 80 });

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
        // Local backend needs no API key — always allow
        const needsKey = settings.backend === 'anthropic';
        if (needsKey && !settings.apiKey) {
          sendResponse({ success: false, error: 'No Anthropic API key. Set it in extension options.' });
          return;
        }
        const taskKey = `compress:${message.text.slice(0, 40)}`;
        let result;
        try {
          result = await queue.enqueue(taskKey, () => compress(message.text, {
            apiKey: settings.apiKey || '',
            groqApiKey: settings.groqApiKey || '',
            mode: message.mode || settings.aggressiveness,
            backend: settings.backend || 'auto',
            timeoutMs: settings.timeoutMs || 8000,
            localThreshold: settings.localThreshold ?? 20,
            cacheEnabled: settings.cacheEnabled !== false,
          }));
        } catch (err) {
          if (err.message === 'debounced' || err.message === 'cleared') {
            sendResponse({ success: false, error: 'debounced', compressed: message.text });
            return;
          }
          sendResponse({ success: false, error: err.message, compressed: message.text });
          return;
        }
        // Save last compression event for popup live badge
        if (result.source && result.source !== 'none') {
          chrome.storage.local.set({
            lastCompression: {
              source: result.source,
              stats: result.stats,
              domain: result.domain,
              savedPct: result.stats ? result.stats.pct : 0,
              ts: Date.now(),
            },
          });
        }
        sendResponse({
          success: !result.error && result.source !== 'none',
          compressed: result.compressed,
          stats: result.stats,
          source: result.source,
          domain: result.domain,
          error: result.error,
        });
        break;
      }

      case 'GET_STATS': {
        const stats = await getStoredStats();
        try {
          const cs = await getCacheStats();
          sendResponse({ ...stats, cacheEntries: cs.count });
        } catch (_) {
          sendResponse(stats);
        }
        break;
      }

      case 'GET_QUEUE_STATUS': {
        sendResponse({ pending: queue.pendingCount, running: queue.isRunning });
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
        const testBackend = message.backend || settings.backend || 'auto';
        const needsApiKey = testBackend === 'anthropic' || (testBackend === 'auto' && !settings.groqApiKey);
        if (needsApiKey && !settings.apiKey) {
          sendResponse({ ok: false, error: 'No API key configured for selected backend' });
          return;
        }
        const start = Date.now();
        const result = await compress('Hello, please compress this short test message for me.', {
          apiKey: settings.apiKey || '',
          groqApiKey: settings.groqApiKey || '',
          mode: 'balanced',
          backend: testBackend,
          timeoutMs: 10000,
          cacheEnabled: false,
        });
        const latencyMs = Date.now() - start;
        sendResponse({ ok: result.source !== 'none', latencyMs, source: result.source, error: result.error });
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
        groqApiKey: '',
        enabled: true,
        aggressiveness: 'balanced',
        backend: 'auto',
        timeoutMs: 8000,
        showIndicator: true,
        showToast: true,
        platforms: ['claude.ai'],
        localThreshold: 20,
        cacheEnabled: true,
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
