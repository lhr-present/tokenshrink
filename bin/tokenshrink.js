#!/usr/bin/env node
/**
 * TokenShrink CLI — compress prompts to minimum tokens. Zero API calls. Zero cost.
 *
 * Install:  npm install -g tokenshrink
 * Usage:    tokenshrink "your verbose prompt here"
 *           echo "your prompt" | tokenshrink
 *           tokenshrink --mode extreme "your prompt"
 *           tokenshrink --quiet "your prompt"   # compressed text only — pipe-friendly
 *           tokenshrink --stats "your prompt"   # JSON stats only
 *
 * Modes:    balanced (default) — natural language, 30-50% reduction
 *           extreme            — telegram style, 50-70% reduction
 *           technical          — preserves all code/variable names, ~25% reduction
 */

// ── Load canonical engine (dist/core.cjs) or fall back to inline rules ───────

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const _require = createRequire(import.meta.url);

let _canonicalCompress = null;
try {
  const mod = _require(join(__dirname, '../dist/core.cjs'));
  _canonicalCompress = (text, mode) => {
    const r = mod.localCompress(text, { mode });
    return {
      compressed: r.compressed,
      origTokens: r.stats?.originalTokens ?? Math.ceil((text || '').length / 4),
      compTokens: r.stats?.compressedTokens ?? Math.ceil((r.compressed || '').length / 4),
      saved: r.stats?.saved ?? 0,
      pct:   r.stats?.pct   ?? 0,
      domain: r.domain ?? 'general',
    };
  };
} catch (_) {
  // dist/core.cjs not present (npx use — no build step). Inline fallback below.
}

// ── Inline compressor fallback (npx / npm install -g without build) ──────────

const PROTECTED_PATTERNS = [
  /```[\s\S]*?```/g,
  /`[^`\n]+`/g,
  /https?:\/\/\S+/g,
  /"(?:[^"\\]|\\.)*"/g,
];

function maskProtected(text) {
  const regions = [];
  let masked = text;
  for (const pattern of PROTECTED_PATTERNS) {
    pattern.lastIndex = 0;
    masked = masked.replace(pattern, (match) => {
      const idx = regions.length;
      regions.push(match);
      return `\x00P${idx}\x00`;
    });
  }
  return { masked, regions };
}

function unmask(masked, regions) {
  return masked.replace(/\x00P(\d+)\x00/g, (_, i) => regions[+i]);
}

const FILLER_LIST = [
  'I would like to', "I'd like to", 'Could you please', 'Can you please',
  'I was wondering if you could', 'I am wondering', 'Would you be able to',
  'I need you to', 'I want you to', 'Please help me to', 'Please help me',
  'I am looking for', "I'm looking for", 'I need help with',
  'As an AI', 'As a language model', 'I understand that',
  'It would be great if', 'It would be helpful if', 'Feel free to',
  'I hope this makes sense', 'Let me know if', 'Thanks in advance',
  'Thank you in advance', 'I appreciate your help', 'I appreciate it',
  'I just wanted to', 'I was just wondering', "I'm just trying to",
  'I simply want to', "If you don't mind", "If it's not too much trouble",
  'When you get a chance', 'Whenever you have time', "I hope you don't mind",
  'Sorry to bother you', 'Sorry for the trouble', 'Thank you for your time',
  'Thank you for your consideration', 'I would be very grateful',
  "I'd really appreciate it", 'That would be great', 'That would be wonderful',
  'I am writing to ask about', 'I am writing to',
  'I was hoping you could', 'I would appreciate if',
  'Do you think you could', 'Would it be possible for you to',
  'I am reaching out to',
];

const _esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const FILLER_RE = new RegExp(FILLER_LIST.sort((a, b) => b.length - a.length).map(_esc).join('|'), 'gi');

const HEDGE_LIST = [
  'sort of', 'kind of', 'a little bit', 'a bit', 'somewhat', 'rather',
  'fairly', 'pretty much', 'more or less', 'in a way', 'to some extent',
  'generally speaking', 'for the most part',
];
const HEDGE_RE = new RegExp(HEDGE_LIST.sort((a, b) => b.length - a.length).map(_esc).join('|'), 'gi');

const VERBOSE_RULES = [
  [/\bmake a decision\b/gi, 'decide'],
  [/\bmake an assumption\b/gi, 'assume'],
  [/\bmake a recommendation\b/gi, 'recommend'],
  [/\bmake a suggestion\b/gi, 'suggest'],
  [/\bmake an attempt\b/gi, 'try'],
  [/\bmake an effort\b/gi, 'try'],
  [/\bgive consideration to\b/gi, 'consider'],
  [/\btake into account\b/gi, 'account for'],
  [/\btake into consideration\b/gi, 'consider'],
  [/\btake advantage of\b/gi, 'use'],
  [/\bcome to a conclusion\b/gi, 'conclude'],
  [/\bcome to an agreement\b/gi, 'agree'],
  [/\bprovide an explanation of\b/gi, 'explain'],
  [/\bprovide information about\b/gi, 'explain'],
  [/\bperform an analysis of\b/gi, 'analyze'],
  [/\bconduct a review of\b/gi, 'review'],
  [/\bcarry out\b/gi, 'do'],
  [/\bis being\b/gi, 'is'],
  [/\bwas being\b/gi, 'was'],
  [/\bhas been\b/gi, 'has'],
  [/\bhave been\b/gi, 'have'],
  [/\bhad been\b/gi, 'had'],
  [/\bhave the ability to\b/gi, 'can'],
  [/\bare able to\b/gi, 'can'],
  [/\bis able to\b/gi, 'can'],
  [/\bwere able to\b/gi, 'could'],
  [/\bit is important to note that\b/gi, 'note:'],
  [/\bit is worth noting that\b/gi, 'note:'],
  [/\bit should be noted that\b/gi, 'note:'],
  [/\bplease note that\b/gi, 'note:'],
  [/\bit is necessary to\b/gi, 'must'],
  [/\bit is essential that\b/gi, 'must'],
  [/\bit is recommended that\b/gi, 'should'],
  [/\bthe fact that\b/gi, 'that'],
  [/\bin terms of\b/gi, 'for'],
  [/\bon the basis of\b/gi, 'based on'],
  [/\bfor the reason that\b/gi, 'because'],
  [/\bas a result of\b/gi, 'due to'],
  [/\bin the near future\b/gi, 'soon'],
  [/\bin the long run\b/gi, 'long-term'],
  [/\bon a daily basis\b/gi, 'daily'],
  [/\bon a regular basis\b/gi, 'regularly'],
  [/\bat this point in time\b/gi, 'now'],
  [/\bat the present time\b/gi, 'now'],
  [/\bat the current time\b/gi, 'now'],
  [/\bon the other hand\b/gi, 'however'],
  [/\bin addition to\b/gi, 'plus'],
  [/\bas well as\b/gi, 'and'],
  [/\beach and every\b/gi, 'every'],
  [/\bfirst and foremost\b/gi, 'first'],
  [/\bin order to\b/gi, 'to'],
  [/\bdue to the fact that\b/gi, 'because'],
  [/\bin the event that\b/gi, 'if'],
  [/\bfor the purpose of\b/gi, 'for'],
  [/\bwith regard to\b/gi, 're:'],
  [/\bwith respect to\b/gi, 're:'],
  [/\ba large number of\b/gi, 'many'],
  [/\bthe majority of\b/gi, 'most'],
  [/\bin close proximity to\b/gi, 'near'],
  [/\bprior to\b/gi, 'before'],
  [/\bsubsequent to\b/gi, 'after'],
  [/\bmake use of\b/gi, 'use'],
];

const TURKISH_DETECT_RE = /[şğüöıçŞĞÜÖİÇ]|(?:acaba|lütfen|hakkında|nasıl|nedir|misiniz|mısınız)\b/i;
const TURKISH_RULES = [
  [/^lütfen\s+/i, ''],
  [/\s+lütfen\b/gi, ''],
  [/^acaba\s+/i, ''],
  [/\bşunu söyleyebilir misiniz\b/gi, 'söyleyin:'],
  [/\bbana yardımcı olabilir misiniz\b/gi, 'yardım edin:'],
  [/\bhakkında bilgi verebilir misiniz\b/gi, 'açıklayın:'],
  [/\bmerak ediyorum\b/gi, ''],
  [/\bsize şunu sormak istiyorum[:,]?\s*/gi, ''],
  [/\baslında\s+/gi, ''],
];

const CODE_SIGNALS_RE = /```|`[^`]+`|\b(function|class|import|export|const|let|var|def|return|async|await|npm|git|bash|python|javascript|typescript|sql)\b/i;
const ACADEMIC_RE = /\b(hypothesis|methodology|empirical|theoretical|literature|paradigm|quantitative|qualitative)\b/i;

function detectDomain(text) {
  if (CODE_SIGNALS_RE.test(text)) return 'code';
  if (ACADEMIC_RE.test(text)) return 'academic';
  return 'general';
}

function estimateTokens(text) {
  if (!text) return 0;
  const codeBlocks = (text.match(/```[\s\S]*?```|`[^`\n]+`/g) || []);
  let tokens = 0;
  let remaining = text;
  for (const block of codeBlocks) {
    tokens += Math.ceil(block.length / 3);
    remaining = remaining.replace(block, '');
  }
  tokens += Math.ceil(remaining.length / 4);
  return Math.max(1, tokens);
}

function compress(text, mode = 'balanced') {
  // Use canonical engine when available (install.sh builds dist/core.cjs)
  if (_canonicalCompress) return _canonicalCompress(text, mode);

  if (!text || text.trim().length < 10) return { compressed: text, origTokens: 0, compTokens: 0, saved: 0, pct: 0, domain: 'general' };

  const domain = detectDomain(text);
  const isTurkish = TURKISH_DETECT_RE.test(text);
  const origTokens = estimateTokens(text);
  const { masked, regions } = maskProtected(text);
  let out = masked;

  // Skip aggressive rules for technical/code mode — only filler removal
  if (mode !== 'technical') {
    out = out.replace(FILLER_RE, '');
    out = out.replace(HEDGE_RE, '');
    for (const [re, rep] of VERBOSE_RULES) { re.lastIndex = 0; out = out.replace(re, rep); }
    if (isTurkish) {
      for (const [re, rep] of TURKISH_RULES) { re.lastIndex = 0; out = out.replace(re, rep); }
    }
  } else {
    out = out.replace(FILLER_RE, '');
  }

  if (mode === 'extreme') {
    out = out.replace(/\b(please|kindly)\b\s*/gi, '');
    out = out.replace(/\b(very|quite|rather|somewhat|fairly|pretty)\b\s+/gi, '');
  }

  // Cleanup
  out = out.replace(/\b(\w[\w]*:?)\s+\1(?=\s|$)/gi, '$1');
  out = out.replace(/(^|[.!?]\s+)([a-z])/g, (_, p, c) => p + c.toUpperCase());
  out = out.replace(/^(and |but |or |so |me to |to (?=\w))+/i, '');
  out = out.replace(/^([a-z])/, (c) => c.toUpperCase());
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/ +([,.;:!?])/g, '$1').trim();

  out = unmask(out, regions);

  const compTokens = estimateTokens(out);
  const saved = Math.max(0, origTokens - compTokens);
  const pct = origTokens > 0 ? Math.round((saved / origTokens) * 100) : 0;

  return { compressed: out, origTokens, compTokens, saved, pct, domain };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let mode = 'balanced';
let quiet = false;
let statsOnly = false;
const textArgs = [];

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--quiet' || a === '-q') { quiet = true; continue; }
  if (a === '--stats' || a === '-s') { statsOnly = true; continue; }
  if (a === '--help' || a === '-h') {
    process.stdout.write([
      '',
      '  TokenShrink — compress prompts, save tokens, zero API cost',
      '',
      '  Usage:',
      '    tokenshrink "verbose prompt"          show compressed + stats',
      '    tokenshrink --quiet "verbose prompt"  compressed text only',
      '    tokenshrink --stats "verbose prompt"  JSON stats only',
      '    echo "prompt" | tokenshrink --quiet   pipe-friendly',
      '',
      '  Modes:  --mode balanced (default) | extreme | technical',
      '',
      '  Examples:',
      "    tokenshrink \"I was wondering if you could help me understand how transformers work\"",
      "    echo \"verbose prompt\" | tokenshrink -q | pbcopy",
      '',
    ].join('\n') + '\n');
    process.exit(0);
  }
  if ((a === '--mode' || a === '-m') && args[i + 1]) { mode = args[++i]; continue; }
  textArgs.push(a);
}

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
  if (!text.trim()) text = await readStdin();
  text = text.trim();

  if (!text) {
    process.stderr.write('TokenShrink: no input. Use: tokenshrink "your prompt"  or  echo "prompt" | tokenshrink\n');
    process.exit(1);
  }

  const result = compress(text, mode);

  if (statsOnly) {
    process.stdout.write(JSON.stringify({
      mode, domain: result.domain,
      origTokens: result.origTokens,
      compTokens: result.compTokens,
      saved: result.saved,
      pct: result.pct,
    }, null, 2) + '\n');
    return;
  }

  if (quiet) {
    process.stdout.write(result.compressed + '\n');
    return;
  }

  // Default: stats to stderr (doesn't pollute pipe), compressed to stdout
  process.stderr.write(
    `\n  TokenShrink  ${result.origTokens} → ${result.compTokens} tokens  (-${result.pct}% / -${result.saved} tokens)  [${mode}/${result.domain}]\n\n`
  );
  process.stdout.write(result.compressed + '\n');
}

main().catch((err) => {
  process.stderr.write('TokenShrink error: ' + err.message + '\n');
  process.exit(1);
});
