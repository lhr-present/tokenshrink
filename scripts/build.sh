#!/bin/bash
set -e

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.1.0")

echo "Building TokenShrink v$VERSION..."

mkdir -p dist/chrome dist/firefox releases

# Chrome build
rm -rf dist/chrome/*
cp -r src icons manifest.json dist/chrome/
cd dist/chrome && zip -r ../../releases/tokenshrink-chrome-v${VERSION}.zip . -x "*.DS_Store" && cd ../..
echo "  ✓ Chrome: releases/tokenshrink-chrome-v${VERSION}.zip ($(du -sh releases/tokenshrink-chrome-v${VERSION}.zip | cut -f1))"

# Firefox build
rm -rf dist/firefox/*
cp -r src icons dist/firefox/
cp firefox_manifest.json dist/firefox/manifest.json
cd dist/firefox && zip -r ../../releases/tokenshrink-firefox-v${VERSION}.zip . -x "*.DS_Store" && cd ../..
echo "  ✓ Firefox: releases/tokenshrink-firefox-v${VERSION}.zip ($(du -sh releases/tokenshrink-firefox-v${VERSION}.zip | cut -f1))"

echo ""
echo "Build complete: TokenShrink v$VERSION (Chrome + Firefox)"
