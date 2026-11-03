/**
 * Launch admin CLI.
 *
 *   bun run src/launch/admin.ts create <slug> <name> <symbol> [capEth=0.01] [freshPoolCapEth=0.02] [registrationHours=24] [windowMin=30] [lockMin=60] [disputeMin=30]
 *   bun run src/launch/admin.ts build <slug>
 *   bun run src/launch/admin.ts deploy <slug>          # factory.createLaunch with the built root; window opens after the dispute period
 *   bun run src/launch/admin.ts resolve <slug> <disputeId> accept|reject [unlink] [note...]
 *   bun run src/launch/admin.ts update-root <slug>     # after a rebuild, before windowStart
 *   bun run src/launch/admin.ts finalize <slug>        # after windowEnd (anyone may call)
 *
 * Env: LAUNCH_RPC_URL, LAUNCH_CHAIN_ID, LAUNCH_ADMIN_KEY, LAUNCH_DEPLOYMENT (contracts/deployments/<chainId>.json), DATA_DIR.
 */
import { readFileSync } from "node:fs";
import { createWalletClient, getAddress, http, parseEther, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { kinHookAbi, kinLaunchFactoryAbi } from "../abi/kin";
import { launchRuntime } from "../runtime";
import { chainFor } from "../sandbox/relayer";

const [cmd, slug, ...rest] = process.argv.slice(2);
if (!cmd || !slug) {
  console.error("usage: admin.ts <create|build|deploy|resolve|update-root|finalize> <slug> ...");
  process.exit(1);
}
const rt = launchRuntime();
const now = () => Math.floor(Date.now() / 1000);

function onchainClients() {
  const key = process.env.LAUNCH_ADMIN_KEY as Hex | undefined;
  const depPath = process.env.LAUNCH_DEPLOYMENT;
  if (!key || !depPath || !rt.rpcUrl || !rt.pub) throw new Error("LAUNCH_ADMIN_KEY, LAUNCH_DEPLOYMENT and LAUNCH_RPC_URL are required");
  const dep = JSON.parse(readFileSync(depPath, "utf8"));
  const wallet = createWalletClient({ chain: chainFor(rt.chainId, rt.rpcUrl), transport: http(rt.rpcUrl), account: privateKeyToAccount(key) });
  return { wallet, pub: rt.pub, factory: getAddress(dep.factory), hook: getAddress(dep.kinHook) };
}

switch (cmd) {
  case "create": {
    const [name, symbol, cap = "0.01", fresh = "0.02", regHours = "24", windowMin = "30", lockMin = "60", disputeMin = "30"] = rest;
    if (!name || !symbol) throw new Error("name and symbol are required");
    const rec = rt.service.create({
      slug,
      chainId: rt.chainId,
      name,
      symbol,
      registrationClosesAt: now() + Math.round(Number(regHours) * 3600),
      tiers: {
        capWei: parseEther(cap).toString(),
        freshPoolCapWei: parseEther(fresh).toString(),
        verifiedCapWei: parseEther(cap).toString(), // Base Verify tier not wired yet: same as cap
        freshMaxNonce: 0,
      },
      window: { delayAfterBuildSec: Number(disputeMin) * 60, lengthSec: Number(windowMin) * 60, lockSec: Number(lockMin) * 60 },
    });
    console.log(JSON.stringify(rt.service.publicView(rec), null, 2));
    break;
  }
  case "build": {
    console.log(JSON.stringify(await rt.service.build(slug), null, 2));
    break;
  }
  case "resolve": {
    const [id, decision, maybeUnlink, ...note] = rest;
    const unlink = maybeUnlink === "unlink";
    const text = (unlink ? note : [maybeUnlink ?? "", ...note]).join(" ").trim();
    console.log(rt.service.resolveDispute(slug, id!, decision === "accept", text, unlink));
    break;
  }
  case "deploy": {
    const rec = rt.service.get(slug);
    if (!rec.allowlist) throw new Error("build the allowlist first");
    if (rec.onchain) throw new Error("already deployed");
    const { wallet, pub, factory } = onchainClients();
    const head = await pub.getBlock();
    const windowStart = head.timestamp + BigInt(rec.window.delayAfterBuildSec);
    const hash = await wallet.writeContract({
      address: factory,
      abi: kinLaunchFactoryAbi,
      functionName: "createLaunch",
      args: [
        {
          name: rec.name,
          symbol: rec.symbol,
          totalSupply: 1_000_000_000n * 10n ** 18n,
          creatorAllocation: 0n,
          fee: 10_000,
          tickSpacing: 200,
          startTick: 184_200,
          tickLower: 69_000,
          root: rec.allowlist.root,
          evidenceHash: rec.allowlist.evidenceHash,
          stats: rec.allowlist.stats,
          windowStart,
          windowEnd: windowStart + BigInt(rec.window.lengthSec),
          lockDuration: BigInt(rec.window.lockSec),
          salt: ("0x" + Buffer.from(slug.padEnd(32, "\0").slice(0, 32)).toString("hex")) as Hex,
        },
        false,
      ],
    });
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    if (rcpt.status !== "success") throw new Error(`createLaunch reverted: ${hash}`);
    const [ev] = parseEventLogs({ abi: kinLaunchFactoryAbi, logs: rcpt.logs, eventName: "LaunchCreated" });
    const updated = rt.service.attachOnchain(slug, {
      poolId: ev!.args.id as Hex,
      token: ev!.args.token,
      launchTx: hash,
      windowStart: Number(windowStart),
      windowEnd: Number(windowStart) + rec.window.lengthSec,
      lockDuration: rec.window.lockSec,
      rootVersion: rec.allowlist.version,
    });
    console.log(JSON.stringify(updated.onchain, null, 2));
    break;
  }
  case "update-root": {
    const rec = rt.service.get(slug);
    if (!rec.onchain || !rec.allowlist) throw new Error("not deployed");
    if (rec.allowlist.version === rec.onchain.rootVersion) throw new Error("onchain root is already the latest version");
    const { wallet, pub, hook } = onchainClients();
    const hash = await wallet.writeContract({
      address: hook,
      abi: kinHookAbi,
      functionName: "updateAllowlist",
      args: [rec.onchain.poolId, rec.allowlist.root, rec.allowlist.evidenceHash, rec.allowlist.stats],
    });
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    if (rcpt.status !== "success") throw new Error(`updateAllowlist reverted: ${hash}`);
    rt.service.attachOnchain(slug, { ...rec.onchain, rootVersion: rec.allowlist.version });
    console.log(`root updated to v${rec.allowlist.version}: ${hash}`);
    break;
  }
  case "finalize": {
    const rec = rt.service.get(slug);
    if (!rec.onchain) throw new Error("not deployed");
    const { wallet, pub, hook } = onchainClients();
    const hash = await wallet.writeContract({ address: hook, abi: kinHookAbi, functionName: "finalize", args: [rec.onchain.poolId] });
    console.log(`finalize: ${(await pub.waitForTransactionReceipt({ hash })).status} ${hash}`);
    break;
  }
  default:
    throw new Error(`unknown command ${cmd}`);
}
