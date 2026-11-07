#!/usr/bin/env bash
# Runs the attack sandbox end to end on a local anvil chain (one block per second, like a real chain):
# deploy Kin, fund a throwaway relayer through anvil's RPC, then src/sandbox/cli.ts.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT=${ANVIL_PORT:-8547}
RPC="http://127.0.0.1:${PORT}"
anvil --port "$PORT" --block-time 1 --silent &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 0.2; done

WALLET=$(cast wallet new --json)
export DEPLOYER_PRIVATE_KEY=$(echo "$WALLET" | jq -r '(if type=="object" and has("data") then .data else . end | if type=="array" then .[0] else . end).private_key')
DEPLOYER=$(echo "$WALLET" | jq -r '(if type=="object" and has("data") then .data else . end | if type=="array" then .[0] else . end).address')
cast rpc --rpc-url "$RPC" anvil_setBalance "$DEPLOYER" 0x56BC75E2D63100000 >/dev/null

cd "$ROOT/contracts"
forge script script/DeployKin.s.sol --rpc-url "$RPC" --broadcast >/dev/null

cd "$ROOT/engine"
SANDBOX_RPC_URL="$RPC" SANDBOX_RELAYER_KEY="$DEPLOYER_PRIVATE_KEY" \
  SANDBOX_DEPLOYMENT="$ROOT/contracts/deployments/31337.json" SANDBOX_WINDOW_DELAY_SEC=3 \
  bun run src/sandbox/cli.ts
