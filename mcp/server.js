#!/usr/bin/env node
/**
 * TokenShrink MCP Server
 *
 * Provides prompt compression tools + auto-compress system prompt for Claude Desktop.
 * Zero Anthropic API usage. Local rules are always free. Groq free tier optional.
 *
 * Install into Claude Desktop:
 *   curl -fsSL https://raw.githubusercontent.com/lhr-present/tokenshrink/master/install.sh | bash
 *
 * Or manually add to ~/. config/claude/claude_desktop_config.json:
 *   { "mcpServers": { "tokenshrink": { "command": "node", "args": ["/path/to/mcp/server.js"] } } }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// ── Inline local compressor (self-contained, zero file dependencies) ──────────

const PROTECTED_PATTERNS = [
  /```[\s\S]*?```/g,
  /`[^`\n]+`/g,
  /https?:\/\/\S+/g,
  /"(?:[^"\\]|\\.)*"/g,
];

function maskProtected(text) {
  const regions = [];
  let masked = text;
  for (const re of PROTECTED_PATTERNS) {
    masked = masked.replace(new RegExp(re.source, re.flags), (m) => {
      regions.push(m);
      return `\x00P${regions.length - 1}\x00`;
    });
  }
  return { masked, regions };
}

function unmask(text, regions) {
  return text.replace(/\x00P(\d+)\x00/g, (_, i) => regions[+i] ?? _);
}

// Single-pass filler regex (pre-compiled at startup)
const FILLER_LIST = [
  'I would like to',"I'd like to",'Could you please','Can you please',
  'I was wondering if you could','I am wondering','Would you be able to',
  'I need you to','I want you to','Please help me to','Please help me',
  "I'm looking for",'I am looking for','I need help with',
  'It would be great if','It would be helpful if','Feel free to',
  'I hope this makes sense','Let me know if','Thanks in advance',
  'Thank you in advance','I appreciate your help','I just wanted to',
  'I was just wondering',"I'm just trying to",'I simply want to',
  "If you don't mind","If it's not too much trouble",
  'I was hoping you could','I would appreciate if',
  'Do you think you could','Would it be possible for you to',
  'I am reaching out to','I am writing to ask',
];
const FILLER_RE = new RegExp(
  `(?:^|(?<=\\s))(?:${FILLER_LIST.map(f => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*`,
  'gi'
);

// Phrase replacements
const REPLACEMENTS = [
  [/\bin order to\b/gi, 'to'],
  [/\bdue to the fact that\b/gi, 'because'],
  [/\bat this point in time\b/gi, 'now'],
  [/\bat the present time\b/gi, 'now'],
  [/\bin the event that\b/gi, 'if'],
  [/\bfor the purpose of\b/gi, 'for'],
  [/\bwith regard to\b/gi, 're:'],
  [/\bwith respect to\b/gi, 're:'],
  [/\ba large number of\b/gi, 'many'],
  [/\bthe majority of\b/gi, 'most'],
  [/\bon a regular basis\b/gi, 'regularly'],
  [/\bin close proximity to\b/gi, 'near'],
  [/\bprior to\b/gi, 'before'],
  [/\bsubsequent to\b/gi, 'after'],
  [/\bin addition to\b/gi, 'plus'],
  [/\bmake use of\b/gi, 'use'],
  [/\btake into consideration\b/gi, 'consider'],
  [/\bis able to\b/gi, 'can'],
  [/\bare able to\b/gi, 'can'],
  [/\bit is important to note that\b/gi, 'note:'],
  [/\bit is worth noting that\b/gi, 'note:'],
  [/\bit should be noted that\b/gi, 'note:'],
  [/\bthe fact that\b/gi, 'that'],
  [/\bin terms of\b/gi, 'for'],
  [/\bon the basis of\b/gi, 'based on'],
  [/\beach and every\b/gi, 'every'],
  [/\bfirst and foremost\b/gi, 'first'],
  [/\bmake a decision\b/gi, 'decide'],
  [/\bmake an attempt\b/gi, 'try'],
  [/\bmake an effort\b/gi, 'try'],
  [/\bgive consideration to\b/gi, 'consider'],
  [/\btake into account\b/gi, 'account for'],
  [/\bcome to a conclusion\b/gi, 'conclude'],
  [/\bprovide an explanation of\b/gi, 'explain'],
  [/\bprovide information about\b/gi, 'explain'],
  [/\bperform an analysis of\b/gi, 'analyze'],
  [/\bconduct a review of\b/gi, 'review'],
  [/\bhas been\b/gi, 'has'],
  [/\bhave been\b/gi, 'have'],
  [/\bwill be able to\b/gi, 'can'],
];

function detectDomain(text) {
  const codeSignals = (text.match(/```|`[^`]+`|function\s*\(|=>\s*{|import\s+|class\s+\w/g) || []).length;
  if (codeSignals >= 2) return 'code';
  const academicSignals = (text.match(/\b(hypothesis|methodology|framework|empirical|paradigm|literature)\b/gi) || []).length;
  if (academicSignals >= 2) return 'academic';
  const chatSignals = (text.match(/\b(please|could you|would you|help me|I need)\b/gi) || []).length;
  if (chatSignals >= 3) return 'chat';
  return 'general';
}

function localCompress(text, mode = 'balanced') {
  if (!text || text.trim().length < 10) {
    return { compressed: text, origTokens: 0, compTokens: 0, saved: 0, pct: 0, domain: 'general', source: 'local' };
  }

  const origTokens = Math.ceil(text.length / 4);
  const domain = detectDomain(text);
  const { masked, regions } = maskProtected(text);
  let out = masked;

  // Filler removal
  out = out.replace(FILLER_RE, ' ');

  // Phrase replacements
  for (const [re, rep] of REPLACEMENTS) out = out.replace(re, rep);

  // Extreme mode extras
  if (mode === 'extreme') {
    out = out
      .replace(/\b(please|kindly)\b\s*/gi, '')
      .replace(/\b(very|quite|rather|somewhat|fairly|pretty)\b\s+/gi, '');
  }

  // Technical mode: preserve code, light rules only
  if (mode === 'technical') {
    out = out.replace(FILLER_RE, ' ');
  }

  // Cleanup
  out = out
    .replace(/\b(\w[\w]*:?)\s+\1(?=\s|$)/gi, '$1')  // dedup
    .replace(/^(and |but |or |so |me to |to (?=\w))+/i, '')
    .replace(/^([a-z])/, c => c.toUpperCase())
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ +([,.;:!?])/g, '$1')
    .trim();

  out = unmask(out, regions);

  const compTokens = Math.ceil(out.length / 4);
  const saved = Math.max(0, origTokens - compTokens);
  const pct = origTokens > 0 ? Math.round((saved / origTokens) * 100) : 0;

  return { compressed: out, origTokens, compTokens, saved, pct, domain, source: 'local' };
}

// ── Groq free tier (optional, zero Anthropic cost) ────────────────────────────

async function groqCompress(text, { groqApiKey, mode = 'balanced' }) {
  if (!groqApiKey) return null;

  const prompts = {
    balanced: 'Compress this prompt to minimum tokens preserving full meaning. Remove all filler, hedging, and politeness. Output ONLY the compressed text, nothing else.',
    extreme:  'Compress to absolute minimum telegram style. Remove all filler. Preserve technical terms and code exactly. Output ONLY compressed text.',
    technical: 'Compress removing filler while preserving all technical terms, code, variable names, and specific details exactly. Output ONLY compressed text.',
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        max_tokens: Math.min(1024, Math.ceil(text.length / 2)),
        temperature: 0.1,
        messages: [
          { role: 'system', content: prompts[mode] || prompts.balanced },
          { role: 'user', content: text },
        ],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || null;
  } catch (_) {
    return null;
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

const CONFIG_PATH = join(homedir(), '.tokenshrink-mcp.json');

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return {};
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); } catch (_) { return {}; }
}

function saveConfig(update) {
  const cfg = { ...loadConfig(), ...update };
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  return cfg;
}

// ── Session stats ─────────────────────────────────────────────────────────────

const session = { compressions: 0, totalSaved: 0, totalOrig: 0, groqUsed: 0 };

function recordStats(origTokens, compTokens, source) {
  session.compressions++;
  session.totalOrig += origTokens;
  session.totalSaved += Math.max(0, origTokens - compTokens);
  if (source === 'groq') session.groqUsed++;
}

// ── MCP Server ────────────────────────────────────────────────────────────────

const server = new McpServer({ name: 'tokenshrink', version: '0.1.0' });

// ── Tool: compress ────────────────────────────────────────────────────────────

server.tool(
  'compress',
  'Compress a prompt to minimum tokens. Returns compressed text + stats. Local rules are instant and free. Set use_groq=true for higher quality via Groq free tier.',
  {
    text: z.string().describe('The prompt text to compress'),
    mode: z.enum(['balanced', 'extreme', 'technical']).optional().default('balanced')
      .describe('balanced=natural 30-50% | extreme=telegram 50-70% | technical=preserves all code'),
    use_groq: z.boolean().optional().default(false)
      .describe('Use Groq free LLM tier for higher quality (requires groq_api_key in config)'),
  },
  async ({ text, mode, use_groq }) => {
    const config = loadConfig();
    const local = localCompress(text, mode);
    let final = local.compressed;
    let source = 'local';

    // Try Groq if requested and local savings are low
    if (use_groq && config.groqApiKey && local.pct < 25) {
      const groqResult = await groqCompress(text, { groqApiKey: config.groqApiKey, mode });
      if (groqResult && groqResult.length < text.length * 0.95) {
        final = groqResult;
        source = 'groq';
      }
    }

    const compTokens = Math.ceil(final.length / 4);
    recordStats(local.origTokens, compTokens, source);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          compressed: final,
          source,
          domain: local.domain,
          stats: {
            origTokens: local.origTokens,
            compTokens,
            saved: local.origTokens - compTokens,
            pct: Math.round(((local.origTokens - compTokens) / local.origTokens) * 100),
          },
        }, null, 2),
      }],
    };
  }
);

// ── Tool: compress_and_use ────────────────────────────────────────────────────

server.tool(
  'compress_and_use',
  'Compress text and return ONLY the compressed version — ready to use directly as the new prompt. Use this for the auto-compress workflow.',
  {
    text: z.string().describe('Text to compress'),
    mode: z.enum(['balanced', 'extreme', 'technical']).optional().default('balanced'),
  },
  async ({ text, mode }) => {
    const result = localCompress(text, mode);
    recordStats(result.origTokens, result.compTokens, 'local');
    return {
      content: [{ type: 'text', text: result.compressed }],
    };
  }
);

// ── Tool: compression_stats ───────────────────────────────────────────────────

server.tool(
  'compression_stats',
  'Get session compression statistics — tokens saved, compressions run, avg reduction.',
  {},
  async () => {
    const avgPct = session.totalOrig > 0
      ? Math.round((session.totalSaved / session.totalOrig) * 100)
      : 0;
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          session: {
            compressions: session.compressions,
            tokensSaved: session.totalSaved,
            avgReduction: `${avgPct}%`,
            groqCalls: session.groqUsed,
            localCalls: session.compressions - session.groqUsed,
          },
          cost: '$0.00 (local rules only)',
        }, null, 2),
      }],
    };
  }
);

// ── Tool: set_config ──────────────────────────────────────────────────────────

server.tool(
  'set_config',
  'Save TokenShrink config — Groq API key for free LLM tier, default mode.',
  {
    groq_api_key: z.string().optional().describe('Groq API key (get free at console.groq.com — 14,400 free calls/day)'),
    default_mode: z.enum(['balanced', 'extreme', 'technical']).optional(),
  },
  async ({ groq_api_key, default_mode }) => {
    const update = {};
    if (groq_api_key) update.groqApiKey = groq_api_key;
    if (default_mode) update.defaultMode = default_mode;
    saveConfig(update);
    return {
      content: [{ type: 'text', text: `✓ Config saved to ${CONFIG_PATH}` }],
    };
  }
);

// ── Prompt: auto_compress ─────────────────────────────────────────────────────

server.prompt(
  'auto_compress',
  'Makes Claude automatically compress every verbose user message before responding — invisible to the user, saves tokens on every turn.',
  {},
  () => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `You have access to TokenShrink MCP tools. Follow these rules silently on every turn:

1. If the user message is >30 words: call compress_and_use(text=<their message>, mode="balanced") first, then respond to the COMPRESSED version as if that's what they sent.
2. If the message is ≤30 words, technical/code-only, or already minimal: respond directly without compressing.
3. For messages with code blocks: use mode="technical" to preserve all code exactly.
4. Never mention compression to the user — it must be completely invisible.
5. Never compress system instructions, only user messages.

This saves tokens on input + reduces context length on every turn.`,
      },
    }],
  })
);

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
