#!/usr/bin/env bash
# Runs on every Codespace start: Setu in the background on port 8787 (log: /tmp/setu.log).
cd "$(dirname "$0")/../apps/server"
pkill -f 'tsx src/index.ts' 2>/dev/null || true
export SETU_LIVE_GEN=en,hi,or SETU_TRUST_DRAFT=1 PORT=8787
nohup node --import tsx src/index.ts > /tmp/setu.log 2>&1 &
echo "Setu starting: log in /tmp/setu.log"
