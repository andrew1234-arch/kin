# Testing Kin

A guide for judges and anyone else who wants to check that Kin does what it says. Everything runs on **Base
Sepolia** with test ETH. You need a browser and nothing else: the site has a built-in test wallet and its own
faucet. About 10 minutes for tests 1 to 4.

**Live site:** https://kin-flame-seven.vercel.app

**The one thing to look for:** one person gets **one** buy limit, however many wallets they use. Wallets funded
from the same place share a single limit, and the pool itself refuses anything over it.

---

## Test 1: Game a launch yourself (2 minutes)

You play a bundler: one person with three wallets, all buying in the same launch.

1. Open **The flow** (top menu) and stay in part **01 · Do it yourself**.
2. The card at the top names the live launch, its limit per buyer and when its window closes. Press **Start the test**.
3. Watch the five steps run on their own. Each finished step links to its Base Sepolia transaction:

| Step | What happens | What you should see |
|---|---|---|
| 1 | Three wallets are created in your browser | Three addresses |
| 2 | Kin's faucet sends 0.0005 test ETH to the first wallet | The faucet transaction |
| 3 | The first wallet funds the other two, like a bundler would | Two transfers, "You → Extra wallet 1/2" |
| 4 | Kin traces where each wallet's ETH came from | "Same source, so Kin treats them as one buyer with one 0.0003 ETH limit" |
| 5 | All three wallets buy 0.00015 ETH each | Two marked **bought**, one marked **blocked** |

On the right, the diagram fills in as the run goes: the funder, the three wallets grouped as one buyer, and their
buys hitting the pool's limit bar. Below it, **With Kin** shows 2/3 and **Without Kin** shows 3/3 (the same buys
simulated on a normal pool with the same token settings).

**Expected result:** "Kin blocked 1 of 3 buys. Without Kin, 3 of 3 go through." and "Recorded onchain: 0.0003 ETH".

**Why exactly one is blocked:** the launch's limit is 0.0003 ETH and each wallet tries half of it. The first two
fill the shared limit, so the third goes over it. If each wallet tried the full limit, two of three would be
refused. The number that matters is not how many buys fail but how much the group gets: **one limit, not three**.

**Check that it's real:**
- Click the **blocked** buy's transaction. On Basescan it shows as failed: the pool reverted it.
- Click either **bought** transaction: it succeeded, and the tokens went to Kin's vault.
- Open **Kin Scan**, pick the same launch, and find your three wallets as one group with "limit reached".

If anything stops halfway, press **Continue**: the run picks up where it left off (progress is saved in your browser).
**Run it again** starts over with three new wallets.

## Test 2: Watch 20 wallets hit Kin (1 to 2 minutes)

1. On **The flow**, scroll to part **02 · At scale**. The latest run is already shown.
2. Press **Run the attack** for a fresh one. (If someone else's run is in progress, you watch theirs live.)
3. One funder sends ETH to 20 brand-new wallets. Kin traces them, gives all 20 one shared limit, and all 20 buy at the
   moment the window opens: on a Kin pool and on a normal pool with the same settings.

**Expected result:** **With Kin 10/20, Without Kin 20/20.** The sandbox's limit is ten buys' worth, so the first ten
fill it and the other ten are refused. The diagram shows the 20 wallets grouped as one buyer and each buy landing or
being refused. The step list links to the funding transactions and both launch transactions.

## Test 3: Launch your own token (1 minute, then a 32-minute wait)

1. Press **Launch with Kin** (top right).
2. Enter a name and a symbol. Keep or change the limit per buyer, the window and the lock.
3. Press **Launch token**. In about 10 seconds you land on your launch's page with a **"$YOURS is live"** banner, a
   link to share and the deploy transaction.

**Expected result:** the page shows "Starts soon" and a countdown. Buying opens about 32 minutes after launch: the
contract requires a review period so buyers can check the rules first. The rules' hash is shown under **Rules and
evidence** with a check that it matches what was committed onchain.

When the window opens, buy in it: connect your own wallet (Base Sepolia) or choose **Test wallet (no extension)** from
**Connect**, ask for your limit and buy. Try a second wallet funded from the first one: it gets the same entity and
shares the first wallet's limit.

Your launch also appears under **Launches** and in **Kin Scan**. Launching from the site is limited to 3 launches per
connection per day.

## Test 4: Kin Scan (1 minute)

1. Open **Kin Scan**. It opens on Kin's own launches; pick the one you used in Test 1 (usually "Kin Demo N").
2. You see every wallet that asked for a limit, in order. Numbered wallets were funded from the same place, and Kin
   counted each numbered group as one buyer.
3. Under **Wallets Kin counted as one buyer**, each group shows its funder, a picture of the group and its shared
   limit bar, with the amount used read straight from the pool. Expand a group to see each wallet and the transfer
   that linked it.

**Expected result** for a Test 1 run: one group of 3 wallets, funded by your first wallet, "0.0003 of 0.0003 ETH used",
marked "limit reached".

**Bonus:** further down, **Scan any token on Base** takes a Base mainnet token address and shows which of its early
buyers shared a funder, and what Kin's limit would have refused. A first scan of a busy token can take a minute.

## Test 5: Your profile

Open **Profile** from the wallet menu (or follow "Claim them from your profile" after Test 1). It lists every launch
the connected wallet has a limit in, its entity, what it bought and what sits in the vault. The **Claim** button
appears when the lock ends. For demo launches that is 10 minutes after the 3-hour window closes, so you may need
to come back later.

---

## Check it without the website

Everything Kin decides is public, and everything the pool enforced is onchain.

- **Every limit Kin handed out** in a launch, with the transfers behind it: the **Raw data** link in Kin Scan
  (the engine's `/launches/<slug>/permits`).
- **A group's onchain total**, read directly from the hook (pool id and entity id are in the raw data):
  ```bash
  cast call 0x4Aec96A3CCAe1bb7C05dd56F98B2aE54FF8b00c0 \
    "entitySpent(bytes32,bytes32)(uint256)" <poolId> <entityId> --rpc-url https://sepolia.base.org
  ```
- **Every window buy** emits `WindowBuy(poolId, entity, buyer, amountIn, entitySpent)` from the hook.
- **A refused buy** reverts with `EntityCapExceeded(entity, cap, attempted)` (selector `0x2e0dd880`), wrapped by the
  Uniswap v4 PoolManager.
- **Contract addresses** are in the [README](README.md#deployed-contracts-base-sepolia).

## Run the tests yourself

```bash
git clone --recursive https://github.com/andrew1234-arch/kin && cd kin
(cd contracts && forge test)              # 53 tests: hook, router, vault, factory, permits
(cd engine && bun install && bun test)    # 59 tests: clustering, launches, permits, public launches
./engine/scripts/sandbox-local.sh         # the 20-wallet attack on a local chain, about 20 seconds
```

## Good to know

- **Test ETH only.** Launches run on Base Sepolia. Nothing on this site touches real money.
- **Test wallets live in your browser.** Their keys never leave it and only ever hold test ETH.
- **The faucet** gives each wallet one drip a day and each connection four. If it says you've used yours, use your
  own wallet with any Base Sepolia faucet, or come back tomorrow.
- **A buy window is always open.** The engine opens a new 3-hour demo window before the last one closes. If you
  arrive in the gap, the page says when the next one opens.
- **What Kin can't catch:** wallets each funded from a different exchange or bridge look unrelated, on purpose, so
  people who withdrew from the same exchange aren't linked. Kin makes bundling cost more and makes it visible; it
  does not make it impossible. See [Trust model and limits](README.md#trust-model-and-limits).

## If something goes wrong

| You see | What to do |
|---|---|
| "The test is offline right now" | The engine is unreachable. Try again in a few minutes. |
| A step stuck on "Waiting for the chain indexer" | The funding history lags the chain by a few seconds. It retries on its own; press **Continue** if it stops. |
| "This connection has used its test ETH for today" | The faucet's limit. Use your own wallet with Base Sepolia ETH, or try tomorrow. |
| "No test launch is open right now" | The next demo window is being deployed; the page shows when it opens. |
| A launch you created says "Starts soon" | Expected: buying opens about 32 minutes after launch. |
