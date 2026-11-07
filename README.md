# Kin

**Token launches on Base that cap entities, not wallets.**

Clanker taxes everyone who's early. Kin only limits the ones who are secretly the same person.

Wallets register for a launch. Registered wallets are grouped into entities by weighted onchain evidence (shared funders, funding sources, same-block buys), and the
evidence is published as a file whose hash is committed onchain before the window opens. Linked wallets share
one cap, fresh wallets share one pooled cap, aged unlinked wallets get their own. During the window a Uniswap v4
hook only accepts buys through the Kin router, within each entity's cap, and the tokens sit in a vault until the
lock ends. Then trading opens to everyone. This makes bundling expensive and visible; it does not stop it.

## Layout

```
contracts/   Foundry: KinHook, KinRouter, KinVault, KinLaunchFactory, tests, deploy + Gate B scripts
engine/      Bun + TypeScript: Kin Scan, cluster engine, allowlist builder, launch backend, sandbox relayer,
             replay job, Gate A, HTTP API (src/server.ts)
web/         Next.js: /, /scan, /sandbox, /launch, /launch/[slug], /receipt/[slug], /embed/receipt/[slug], /replay
BUILD_LOG.md what was built, with which AI tool, and what was changed by hand
SCORECARD.md the Vibeathon 02 rubric, scored with evidence and open gaps
```

## Status

| Piece | State |
|---|---|
| Contracts | 31 tests pass (`cd contracts && forge test`) |
| Engine | 50 tests pass (`cd engine && bun test`), including a launch-backend integration test on a local chain |
| Cluster engine | Weighted evidence ported from [Nuno](https://github.com/andrew1234-arch/nuno) (same funder 1.0, shared source 0.8, same-block early buy 0.5, merge at 1.0, hub cap with farm exception) |
| Kin Scan (API + page) | Built; verified on a local chain. Not yet run on Base mainnet |
| Attack sandbox (relayer + page) | Built; verified on a local chain with 1 s blocks: Kin pool 10/20, plain pool 20/20, ~20 s |
| Kin Launch (register → allowlist + evidence → dispute → window buy → vault → claim → receipt) | Built; verified on a local chain. Not yet on Base Sepolia |
| Fairness Receipt page + embed | Built |
| Replay job + page | Built; sample selection is by rule from Clanker v4 events; **not yet computed** (needs Base mainnet access) |
| Base Verify tier (verified-human cap) | Built and tested against a local mock of Base's API; needs a Base Verify secret key (Base's interest form) to go live |
| Gate A / Gate B on real networks | Pending: this build environment cannot reach Base |
| Live URL | None yet |

No number in this repository describes real-world usage or Base data until a job has computed it.

## Run everything locally

Needs Foundry, Bun and Node.

```bash
git clone --recursive https://github.com/andrew1234-arch/kin && cd kin
(cd contracts && forge test)
(cd engine && bun install && bun test)
./engine/scripts/dev-local.sh      # anvil + contracts + engine API on :8787, seeded with demo launches
# in another shell:
cd web && npm install
NEXT_PUBLIC_KIN_API=http://127.0.0.1:8787 NEXT_PUBLIC_CHAIN_ID=31337 NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545 \
NEXT_PUBLIC_DEPLOYMENT_JSON="$(cat ../contracts/deployments/31337.json)" npm run dev
```

## Go live (Base Sepolia + Base mainnet read-only)

1. Fund a throwaway deployer with Base Sepolia ETH. Deploy: see `contracts/README.md` (Gate B runbook).
2. Run the engine (`engine/Dockerfile`) on a worker host with the variables in `engine/.env.example`
   (Base mainnet RPC + history provider for Scan; Base Sepolia RPC for launches and the sandbox relayer key).
3. Deploy `web/` to Vercel with the variables in `web/.env.example`.
4. Create a launch: `bun run src/launch/admin.ts create <slug> <name> <symbol> …`, then `build` and `deploy`
   when registration closes, `resolve` / `build` / `update-root` for disputes, and `finalize` after the window.
5. Real-network runs, one command each (results land in `reports/`):
   - `engine/scripts/real-mainnet.sh [N=50] [DAYS=7] [SETTLE_HOURS=24]`: probes the history provider, selects the
     replay sample by rule from Clanker v4 `TokenCreated` events (WETH-paired, evenly spaced over a settled 7-day
     range), runs Gate A on 3 of them, then the replay over the whole sample.
   - `engine/scripts/real-sepolia.sh`: deploys Kin to Base Sepolia if needed, runs Gate B, then one sandbox run.
