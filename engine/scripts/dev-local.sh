#!/usr/bin/env bash
# Full local stack: anvil (1 s blocks) + Kin contracts + engine API seeded with demo data.
# Launches and the sandbox run on the local chain. Scan does too (fixture token) unless BASE_RPC_URL is set.
#   ./engine/scripts/dev-local.sh            # keeps running; Ctrl-C to stop
# Then: cd web && NEXT_PUBLIC_KIN_API=http://127.0.0.1:8787 NEXT_PUBLIC_CHAIN_ID=31337 \
#       NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545 NEXT_PUBLIC_DEPLOYMENT_JSON="$(cat contracts/deployments/31337.json)" npm run dev
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RPC="http://127.0.0.1:${ANVIL_PORT:-8545}"
export DATA_DIR=${DATA_DIR:-$(mktemp -d)}
anvil --port "${ANVIL_PORT:-8545}" --block-time 1 --silent &
PIDS=($!)
trap 'kill ${PIDS[@]} 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 0.2; done

WALLET=$(cast wallet new --json)
export DEPLOYER_PRIVATE_KEY=$(echo "$WALLET" | jq -r '(if type=="object" and has("data") then .data else . end | if type=="array" then .[0] else . end).private_key')
DEPLOYER=$(echo "$WALLET" | jq -r '(if type=="object" and has("data") then .data else . end | if type=="array" then .[0] else . end).address')
cast rpc --rpc-url "$RPC" anvil_setBalance "$DEPLOYER" 0x56BC75E2D63100000 >/dev/null

cd "$ROOT/contracts"
forge script script/DeployKin.s.sol --rpc-url "$RPC" --broadcast >/dev/null
forge script script/LocalScanFixture.s.sol:LocalScanFixture --rpc-url "$RPC" --broadcast >/dev/null
forge script script/LocalScanFixture.s.sol:LocalScanFixtureBuys --rpc-url "$RPC" --broadcast >/dev/null
echo "scan token: $(jq -r .token deployments/31337-scan-fixture.json)"

cd "$ROOT/engine"
# Kin Scan: real Base mainnet tokens when BASE_RPC_URL is an Alchemy Base mainnet endpoint, else the local fixture token.
if [ -n "${BASE_RPC_URL:-}" ]; then
  export HISTORY_PROVIDER=${HISTORY_PROVIDER:-alchemy}
  echo "scan: Base mainnet via BASE_RPC_URL"
else
  export BASE_RPC_URL="$RPC" HISTORY_PROVIDER=rpc-scan
  echo "scan: local chain only (set BASE_RPC_URL to an Alchemy Base mainnet URL to scan real tokens)"
fi
export EXTRA_EXCLUSIONS="$DEPLOYER"
export LAUNCH_RPC_URL="$RPC" LAUNCH_CHAIN_ID=31337 LAUNCH_HISTORY_PROVIDER=rpc-scan
# DeployKin makes the deployer the hook's permit signer, so the engine signs instant-launch permits with it.
export PERMIT_SIGNER_KEY="$DEPLOYER_PRIVATE_KEY"
export SANDBOX_RPC_URL="$RPC" SANDBOX_RELAYER_KEY="$DEPLOYER_PRIVATE_KEY" SANDBOX_DEPLOYMENT="$ROOT/contracts/deployments/31337.json" SANDBOX_WINDOW_DELAY_SEC=3
export PORT=${PORT:-8787}
bun run src/server.ts &
PIDS+=($!)
for _ in $(seq 1 50); do curl -s "http://127.0.0.1:$PORT/health" >/dev/null && break; sleep 0.2; done

API_URL="http://127.0.0.1:$PORT" RPC_URL="$RPC" ADMIN_KEY="$DEPLOYER_PRIVATE_KEY" \
  DEPLOYMENT="$ROOT/contracts/deployments/31337.json" bun run scripts/seed-local.ts
echo "DATA_DIR=$DATA_DIR"
echo "engine API on http://127.0.0.1:$PORT: ready"
wait
