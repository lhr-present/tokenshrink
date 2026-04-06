# TokenShrink

**Cut your LLM token usage by 30–60% on every message. Zero API calls. Zero cost. Works everywhere.**

[![npm version](https://img.shields.io/npm/v/%40hlnx4%2Ftoken-shrink?style=flat-square&color=00ff8c&labelColor=0a0a0a)](https://www.npmjs.com/package/@hlnx4/token-shrink)
[![npm downloads](https://img.shields.io/npm/dm/%40hlnx4%2Ftoken-shrink?style=flat-square&color=00ff8c&labelColor=0a0a0a)](https://www.npmjs.com/package/@hlnx4/token-shrink)
[![license](https://img.shields.io/badge/license-MIT-00ff8c?style=flat-square&labelColor=0a0a0a)](LICENSE)

```
Before: "I was wondering if you could please help me understand how transformer
         neural networks work and why they have been so effective in the field
         of natural language processing, if you don't mind."
         → 47 tokens

After:  "Help me understand how transformer neural networks work and why they're
         so effective in NLP."
         → 18 tokens

Saved:  29 tokens  (62%)  — instant, local, $0.00
```

---

## Why this matters

Claude Opus 4 costs **$15 per million input tokens**.
If you send 500 words per message, 100 times a day, that's ~12,500 tokens → **$0.19/day → $68/year**.
TokenShrink cuts that in half, automatically, with no quality loss.

For teams and heavy users, the savings compound fast:
- 10 developers × 100 messages/day = **$680/year saved at zero cost**
- API automation at scale = savings in the thousands per month

---

## Install

### Terminal / CLI (all platforms)

```bash
npm install -g tokenshrink
```

Or one-command full install (Claude Desktop + CLI + shell aliases):

```bash
curl -fsSL https://raw.githubusercontent.com/lhr-present/tokenshrink/master/install.sh | bash
```

### Claude Desktop (MCP — auto-compresses every message silently)

```bash
# After install.sh, restart Claude Desktop, then:
# Click + → select "auto_compress" once per conversation
# Every message >30 words compresses automatically. Invisible to the user.
```

### Claude Code CLI

```bash
claude mcp add --scope user tokenshrink -- node ~/.tokenshrink/mcp/server.js
```

---

## Usage

```bash
# Compress and see stats
tokenshrink "I was wondering if you could help me understand transformers"

# Quiet mode — compressed text only (pipe-friendly)
tokenshrink -q "I was wondering if you could help me understand transformers"

# Pipe into clipboard
echo "verbose prompt here" | tokenshrink -q | pbcopy    # Mac
echo "verbose prompt here" | tokenshrink -q | xclip -sel clip  # Linux

# Compression modes
tokenshrink --mode balanced  "..."   # 30-50% — natural language (default)
tokenshrink --mode extreme   "..."   # 50-70% — telegram style
tokenshrink --mode technical "..."   # ~25%   — preserves all code/variable names

# JSON stats
tokenshrink --stats "your prompt"
```

Shell aliases (added automatically by install.sh):

```bash
alias ts='tokenshrink'
alias tsc='tokenshrink -q | xclip -sel clip && echo "✓ compressed → clipboard"'
```

---

## What it removes

TokenShrink applies 100+ pre-compiled rules at under 2ms per message:

| Category | Example → Compressed |
|---|---|
| Filler openers | "I was wondering if you could..." → removed |
| Politeness hedges | "please", "if you don't mind" → removed |
| Verbose phrases | "in order to" → "to", "due to the fact that" → "because" |
| Nominalizations | "make a decision" → "decide", "make an attempt" → "try" |
| Passive bloat | "has been completed" → "has completed" |
| Academic filler | "it is important to note that" → "note:" |
| Turkish support | "lütfen", "acaba", polite openers → removed |

Code blocks, URLs, and quoted strings are **never touched**.

---

## Platforms

| Platform | Method | Status |
|---|---|---|
| Terminal | `tokenshrink` CLI | ✓ Available now |
| Claude Desktop | MCP auto_compress | ✓ Available now |
| Claude Code CLI | MCP server | ✓ Available now |
| claude.ai | Chrome/Firefox extension | 🔜 Coming soon |
| VS Code | Extension | 🔜 Coming soon |
| ChatGPT / Gemini | Browser extension | 🔜 Coming soon |

---

## MCP tools (Claude Desktop / Claude Code)

After install, these tools are available in Claude:

| Tool | Description |
|---|---|
| `compress` | Compress text + return stats |
| `compress_and_use` | Compress and return only the compressed text |
| `compression_stats` | Session token savings summary |
| `set_config` | Set Groq API key for higher-quality compression |

**Optional Groq upgrade** — get 14,400 free LLM-quality compressions/day:
```
Get free key at console.groq.com → tell Claude: "set my groq key to gsk_..."
```

---

## Architecture

```
Input text
    │
    ▼
[Mask protected regions]  ← code blocks, URLs, quoted strings
    │
    ▼
[100+ regex rules]         ← filler, hedges, verbose phrases, nominalizations
    │                         Turkish rules if Turkish detected
    ▼
[Cleanup + normalize]      ← whitespace, capitalization, dedup
    │
    ▼
[Unmask protected regions]
    │
    ▼
Compressed output          ← zero API calls, <2ms, runs locally
```

---

## Contributing

Pull requests welcome. To add rules, edit `src/core/localCompressor.js`.
Rules must be pre-compiled regex (no dynamic regex in hot path) and must not match inside code blocks or URLs.

---

## Support the project

If TokenShrink saves you money, consider:

- ⭐ Star this repo
- [Sponsor on GitHub](https://github.com/sponsors/lhr-present)
- Share with your team
- Send crypto (every bit helps keep this free)

**Crypto donations:**

| Network | Address |
|---|---|
| Solana (SOL) | `H45tgS8vBmDzwNLAjRv9XQUESbU6GzwW8zx7eXxU5ysf` |
| Ethereum (ETH) | `0xC9bDb4a80d2e0c5b8205230bF0B37e66E71f5cE0` |

**TokenShrink Pro** (coming soon) — VS Code extension + team dashboard + unlimited Groq LLM compression.
Join the waitlist: open an issue with title `[Pro waitlist]`.

---
