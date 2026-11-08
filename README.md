<p><img src="brand/kin-logo-on-light.png" alt="Kin" height="72"></p>

# Kin

**Token launches on Base that cap entities, not wallets.**

Clanker taxes everyone who's early. Kin only limits the ones who are secretly the same person.

Wallets are grouped into entities by onchain funding evidence (shared funders within two hops, funding
sources, same-block buys). Linked wallets share one cap, fresh wallets share one pooled cap, aged unlinked
wallets get their own. A launch runs in one of two modes:

- **Instant** (default): no registration. When a wallet asks to buy, the engine traces its funding on the spot,
  assigns it an entity and signs an EIP-712 permit for that entity and cap, valid until the window closes (the
  browser keeps it, so a wallet that has its permit can buy even if the engine goes offline). KinHook checks the
  signature against its permit signer in the swap. The rules' hash is committed onchain at deploy and every
  assignment is public at `/launches/<slug>/permits`.
- **Allowlist**: wallets register first; the entities go into a Merkle root and an evidence file whose hash is
  committed onchain before the window, and wallets can dispute a link until the window opens.

In both modes, during the window a Uniswap v4 hook only accepts buys through the Kin router, within each
entity's cap, and the tokens sit in a vault until the lock ends. Then trading opens to everyone. This makes bundling expensive and visible; it does not stop it.

What Kin does not protect, by design today: buys after the window (open trading, no caps), the order of buys
inside the window (earlier buys get a better price), and the launcher's honesty about the root and evidence
(anyone can recompute them from the published evidence, but nothing onchain checks them). In instant mode the
hook trusts the engine's permit signer instead: every assignment it signs is public and each buy's entity is in
the `WindowBuy` event, but there is no dispute before the buy. See BUILD_LOG.md.

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
| Contracts | 53 tests pass (`cd contracts && forge test`), 12 of them for instant-launch permits |
| Engine | 57 tests pass (`cd engine && bun test`), including launch-backend and instant-launch integration tests on a local chain |
| Cluster engine | Weighted evidence ported from [Nuno](https://github.com/andrew1234-arch/nuno) (same funder 1.0, shared source 0.8, same-block early buy 0.5, merge at 1.0, hub cap with farm exception) |
| Kin Scan (API + page) | Built; verified on a local chain. Not yet run on Base mainnet |
| Attack sandbox (relayer + page) | Built; verified on a local chain with 1 s blocks: Kin pool 10/20, plain pool 20/20, ~20 s |
| Kin Launch, allowlist mode (register → allowlist + evidence → dispute → window buy → vault → claim → receipt) | Built; verified on a local chain. Not yet on Base Sepolia |
| Kin Launch, instant mode (connect → funding traced at buy time → signed permit → window buy → vault → claim → receipt) | Built; contracts and engine tested, seeded on a local chain (`demo-instant`). Not yet on Base Sepolia |
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
4. Create a launch. Instant (no registration; set `PERMIT_SIGNER_KEY` to the hook's permit signer, the deployer by
   default): `bun run src/launch/admin.ts create-instant <slug> <name> <symbol> …` creates and deploys in one step;
   keep the engine online through the window. Allowlist: `create <slug> <name> <symbol> …`, then `build` and `deploy`
   when registration closes, `resolve` / `build` / `update-root` for disputes. `finalize` after the window either way.
5. Real-network runs, one command each (results land in `reports/`):
   - `engine/scripts/real-mainnet.sh [N=50] [DAYS=7] [SETTLE_HOURS=24]`: probes the history provider, selects the
     replay sample by rule from Clanker v4 `TokenCreated` events (WETH-paired, evenly spaced over a settled 7-day
     range), runs Gate A on 3 of them, then the replay over the whole sample.
   - `engine/scripts/real-sepolia.sh`: deploys Kin to Base Sepolia if needed, runs Gate B, then one sandbox run.
