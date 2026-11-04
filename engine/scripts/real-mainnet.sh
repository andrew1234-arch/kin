#!/usr/bin/env bash
# Real Base mainnet run, read-only: provider probe -> replay sample selection -> Gate A on 3 sampled
# launches -> replay over the whole sample (reusing Gate A's scans). Results go to reports/.
#
# Settings come from the environment, then engine/.env (the environment wins; blank values are unset):
#   BASE_RPC_URL (archive), HISTORY_PROVIDER (+ BLOCKSCOUT_API_URL), optional GATE_A_PRICING.
# Arguments: [N=50] [RANGE_DAYS=7] [SETTLE_HOURS=24]
set -euo pipefail
ENGINE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$ENGINE/.." && pwd)"
cd "$ENGINE"
. scripts/run-env.sh
load_env "$ENGINE/.env"
: "${BASE_RPC_URL:?set BASE_RPC_URL (environment or engine/.env)}"
N=${1:-50}; DAYS=${2:-7}; SETTLE=${3:-24}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
REPORTS="$ROOT/reports"
mkdir -p "$REPORTS"
SAMPLE="$REPORTS/replay-sample-${STAMP}.json"
GATE_A="$REPORTS/gate-a-${STAMP}.json"
REPLAY="$REPORTS/replay-${STAMP}.json"

echo "== 1. history provider probe"
bun run scripts/probe-history.ts

echo "== 2. replay sample: Clanker v4, ${DAYS} days ending ${SETTLE} h ago, ${N} evenly spaced"
# Written atomically by the selector; on failure nothing is written.
bun run src/replay/selectSample.ts "$N" "$DAYS" "$SETTLE" --out "$SAMPLE"
cp "$SAMPLE" replay/sample.json

echo "== 3. Gate A on the first 3 sampled launches"
# Exit 10 = no token could be scanned (report written): continue to the replay. Any other failure
# (2 bad settings, 3 unexpected error, 1 Bun crash) stops the run.
set +e
bun run src/gates/gateA.ts --sample "$SAMPLE" --count 3 --out "$GATE_A"
GATE_A_STATUS=$?
set -e
case $GATE_A_STATUS in
  0) ;;
  10) echo "Gate A could not scan any of the 3 tokens (see $GATE_A); continuing to the replay" ;;
  *) echo "Gate A failed (exit $GATE_A_STATUS); stopping"; exit 1 ;;
esac

echo "== 4. replay over the whole sample (reusing Gate A's scans made with the same parameters)"
REUSE=()
[ -f "$GATE_A" ] && REUSE=(--reuse "$GATE_A")
# --publish updates the file the public /replay page serves, only if every sampled token was scanned.
bun run src/replay/replay.ts "$SAMPLE" ${REUSE[@]+"${REUSE[@]}"} --out "$REPLAY" --publish
jq '.aggregates' "$REPLAY"
echo "reports: $SAMPLE, $GATE_A, $REPLAY"
