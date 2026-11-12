#!/usr/bin/env bash
# Builds the WordCraft word processor (github.com/storytold/wordcraft) for the browser and puts
# it in public/wordcraft, where the Edit Word and Convert Word tools load it from.
#
# Needs Rust (rustup), the wasm32 target and trunk:
#   rustup target add wasm32-unknown-unknown
#   cargo install trunk --locked
#
# The built files are committed, so you only need this to move to a newer WordCraft.
# Change WORDCRAFT_REV, run it, and commit public/wordcraft.
set -euo pipefail

WORDCRAFT_REV="${WORDCRAFT_REV:-07f977372d3767e4abf7f3b0cc77c351289013f2}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$HERE/public/wordcraft"
SRC="${WORDCRAFT_SRC:-$HERE/.wordcraft-src}"

if [ ! -d "$SRC/.git" ]; then
  git clone https://github.com/storytold/wordcraft "$SRC"
fi
git -C "$SRC" fetch --quiet origin "$WORDCRAFT_REV" || true
git -C "$SRC" checkout --quiet "$WORDCRAFT_REV"

(cd "$SRC/apps/wordcraft-web" && trunk build --release)

rm -rf "$OUT"
mkdir -p "$OUT"
cp -R "$SRC/dist/web/." "$OUT/"
# The licence and notices travel with the build (MIT OR Apache-2.0, plus bundled fonts).
cp "$SRC/LICENSE-MIT" "$SRC/LICENSE-APACHE" "$SRC/NOTICE" "$OUT/"
echo "$WORDCRAFT_REV" > "$OUT/REVISION"
du -sh "$OUT"
