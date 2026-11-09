#!/usr/bin/env bash
# Copies the engine's secrets from contracts/.env and engine/.env into the linked Railway service, without printing
# them. Run once after `railway link` (or `railway init`):   ./engine/scripts/railway-env.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RAILWAY="${RAILWAY:-$(command -v railway || echo "$HOME/.local/railway/node_modules/.bin/railway")}"
. "$ROOT/engine/scripts/run-env.sh"
load_env "$ROOT/contracts/.env" "$ROOT/engine/.env"
: "${DEPLOYER_PRIVATE_KEY:?set DEPLOYER_PRIVATE_KEY in contracts/.env}"
# Same faucet key serve-sepolia.sh derives, so the hosted faucet is the wallet already funded.
FAUCET_KEY="${FAUCET_KEY:-$(cast keccak "kin-faucet:$DEPLOYER_PRIVATE_KEY")}"
args=(--set "DEPLOYER_PRIVATE_KEY=$DEPLOYER_PRIVATE_KEY" --set "FAUCET_KEY=$FAUCET_KEY")
for k in BASE_SEPOLIA_RPC_URL BASE_RPC_URL BASE_VERIFY_SECRET_KEY CORS_ORIGIN; do
  [ -n "${!k:-}" ] && args+=(--set "$k=${!k}")
done
"$RAILWAY" variables "${args[@]}" --skip-deploys >/dev/null
echo "set on Railway: DEPLOYER_PRIVATE_KEY FAUCET_KEY$(for k in BASE_SEPOLIA_RPC_URL BASE_RPC_URL BASE_VERIFY_SECRET_KEY CORS_ORIGIN; do [ -n "${!k:-}" ] && printf ' %s' "$k"; done)"
