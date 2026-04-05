#!/usr/bin/env node
/**
 * TokenShrink CLI — compress a prompt using local rules, zero API calls.
 *
 * Usage:
 *   echo "your long prompt" | node compress.js
 *   node compress.js "your long prompt"
 *   node compress.js --quiet "your long prompt"   # output only, no stats
 *   node compress.js --stats "your long prompt"   # stats only, no text
 *   node compress.js --mode extreme "your text"   # balanced|extreme|technical
 *
 * Shell alias (add to ~/.bashrc or ~/.zshrc):
 *   alias ts='node ~/tokenshrink/bin/compress.js'
 *
 * Pipe into claude:
 *   echo "your verbose prompt" | node ~/tokenshrink/bin/compress.js --quiet | pbcopy
 *   # Then paste into claude terminal
 *
 * Or wrap claude (reads your prompt, compresses, passes to claude):
 *   tsc() { node ~/tokenshrink/bin/compress.js --quiet "$*" | cat; }
 */

import { localCompress } from '../src/core/localCompressor.js';

// ── CLI arg parsing ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let mode = 'balanced';
let quiet = false;    // suppress stats, output compressed text only
let statsOnly = false; // output stats only, no text
const textArgs = [];

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--quiet' || a === '-q') { quiet = true; continue; }
  if (a === '--stats' || a === '-s') { statsOnly = true; continue; }
  if ((a === '--mode' || a === '-m') && args[i + 1]) { mode = args[++i]; continue; }
  textArgs.push(a);
}

// ── Input: args or stdin ──────────────────────────────────────────────────────

async function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) { resolve(''); return; }
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

async function main() {
  let text = textArgs.join(' ');
  if (!text.trim()) {
    text = await readStdin();
  }
  text = text.trim();

  if (!text) {
    process.stderr.write('TokenShrink: no input. Pass text as argument or via stdin.\n');
    process.stderr.write('  echo "your prompt" | node compress.js\n');
    process.stderr.write('  node compress.js "your prompt"\n');
    process.exit(1);
  }

  if (text.length < 10) {
    if (!quiet) process.stderr.write('TokenShrink: input too short to compress.\n');
    process.stdout.write(text + '\n');
    return;
  }

  // ── Compress ─────────────────────────────────────────────────────────────────

  const result = localCompress(text, { mode });
  const compressed = result.compressed || text;
  const stats = result.stats || {};
  const saved = stats.saved || 0;
  const pct = stats.pct || 0;
  const domain = result.domain || 'general';
  const origTokens = stats.originalTokens || Math.ceil(text.length / 4);
  const compTokens = stats.compressedTokens || Math.ceil(compressed.length / 4);

  // ── Output ────────────────────────────────────────────────────────────────────

  if (statsOnly) {
    process.stdout.write(JSON.stringify({
      saved, pct, domain, mode,
      originalTokens: origTokens,
      compressedTokens: compTokens,
      originalLength: text.length,
      compressedLength: compressed.length,
    }, null, 2) + '\n');
    return;
  }

  if (quiet) {
    process.stdout.write(compressed + '\n');
    return;
  }

  // Default: compressed text + stats banner to stderr
  process.stderr.write(
    `\n─── TokenShrink ─────────────────────────────\n` +
    `  Mode:    ${mode}  |  Domain: ${domain}\n` +
    `  Tokens:  ${origTokens} → ${compTokens}  (saved ${saved}, ${pct}%)\n` +
    `  Chars:   ${text.length} → ${compressed.length}\n` +
    `─────────────────────────────────────────────\n\n`
  );
  process.stdout.write(compressed + '\n');
}

main().catch((err) => {
  process.stderr.write('TokenShrink error: ' + err.message + '\n');
  process.exit(1);
});
