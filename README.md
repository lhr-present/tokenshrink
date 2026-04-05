# TokenShrink

![version](https://img.shields.io/badge/version-0.1.0-00ff8c?style=flat-square&labelColor=0a0a0a)
![license](https://img.shields.io/badge/license-MIT-00ff8c?style=flat-square&labelColor=0a0a0a)
![platforms](https://img.shields.io/badge/platforms-Chrome%20%7C%20Firefox-00ff8c?style=flat-square&labelColor=0a0a0a)

Automatically compresses every prompt to its minimum-token form before sending. Saves 30–60% on every API call.

## What it does

TokenShrink intercepts your message on claude.ai the moment you hit Send, rewrites it to the fewest tokens possible using Claude Haiku (fast + cheap), then silently fires the original send action — you see the compressed version go through.

## Architecture

```
[Page textarea]
      │ keydown/click
      ▼
[content.js] ──► [Adapter (claude.js)]
      │
      ▼
[Interceptor]
      │ chrome.runtime.sendMessage COMPRESS
      ▼
[background.js service worker]
      │ fetch POST
      ▼
[Anthropic API — claude-haiku]
      │ compressed text
      ▼
[Interceptor] ──► adapter.setText() ──► re-fire send
```

## Install

### Chrome (unpacked)
1. Download and unzip `releases/tokenshrink-chrome-v0.1.0.zip`
2. Open `chrome://extensions/` → enable Developer Mode
3. Click "Load unpacked" → select the unzipped folder
4. Open extension options → enter your Anthropic API key

### Firefox (temporary)
1. Download and unzip `releases/tokenshrink-firefox-v0.1.0.zip`
2. Open `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on" → select `manifest.json` from the unzipped folder

## Platform support

| Platform | Status | Notes |
|---|---|---|
| claude.ai | ✓ Active | Full interceptor |
| chatgpt.com | 🔜 Soon | Adapter stubbed |
| gemini.google.com | 🔜 Soon | Adapter stubbed |
| Safari | - | Not planned v1 |

## Compression modes

| Mode | Reduction | Best for |
|---|---|---|
| Balanced | ~35% | General use |
| Extreme | ~60% | Short imperative prompts |
| Technical | ~25% prose | Code-heavy prompts |

## Adding a new platform adapter

1. Create `src/adapters/yourplatform.js` — export an object with: `name`, `hostMatch`, `getTextarea`, `getSendButton`, `getText`, `setText`, `isReady`
2. Import it in `src/adapters/index.js` and add to the `ADAPTERS` array
3. Add the hostname to `host_permissions` and `content_scripts.matches` in `manifest.json`

## Roadmap

- [ ] ChatGPT adapter (chatgpt.com)
- [ ] Gemini adapter
- [ ] Per-platform compression stats
- [ ] Pre-send diff view (show what was removed)
- [ ] Safari MV3 port
- [ ] Domain-specific modes (academic, Turkish, code-only)
