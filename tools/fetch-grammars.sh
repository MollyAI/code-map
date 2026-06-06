#!/bin/sh
# tools/fetch-grammars.sh — fetch the pinned web-tree-sitter runtime + grammar
# wasm, and print sha256 for grammars/manifest.json. Dev-time only; users never
# run this (the bundled wasm is committed; remote wasm is fetched by
# scripts/lib/grammars.mjs at runtime against the pinned URLs).
#
# Usage: tools/fetch-grammars.sh <dest-dir>     (e.g. tools/fetch-grammars.sh grammars)
set -e

WTS=0.25.10
PACK="@sourcegraph/tree-sitter-wasms@0.1.9"
DEST=${1:?usage: fetch-grammars.sh <dest-dir>}
mkdir -p "$DEST/bundled"

# web-tree-sitter 0.25.10 runtime: ESM loader + companion wasm.
# (0.26+ renamed these to web-tree-sitter.*; do not mix versions.)
curl -fsSL "https://unpkg.com/web-tree-sitter@$WTS/tree-sitter.js"   -o "$DEST/tree-sitter.js"
curl -fsSL "https://unpkg.com/web-tree-sitter@$WTS/tree-sitter.wasm" -o "$DEST/tree-sitter.wasm"

# 8 bundled (committed) grammars: common + small.
for L in python javascript typescript go java rust c lua; do
  curl -fsSL "https://unpkg.com/$PACK/out/tree-sitter-$L.wasm" -o "$DEST/bundled/tree-sitter-$L.wasm"
done

echo "=== runtime sizes ==="
wc -c "$DEST/tree-sitter.js" "$DEST/tree-sitter.wasm"

echo "=== sha256 + bytes (bundled — paste into manifest.json) ==="
for L in python javascript typescript go java rust c lua; do
  f="$DEST/bundled/tree-sitter-$L.wasm"
  printf '%s  sha256=%s  bytes=%s\n' "$L" "$(shasum -a 256 "$f" | cut -d' ' -f1)" "$(wc -c < "$f" | tr -d ' ')"
done

echo "=== sha256 + bytes (remote — paste into manifest.json; NOT committed) ==="
tmp=$(mktemp)
for L in cpp c_sharp kotlin swift objc dart; do
  curl -fsSL "https://unpkg.com/$PACK/out/tree-sitter-$L.wasm" -o "$tmp"
  printf '%s  sha256=%s  bytes=%s\n' "$L" \
    "$(shasum -a 256 "$tmp" | cut -d' ' -f1)" \
    "$(wc -c < "$tmp" | tr -d ' ')"
done
rm -f "$tmp"
