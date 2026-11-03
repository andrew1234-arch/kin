# Kin

**Token launches on Base that cap entities, not wallets.**

Clanker taxes everyone who's early. Kin only limits the ones who are secretly the same person.

Wallets register for a launch. Registered wallets are grouped into entities by shared funding sources, and the
evidence is published as a file whose hash is committed onchain before the window opens. Linked wallets share
one cap, fresh wallets share one pooled cap, aged unlinked wallets get their own. During the window a Uniswap v4
hook only accepts buys through the Kin router, within each entity's cap, and the tokens sit in a vault until the
lock ends. Then trading opens to everyone. This makes bundling expensive and visible; it does not stop it.

## Layout

```
contracts/   Foundry: KinHook, KinRouter, KinVault, KinLaunchFactory, tests, deploy + Gate B scripts
engine/      Bun + TypeScript: cluster engine, allowlist builder, exclusion list, Gate A
web/         Next.js: Scan, Sandbox, Launch, Receipt, Replay pages
BUILD_LOG.md what was built, with which AI tool, and what was changed by hand
```

## Status (3 Nov 2026)

| Piece | State |
|---|---|
| Contracts | Built; 31 tests pass (`cd contracts && forge test`) |
| Gate B | Passes on a local chain; Base Sepolia run pending (network + funded key) |
| Engine: clustering, allowlist, evidence | Built; 9 tests pass (`cd engine && bun test`) |
| Gate A | Script ready and checked on a local chain; not yet run on Base |
| Kin Scan, Sandbox, Launch UI, Receipt, Replay | Not built yet |
| Live URL | None yet |

No number in this repository describes real-world usage or Base data until a job has computed it.

## Run

```bash
git clone --recursive https://github.com/andrew1234-arch/kin && cd kin
(cd contracts && forge test)
(cd engine && bun install && bun test)
(cd web && npm install && npm run build)
./contracts/script/gate-b-local.sh     # Gate B rehearsal on anvil
./engine/scripts/gate-a-local.sh       # Gate A pipeline on anvil
```

See `contracts/README.md` for the Base Sepolia Gate B runbook and `engine/.env.example` for Gate A settings.
