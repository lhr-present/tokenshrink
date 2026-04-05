/**
 * @module core/compressor
 * Calls Anthropic API (claude-haiku) to compress a prompt to minimum tokens.
 * Never throws — always degrades gracefully to original text on failure.
 */

import { COMPRESSION_PROMPTS } from '../config/systemPrompts.js';
import { estimateSavings } from './tokenCounter.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

/**
 * Compress text using Claude Haiku.
 * @param {string} text - The original prompt text
 * @param {{ apiKey: string, mode?: string, timeoutMs?: number }} options
 * @returns {Promise<{ compressed: string, stats: object|null, error?: string }>}
 */
export async function compress(text, { apiKey, mode = 'balanced', timeoutMs = 8000 }) {
  if (!text || text.trim().length === 0) {
    return { compressed: text, stats: null };
  }

  if (!apiKey) {
    return { compressed: text, stats: null, error: 'No API key configured' };
  }

  const systemPrompt = COMPRESSION_PROMPTS[mode] || COMPRESSION_PROMPTS.balanced;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: Math.min(4096, Math.max(64, text.length)),
        system: systemPrompt,
        messages: [{ role: 'user', content: text }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: { message: response.statusText } }));
      return {
        compressed: text,
        stats: null,
        error: err?.error?.message || `API error ${response.status}`,
      };
    }

    const data = await response.json();
    let compressed = data?.content?.[0]?.text || text;

    // Strip any markdown fences Claude might wrap output in
    compressed = compressed
      .replace(/^```[^\n]*\n?/, '')
      .replace(/\n?```$/, '')
      .trim();

    // Safety: if compression made it longer, return original
    if (compressed.length > text.length * 1.1) {
      compressed = text;
    }

    const stats = estimateSavings(text, compressed);
    return { compressed, stats };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { compressed: text, stats: null, error: 'Compression timed out' };
    }
    return { compressed: text, stats: null, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}
