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
import { createRequire } from 'module';

// ── Shared compression engine (dist/core.cjs = same 100+ rules as browser ext) ─

const _require = createRequire(import.meta.url);

let _engine = null;
function getEngine() {
  if (_engine) return _engine;
  const corePath = new URL('../dist/core.cjs', import.meta.url).pathname;
  try {
    const mod = _require(corePath);
    _engine = {
      localCompress: (text, mode = 'balanced') => {
        const r = mod.localCompress(text, { mode });
        // Normalize to shape expected by tools: { compressed, origTokens, compTokens, saved, pct, domain }
        return {
          compressed: r.compressed,
          origTokens: r.stats?.originalTokens ?? Math.ceil((text || '').length / 4),
          compTokens: r.stats?.compressedTokens ?? Math.ceil((r.compressed || '').length / 4),
          saved:      r.stats?.saved ?? 0,
          pct:        r.stats?.pct   ?? 0,
          domain:     r.domain       ?? 'general',
        };
      },
    };
  } catch (_) {
    // dist/core.cjs not built yet — minimal inline fallback (install.sh always builds it)
    _engine = {
      localCompress: (text, mode = 'balanced') => {
        if (!text || text.trim().length < 10) {
          return { compressed: text, origTokens: 0, compTokens: 0, saved: 0, pct: 0, domain: 'general' };
        }
        const origTokens = Math.ceil(text.length / 4);
        let out = text
          .replace(/\bI would like to\b/gi, '')
          .replace(/\bCould you please\b/gi, '')
          .replace(/\bI was wondering if you could\b/gi, '')
          .replace(/\bin order to\b/gi, 'to')
          .replace(/\bdue to the fact that\b/gi, 'because')
          .replace(/\bit is important to note that\b/gi, 'note:')
          .replace(/[ \t]{2,}/g, ' ')
          .trim();
        if (mode === 'extreme') {
          out = out.replace(/\b(please|kindly)\b\s*/gi, '').replace(/\b(very|quite|rather)\b\s+/gi, '');
        }
        const compTokens = Math.ceil(out.length / 4);
        const saved = Math.max(0, origTokens - compTokens);
        const pct = origTokens > 0 ? Math.round((saved / origTokens) * 100) : 0;
        return { compressed: out, origTokens, compTokens, saved, pct, domain: 'general' };
      },
    };
  }
  return _engine;
}

// ── Accurate token estimator (matches tokenCounter.js logic) ─────────────────

function estimateTokens(text) {
  if (!text) return 0;
  let remaining = text;
  let tokens = 0;
  const codeBlocks = text.match(/```[\s\S]*?```|`[^`\n]+`/g) || [];
  for (const block of codeBlocks) {
    tokens += Math.ceil(block.length / 3);
    remaining = remaining.replace(block, '');
  }
  const cjk = remaining.match(/[\u3000-\u9fff\uf900-\ufaff\u3040-\u30ff]/g) || [];
  tokens += Math.ceil(cjk.length / 1.5);
  remaining = remaining.replace(/[\u3000-\u9fff\uf900-\ufaff\u3040-\u30ff]/g, '');
  const nums = remaining.match(/\b\d+(?:\.\d+)?\b/g) || [];
  for (const n of nums) tokens += Math.ceil(n.length / 6);
  remaining = remaining.replace(/\b\d+(?:\.\d+)?\b/g, '');
  tokens += Math.ceil(remaining.length / 4);
  return Math.max(1, tokens);
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
    const effectiveMode = mode || config.defaultMode || 'balanced';
    const local = getEngine().localCompress(text, effectiveMode);
    let final = local.compressed;
    let source = 'local';

    // Try Groq if requested and local savings are low
    if (use_groq && config.groqApiKey && local.pct < 25) {
      const groqResult = await groqCompress(text, { groqApiKey: config.groqApiKey, mode: effectiveMode });
      if (groqResult && groqResult.length < text.length * 0.95) {
        final = groqResult;
        source = 'groq';
      }
    }

    const compTokens = estimateTokens(final);
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
    const config = loadConfig();
    const effectiveMode = mode || config.defaultMode || 'balanced';
    const result = getEngine().localCompress(text, effectiveMode);
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

// ── Tool: batch_compress ──────────────────────────────────────────────────────

server.tool(
  'batch_compress',
  'Compress multiple prompts at once — useful for compressing a list of messages or documents.',
  {
    texts: z.array(z.string()).min(1).max(20).describe('Array of texts to compress (max 20)'),
    mode: z.enum(['balanced', 'extreme', 'technical']).optional().default('balanced'),
  },
  async ({ texts, mode }) => {
    const config = loadConfig();
    const effectiveMode = mode || config.defaultMode || 'balanced';
    const results = texts.map(text => {
      const r = getEngine().localCompress(text, effectiveMode);
      session.compressions++;
      session.totalSaved += r.saved || 0;
      session.totalOrig  += r.origTokens || 0;
      return {
        original:   text.slice(0, 60) + (text.length > 60 ? '...' : ''),
        compressed: r.compressed,
        pct:        r.pct,
        saved:      r.saved,
      };
    });
    const totalSaved = results.reduce((a, r) => a + (r.saved || 0), 0);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ results, totalSaved, count: texts.length }, null, 2),
      }],
    };
  }
);

// ── Tool: session_report ──────────────────────────────────────────────────────

server.tool(
  'session_report',
  'Get a detailed compression report with cost savings estimate for this session.',
  {},
  async () => {
    const avgPct = session.totalOrig > 0
      ? Math.round((session.totalSaved / session.totalOrig) * 100) : 0;
    // Rough cost at Haiku input price ($1 / 1M tokens)
    const costSaved = ((session.totalSaved / 1_000_000) * 1).toFixed(6);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          session: {
            compressions:     session.compressions,
            originalTokens:   session.totalOrig,
            compressedTokens: session.totalOrig - session.totalSaved,
            tokensSaved:      session.totalSaved,
            avgReduction:     `${avgPct}%`,
            groqCalls:        session.groqUsed,
            estimatedCostSaved: `$${costSaved} (at $1/M tokens)`,
          },
        }, null, 2),
      }],
    };
  }
);

// ── Prompt: auto_compress ─────────────────────────────────────────────────────

server.prompt(
  'auto_compress',
  'Makes Claude automatically compress verbose user messages before processing. Transparent to user.',
  {},
  () => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `You have the TokenShrink compression tools available.

RULES (apply silently every turn):
1. If the user's message is >25 words AND is NOT primarily code:
   → Call compress_and_use(text=<their message>, mode="balanced")
   → Respond to the COMPRESSED version as if that's what they wrote
   → Never tell the user you compressed their message

2. If the message is >25 words AND contains code blocks (triple backticks):
   → Call compress_and_use(text=<their message>, mode="technical")
   → Code blocks are preserved exactly

3. If the message is ≤25 words: respond directly, no compression

4. Every 10 compressions: silently call compression_stats() and append at the END of your response (small):
   _[TokenShrink: X tokens saved this session]_

5. Never compress system instructions — only user messages.

This is permanent for this conversation. Begin.`,
      },
    }],
  })
);

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
