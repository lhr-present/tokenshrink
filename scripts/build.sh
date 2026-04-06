#!/bin/bash
set -e
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.1.0")
echo "Building TokenShrink v$VERSION..."

# ── Build shared core bundle first ────────────────────────────────────────────
echo "→ Building shared core bundle..."
bash scripts/bundle-core.sh

# Clean
rm -rf dist/chrome dist/firefox
mkdir -p dist/chrome/src/ui/popup dist/chrome/src/ui/options dist/chrome/icons

# Bundle content script (resolves all imports into one IIFE — required for Chrome MV3 content scripts)
npx esbuild src/content.js \
  --bundle \
  --outfile=dist/chrome/content.js \
  --format=iife \
  --target=chrome100 \
  --log-level=warning

# Bundle background service worker (ESM format — MV3 service workers support ESM)
npx esbuild src/background.js \
  --bundle \
  --outfile=dist/chrome/background.js \
  --format=esm \
  --target=chrome100 \
  --log-level=warning

# Bundle popup and options JS
npx esbuild src/ui/popup/popup.js \
  --bundle \
  --outfile=dist/chrome/src/ui/popup/popup.js \
  --format=iife \
  --target=chrome100 \
  --log-level=warning

npx esbuild src/ui/options/options.js \
  --bundle \
  --outfile=dist/chrome/src/ui/options/options.js \
  --format=iife \
  --target=chrome100 \
  --log-level=warning

# Copy static assets — patch manifest paths for bundled layout
sed \
  -e 's|"src/background.js"|"background.js"|' \
  -e 's|"src/content.js"|"content.js"|' \
  -e 's|"src/ui/popup/popup.html"|"src/ui/popup/popup.html"|' \
  -e 's|"src/ui/options/options.html"|"src/ui/options/options.html"|' \
  manifest.json > dist/chrome/manifest.json
cp -r icons/* dist/chrome/icons/
cp src/ui/popup/popup.html src/ui/popup/popup.css dist/chrome/src/ui/popup/
cp src/ui/options/options.html src/ui/options/options.css dist/chrome/src/ui/options/

# Firefox build (same bundles, different manifest)
cp -r dist/chrome dist/firefox
sed \
  -e 's|"src/background.js"|"background.js"|' \
  -e 's|"src/content.js"|"content.js"|' \
  firefox_manifest.json > dist/firefox/manifest.json

# ZIP releases
mkdir -p releases
cd dist/chrome && zip -r ../../releases/tokenshrink-chrome-v$VERSION.zip . -x "*.DS_Store" && cd ../..
cd dist/firefox && zip -r ../../releases/tokenshrink-firefox-v$VERSION.zip . -x "*.DS_Store" && cd ../..

# Build standalone CLI binary (Node.js, no dependencies)
npx esbuild bin/compress.js \
  --bundle \
  --platform=node \
  --target=node18 \
  --outfile=dist/compress \
  --format=cjs \
  --log-level=warning
chmod +x dist/compress

echo ""
echo "Build complete: TokenShrink v$VERSION (Chrome + Firefox + CLI)"
ls -lh releases/

echo "--- Bundle sizes ---"
ls -lh dist/chrome/content.js dist/chrome/background.js
echo "--- Import check ---"
[ "$(grep -c '^import ' dist/chrome/content.js)" = "0" ] && echo "✓ content.js clean" || echo "FAIL: bare imports in content.js"
[ "$(grep -c '^import ' dist/chrome/background.js)" = "0" ] && echo "✓ background.js clean" || echo "FAIL: bare imports in background.js"
echo "--- type=module check ---"
grep -r 'type="module"' dist/chrome/ && echo "FAIL: type=module found" || echo "✓ no type=module"
echo "--- manifest content_scripts path ---"
node -e "const m=JSON.parse(require('fs').readFileSync('dist/chrome/manifest.json')); console.log('js:', m.content_scripts[0].js)"
