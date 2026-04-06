/**
 * @module core/localCompressor
 * Pure JavaScript rule-based compression engine. 100+ rules.
 * Zero API calls. Zero cost. Runs entirely in the browser.
 * All regex pre-compiled at module load for <2ms on 500-word inputs.
 * Supports Turkish. Detects domain (code/academic/chat/general).
 */

import { estimateSavings } from './tokenCounter.js';

// ─── Protected region masking ─────────────────────────────────────────────────

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

// ─── Pre-compiled filler regex (single pass) ──────────────────────────────────

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
  'I simply want to', 'If you don\'t mind', "If it's not too much trouble",
  'When you get a chance', 'Whenever you have time', 'I hope you don\'t mind',
  'Sorry to bother you', 'Sorry for the trouble', 'Thank you for your time',
  'Thank you for your consideration', 'I would be very grateful',
  "I'd really appreciate it", 'That would be great', 'That would be wonderful',
  'I am writing to ask about', 'I am writing to',
];

const _esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const FILLER_RE = new RegExp(
  FILLER_LIST.sort((a, b) => b.length - a.length).map(_esc).join('|'),
  'gi'
);

// ─── Pre-compiled hedge regex ─────────────────────────────────────────────────

const HEDGE_LIST = [
  'sort of', 'kind of', 'a little bit', 'a bit', 'somewhat', 'rather',
  'fairly', 'pretty much', 'more or less', 'in a way', 'to some extent',
  'generally speaking', 'for the most part',
];

const HEDGE_RE = new RegExp(
  HEDGE_LIST.sort((a, b) => b.length - a.length).map(_esc).join('|'),
  'gi'
);

// ─── Pre-compiled verbose → compact replacements ──────────────────────────────
// Each: [compiled regex, replacement string]

const VERBOSE_RULES = [
  // Nominalizations → verbs
  [/\bmake a decision\b/gi, 'decide'],
  [/\bmake an assumption\b/gi, 'assume'],
  [/\bmake a recommendation\b/gi, 'recommend'],
  [/\bmake a suggestion\b/gi, 'suggest'],
  [/\bmake a determination\b/gi, 'determine'],
  [/\bmake an assessment\b/gi, 'assess'],
  [/\bmake an attempt\b/gi, 'try'],
  [/\bmake an effort\b/gi, 'try'],
  [/\bmake a change\b/gi, 'change'],
  [/\bmake a comparison\b/gi, 'compare'],
  [/\bmake a distinction\b/gi, 'distinguish'],
  [/\bgive consideration to\b/gi, 'consider'],
  [/\bgive an explanation of\b/gi, 'explain'],
  [/\bgive a description of\b/gi, 'describe'],
  [/\btake action on\b/gi, 'act on'],
  [/\btake a look at\b/gi, 'look at'],
  [/\btake into account\b/gi, 'account for'],
  [/\btake into consideration\b/gi, 'consider'],
  [/\btake advantage of\b/gi, 'use'],
  [/\btake steps to\b/gi, ''],
  [/\btake measures to\b/gi, ''],
  [/\bcome to a conclusion\b/gi, 'conclude'],
  [/\bcome to an agreement\b/gi, 'agree'],
  [/\bcome to the realization\b/gi, 'realize'],
  [/\bcome to the conclusion\b/gi, 'conclude'],
  [/\breach a conclusion\b/gi, 'conclude'],
  [/\breach an agreement\b/gi, 'agree'],
  [/\bprovide an explanation of\b/gi, 'explain'],
  [/\bprovide information about\b/gi, 'explain'],
  [/\bprovide assistance with\b/gi, 'assist with'],
  [/\bperform an analysis of\b/gi, 'analyze'],
  [/\bconduct an investigation of\b/gi, 'investigate'],
  [/\bconduct a review of\b/gi, 'review'],
  [/\bcarry out\b/gi, 'do'],
  [/\bbring about\b/gi, 'cause'],
  [/\bachieve an improvement in\b/gi, 'improve'],

  // Passive voice
  [/\bis being\b/gi, 'is'],
  [/\bwas being\b/gi, 'was'],
  [/\bhas been\b/gi, 'has'],
  [/\bhave been\b/gi, 'have'],
  [/\bhad been\b/gi, 'had'],
  [/\bwill be\b/gi, 'will'],
  [/\bwould be\b/gi, 'would'],
  [/\bshould be\b/gi, 'should'],
  [/\bmust be\b/gi, 'must'],
  [/\bcan be\b/gi, 'can'],
  [/\bcould be\b/gi, 'could'],
  [/\bhave the ability to\b/gi, 'can'],
  [/\bare able to\b/gi, 'can'],
  [/\bis able to\b/gi, 'can'],
  [/\bwere able to\b/gi, 'could'],
  [/\bwas able to\b/gi, 'could'],

  // Academic verbosity
  [/\bit is important to note that\b/gi, 'note:'],
  [/\bit is worth noting that\b/gi, 'note:'],
  [/\bit should be noted that\b/gi, 'note:'],
  [/\bplease note that\b/gi, 'note:'],
  [/\bit is necessary to\b/gi, 'must'],
  [/\bit is essential that\b/gi, 'must'],
  [/\bit is recommended that\b/gi, 'should'],
  [/\bit is suggested that\b/gi, ''],
  [/\bit is clear that\b/gi, ''],
  [/\bit is obvious that\b/gi, ''],
  [/\bthere is no doubt that\b/gi, ''],
  [/\bit is worth mentioning that\b/gi, ''],
  [/\bthe fact that\b/gi, 'that'],
  [/\bin the field of\b/gi, 'in'],
  [/\bin the area of\b/gi, 'in'],
  [/\bin the domain of\b/gi, 'in'],
  [/\bin terms of\b/gi, 'for'],
  [/\bwith the exception of\b/gi, 'except'],
  [/\bin the absence of\b/gi, 'without'],
  [/\bin the presence of\b/gi, 'with'],
  [/\bon the basis of\b/gi, 'based on'],
  [/\bfor the reason that\b/gi, 'because'],
  [/\bas a consequence of\b/gi, 'due to'],
  [/\bas a result of this\b/gi, 'so'],
  [/\bas a result of\b/gi, 'due to'],
  [/\bin the same way\b/gi, 'similarly'],
  [/\bin a similar fashion\b/gi, 'similarly'],
  [/\bat the same time\b/gi, 'simultaneously'],
  [/\bin the near future\b/gi, 'soon'],
  [/\bin the long run\b/gi, 'long-term'],
  [/\bin the short term\b/gi, 'short-term'],
  [/\bon a daily basis\b/gi, 'daily'],
  [/\bon a monthly basis\b/gi, 'monthly'],
  [/\bon a yearly basis\b/gi, 'yearly'],
  [/\bon a regular basis\b/gi, 'regularly'],
  [/\bat this point in time\b/gi, 'now'],
  [/\bat the present time\b/gi, 'now'],
  [/\bat the current time\b/gi, 'now'],
  [/\bfor the time being\b/gi, 'temporarily'],
  [/\bin the meantime\b/gi, 'meanwhile'],
  [/\bon the other hand\b/gi, 'however'],
  [/\bin contrast to\b/gi, 'unlike'],
  [/\bas opposed to\b/gi, 'vs'],
  [/\bin addition to this\b/gi, 'also'],
  [/\bin addition to\b/gi, 'plus'],
  [/\bas well as\b/gi, 'and'],
  [/\beach and every\b/gi, 'every'],
  [/\bfirst and foremost\b/gi, 'first'],
  [/\btrue and accurate\b/gi, 'accurate'],
  [/\bcompletely and utterly\b/gi, 'completely'],
  [/\bfinal and conclusive\b/gi, 'final'],

  // Chat verbosity
  [/\bjust to let you know\b/gi, 'FYI:'],
  [/\bjust to clarify\b/gi, 'Clarification:'],
  [/\bas i mentioned before\b/gi, 'As mentioned'],
  [/\bas i said earlier\b/gi, 'As stated'],
  [/\bto be honest with you\b/gi, 'Honestly'],
  [/\bto be perfectly honest\b/gi, 'Honestly'],
  [/\bi was wondering if you could provide me with\b/gi, 'Give me'],
  [/\bcould you provide me with\b/gi, 'Give me'],
  [/\bi am looking for information about\b/gi, 'Explain'],
  [/\bprovide me with information about\b/gi, 'Explain'],

  // Legacy verbose rules
  [/\bdue to the fact that\b/gi, 'because'],
  [/\bin order to\b/gi, 'to'],
  [/\bin the event that\b/gi, 'if'],
  [/\bfor the purpose of\b/gi, 'for'],
  [/\bwith regard to\b/gi, 're:'],
  [/\bwith respect to\b/gi, 're:'],
  [/\ba large number of\b/gi, 'many'],
  [/\ba small number of\b/gi, 'few'],
  [/\bthe majority of\b/gi, 'most'],
  [/\bin close proximity to\b/gi, 'near'],
  [/\bprior to\b/gi, 'before'],
  [/\bsubsequent to\b/gi, 'after'],
  [/\bin spite of\b/gi, 'despite'],
  [/\bmake use of\b/gi, 'use'],
  [/\bthere is a need for\b/gi, 'need'],
  [/\bi would appreciate it if you could\b/gi, 'please'],
  [/\bcould you provide me with\b/gi, 'give me'],
];

// ─── Turkish rules (only applied if Turkish detected) ─────────────────────────

const TURKISH_DETECT_RE = /[şğüöıçŞĞÜÖİÇ]|(?:acaba|lütfen|hakkında|nasıl|nedir|misiniz|mısınız)\b/i;

const TURKISH_RULES = [
  [/^lütfen\s+/i, ''],
  [/\s+lütfen\b/gi, ''],
  [/^acaba\s+/i, ''],
  [/\bşunu söyleyebilir misiniz\b/gi, 'söyleyin:'],
  [/\bbana yardımcı olabilir misiniz\b/gi, 'yardım edin:'],
  [/\bhakkında bilgi verebilir misiniz\b/gi, 'açıklayın:'],
  [/\bne olduğunu anlamak istiyorum\b/gi, 'nedir?'],
  [/\bbunu anlamama yardım eder misiniz\b/gi, 'açıklayın:'],
  [/\bmerak ediyorum\b/gi, ''],
  [/\bsize şunu sormak istiyorum[:,]?\s*/gi, ''],
  [/\bşöyle bir sorum var[:,]?\s*/gi, ''],
  [/\bbir konuda yardım istiyorum[:,]?\s*/gi, ''],
  [/\baslında\s+/gi, ''],
  [/\bşu an için\b/gi, 'şu an'],
  [/\bbu konuda\s+/gi, ''],
];

// ─── Domain detection ─────────────────────────────────────────────────────────

const CODE_SIGNALS = /```|`[^`]+`|\b(function|class|import|export|const|let|var|def|return|async|await|npm|git|bash|python|javascript|typescript|sql|api|json|html|css|dockerfile|kubernetes|terraform)\b/i;
const ACADEMIC_SIGNALS = /\b(hypothesis|methodology|literature|empirical|theoretical|peer.reviewed|citation|abstract|findings|dataset|correlation|statistical|significant|research|study|analysis|framework|quantitative|qualitative|paradigm|epistemolog)\b/i;
const CHAT_OPENER = /^(?:hi|hey|hello|can you|could you|what is|what are|how do|how can|help me|i need|explain|tell me|show me|give me|describe|list|write).{0,80}$/i;

/**
 * Detect the domain of a text for prompt routing.
 * @param {string} text
 * @returns {'code'|'academic'|'chat'|'general'}
 */
export function detectDomain(text) {
  if (CODE_SIGNALS.test(text)) return 'code';
  if (ACADEMIC_SIGNALS.test(text)) return 'academic';
  if (text.trim().length < 120 && CHAT_OPENER.test(text.trim())) return 'chat';
  return 'general';
}

// ─── Core rule application ────────────────────────────────────────────────────

// Extreme-mode extras (pre-compiled)
const EXTREME_POLITE_RE = /\b(please|kindly)\b\s*/gi;
const EXTREME_HEDGE_RE  = /\b(very|quite|rather|somewhat|fairly|pretty)\b\s+/gi;

function applyRules(text, isTurkish, mode = 'balanced') {
  let out = text;
  let appliedRules = 0;

  // 1. Filler removal — all modes
  const after1 = out.replace(FILLER_RE, '');
  if (after1 !== out) appliedRules++;
  out = after1;

  // Technical mode: only filler removal — preserve all technical phrasing
  if (mode === 'technical') {
    return { out, appliedRules };
  }

  // 2. Hedge removal — balanced + extreme
  const after2 = out.replace(HEDGE_RE, '');
  if (after2 !== out) appliedRules++;
  out = after2;

  // 3. Verbose → compact (pre-compiled, ordered longest-first)
  for (const [re, rep] of VERBOSE_RULES) {
    re.lastIndex = 0;
    const next = out.replace(re, rep);
    if (next !== out) appliedRules++;
    out = next;
  }

  // 4. Turkish rules (gated)
  if (isTurkish) {
    for (const [re, rep] of TURKISH_RULES) {
      re.lastIndex = 0;
      const next = out.replace(re, rep);
      if (next !== out) appliedRules++;
      out = next;
    }
  }

  // 5. Extreme mode extras — strip remaining politeness + filler adverbs
  if (mode === 'extreme') {
    EXTREME_POLITE_RE.lastIndex = 0;
    EXTREME_HEDGE_RE.lastIndex = 0;
    const afterP = out.replace(EXTREME_POLITE_RE, '');
    if (afterP !== out) appliedRules++;
    out = afterP;
    const afterH = out.replace(EXTREME_HEDGE_RE, '');
    if (afterH !== out) appliedRules++;
    out = afterH;
  }

  // 5. Post-removal cleanup
  // Deduplicate consecutive identical label tokens (e.g. "note: note:" → "note:")
  out = out.replace(/\b(\w[\w]*:?)\s+\1(?=\s|$)/gi, '$1');

  // Capitalize sentence starts
  out = out.replace(/(^|[.!?]\s+)([a-z])/g, (_, p, c) => p + c.toUpperCase());

  // Strip leading orphaned connectors
  out = out
    .replace(/^(and |but |or |so |yet |then |also |plus |me to |to (?=\w))+/i, '')
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

  return { out, appliedRules };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compress text using local rules only. No API call.
 * @param {string} text
 * @param {{ forceDomain?: string }} [options]
 * @returns {{ compressed: string, stats: object, domain: string, appliedRules: number }}
 */
export function localCompress(text, { forceDomain, mode = 'balanced' } = {}) {
  if (!text || text.trim().length === 0) {
    const empty = { originalTokens: 0, compressedTokens: 0, saved: 0, pct: 0 };
    return { compressed: text, stats: empty, domain: 'general', appliedRules: 0 };
  }

  const domain = forceDomain || detectDomain(text);
  const isTurkish = TURKISH_DETECT_RE.test(text);

  const { masked, regions } = maskProtected(text);
  const { out: compressedMasked, appliedRules } = applyRules(masked, isTurkish, mode);
  const compressed = unmask(compressedMasked, regions);
  const stats = estimateSavings(text, compressed);

  return { compressed, stats, domain, appliedRules };
}

/**
 * Estimate % reduction without returning full result.
 * @param {string} text
 * @returns {number}
 */
export function estimateLocalReduction(text) {
  return localCompress(text).stats.pct;
}

/**
 * Profile which rules fired and their individual savings (dev tool).
 * @param {string} text
 * @returns {Array<{ rule: string, before: string, after: string, saved: number }>}
 */
export function profileRules(text) {
  const results = [];
  const { masked, regions } = maskProtected(text);
  let current = masked;

  const check = (label, fn) => {
    const next = fn(current);
    if (next !== current) {
      results.push({ rule: label, saved: current.length - next.length });
      current = next;
    }
  };

  check('filler', (t) => t.replace(FILLER_RE, ''));
  check('hedge', (t) => t.replace(HEDGE_RE, ''));
  VERBOSE_RULES.forEach(([re, rep], i) => {
    re.lastIndex = 0;
    check(`verbose[${i}]`, (t) => t.replace(re, rep));
  });

  return results;
}
