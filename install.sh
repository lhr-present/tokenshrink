#!/bin/bash
set -e

REPO="https://github.com/lhr-present/tokenshrink"
INSTALL_DIR="$HOME/.tokenshrink"

# Claude Desktop config paths (Linux / Mac / Windows WSL)
if [ -f "$HOME/.config/claude/claude_desktop_config.json" ]; then
  CONFIG_FILE="$HOME/.config/claude/claude_desktop_config.json"
elif [ -f "$HOME/Library/Application Support/Claude/claude_desktop_config.json" ]; then
  CONFIG_FILE="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
elif [ -f "/mnt/c/Users/$USER/AppData/Roaming/Claude/claude_desktop_config.json" ]; then
  CONFIG_FILE="/mnt/c/Users/$USER/AppData/Roaming/Claude/claude_desktop_config.json"
else
  # Default Linux path — Claude Desktop creates this on first run
  CONFIG_FILE="$HOME/.config/claude/claude_desktop_config.json"
fi

echo "╔══════════════════════════════════════════╗"
echo "║   TokenShrink — One-Command Install      ║"
echo "║   Zero Anthropic tokens. Free forever.   ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Step 1: Clone or update ───────────────────────────────────────────────────

if [ -d "$INSTALL_DIR/.git" ]; then
  echo "→ Updating existing install at $INSTALL_DIR..."
  git -C "$INSTALL_DIR" pull origin master --quiet
else
  echo "→ Cloning from GitHub..."
  git clone "$REPO.git" "$INSTALL_DIR" --depth=1 --quiet
fi

# ── Step 2: Install MCP server deps ──────────────────────────────────────────

echo "→ Installing MCP server dependencies..."
cd "$INSTALL_DIR/mcp"
npm install --silent --no-fund --no-audit

# ── Step 2b: Build shared compression engine ──────────────────────────────────

echo "→ Building shared compression engine..."
cd "$INSTALL_DIR"
npm install --silent --no-fund --no-audit 2>/dev/null || true
bash scripts/bundle-core.sh

# ── Step 3: Build CLI binary ──────────────────────────────────────────────────

echo "→ Building CLI binary..."
cd "$INSTALL_DIR"
npm install --silent --no-fund --no-audit 2>/dev/null || true
mkdir -p dist
npx esbuild bin/compress.js \
  --bundle --platform=node --target=node18 \
  --outfile=dist/compress --format=cjs \
  --log-level=silent 2>/dev/null || true
chmod +x dist/compress 2>/dev/null || true

# ── Step 4: Patch Claude Desktop config ──────────────────────────────────────

echo "→ Patching Claude Desktop config..."
mkdir -p "$(dirname "$CONFIG_FILE")"

if [ ! -f "$CONFIG_FILE" ]; then
  echo '{"mcpServers":{}}' > "$CONFIG_FILE"
fi

node -e "
const fs = require('fs');
const cfgPath = '$CONFIG_FILE';
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch(e) { cfg = {}; }
cfg.mcpServers = cfg.mcpServers || {};
cfg.mcpServers.tokenshrink = {
  command: 'node',
  args: ['$INSTALL_DIR/mcp/server.js'],
  env: {}
};
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
console.log('  ✓ Patched: ' + cfgPath);
"

# ── Step 5: Shell aliases ─────────────────────────────────────────────────────

# Detect clipboard command (Linux xclip/xsel, macOS pbcopy)
if command -v xclip &>/dev/null; then
  CLIP_COPY="xclip -selection clipboard"
  CLIP_PASTE="xclip -selection clipboard -o"
elif command -v xsel &>/dev/null; then
  CLIP_COPY="xsel --clipboard --input"
  CLIP_PASTE="xsel --clipboard --output"
elif command -v pbcopy &>/dev/null; then
  CLIP_COPY="pbcopy"
  CLIP_PASTE="pbpaste"
else
  CLIP_COPY=""
  CLIP_PASTE=""
fi

for RC in "$HOME/.bashrc" "$HOME/.zshrc"; do
  if [ -f "$RC" ] && ! grep -q "tokenshrink" "$RC" 2>/dev/null; then
    echo "" >> "$RC"
    echo "# TokenShrink" >> "$RC"
    echo "alias ts='$INSTALL_DIR/bin/tokenshrink.js'" >> "$RC"
    if [ -n "$CLIP_COPY" ]; then
      echo "alias tsc='$INSTALL_DIR/bin/tokenshrink.js --quiet | $CLIP_COPY && echo \"✓ compressed → clipboard\"'" >> "$RC"
      echo "alias tsclip='$CLIP_PASTE | $INSTALL_DIR/bin/tokenshrink.js --quiet | $CLIP_COPY && echo \"✓ clipboard compressed\"'" >> "$RC"
    else
      echo "# tsc/tsclip require xclip, xsel (Linux) or pbcopy (macOS)" >> "$RC"
    fi
    echo "  ✓ Added aliases to $RC"
  fi
done

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   ✓ TokenShrink installed!                           ║"
echo "║                                                      ║"
echo "║   Claude Desktop:                                    ║"
echo "║   1. Restart Claude Desktop                          ║"
echo "║   2. Start a conversation                            ║"
echo "║   3. Click the + icon → 'auto_compress' prompt       ║"
echo "║      → Every message now auto-compresses silently    ║"
echo "║                                                      ║"
echo "║   Optional free Groq upgrade (14,400 calls/day):     ║"
echo "║   Get key at console.groq.com then ask Claude:       ║"
echo "║   'set my groq key to gsk_...'                       ║"
echo "║                                                      ║"
echo "║   CLI (after source ~/.bashrc):                      ║"
echo "║   ts 'verbose prompt'     → stats + compressed text  ║"
echo "║   tsc 'verbose prompt'    → compress → clipboard     ║"
echo "║   tsclip                  → compress clipboard text  ║"
echo "╚══════════════════════════════════════════════════════╝"
