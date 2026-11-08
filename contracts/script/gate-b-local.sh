#!/usr/bin/env bash
# Gate B rehearsal on a local anvil chain: deploy -> create launch -> wait for window ->
# rejected swap via another router (simulated + a real failed tx) -> capped, vaulted buy via KinRouter.
# The Base Sepolia run uses the same scripts with --rpc-url base_sepolia (see contracts/README.md).
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=${ANVIL_PORT:-8545}
RPC="http://127.0.0.1:${PORT}"
anvil --port "$PORT" --silent &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 0.2; done

# A throwaway key, funded through anvil's RPC (no dev keys hardcoded).
WALLET=$(cast wallet new --json)
export DEPLOYER_PRIVATE_KEY=$(echo "$WALLET" | jq -r '.[0].private_key')
DEPLOYER=$(echo "$WALLET" | jq -r '.[0].address')
cast rpc --rpc-url "$RPC" anvil_setBalance "$DEPLOYER" 0x56BC75E2D63100000 >/dev/null  # 100 ETH
export GATE_B_DELAY_SECONDS=30

echo "== deploy"
forge script script/DeployKin.s.sol --rpc-url "$RPC" --broadcast --slow 2>&1 | grep -E "^  (chainId|PoolManager|KinRouter|KinHook|KinVault|Factory|OtherRouter)|Error" 
echo "== create launch"
forge script script/GateB.s.sol:GateBCreateLaunch --rpc-url "$RPC" --broadcast --slow 2>&1 | grep -E "launch index|window opens|Error"

echo "== advance time past windowStart"
cast rpc --rpc-url "$RPC" evm_increaseTime 60 >/dev/null
cast rpc --rpc-url "$RPC" evm_mine >/dev/null

echo "== swap: other router (must be rejected) + KinRouter (must land)"
forge script script/GateB.s.sol:GateBSwap --rpc-url "$RPC" --broadcast --slow 2>&1 | grep -E "OK|landed|vaulted|FAIL|Error" || true

echo "== explorer-visible rejection: real tx through the other router with a fixed gas limit"
DEP=deployments/31337.json
GB=deployments/31337-gateb.json
OTHER=$(jq -r .otherRouter $DEP); FACTORY=$(jq -r .factory $DEP); IDX=$(jq -r .launchIndex $GB)
KEY=$(cast call --rpc-url "$RPC" "$FACTORY" "launchKey(uint256)((address,address,uint24,int24,address))" "$IDX")
KEY=$(echo "$KEY" | sed -E 's/ ?\[[^]]*\]//g' | tr -d ' ')
STATUS=$(cast send --rpc-url "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" --gas-limit 500000 --value 100000000000000 \
  "$OTHER" "swap((address,address,uint24,int24,address),(bool,int256,uint160),(bool,bool),bytes)" \
  "$KEY" "(true,-100000000000000,4295128740)" "(false,false)" 0x --json | jq -r .status)
echo "other-router tx status: $STATUS (0x0 = reverted, as required)"
