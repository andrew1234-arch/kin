#!/usr/bin/env bash
# Full local stack: anvil (1 s blocks) + Kin contracts + engine API seeded with demo data.
# Scan runs against the local chain (scan fixture token), launches and the sandbox too.
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
export DEPLOYER_PRIVATE_KEY=$(echo "$WALLET" | jq -r '.[0].private_key')
DEPLOYER=$(echo "$WALLET" | jq -r '.[0].address')
cast rpc --rpc-url "$RPC" anvil_setBalance "$DEPLOYER" 0x56BC75E2D63100000 >/dev/null

cd "$ROOT/contracts"
forge script script/DeployKin.s.sol --rpc-url "$RPC" --broadcast >/dev/null
forge script script/LocalScanFixture.s.sol:LocalScanFixture --rpc-url "$RPC" --broadcast >/dev/null
forge script script/LocalScanFixture.s.sol:LocalScanFixtureBuys --rpc-url "$RPC" --broadcast >/dev/null
echo "scan token: $(jq -r .token deployments/31337-scan-fixture.json)"

cd "$ROOT/engine"
export BASE_RPC_URL="$RPC" HISTORY_PROVIDER=rpc-scan EXTRA_EXCLUSIONS="$DEPLOYER"
export LAUNCH_RPC_URL="$RPC" LAUNCH_CHAIN_ID=31337 LAUNCH_HISTORY_PROVIDER=rpc-scan
export SANDBOX_RPC_URL="$RPC" SANDBOX_RELAYER_KEY="$DEPLOYER_PRIVATE_KEY" SANDBOX_DEPLOYMENT="$ROOT/contracts/deployments/31337.json" SANDBOX_WINDOW_DELAY_SEC=3
export PORT=${PORT:-8787}
bun run src/server.ts &
PIDS+=($!)
for _ in $(seq 1 50); do curl -s "http://127.0.0.1:$PORT/health" >/dev/null && break; sleep 0.2; done

API_URL="http://127.0.0.1:$PORT" RPC_URL="$RPC" ADMIN_KEY="$DEPLOYER_PRIVATE_KEY" \
  DEPLOYMENT="$ROOT/contracts/deployments/31337.json" bun run scripts/seed-local.ts
echo "DATA_DIR=$DATA_DIR"
echo "engine API on http://127.0.0.1:$PORT — ready"
wait
