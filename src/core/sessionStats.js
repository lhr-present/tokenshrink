/**
 * @module core/sessionStats
 * In-memory session stats tracker. Resets on tab close.
 * Tracks cumulative token savings across all compressions in this session.
 */

let stats = {
  totalOriginalTokens: 0,
  totalCompressedTokens: 0,
  totalSaved: 0,
  compressionCount: 0,
};

/**
 * Add a compression result to session stats.
 * @param {{ originalTokens: number, compressedTokens: number, saved: number }} savingsObj
 */
export function addSession(savingsObj) {
  if (!savingsObj) return;
  stats.totalOriginalTokens += savingsObj.originalTokens || 0;
  stats.totalCompressedTokens += savingsObj.compressedTokens || 0;
  stats.totalSaved += savingsObj.saved || 0;
  stats.compressionCount += 1;
}

/**
 * Get current session totals.
 * @returns {{ totalOriginalTokens, totalCompressedTokens, totalSaved, compressionCount, avgPct }}
 */
export function getTotal() {
  const avgPct =
    stats.totalOriginalTokens > 0
      ? Math.round((stats.totalSaved / stats.totalOriginalTokens) * 100)
      : 0;
  return { ...stats, avgPct };
}

/**
 * Reset session stats.
 */
export function reset() {
  stats = {
    totalOriginalTokens: 0,
    totalCompressedTokens: 0,
    totalSaved: 0,
    compressionCount: 0,
  };
}
