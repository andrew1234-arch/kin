# Kin contracts

Foundry project. Uniswap v4 (`lib/v4-periphery`, with v4-core nested) and OpenZeppelin `uniswap-hooks`
(production `BaseHook`) are git submodules.

| Contract | Role |
|---|---|
| `KinHook` | BEFORE_SWAP + AFTER_SWAP v4 hook. Registration/dispute period → capped window → open trading. Merkle allowlist of `(wallet, entityId, entityCap)`, one shared cap per entity (pinned by the entity's first buy), charged in what each swap actually paid. Deploy-time limits: minimum review period after every root change, window and lock bounds, creator share of supply. `evidenceHash` commitment, root frozen at `windowStart`, Fairness Receipt (final at `windowEnd`; `finalize()` only emits it). |
| `KinRouter` | The only router the hook trusts in the window. Writes its own `msg.sender` into the hook data. Native ETH or ERC-20 input, exact-input only. Window buys are delivered to `KinVault`. |
| `KinVault` | Holds window buys per buyer; `claim()` from `windowEnd + lockDuration`. Balances are not transferable. |
| `KinLaunchFactory` | Fixed-supply token + native-ETH/token pool + one-sided liquidity (locked; the creator can `collectFees`) + `configureLaunch`. Deployed with `hook = 0` it is the sandbox-only plain factory (hookless comparison pools); the Kin factory can't create plain pools. |

## Build and test

```bash
git submodule update --init --recursive
forge test            # 41 tests: the 8 PoC behaviours, acceptance and limit tests, a 1000-run fuzz, the engine cross-check
```

`test/fixtures/engine-allowlist.json` is written by `engine/test/allowlist.test.ts`; `EngineFixture.t.sol`
checks that KinHook accepts the engine's root and proofs.

## Gate B

Local rehearsal (no network needed, runs the same scripts against anvil):

```bash
./script/gate-b-local.sh
```

Base Sepolia (needs a funded `DEPLOYER_PRIVATE_KEY` and `BASE_SEPOLIA_RPC_URL`, see `.env.example`):

```bash
source .env
forge script script/DeployKin.s.sol --rpc-url base_sepolia --broadcast --slow          # writes deployments/84532.json
# the sandbox's own deployment, whose hook has no minimum review period:
KIN_DEPLOYMENT_NAME=sandbox KIN_MIN_REVIEW_SECONDS=0 KIN_MIN_WINDOW_SECONDS=60 \
  forge script script/DeployKin.s.sol --rpc-url base_sepolia --broadcast --slow        # writes deployments/84532-sandbox.json
forge script script/GateB.s.sol:GateBCreateLaunch --rpc-url base_sepolia --broadcast --slow
# wait until the window opens (GATE_B_DELAY_SECONDS, default the hook's minimum review period + 30 s)
forge script script/GateB.s.sol:GateBSwap --rpc-url base_sepolia --broadcast --slow
```

Or run all of it, with onchain verification of every step, via `engine/scripts/real-sepolia.sh`.
Note: Foundry 1.7.1's `forge script` can print `Error: script failed` and still exit 0, so never gate on its exit
code; `real-sepolia.sh` checks the chain instead (contract code after deploy, the factory's `launchCount`, the
hook's `entitySpent` and the vault's `owed`).

`GateBSwap` (a) simulates a swap through Uniswap's PoolSwapTest router on Base Sepolia, carrying hook data that
claims to be the allowlisted buyer, and requires it to revert with `KinHook.UntrustedRouter`; then (b) broadcasts
one real buy through KinRouter and checks that the entity spend was recorded and the tokens were vaulted.
For a failed transaction that is visible in a block explorer, see the last step of `script/gate-b-local.sh`
(`cast send … --gas-limit 500000` to the other router).

External addresses (PoolManager, PoolSwapTest, the CREATE2 deployer) are in `script/Addresses.sol`, each with its
source: the official Uniswap docs repository, pinned to a commit.
