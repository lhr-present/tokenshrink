/**
 * @module core/tokenCounter
 * Offline token estimation using cl100k_base approximation.
 * No API call — instant, runs in content script.
 */

const CODE_BLOCK_RE = /```[\s\S]*?```|`[^`\n]+`/g;
const CJK_RE = /[\u3000-\u9fff\uf900-\ufaff\u3040-\u30ff]/g;
const NUMBER_RE = /\b\d+(?:\.\d+)?\b/g;

/**
 * Estimate token count for a string using region-aware heuristics.
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text || text.length === 0) return 0;

  let remaining = text;
  let totalTokens = 0;

  // Code blocks: ~3 chars/token
  const codeMatches = text.match(CODE_BLOCK_RE) || [];
  for (const block of codeMatches) {
    totalTokens += Math.ceil(block.length / 3);
    remaining = remaining.replace(block, '');
  }

  // CJK characters: ~1.5 chars/token (each char ≈ 0.67 tokens)
  const cjkMatches = remaining.match(CJK_RE) || [];
  totalTokens += Math.ceil(cjkMatches.length / 1.5);
  remaining = remaining.replace(CJK_RE, '');

  // Numbers: ~6 chars/token
  const numMatches = remaining.match(NUMBER_RE) || [];
  for (const num of numMatches) {
    totalTokens += Math.ceil(num.length / 6);
    remaining = remaining.replace(num, '');
  }

  // Remaining: standard ~4 chars/token
  totalTokens += Math.ceil(remaining.length / 4);

  return Math.max(1, totalTokens);
}

/**
 * Calculate savings between original and compressed text.
 * @param {string} original
 * @param {string} compressed
 * @returns {{ originalTokens: number, compressedTokens: number, saved: number, pct: number }}
 */
export function estimateSavings(original, compressed) {
  const originalTokens = estimateTokens(original);
  const compressedTokens = estimateTokens(compressed);
  const saved = originalTokens - compressedTokens;
  const pct = originalTokens > 0 ? Math.round((saved / originalTokens) * 100) : 0;
  return { originalTokens, compressedTokens, saved, pct };
}
