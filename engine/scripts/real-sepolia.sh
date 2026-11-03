#!/usr/bin/env bash
# Real Base Sepolia run: deploy Kin (if not yet deployed) -> Gate B (launch, rejected swap through
# Uniswap's PoolSwapTest, capped + vaulted KinRouter buy) -> one attack-sandbox run.
#
# Needs: BASE_SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY (funded with Base Sepolia ETH),
#        SANDBOX_RELAYER_KEY (funded; may be the same key), optional SANDBOX_EXPLORER_URL.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$ROOT/contracts/.env" ] && set -a && . "$ROOT/contracts/.env" && set +a
[ -f "$ROOT/engine/.env" ] && set -a && . "$ROOT/engine/.env" && set +a
: "${BASE_SEPOLIA_RPC_URL:?set BASE_SEPOLIA_RPC_URL}" "${DEPLOYER_PRIVATE_KEY:?set DEPLOYER_PRIVATE_KEY}"
[ "$(cast chain-id --rpc-url "$BASE_SEPOLIA_RPC_URL")" = "84532" ] || { echo "not Base Sepolia"; exit 1; }
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$ROOT/reports"
cd "$ROOT/contracts"

if [ ! -f deployments/84532.json ]; then
  echo "== deploy Kin to Base Sepolia"
  forge script script/DeployKin.s.sol --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast --slow
fi
jq . deployments/84532.json

echo "== Gate B: create launch"
forge script script/GateB.s.sol:GateBCreateLaunch --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast --slow 2>&1 | grep -E "launch index|token|window opens|Error|error"
OPENS=$(jq -r .windowStart deployments/84532-gateb.json)
echo "== waiting for the window (opens at $OPENS)"
until [ "$(cast block latest -f timestamp --rpc-url "$BASE_SEPOLIA_RPC_URL")" -ge "$OPENS" ]; do sleep 3; done
echo "== Gate B: other router must be rejected, KinRouter buy must land"
forge script script/GateB.s.sol:GateBSwap --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast --slow 2>&1 | tee "$ROOT/reports/gate-b-${STAMP}.log" | grep -E "OK|landed|vaulted|FAIL|Error"

echo "== attack sandbox: one run"
cd "$ROOT/engine"
SANDBOX_RPC_URL="${SANDBOX_RPC_URL:-$BASE_SEPOLIA_RPC_URL}" SANDBOX_RELAYER_KEY="${SANDBOX_RELAYER_KEY:-$DEPLOYER_PRIVATE_KEY}" \
  SANDBOX_DEPLOYMENT="$ROOT/contracts/deployments/84532.json" \
  bun run src/sandbox/cli.ts | tee "$ROOT/reports/sandbox-${STAMP}.log" | tail -1
echo "logs in reports/ — stamp ${STAMP}"
