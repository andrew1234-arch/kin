import { readFileSync } from "node:fs";
import { getAddress, keccak256, parseEther, parseEventLogs, toBytes, type Address, type Hex } from "viem";
import { kinLaunchFactoryAbi } from "../abi/kin";
import { envNum, envStr } from "../env";
import { launchParams } from "../launchParams";
import type { launchRuntime } from "../runtime";
import { adminClients, deployLaunch, withAdminLock } from "./onchain";

/**
 * Demo keeper (DEMO_LAUNCHES=1): keeps an instant launch window open at all times, so anyone testing Kin (judges
 * during 9–16 Nov) finds a launch they can buy in, whenever they arrive. When the newest demo launch's window has
 * less than DEMO_LEAD_MIN left, it creates and deploys the next one; the hook's review period means a new window
 * opens about 32 minutes after deploy, so the default lead overlaps the windows by a few minutes.
 *
 *   DEMO_WINDOW_MIN (180)  window length       DEMO_LOCK_MIN (10)       vault lock after the window
 *   DEMO_CAP_ETH (0.0001)  cap per entity      DEMO_FRESH_CAP_ETH (0.003)  shared cap for wallets with no history
 *   DEMO_LEAD_MIN (40)     when to deploy the next one
 *
 * Demo launches treat only never-used wallets (nonce 0) as fresh, with no age rule: a test wallet that has sent a
 * transaction is judged by its funding links alone, which is what a test drive needs to show.
 *
 * Each demo launch also gets a plain twin: a hookless pool with the same token settings (deployment `plainFactory`),
 * so the test drive can show what the same buys would do without Kin.
 */
type Runtime = ReturnType<typeof launchRuntime>;

export function demoSettings() {
  return {
    windowSec: Math.round(envNum("DEMO_WINDOW_MIN", 180, { min: 5 }) * 60),
    lockSec: Math.round(envNum("DEMO_LOCK_MIN", 10, { min: 0 }) * 60),
    leadSec: Math.round(envNum("DEMO_LEAD_MIN", 40, { min: 1 }) * 60),
    capWei: parseEther(envStr("DEMO_CAP_ETH") ?? "0.0001"),
    freshCapWei: parseEther(envStr("DEMO_FRESH_CAP_ETH") ?? "0.003"),
  };
}

export function startDemoKeeper(rt: Runtime, log = console.log) {
  const adminKey = envStr("LAUNCH_ADMIN_KEY") as Hex | undefined;
  const deploymentPath = envStr("LAUNCH_DEPLOYMENT");
  if (!adminKey || !deploymentPath || !rt.rpcUrl) {
    log("demo keeper: off (needs LAUNCH_ADMIN_KEY, LAUNCH_DEPLOYMENT and LAUNCH_RPC_URL)");
    return () => {};
  }
  const s = demoSettings();
  const clients = () => adminClients({ rpcUrl: rt.rpcUrl!, chainId: rt.chainId, adminKey, deploymentPath });
  const plainFactory = (() => {
    const f = JSON.parse(readFileSync(deploymentPath, "utf8")).plainFactory as string | undefined;
    return f ? (getAddress(f) as Address) : null;
  })();
  let busy = false;

  /** A hookless pool with the demo launch's token settings; no window or permits apply to it. */
  const deployTwin = async (slug: string) => {
    if (!plainFactory) return;
    const rec = rt.service.get(slug);
    const o = rec.onchain!;
    const c = clients();
    const zero = `0x${"00".repeat(32)}` as Hex;
    const { hash, rcpt } = await withAdminLock(async () => {
    const hash = await c.wallet.writeContract({
      address: plainFactory,
      abi: kinLaunchFactoryAbi,
      functionName: "createLaunch",
      args: [
        {
          name: `${rec.name} (plain)`,
          symbol: "PLAIN",
          ...launchParams(),
          root: zero,
          evidenceHash: zero,
          stats: { allowlistedWallets: 0, entities: 0, linkedWallets: 0, freshWallets: 0 },
          windowStart: BigInt(o.windowStart),
          windowEnd: BigInt(o.windowEnd),
          lockDuration: BigInt(o.lockDuration),
          salt: keccak256(toBytes(`kin:${slug}:plain:${Date.now()}`)),
        },
        true,
      ],
      chain: c.wallet.chain,
      account: c.wallet.account,
    });
    return { hash, rcpt: await c.pub.waitForTransactionReceipt({ hash }) };
    });
    if (rcpt.status !== "success") throw new Error(`plain twin reverted: ${hash}`);
    const [ev] = parseEventLogs({ abi: kinLaunchFactoryAbi, logs: rcpt.logs, eventName: "LaunchCreated" });
    const k = ev!.args.key;
    rt.store.update(slug, (r) => {
      r.plainTwin = {
        poolId: ev!.args.id as Hex,
        key: { currency0: k.currency0, currency1: k.currency1, fee: k.fee, tickSpacing: k.tickSpacing, hooks: k.hooks },
        token: ev!.args.token as Address,
        launchTx: hash,
      };
      return r;
    });
    log(`demo keeper: plain twin for ${slug} (${hash})`);
  };

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const now = Math.floor(Date.now() / 1000);
      const demos = rt.store.list().filter((r) => r.demo);
      // A demo launch whose deploy failed last time: retry it rather than piling up new records.
      const stuck = demos.find((r) => !r.onchain);
      if (stuck) {
        log(`demo keeper: deploying ${stuck.slug} (retry)`);
        await deployLaunch(rt.service, stuck.slug, clients());
        return;
      }
      // Open demo launches without a plain twin (deployed before twins existed, or the twin failed): add one.
      const twinless = demos.find((r) => r.onchain && !r.plainTwin && r.onchain.windowEnd > now);
      if (twinless && plainFactory) {
        await deployTwin(twinless.slug);
        return;
      }
      // Only launches with today's settings count: after DEMO_CAP_ETH changes, the next window is deployed right away.
      const current = demos.filter((r) => r.tiers.capWei === s.capWei.toString());
      const latestEnd = Math.max(0, ...current.map((r) => r.onchain!.windowEnd));
      if (latestEnd - now > s.leadSec) return;
      let n = demos.length + 1;
      while (rt.store.list().some((r) => r.slug === `kin-demo-${n}`)) n++;
      const slug = `kin-demo-${n}`;
      rt.service.create({
        slug,
        chainId: rt.chainId,
        name: `Kin Demo ${n}`,
        symbol: "KDEMO",
        mode: "instant",
        demo: true,
        registrationClosesAt: now,
        tiers: {
          capWei: s.capWei.toString(),
          freshPoolCapWei: s.freshCapWei.toString(),
          verifiedCapWei: s.capWei.toString(),
          freshMaxNonce: 0,
          freshMaxAgeHours: 0,
        },
        // deployLaunch raises the delay to the hook's review period (+2 min) when that is longer.
        window: { delayAfterBuildSec: 0, lengthSec: s.windowSec, lockSec: s.lockSec },
      });
      const o = await deployLaunch(rt.service, slug, clients());
      log(`demo keeper: ${slug} deployed; window ${new Date(o.windowStart * 1000).toISOString()} to ${new Date(o.windowEnd * 1000).toISOString()}`);
      await deployTwin(slug);
    } catch (e) {
      log(`demo keeper: ${(e as Error).message.split("\n")[0]}`);
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(tick, 60_000);
  return () => clearInterval(timer);
}
