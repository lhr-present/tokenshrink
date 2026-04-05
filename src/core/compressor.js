/**
 * @module core/compressor
 * 3-layer compression pipeline:
 *   Layer 1: Local rules (always free, instant)
 *   Layer 2: Groq free tier (llama-3.1-8b-instant)
 *   Layer 3: Anthropic Haiku (paid, highest quality)
 *
 * Layer selection: auto | local | groq | anthropic
 * Cache checked before any compression layer.
 * Never throws — always degrades gracefully to original text on failure.
 */

import { COMPRESSION_PROMPTS } from '../config/systemPrompts.js';
import { estimateSavings } from './tokenCounter.js';
import { localCompress } from './localCompressor.js';
import { getCached, setCached } from './compressionCache.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const GROQ_MODEL = 'llama-3.1-8b-instant';

// ─── Layer 3: Anthropic Haiku ─────────────────────────────────────────────────

async function callAnthropic(text, { apiKey, mode, timeoutMs }) {
  const systemPrompt = COMPRESSION_PROMPTS[mode] || COMPRESSION_PROMPTS.balanced;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: Math.min(4096, Math.max(64, text.length)),
        system: systemPrompt,
        messages: [{ role: 'user', content: text }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return { compressed: null, error: err?.error?.message || `Anthropic error ${response.status}` };
    }

    const data = await response.json();
    const raw = data?.content?.[0]?.text || '';
    return { compressed: stripFences(raw), error: null };
  } catch (err) {
    return { compressed: null, error: err.name === 'AbortError' ? 'Anthropic timeout' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Layer 2: Groq free tier ──────────────────────────────────────────────────

async function callGroq(text, { groqApiKey, mode, timeoutMs }) {
  const systemPrompt = COMPRESSION_PROMPTS[mode] || COMPRESSION_PROMPTS.balanced;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 5000));

  try {
    const response = await fetch(GROQ_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: Math.min(2048, Math.max(64, Math.ceil(text.length / 2))),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return { compressed: null, error: err?.error?.message || `Groq error ${response.status}` };
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    return { compressed: stripFences(raw), error: null };
  } catch (err) {
    return { compressed: null, error: err.name === 'AbortError' ? 'Groq timeout' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripFences(text) {
  return text.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '').trim();
}

function isBetter(original, compressed) {
  return compressed && compressed.length > 0 && compressed.length < original.length * 1.05;
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

/**
 * Compress text using the 3-layer pipeline.
 * @param {string} text
 * @param {{
 *   apiKey?: string,
 *   groqApiKey?: string,
 *   mode?: string,
 *   backend?: 'auto'|'local'|'groq'|'anthropic',
 *   timeoutMs?: number,
 *   localThreshold?: number,
 *   cacheEnabled?: boolean
 * }} options
 * @returns {Promise<{ compressed: string, stats: object, source: string, error?: string }>}
 */
export async function compress(text, {
  apiKey = '',
  groqApiKey = '',
  mode = 'balanced',
  backend = 'auto',
  timeoutMs = 8000,
  localThreshold = 20,
  cacheEnabled = true,
} = {}) {
  if (!text || text.trim().length === 0) {
    return { compressed: text, stats: null, source: 'none' };
  }

  // Cache check
  if (cacheEnabled) {
    try {
      const cached = await getCached(text, mode);
      if (cached) {
        return { ...cached, source: 'cache' };
      }
    } catch (_) { /* storage unavailable in some contexts */ }
  }

  // Layer 1: Local rules (always runs first)
  const localResult = localCompress(text);
  const localPct = localResult.stats?.pct || 0;

  // If local gives enough reduction, or backend is 'local', stop here
  if (backend === 'local' || (backend !== 'anthropic' && backend !== 'groq' && localPct >= localThreshold)) {
    const result = { compressed: localResult.compressed, stats: localResult.stats, source: 'local' };
    if (cacheEnabled) setCached(text, mode, result).catch(() => {});
    return result;
  }

  // Use local-compressed text as input to API layers (compound reduction)
  const apiInput = localResult.compressed || text;

  // Layer 2: Groq
  if ((backend === 'groq' || backend === 'auto') && groqApiKey) {
    const groqResult = await callGroq(apiInput, { groqApiKey, mode, timeoutMs });
    if (!groqResult.error && isBetter(text, groqResult.compressed)) {
      const stats = estimateSavings(text, groqResult.compressed);
      const result = { compressed: groqResult.compressed, stats, source: 'groq' };
      if (cacheEnabled) setCached(text, mode, result).catch(() => {});
      return result;
    }
    // Groq failed — fall through
  }

  // Layer 3: Anthropic Haiku
  if ((backend === 'anthropic' || backend === 'auto') && apiKey) {
    const anthropicResult = await callAnthropic(apiInput, { apiKey, mode, timeoutMs });
    if (!anthropicResult.error && isBetter(text, anthropicResult.compressed)) {
      const stats = estimateSavings(text, anthropicResult.compressed);
      const result = { compressed: anthropicResult.compressed, stats, source: 'anthropic' };
      if (cacheEnabled) setCached(text, mode, result).catch(() => {});
      return result;
    }
  }

  // Fallback: return local result (always safe)
  if (localResult.compressed && localResult.compressed !== text) {
    if (cacheEnabled) setCached(text, mode, { compressed: localResult.compressed, stats: localResult.stats }).catch(() => {});
    return { compressed: localResult.compressed, stats: localResult.stats, source: 'local' };
  }

  return { compressed: text, stats: estimateSavings(text, text), source: 'none' };
}
