#!/usr/bin/env bash
# The hosted engine: launches, permits and the sandbox on Base Sepolia; Kin Scan on Base mainnet.
#   ./engine/scripts/serve-sepolia.sh            # API on :${PORT:-8788}
#   ./engine/scripts/serve-sepolia.sh admin create-instant <slug> <name> <symbol> ...   # the admin CLI, same settings
# Settings come from the environment, then contracts/.env, then engine/.env (earlier wins; blank = unset):
#   DEPLOYER_PRIVATE_KEY   launch admin, permit signer and sandbox relayer unless LAUNCH_ADMIN_KEY,
#                          PERMIT_SIGNER_KEY or SANDBOX_RELAYER_KEY are set (the hook trusts the deployer by default)
#   BASE_SEPOLIA_RPC_URL   default https://sepolia.base.org
#   BASE_RPC_URL           Base mainnet for Kin Scan; default https://mainnet.base.org
# Funding history: Alchemy when the matching RPC URL is an Alchemy endpoint, else the public Blockscout API.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
. "$ROOT/engine/scripts/run-env.sh"
load_env "$ROOT/contracts/.env" "$ROOT/engine/.env"
: "${DEPLOYER_PRIVATE_KEY:?set DEPLOYER_PRIVATE_KEY}"
: "${BASE_SEPOLIA_RPC_URL:=https://sepolia.base.org}"
: "${BASE_RPC_URL:=https://mainnet.base.org}"
DEP="$ROOT/contracts/deployments/84532.json"
[ -f "$DEP" ] || { echo "no Base Sepolia deployment: run engine/scripts/real-sepolia.sh first"; exit 1; }
[ "$(cast chain-id --rpc-url "$BASE_SEPOLIA_RPC_URL")" = "84532" ] || { echo "BASE_SEPOLIA_RPC_URL is not Base Sepolia"; exit 1; }
[ "$(cast chain-id --rpc-url "$BASE_RPC_URL")" = "8453" ] || { echo "BASE_RPC_URL is not Base mainnet"; exit 1; }
is_alchemy() { case "$1" in *alchemy.com*) return 0 ;; *) return 1 ;; esac; }

export LAUNCH_RPC_URL="${LAUNCH_RPC_URL:-$BASE_SEPOLIA_RPC_URL}" LAUNCH_CHAIN_ID=84532 LAUNCH_DEPLOYMENT="${LAUNCH_DEPLOYMENT:-$DEP}"
export LAUNCH_ADMIN_KEY="${LAUNCH_ADMIN_KEY:-$DEPLOYER_PRIVATE_KEY}" PERMIT_SIGNER_KEY="${PERMIT_SIGNER_KEY:-$DEPLOYER_PRIVATE_KEY}"
if is_alchemy "$LAUNCH_RPC_URL"; then
  export LAUNCH_HISTORY_PROVIDER="${LAUNCH_HISTORY_PROVIDER:-alchemy}"
else
  export LAUNCH_HISTORY_PROVIDER="${LAUNCH_HISTORY_PROVIDER:-blockscout}" LAUNCH_BLOCKSCOUT_API_URL="${LAUNCH_BLOCKSCOUT_API_URL:-https://base-sepolia.blockscout.com/api/v2}"
fi
export BASE_RPC_URL
if is_alchemy "$BASE_RPC_URL"; then
  # Alchemy's free tier answers eth_getLogs for at most 10 blocks per call; Scan stops once it has its early buyers,
  # so it is usually a few dozen calls. 3 h of blocks at most (2 s blocks) bounds a token with few buyers.
  export HISTORY_PROVIDER="${HISTORY_PROVIDER:-alchemy}" LOGS_CHUNK="${LOGS_CHUNK:-10}" MAX_SCAN_BLOCKS="${MAX_SCAN_BLOCKS:-5400}"
else
  export HISTORY_PROVIDER="${HISTORY_PROVIDER:-blockscout}" BLOCKSCOUT_API_URL="${BLOCKSCOUT_API_URL:-https://base.blockscout.com/api/v2}"
fi

# Sandbox: small buys so a few runs a day don't drain the relayer.
export SANDBOX_RPC_URL="${SANDBOX_RPC_URL:-$BASE_SEPOLIA_RPC_URL}" SANDBOX_RELAYER_KEY="${SANDBOX_RELAYER_KEY:-$DEPLOYER_PRIVATE_KEY}"
export SANDBOX_DEPLOYMENT="${SANDBOX_DEPLOYMENT:-$ROOT/contracts/deployments/84532-sandbox.json}"
export SANDBOX_PER_WALLET_ETH="${SANDBOX_PER_WALLET_ETH:-0.00002}" SANDBOX_MAX_RUNS_PER_DAY="${SANDBOX_MAX_RUNS_PER_DAY:-12}"
export SANDBOX_EXPLORER_URL="${SANDBOX_EXPLORER_URL:-https://sepolia.basescan.org}"

export DATA_DIR="${DATA_DIR:-$ROOT/engine/data/runtime/sepolia}" PORT="${PORT:-8788}" TRUST_PROXY="${TRUST_PROXY:-1}"
mkdir -p "$DATA_DIR"
cd "$ROOT/engine"
if [ "${1:-}" = "admin" ]; then
  shift
  export LAUNCH_DEPLOYMENT
  exec bun run src/launch/admin.ts "$@"
fi
echo "engine: launches on Base Sepolia (history: $LAUNCH_HISTORY_PROVIDER), scan on Base mainnet (history: $HISTORY_PROVIDER), port $PORT"
exec bun run src/server.ts
