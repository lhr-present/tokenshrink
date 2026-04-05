/**
 * @module core/localCompressor
 * Pure JavaScript rule-based compression engine.
 * Zero API calls. Zero cost. Runs entirely in the browser.
 * Preserves code blocks, inline code, URLs, and quoted strings.
 */

import { estimateSavings } from './tokenCounter.js';

// Regions that must never be touched by compression rules
const PROTECTED_PATTERNS = [
  /```[\s\S]*?```/g,          // fenced code blocks
  /`[^`\n]+`/g,               // inline code
  /https?:\/\/\S+/g,          // URLs
  /"(?:[^"\\]|\\.)*"/g,       // double-quoted strings
  // NOTE: single-quoted strings intentionally omitted — apostrophes in contractions
  // (I'd, it's, can't) cause false matches that consume large chunks of text.
];

/**
 * Extract protected regions from text, replacing with placeholders.
 * Returns { masked, regions } where masked has PLACEHOLDER_n tokens.
 * @param {string} text
 * @returns {{ masked: string, regions: string[] }}
 */
function maskProtected(text) {
  const regions = [];
  let masked = text;

  for (const pattern of PROTECTED_PATTERNS) {
    pattern.lastIndex = 0;
    masked = masked.replace(pattern, (match) => {
      const idx = regions.length;
      regions.push(match);
      return `\x00PLACEHOLDER_${idx}\x00`;
    });
  }

  return { masked, regions };
}

/**
 * Restore protected regions from placeholders.
 * @param {string} masked
 * @param {string[]} regions
 * @returns {string}
 */
function unmask(masked, regions) {
  return masked.replace(/\x00PLACEHOLDER_(\d+)\x00/g, (_, idx) => regions[parseInt(idx, 10)]);
}

// ─── Rule definitions ────────────────────────────────────────────────────────

const FILLER_PHRASES = [
  'I would like to',
  "I'd like to",
  'Could you please',
  'Can you please',
  'I was wondering if you could',
  'I am wondering',
  'Would you be able to',
  'I need you to',
  'I want you to',
  'Please help me to',
  'Please help me',
  'I am looking for',
  "I'm looking for",
  'I need help with',
  'As an AI',
  'As a language model',
  'I understand that',
  'It would be great if',
  'It would be helpful if',
  'Feel free to',
  'I hope this makes sense',
  'Let me know if',
  'Thanks in advance',
  'Thank you in advance',
  'I appreciate your help',
  'I appreciate it',
];

const HEDGE_PHRASES = [
  'sort of',
  'kind of',
  'a bit',
  'a little bit',
  'somewhat',
  'rather',
  'quite',
  'fairly',
  'pretty much',
  'more or less',
  'in a way',
  'to some extent',
  'generally speaking',
  'for the most part',
];

// [pattern (string or regex), replacement]
const VERBOSE_REPLACEMENTS = [
  ['in order to', 'to'],
  ['due to the fact that', 'because'],
  ['at this point in time', 'now'],
  ['in the event that', 'if'],
  ['for the purpose of', 'for'],
  ['with regard to', 're:'],
  ['with respect to', 're:'],
  ['as a result of', 'due to'],
  ['a large number of', 'many'],
  ['a small number of', 'few'],
  ['the majority of', 'most'],
  ['on a regular basis', 'regularly'],
  ['in close proximity to', 'near'],
  ['prior to', 'before'],
  ['subsequent to', 'after'],
  ['in addition to', 'plus'],
  ['in spite of', 'despite'],
  ['make use of', 'use'],
  ['take into consideration', 'consider'],
  ['come to the conclusion', 'conclude'],
  ['is able to', 'can'],
  ['are able to', 'can'],
  ['was able to', 'could'],
  ['were able to', 'could'],
  ['have the ability to', 'can'],
  ['there is a need for', 'need'],
  ['it is important to note that', 'note:'],
  ['it should be noted that', 'note:'],
  ['please note that', 'note:'],
  ['it is worth mentioning that', ''],
  ['I would appreciate it if you could', 'please'],
  ['could you provide me with', 'give me'],
  ['provide information about', 'explain'],
  ['I am writing to', ''],
];

// ─── Core compression pass ────────────────────────────────────────────────────

/**
 * Apply all compression rules to masked text (protected regions already removed).
 * @param {string} text
 * @returns {string}
 */
function applyRules(text) {
  let out = text;

  // 1. Filler phrases — remove entirely (including trailing space)
  for (const phrase of FILLER_PHRASES) {
    const re = new RegExp(`\\b${escapeRegex(phrase)}\\b\\s*`, 'gi');
    out = out.replace(re, '');
  }

  // 2. Hedge removal
  for (const phrase of HEDGE_PHRASES) {
    const re = new RegExp(`\\b${escapeRegex(phrase)}\\b\\s*`, 'gi');
    out = out.replace(re, '');
  }

  // 3. Verbose → compact
  for (const [pattern, replacement] of VERBOSE_REPLACEMENTS) {
    const re = new RegExp(`\\b${escapeRegex(pattern)}\\b`, 'gi');
    out = out.replace(re, replacement);
  }

  // 4. Post-removal cleanup

  // Deduplicate consecutive identical tokens including colon-suffixed labels (e.g. "note: note:" → "note:")
  out = out.replace(/\b(\w[\w]*:?)\s+\1(?=\s|$)/gi, '$1');

  // Remove leading orphaned lowercase fragments (e.g. "get a ... if possible.")
  // Capitalize first word of each sentence
  out = out.replace(/(^|[.!?]\s+)([a-z])/g, (_, punc, c) => punc + c.toUpperCase());

  // Remove trailing orphaned fragment that starts after ? or !
  // e.g. "...models? Get a detailed explanation if possible." — keep it, it's still useful
  // Just ensure no leading orphan on the overall string
  out = out
    .replace(/^(and |but |or |so |yet |then |also |plus |me to |to (?=\w))+/i, '')
    // Capitalize after that removal too
    .replace(/^([a-z])/, (c) => c.toUpperCase());

  // Whitespace normalization
  out = out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ +([,.;:!?])/g, '$1')
    .replace(/([,;:])([^\s\n])/g, '$1 $2')
    .replace(/\s+\./g, '.')
    .replace(/\.{2,}/g, '.')
    .trim();

  return out;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compress text using local rules only. No API call.
 * @param {string} text
 * @returns {{ compressed: string, stats: object }}
 */
export function localCompress(text) {
  if (!text || text.trim().length === 0) {
    return { compressed: text, stats: { originalTokens: 0, compressedTokens: 0, saved: 0, pct: 0 } };
  }

  const { masked, regions } = maskProtected(text);
  const compressedMasked = applyRules(masked);
  const compressed = unmask(compressedMasked, regions);
  const stats = estimateSavings(text, compressed);

  return { compressed, stats };
}

/**
 * Estimate the % reduction local rules would achieve, without actually returning the result.
 * Fast pre-check used by the pipeline to decide whether to call an API.
 * @param {string} text
 * @returns {number} Expected % reduction (0-100)
 */
export function estimateLocalReduction(text) {
  const { stats } = localCompress(text);
  return stats.pct;
}
