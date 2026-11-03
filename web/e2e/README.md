# Browser checks (local stack only)

Run against `engine/scripts/dev-local.sh` plus a web build pointed at it (see the root README). Needs Playwright
with Chromium available to Node (`npm i -D playwright && npx playwright install chromium` if it isn't).

| Script | What it checks |
|---|---|
| `shots.cjs <base> <outDir> <path>…` | Screenshot every page at 1280 px and 390 px; flags horizontal overflow and console errors |
| `wallet-e2e.cjs <base> <rpc> <account> <out.png>` | Connect → register (signed) → file a dispute, on `/launch/demo-open` |
| `buy-e2e.cjs <base> <rpc> <account> <slug> <out.png>` | Wait for the window → buy through KinRouter → tokens vaulted → wait for the lock → claim |

The injected wallet forwards every request to anvil, whose dev accounts are unlocked; `<account>` is one of
`cast rpc eth_accounts`. Never point these at a live network.
