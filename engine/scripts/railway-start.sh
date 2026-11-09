#!/usr/bin/env bash
# Container entrypoint for the hosted engine (Railway): the same settings as serve-sepolia.sh, from the environment.
# Required: DEPLOYER_PRIVATE_KEY, FAUCET_KEY. Optional: BASE_SEPOLIA_RPC_URL, BASE_RPC_URL, BASE_VERIFY_SECRET_KEY.
# DATA_DIR (/data) should be a volume; on first boot it is seeded with the launches in /app/engine/seed/sepolia.
set -euo pipefail
: "${DEPLOYER_PRIVATE_KEY:?set DEPLOYER_PRIVATE_KEY}"
: "${BASE_SEPOLIA_RPC_URL:=https://sepolia.base.org}"
: "${BASE_RPC_URL:=https://mainnet.base.org}"
is_alchemy() { case "$1" in *alchemy.com*) return 0 ;; *) return 1 ;; esac; }
DEP=/app/contracts/deployments

export LAUNCH_RPC_URL="${LAUNCH_RPC_URL:-$BASE_SEPOLIA_RPC_URL}" LAUNCH_CHAIN_ID=84532 LAUNCH_DEPLOYMENT="${LAUNCH_DEPLOYMENT:-$DEP/84532.json}"
export LAUNCH_ADMIN_KEY="${LAUNCH_ADMIN_KEY:-$DEPLOYER_PRIVATE_KEY}" PERMIT_SIGNER_KEY="${PERMIT_SIGNER_KEY:-$DEPLOYER_PRIVATE_KEY}"
if is_alchemy "$LAUNCH_RPC_URL"; then
  export LAUNCH_HISTORY_PROVIDER="${LAUNCH_HISTORY_PROVIDER:-alchemy}"
else
  export LAUNCH_HISTORY_PROVIDER="${LAUNCH_HISTORY_PROVIDER:-blockscout}" LAUNCH_BLOCKSCOUT_API_URL="${LAUNCH_BLOCKSCOUT_API_URL:-https://base-sepolia.blockscout.com/api/v2}"
fi
export BASE_RPC_URL
if is_alchemy "$BASE_RPC_URL"; then
  export HISTORY_PROVIDER="${HISTORY_PROVIDER:-alchemy}" LOGS_CHUNK="${LOGS_CHUNK:-10}" MAX_SCAN_BLOCKS="${MAX_SCAN_BLOCKS:-5400}"
else
  export HISTORY_PROVIDER="${HISTORY_PROVIDER:-blockscout}" BLOCKSCOUT_API_URL="${BLOCKSCOUT_API_URL:-https://base.blockscout.com/api/v2}"
fi
export SANDBOX_RPC_URL="${SANDBOX_RPC_URL:-$BASE_SEPOLIA_RPC_URL}" SANDBOX_RELAYER_KEY="${SANDBOX_RELAYER_KEY:-$DEPLOYER_PRIVATE_KEY}"
export SANDBOX_DEPLOYMENT="${SANDBOX_DEPLOYMENT:-$DEP/84532-sandbox.json}"
export SANDBOX_PER_WALLET_ETH="${SANDBOX_PER_WALLET_ETH:-0.00002}" SANDBOX_MAX_RUNS_PER_DAY="${SANDBOX_MAX_RUNS_PER_DAY:-12}"
export SANDBOX_EXPLORER_URL="${SANDBOX_EXPLORER_URL:-https://sepolia.basescan.org}"
export DEMO_LAUNCHES="${DEMO_LAUNCHES:-1}" PUBLIC_LAUNCHES="${PUBLIC_LAUNCHES:-1}" TRUST_PROXY="${TRUST_PROXY:-1}"
export DATA_DIR="${DATA_DIR:-/data}"

mkdir -p "$DATA_DIR"
if [ ! -d "$DATA_DIR/launches" ] && [ -d /app/engine/seed/sepolia ]; then
  cp -r /app/engine/seed/sepolia/. "$DATA_DIR/"
  echo "seeded $DATA_DIR from the image"
fi
echo "engine: launches on Base Sepolia (history: $LAUNCH_HISTORY_PROVIDER), scan on Base mainnet (history: $HISTORY_PROVIDER), port ${PORT:-8787}"
exec bun run src/server.ts
