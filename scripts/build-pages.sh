#!/bin/sh
# Browser-only static desk for GitHub Pages. Output directory is $1 or dist-pages.
set -eu
out="${1:-dist-pages}"
cd "$(dirname "$0")/../packages/web"
PAGES_BASE="${PAGES_BASE:-/perpdrill/}" npx vite build --outDir "$out" --emptyOutDir
