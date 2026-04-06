/**
 * @module adapters/index
 * Adapter registry — auto-selects the correct platform adapter by hostname.
 */

import claudeAdapter from './claude.js';
import chatgptAdapter from './chatgpt.js';
import geminiAdapter from './gemini.js';
import perplexityAdapter from './perplexity.js';

const ADAPTERS = [claudeAdapter, chatgptAdapter, geminiAdapter, perplexityAdapter];

/**
 * Get the matching adapter for the current page.
 * @returns {object|null} Adapter object or null if no match.
 */
export function getAdapter() {
  const host = window.location.hostname;
  return ADAPTERS.find((a) => a.hostMatch(host)) || null;
}

export { claudeAdapter, chatgptAdapter, geminiAdapter, perplexityAdapter };
export default ADAPTERS;
