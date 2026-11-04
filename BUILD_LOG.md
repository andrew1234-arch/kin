# BUILD_LOG

What was built, with which AI tool and prompt, and what was changed by hand. Newest first.

---

## D2 — Wed 4 Nov 2026: third code-review round

**Tool:** AI coding agent (a third `/code-review` pass, 13 findings, then "fix all of them").
**Changed by hand:** nothing.

Fixes:
- `.env` loader: keys that aren't shell variable names (e.g. `MY-KEY`) are skipped with a warning instead of
  aborting the run scripts; relative paths are read from the caller's directory; Node is used only if it has
  `util.parseEnv` (>= 20.12), otherwise Bun.
- Replay `--publish` replaces the public report only if every sampled token was scanned; `--publish-partial` is
  the explicit opt-in for publishing a run with failures.
- Exit codes: "nothing scanned" is now 10 (1 is Bun's crash code); `real-mainnet.sh` continues only on 10.
- Settings errors from the env helpers, the history-provider choice and ETH amounts are `ConfigError` (exit 2);
  Gate A and the replay re-throw them instead of recording them as failed scans (a new test caught Gate A
  exiting "nothing scanned" for a blank `BASE_RPC_URL`), and Gate A builds its RPC client up front.
- Output paths that are directories or read-only files are refused before scanning.
- Samples that aren't JSON objects, or list a token twice, are refused.
- The provider probe checks every row; a zero value fails only if it's zero in every row.
- The launch chain's history provider no longer inherits the mainnet `HISTORY_PROVIDER`.
- Cleanups: one shared `runCli` for the exit-code mapping; `server.ts` imports `dataDir` from `paths.ts`.

Checked: engine 41 tests, contracts 31, web build, API server smoke test. Locally: a 2-token replay with one failure
is not published with `--publish` and is with `--publish-partial`; an all-failing replay and Gate A exit 10; an
unknown provider exits 2 with nothing written; both runbooks pass again end to end (chain posing as Base; stubbed
RPC error for the Sepolia script).

---

## D2 — Wed 4 Nov 2026: second code-review round

**Tool:** same as above (a second `/code-review` pass, 15 findings, then "fix all of them").
**Changed by hand:** commit authorship moved to the owner's account (history rewritten, no code changed).

Fixes:
- `.env` loading for the run scripts now uses `node:util` `parseEnv` (Node or Bun), so quoted values with inline
  comments parse like Node/Bun do; a blank `KEY=` never hides a value set later; a loader failure (no Node or Bun,
  unreadable file) stops the script (`engine/scripts/run-env.sh`).
- Replay: `latest.json` (served by `/replay`) is written only with `--publish` and only if at least one token was
  scanned; the output directory is created and checked before scanning; the RPC must serve the sample's chain;
  scans are reused only from the same chain; exit codes 0/1/2/3 distinguish success, nothing scanned, bad settings,
  unexpected errors.
- Gate A no longer uses the creation-block hint, so its call counts are what an unhinted `/scan` costs; strict
  flags; a bad pricing file or setting stops the run (exit 2) instead of being reported as "no token scanned".
- `real-sepolia.sh`: an RPC error while checking the recorded deployment stops the run instead of counting as
  "has code" or triggering a redeploy.
- The probe requires a positive transfer value (providers return non-zero transfers only).
- Launches with Blockscout use `LAUNCH_BLOCKSCOUT_API_URL` (Base Sepolia), never the mainnet instance.
- The sample selector rejects extra positional arguments (a forgotten `--out`).
- Gate A and the replay share `engine/src/replay/sample.ts` and no longer load the launch/sandbox runtime.

Checked: engine 34 tests, contracts 31, web build. Locally: Gate A on a hinted sample still makes 5 `eth_getCode`
calls; a replay where every token fails exits 1 and leaves `latest.json` untouched; a wrong-chain sample and a
missing pricing file exit 2 with nothing written; a scan from another chain is not reused; `real-sepolia.sh` with
a stubbed failing `cast code` stops without redeploying; `real-mainnet.sh` passes end to end on a chain posing as Base.

---

## D2 — Wed 4 Nov 2026: code-review fixes

**Tool:** AI coding agent, `/code-review` (15 findings on the replay selector, probe and real-network scripts), then
"fix all of them". **Changed by hand:** nothing yet.

**Correction to session 3:** that entry said the selector was "unit-tested with real-format logs". The test built
its logs with the same ABI it decoded, so it could not catch a wrong event signature. Fixed below.

Fixes:
- Selector fails loudly on zero creation events (the sign of a wrong factory address or signature) and on fewer
  WETH-paired launches than N; validates N / days / settle hours; refuses a non-positive chunk size; fetches
  log chunks in parallel (in chain order); writes its output atomically with `--out`.
- The `TokenCreated` definition is now checked field by field against a copy extracted mechanically from
  Clanker's SDK file (`engine/src/replay/clanker-token-created.abi.json`), and its topic0 is pinned in the test.
  It was also decoded from events emitted by Solidity (below). The real check is still the first live run, which
  now fails if no events match.
- One env helper (`engine/src/env.ts`): blank values are unset, malformed numbers fail. Every engine env read uses
  it (this also fixes a blank `DATA_DIR` sending launch state to a relative path, and a blank `LOGS_CHUNK` looping).
- Scripts load `.env` with `engine/scripts/load-env.mjs` (dotenv parsed in Node, never run as shell; the caller's
  environment wins); no bash-4-only features; Gate A failures no longer abort the replay; Gate A and replay take
  explicit `--out` paths; the replay reuses Gate A's scans when every parameter matches; scans use the sample's
  creation block as a verified deploy-block hint (2 `eth_getCode` calls instead of a binary search).
- `real-sepolia.sh` trusts a recorded deployment only if every contract has code, and verifies Gate B onchain.
  Found while testing: Foundry 1.7.1 `forge script` exits 0 even when it prints "Error: script failed".
- Probe rejects NaN timestamps and malformed rows.
- A test caught a bug in the new argument parser (it dropped the first argument when `--out` was absent); fixed.

Checked (all local; Base itself is still unreachable from this environment):
- engine 26 tests, contracts 31, web build pass;
- Gate A → replay locally: replay reused Gate A's scan; with the creation-block hint, `eth_getCode` calls went 5 → 2;
  a token with no code was recorded as a failure while the rest continued;
- `real-sepolia.sh` on a local chain posing as 84532 with a planted deployment file pointing at nothing: detected,
  moved aside, redeployed, deployment verified onchain, then launch creation correctly reported as failed (no
  Uniswap PoolManager on that chain). Gate B's onchain checks verified separately on a working local chain
  (launchCount 0 → 1, entity spend 0.0005 ETH, tokens vaulted);
- `real-mainnet.sh`, unchanged, on a local chain posing as Base (8453), with a stand-in at Clanker's factory address
  emitting `TokenCreated` from Solidity: probe OK → selector decoded the events and kept the 2 WETH-paired of 3 →
  Gate A scanned both → replay reused both → reports written. A failed selection left no file behind.

---

## D1 (continued) — Tue 3 Nov 2026, session 3

**Tool:** AI coding agent. **Prompt:** "Test it against real services and do the replay samples".
**Changed by hand:** nothing yet.

**Result: blocked.** The environment's egress proxy still refuses every Base RPC, indexer and docs host
(`mainnet.base.org` → `403 Forbidden`, `ERR_PROXY_TUNNEL`), and no RPC URLs or keys are set. No real-network test ran
and no replay number exists. A route through Google Cloud tooling was considered and not used.

**Built so the real runs are one command each:**
- Replay sample chosen by rule, not by hand (`engine/src/replay/selectSample.ts`): every Clanker v4 `TokenCreated`
  event on Base in a 7-day block range ending 24 h before selection, WETH-paired only (so buys are priced in ETH),
  N taken at evenly spaced positions. The output records the rule, block range, match counts and each token's
  creation transaction. Factory address, event ABI and WETH address come from Clanker's official SDK repository
  (`clanker-devco/clanker-sdk` @ `cb67833`), cited in `engine/src/replay/clanker.ts`. Unit-tested with real-format
  logs from a stub RPC (16 engine tests pass).
- `engine/scripts/probe-history.ts`: first live check of the Alchemy/Blockscout adapter (fails loudly if the
  response shape is wrong).
- `engine/scripts/real-mainnet.sh` (probe → sample → Gate A on 3 → replay → `reports/`) and
  `engine/scripts/real-sepolia.sh` (deploy → Gate B → one sandbox run → `reports/`).

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
