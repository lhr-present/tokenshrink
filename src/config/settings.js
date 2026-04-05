/**
 * @module config/settings
 * Central configuration with defaults for TokenShrink extension.
 */

export const DEFAULT_SETTINGS = {
  apiKey: '',
  groqApiKey: '',
  enabled: true,
  aggressiveness: 'balanced',       // 'balanced' | 'extreme' | 'technical'
  backend: 'auto',                   // 'auto' | 'local' | 'groq' | 'anthropic'
  model: 'claude-haiku-4-5-20251001',
  timeoutMs: 8000,
  showIndicator: true,
  showToast: true,
  customSystemPrompt: '',
  platforms: ['claude.ai'],
  localThreshold: 20,               // % reduction before skipping API
  cacheEnabled: true,
};

/**
 * Load settings from chrome.storage.local, merging with defaults.
 * @returns {Promise<typeof DEFAULT_SETTINGS>}
 */
export async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get('settings', (result) => {
      resolve({ ...DEFAULT_SETTINGS, ...(result.settings || {}) });
    });
  });
}

/**
 * Save partial settings to chrome.storage.local.
 * @param {Partial<typeof DEFAULT_SETTINGS>} settings
 * @returns {Promise<void>}
 */
export async function saveSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.local.get('settings', (result) => {
      const merged = { ...DEFAULT_SETTINGS, ...(result.settings || {}), ...settings };
      chrome.storage.local.set({ settings: merged }, resolve);
    });
  });
}
