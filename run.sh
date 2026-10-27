#!/usr/bin/env bash
# One-command launcher for macOS/Linux: installs deps on first run, then starts Prism.
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Install Node.js 18+ from https://nodejs.org first"; exit 1; }
[ -d node_modules ] || npm install
npm start
