#!/usr/bin/env bash
# Real Base mainnet run, read-only: provider probe -> replay sample selection -> Gate A on 3 sampled
# launches -> replay over the whole sample. Results are copied to reports/ for publishing.
#
# Needs (engine/.env or the environment): BASE_RPC_URL (archive), HISTORY_PROVIDER (+ BLOCKSCOUT_API_URL),
# optionally GATE_A_PRICING. Arguments: [N=50] [RANGE_DAYS=7] [SETTLE_HOURS=24]
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a
: "${BASE_RPC_URL:?set BASE_RPC_URL}"
N=${1:-50}; DAYS=${2:-7}; SETTLE=${3:-24}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p ../reports

echo "== 1. history provider probe"
bun run scripts/probe-history.ts

echo "== 2. replay sample: Clanker v4, ${DAYS} days ending ${SETTLE} h ago, ${N} evenly spaced"
bun run src/replay/selectSample.ts "$N" "$DAYS" "$SETTLE" > replay/sample.json
cp replay/sample.json "../reports/replay-sample-${STAMP}.json"

echo "== 3. Gate A on the first 3 sampled launches"
mapfile -t TOKENS < <(jq -r '.tokens[0:3][].address' replay/sample.json)
bun run src/gates/gateA.ts "${TOKENS[@]}"
cp "$(ls -t out/gate-a-*.json | head -1)" "../reports/gate-a-${STAMP}.json"

echo "== 4. replay over the whole sample"
export DATA_DIR=${DATA_DIR:-$(pwd)/data/runtime}
bun run src/replay/replay.ts replay/sample.json
cp "$DATA_DIR/replay/latest.json" "../reports/replay-${STAMP}.json"
jq '.aggregates' "../reports/replay-${STAMP}.json"
echo "reports written to reports/ (sample, gate A, replay) — stamp ${STAMP}"
