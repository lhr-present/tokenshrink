/**
 * @module core/compressionCache
 * SHA-256-keyed LRU compression cache backed by chrome.storage.local.
 * Avoids redundant API calls for identical prompts.
 * Max 500 entries; evicts oldest when full.
 */

const CACHE_PREFIX = 'cache:';
const MAX_ENTRIES = 500;
const INDEX_KEY = 'cache_index'; // Ordered list of keys for LRU eviction

/**
 * Compute a stable cache key: SHA-256 of (text + "|" + mode).
 * Uses SubtleCrypto — available in both content scripts and service workers.
 * @param {string} text
 * @param {string} mode
 * @returns {Promise<string>} hex digest
 */
async function cacheKey(text, mode) {
  const data = new TextEncoder().encode(`${text}|${mode}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Load the LRU index from storage.
 * @returns {Promise<string[]>}
 */
function loadIndex() {
  return new Promise((resolve) => {
    chrome.storage.local.get(INDEX_KEY, (r) => resolve(r[INDEX_KEY] || []));
  });
}

/**
 * Save the LRU index to storage.
 * @param {string[]} index
 * @returns {Promise<void>}
 */
function saveIndex(index) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [INDEX_KEY]: index }, resolve);
  });
}

/**
 * Retrieve a cached compression result.
 * @param {string} text
 * @param {string} mode
 * @returns {Promise<{ compressed: string, stats: object }|null>}
 */
export async function getCached(text, mode) {
  const key = await cacheKey(text, mode);
  return new Promise((resolve) => {
    chrome.storage.local.get(CACHE_PREFIX + key, (r) => {
      const entry = r[CACHE_PREFIX + key];
      if (!entry) return resolve(null);
      // Promote to most-recently-used
      loadIndex().then((index) => {
        const filtered = index.filter((k) => k !== key);
        filtered.push(key);
        saveIndex(filtered);
      });
      resolve({ compressed: entry.compressed, stats: entry.stats });
    });
  });
}

/**
 * Store a compression result in the cache.
 * @param {string} text
 * @param {string} mode
 * @param {{ compressed: string, stats: object }} result
 * @returns {Promise<void>}
 */
export async function setCached(text, mode, result) {
  const key = await cacheKey(text, mode);
  const index = await loadIndex();

  // Evict oldest entries if at capacity
  let evictions = [];
  while (index.length >= MAX_ENTRIES) {
    const oldest = index.shift();
    evictions.push(CACHE_PREFIX + oldest);
  }

  index.push(key);

  return new Promise((resolve) => {
    const toRemove = evictions;
    const toSet = {
      [CACHE_PREFIX + key]: { compressed: result.compressed, stats: result.stats, ts: Date.now() },
      [INDEX_KEY]: index,
    };

    if (toRemove.length > 0) {
      chrome.storage.local.remove(toRemove, () => {
        chrome.storage.local.set(toSet, resolve);
      });
    } else {
      chrome.storage.local.set(toSet, resolve);
    }
  });
}

/**
 * Clear the entire compression cache.
 * @returns {Promise<void>}
 */
export async function clearCache() {
  const index = await loadIndex();
  const keys = [INDEX_KEY, ...index.map((k) => CACHE_PREFIX + k)];
  return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
}

/**
 * Return lightweight stats about the current cache state.
 * @returns {Promise<{ count: number, newestTs: number }>}
 */
export async function getCacheStats() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (items) => {
      const keys = Object.keys(items || {}).filter((k) => k.startsWith(CACHE_PREFIX));
      const entries = keys.map((k) => items[k]).filter(Boolean);
      resolve({
        count: keys.length,
        newestTs: entries.length > 0 ? Math.max(...entries.map((e) => e.ts || 0)) : 0,
      });
    });
  });
}
