#!/bin/bash
# Bundles src/core/localCompressor.js + src/core/tokenCounter.js
# into a single CJS file usable by CLI, MCP, and tests — no ESM issues.
set -e
cd "$(dirname "$0")/.."

mkdir -p dist

npx esbuild src/core/localCompressor.js \
  --bundle \
  --platform=node \
  --target=node18 \
  --format=cjs \
  --outfile=dist/core.cjs \
  --log-level=warning

echo "✓ dist/core.cjs built ($(wc -c < dist/core.cjs | tr -d ' ') bytes)"
