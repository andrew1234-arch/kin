#!/usr/bin/env bash
# Runs the real Gate A pipeline (src/gates/gateA.ts) against a local anvil chain seeded by
# contracts/script/LocalScanFixture.s.sol: one funder -> 3 buyers, plus 2 buyers funded by an
# "exchange" (the deployer, passed as EXTRA_EXCLUSIONS). Expected: 5 early buyers, 1 cluster of 3.
# This validates the RPC half of Gate A; the transfer-history provider is the dev-only rpc-scan.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT=${ANVIL_PORT:-8546}
RPC="http://127.0.0.1:${PORT}"
anvil --port "$PORT" --silent &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 0.2; done

WALLET=$(cast wallet new --json)
export DEPLOYER_PRIVATE_KEY=$(echo "$WALLET" | jq -r '(if type=="object" and has("data") then .data else . end | if type=="array" then .[0] else . end).private_key')
DEPLOYER=$(echo "$WALLET" | jq -r '(if type=="object" and has("data") then .data else . end | if type=="array" then .[0] else . end).address')
cast rpc --rpc-url "$RPC" anvil_setBalance "$DEPLOYER" 0x56BC75E2D63100000 >/dev/null

cd "$ROOT/contracts"
forge script script/DeployKin.s.sol --rpc-url "$RPC" --broadcast --slow >/dev/null
forge script script/LocalScanFixture.s.sol --rpc-url "$RPC" --broadcast --slow >/dev/null
TOKEN=$(jq -r .token deployments/31337-scan-fixture.json)
jq . deployments/31337-scan-fixture.json

cd "$ROOT/engine"
BASE_RPC_URL="$RPC" HISTORY_PROVIDER=rpc-scan EXTRA_EXCLUSIONS="$DEPLOYER" EARLY_BUYERS=50 \
  bun run src/gates/gateA.ts "$TOKEN"
