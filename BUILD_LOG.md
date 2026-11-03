# BUILD_LOG

What was built, with which AI tool and prompt, and what was changed by hand. Newest first.

---

## D1 (continued) — Tue 3 Nov 2026, session 2

**Tool:** AI coding agent (same cloud session). **Prompt:** "Continue the build, start building the rest asap",
then "Continue". **Changed by hand:** nothing yet.

The network is still closed (no Base RPC, no indexers, no secrets), so everything below was built and verified
against a local anvil chain running the real Uniswap v4 PoolManager and the Kin contracts.

### Built

**Engine**
- `scanToken()` (`src/scan/scan.ts`): one pipeline for Kin Scan, Gate A and Replay. Adds per-buy ETH spend
  (tx.value), freshness (nonce before first buy), entity tiers as Kin would assign them, same-block buyers,
  fund-to-buy time, share of early buys and of supply, and the counterfactual (`src/scan/counterfactual.ts`):
  observed buys replayed in chain order through Kin's caps; buys paid in a token are reported as unknown.
- Shared funding tracer (`src/cluster/funding.ts`) used by Scan and the allowlist builder.
- Launch backend (`src/launch/`): file-backed store; registration by signed message, verified through an RPC client
  so smart-contract wallets work too; allowlist build from nonces + funding trace + clustering; versioned allowlist
  and evidence files (exact bytes); disputes (signed, closed at `windowStart`); admin resolution with an
  "unlink" override applied on rebuild; per-wallet status and proofs.
- Admin CLI (`src/launch/admin.ts` + `onchain.ts`): create, build, deploy (factory `createLaunch` with the root and
  evidence hash), resolve, update-root, finalize.
- Attack sandbox relayer (`src/sandbox/relayer.ts`): relayer → one funder → 20 fresh wallets; 20 signed
  registrations; clustering from the real funding receipts; allowlist; a Kin launch and a plain launch; 20 buys on
  each; exact revert reason decoded (`WrappedError` → `EntityCapExceeded`); leftover ETH swept back.
- HTTP API (`src/server.ts`, Bun): scan (cached, rate limited), launches, sandbox runs with server-sent events and
  a per-day budget, replay. `engine/Dockerfile` for a worker host.
- Replay job (`src/replay/replay.ts`): sample file → raw scans + aggregates computed only from them.
  `engine/replay/sample.json` is an empty template: the sample has not been chosen.
- Local dev stack (`scripts/dev-local.sh` + `scripts/seed-local.ts`).

**Web** (Next.js 16, wagmi 3, viem): `/` (pitch, latest sandbox result from the API), `/scan` (stat tiles, cluster
map per entity, evidence with tx links, counterfactual bar, buyers table, method), `/sandbox` (run button, live
event stream, Kin vs plain grids of 20), `/launch` and `/launch/[slug]` (phase bar, register, tier and cap, onchain
entity spend, buy in the window, vault balance and claim, evidence file hash checked in the browser against the
onchain commitment, disputes), `/receipt/[slug]` + `/embed/receipt/[slug]` (read from `KinHook.getReceipt`),
`/replay` ("Not yet computed" until the job runs). Wallets: injected and Coinbase Wallet. (The Base Account
connector was tried first; its SDK pulls a Coinbase CDP package with missing optional modules and broke the build.)

### Verified (local anvil, 1 s blocks)

| Check | Result |
|---|---|
| Sandbox via the API | Kin pool 10/20 landed, plain pool 20/20; next buy reverts `EntityCapExceeded(entity, 0.001 ETH, 0.0011 ETH)`; 16.4 s |
| Scan via the API | 5 early buyers, 1 entity of 3 wallets linked through the shared funder, 2 fresh wallets unlinked |
| Seeded launch | 11 wallets registered over HTTP; allowlist 4 entities (6 linked, 3 fresh); window buys: bundle 3 landed / 3 rejected at its shared cap, fresh pool 2 / 1; finalized receipt: 0.025 ETH, 4 entities, 7 wallets, largest entity 36.0% (= 0.009 / 0.025, checked by hand) |
| Browser, non-deployer wallet | connect → register (signed) → dispute filed; then on a second launch: window buy 0.005 ETH → 493,964 tokens in the vault → claim after the lock → tokens in the wallet (checked onchain); receipt finalized by an unrelated caller |
| Pages | every route screenshotted at 1280 px and 390 px; no horizontal overflow |
| Tests | contracts 31 pass; engine 13 pass (incl. launch-backend integration on anvil); web build + typecheck pass |

### Not done / still blocked

- Gate A, Scan, Replay on Base mainnet; Gate B, sandbox and launches on Base Sepolia: need network access and keys.
- The Alchemy and Blockscout transfer-history adapters are untested against the real services.
- Base Verify tier: not built (its onchain interface couldn't be read from here). Cut to the roadmap per the brief.
- Mainnet fallback deploy (P2): scripts support chain 8453; not deployed.

---

## D1 — Tue 3 Nov 2026

**Tool:** AI coding agent (cloud session, repo `andrew1234-arch/kin`, branch `ccr-1ff4e28c-is4t76`).
**Prompt:** the full "KIN — Build Brief (Vibestarter Vibeathon 02, Base)", pasted by the owner, with
"start with the directives in this text".
**Changed by hand:** nothing yet.

### Inputs that were missing

- The pasted brief was cut off inside Appendix A, mid-way through `src/KinHook.sol`
  (`emit LaunchConfigured(id, root, windowEn`). The PoC's `KinRouter` and its test file never arrived.
  The 8 PoC behaviours were rebuilt from the test names and results listed in Appendix A, and now run
  against the production contracts (`contracts/test/KinPoC.t.sol`).
- The Nuno cluster engine repo has not been provided. `engine/src/cluster/cluster.ts` implements the
  brief's baseline signal (shared funder within 1–2 hops, exclusion list), behind an interface the Nuno
  port can replace.

### Environment

The container's network policy blocks Base RPC (`mainnet.base.org`, `sepolia.base.org`), every block
explorer and indexer tried (Basescan, Blockscout, Alchemy, public RPCs), and `docs.uniswap.org` / `docs.base.org`.
GitHub and npm work. Workarounds, none of which invent data:

- Foundry 1.7.1 installed from npm (`@foundry-rs/forge`, `cast`, `anvil`).
- solc 0.8.26 static binary from the Solidity GitHub release
  (sha256 `d5f23436f443edb85d8e76906d12f0a86ce0490e7663a9e608efeb7a93f149ef`).
- Uniswap v4 addresses read from the official docs **repository** (`github.com/Uniswap/docs`, commit
  `1c7597d7`, `content/protocols/v4/deployments.mdx`), cited in `contracts/script/Addresses.sol`.
- RPC and API endpoints are environment variables only; no defaults were written from memory.

### Built

**Contracts** (`contracts/`, Foundry, v4-periphery `c6e4754d`, OpenZeppelin uniswap-hooks `b5f10574`)
- `KinHook` moved from v4-core's `BaseTestHooks` to OpenZeppelin's production `BaseHook` (BaseHook left
  v4-periphery in commit `5da22e60`). Added `windowStart` (all swaps revert before it), `evidenceHash`,
  root updates only before `windowStart`, per-launch admin, `AllowlistStats` (engine numbers committed
  with the evidence hash), window stats, and `finalize()` / `getReceipt()` for the Fairness Receipt.
- `KinRouter`: native ETH and ERC-20 input, writes `msg.sender` into the hook data, delivers window
  buys to `KinVault`, refunds unused ETH, slippage and deadline checks.
- `KinVault`: per-buyer balances per launch, `claim()` / `claimFor()` from `windowEnd + lockDuration`.
- `KinLaunchFactory`: fixed-supply `KinToken`, native-ETH/token pool, one-sided locked liquidity,
  `configureLaunch`, all parameters in `LaunchCreated`; `plain = true` gives the hookless comparison pool.
- Hook address mined with Uniswap's `HookMiner` for BEFORE_SWAP only.
- Tests: **31 passing** — the 8 PoC behaviours (bundle of 20: Kin pool 10/20 landed, plain pool 20/20),
  `windowStart`, vault lock and claim, native-ETH buys and refunds, root updates blocked after
  `windowStart`, `finalize()` values, fresh-pool sharing, a 1000-run fuzz showing an entity never exceeds
  its cap, and an engine cross-check.

**Engine** (`engine/`, Bun + TypeScript + viem)
- Cluster engine baseline (`src/cluster/cluster.ts`): shared funder within 1–2 hops, union-find, every link
  carries the transaction hashes of both paths, excluded addresses never link.
- Allowlist builder (`src/allowlist/build.ts`): tiers (linked / fresh pool / aged / verified),
  OpenZeppelin `StandardMerkleTree` leaves, canonical evidence JSON, `evidenceHash = keccak256(file)`.
  The leaf format is proven identical to KinHook's by `contracts/test/EngineFixture.t.sol`.
- Exclusion list (`data/exclusions.json`, 2,340 addresses) generated by `scripts/build-exclusions.ts` from
  `dawsbot/eth-labels` (MIT) at commit `d9b21aef`; rules recorded in the file.
- Gate A script (`src/gates/gateA.ts`): deploy block → early buyers → hop-1/hop-2 funding → clusters,
  with wall time and request counts per method; cost only from a pricing file that names its source.
- Tests: **9 passing**.

**Web** (`web/`, Next.js 16): landing page with the three CTAs, placeholder routes that state plainly
that nothing is live yet. `next build` passes.

### Gates

| Gate | Status |
|---|---|
| **A** (indexing cost/speed on 3 real Base launches) | **Not run: Base is unreachable from this container.** The script ran end to end on a local anvil chain seeded with a known scenario (`engine/scripts/gate-a-local.sh`): 5 early buyers found, 1 cluster of 3 linked by the shared funder, the 2 exchange-funded buyers correctly left unlinked. That validates the RPC half only; the transfer-history providers (Alchemy, Blockscout) are untested. |
| **B** (deploy + mined hook + KinRouter swap + other-router rejection) | **Passes on local anvil** with real v4-core PoolManager and the CREATE2 deployer (`contracts/script/gate-b-local.sh`): other router rejected with `KinHook.UntrustedRouter` (simulated, and as a real reverted transaction), KinRouter buy landed and was vaulted. **Not run on Base Sepolia:** RPC blocked and no funded deployer key. |

### Design decisions worth knowing

- A cap is charged at the exact-input amount before the swap (BEFORE_SWAP only). If a swap fills only
  partly at the price limit, the full amount still counts. This is conservative.
- Anyone can initialise a pool that points at KinHook, but such a pool can never trade (`NotConfigured`).
  Only the factory can configure a launch.
- `creatorAllocation` exists for completeness and is emitted in `LaunchCreated`; demo launches use 0.
- Launch LP is owned by the factory with no withdrawal path (locked).
