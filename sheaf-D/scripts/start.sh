#!/usr/bin/env sh
# Runs Sheaf without Docker. Needs Node 20+ and, for the full tool set,
# the programs listed in the README.
set -e
cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  npm install
fi
npm run build
PORT="${PORT:-8080}" npm run start
