#!/usr/bin/env bash
# Real Base Sepolia run: deploy Kin (unless a deployment with live code is recorded) -> Gate B (launch,
# rejected swap through Uniswap's PoolSwapTest, capped + vaulted KinRouter buy) -> one attack-sandbox run.
#
# Settings come from the environment, then contracts/.env, then engine/.env (earlier wins; blank = unset):
#   BASE_SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY (funded with Base Sepolia ETH),
#   SANDBOX_RELAYER_KEY (funded; defaults to the deployer key), optional SANDBOX_EXPLORER_URL.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
. "$ROOT/engine/scripts/run-env.sh"
load_env "$ROOT/contracts/.env" "$ROOT/engine/.env"
: "${BASE_SEPOLIA_RPC_URL:?set BASE_SEPOLIA_RPC_URL}" "${DEPLOYER_PRIVATE_KEY:?set DEPLOYER_PRIVATE_KEY}"
RPC="$BASE_SEPOLIA_RPC_URL"
[ "$(cast chain-id --rpc-url "$RPC")" = "84532" ] || { echo "BASE_SEPOLIA_RPC_URL is not Base Sepolia"; exit 1; }
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$ROOT/reports"
cd "$ROOT/contracts"
DEP=deployments/84532.json

# A deployment file is trusted only if every recorded contract has code onchain. forge writes the file
# during simulation, so a failed broadcast can leave one behind that points at nothing. An RPC error while
# checking stops the run: it must never be mistaken for "has code", nor trigger a needless redeploy.
deployment_live() {
  local k a code
  [ -f "$DEP" ] || return 1
  [ "$(jq -r .chainId "$DEP")" = "84532" ] || return 1
  for k in kinRouter kinHook kinVault factory; do
    a=$(jq -r ".$k // empty" "$DEP")
    [ -n "$a" ] || return 1
    if ! code=$(cast code "$a" --rpc-url "$RPC"); then
      echo "RPC error while checking $k at $a; stopping" >&2
      exit 1
    fi
    if ! [[ "$code" =~ ^0x[0-9a-fA-F]*$ ]]; then
      echo "unexpected reply while checking $k at $a: '$code'; stopping" >&2
      exit 1
    fi
    [ "$code" != "0x" ] || return 1
  done
}
if deployment_live; then
  echo "== using the recorded deployment (all contracts have code)"
else
  if [ -f "$DEP" ]; then
    mv "$DEP" "deployments/84532.stale-${STAMP}.json"
    echo "== recorded deployment had no code onchain; moved to deployments/84532.stale-${STAMP}.json"
  fi
  echo "== deploy Kin to Base Sepolia"
  forge script script/DeployKin.s.sol --rpc-url "$RPC" --broadcast --slow
  deployment_live || { echo "deployment did not land onchain; see the forge output above"; exit 1; }
fi
jq . "$DEP"

# forge script can print "Error: script failed" and still exit 0, so every step below is checked onchain.
num() { awk '{print $1}'; } # strip cast's "[1e15]" annotations
FACTORY=$(jq -r .factory "$DEP"); HOOK=$(jq -r .kinHook "$DEP"); VAULT=$(jq -r .kinVault "$DEP")

echo "== Gate B: create launch"
BEFORE=$(cast call "$FACTORY" "launchCount()(uint256)" --rpc-url "$RPC" | num)
forge script script/GateB.s.sol:GateBCreateLaunch --rpc-url "$RPC" --broadcast --slow > "$ROOT/reports/gate-b-create-${STAMP}.log" 2>&1 || true
AFTER=$(cast call "$FACTORY" "launchCount()(uint256)" --rpc-url "$RPC" | num)
if [ "$AFTER" -le "$BEFORE" ] || [ "$(jq -r .launchIndex deployments/84532-gateb.json 2>/dev/null)" != "$((AFTER - 1))" ]; then
  tail -20 "$ROOT/reports/gate-b-create-${STAMP}.log"; echo "GATE B: launch creation failed (factory launchCount $BEFORE -> $AFTER)"; exit 1
fi
grep -E "launch index|token|window opens" "$ROOT/reports/gate-b-create-${STAMP}.log" || true
OPENS=$(jq -r .windowStart deployments/84532-gateb.json)
echo "== waiting for the window (opens at $OPENS)"
until [ "$(cast block latest -f timestamp --rpc-url "$RPC")" -ge "$OPENS" ]; do sleep 3; done
echo "== Gate B: other router must be rejected, KinRouter buy must land"
forge script script/GateB.s.sol:GateBSwap --rpc-url "$RPC" --broadcast --slow > "$ROOT/reports/gate-b-${STAMP}.log" 2>&1 || true
POOL=$(jq -r .poolId deployments/84532-gateb.json); ENTITY=$(jq -r .entityId deployments/84532-gateb.json); BUYER=$(jq -r .buyer deployments/84532-gateb.json)
SPENT=$(cast call "$HOOK" "entitySpent(bytes32,bytes32)(uint256)" "$POOL" "$ENTITY" --rpc-url "$RPC" | num)
OWED=$(cast call "$VAULT" "owed(bytes32,address)(uint256)" "$POOL" "$BUYER" --rpc-url "$RPC" | num)
if ! grep -q "UntrustedRouter: OK" "$ROOT/reports/gate-b-${STAMP}.log" || [ "$SPENT" = "0" ] || [ "$OWED" = "0" ]; then
  tail -20 "$ROOT/reports/gate-b-${STAMP}.log"
  echo "GATE B FAILED: other-router rejection logged: $(grep -c 'UntrustedRouter: OK' "$ROOT/reports/gate-b-${STAMP}.log"), onchain entity spend $SPENT, vaulted $OWED"
  exit 1
fi
echo "GATE B PASSED: other router rejected (UntrustedRouter); onchain entity spend $SPENT wei, $OWED tokens vaulted for $BUYER"

echo "== attack sandbox: one run"
cd "$ROOT/engine"
SANDBOX_RPC_URL="${SANDBOX_RPC_URL:-$RPC}" SANDBOX_RELAYER_KEY="${SANDBOX_RELAYER_KEY:-$DEPLOYER_PRIVATE_KEY}" \
  SANDBOX_DEPLOYMENT="$ROOT/contracts/$DEP" \
  bun run src/sandbox/cli.ts | tee "$ROOT/reports/sandbox-${STAMP}.log" | tail -1
echo "logs in reports/ — stamp ${STAMP}"
