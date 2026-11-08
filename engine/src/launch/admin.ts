/**
 * Launch admin CLI.
 *
 *   bun run src/launch/admin.ts create <slug> <name> <symbol> [capEth=0.01] [freshPoolCapEth=0.02] [registrationHours=24] [windowMin=30] [lockMin=60] [disputeMin=30] [verifiedCapEth=capEth] [minBalanceEth=0.0005] [freshMaxAgeHours=168]
 *   bun run src/launch/admin.ts create-instant <slug> <name> <symbol> [capEth=0.01] [freshPoolCapEth=capEth] [startsInMin=30] [windowMin=30] [lockMin=60] [freshMaxAgeHours=168]
 *                                                     # no registration: creates and deploys now; buyers get permits at buy time
 *   bun run src/launch/admin.ts build <slug>
 *   bun run src/launch/admin.ts deploy <slug>          # factory.createLaunch with the built root; window opens after the dispute period
 *   bun run src/launch/admin.ts resolve <slug> <disputeId> accept|reject [unlink] [note...]
 *   bun run src/launch/admin.ts update-root <slug>     # after a rebuild, before windowStart
 *   bun run src/launch/admin.ts finalize <slug>        # optional, after windowEnd: emits the receipt event
 *   bun run src/launch/admin.ts publish <slug>         # rewrite the static mirror (DATA_DIR/publish/<slug>.json)
 *
 * Building the allowlist closes registration. The hook enforces its deploy-time limits (minimum review period,
 * window and lock bounds, creator share); `deploy` reverts if the launch's window settings break them.
 *
 * Env: LAUNCH_RPC_URL, LAUNCH_CHAIN_ID, LAUNCH_ADMIN_KEY, LAUNCH_DEPLOYMENT (contracts/deployments/<chainId>.json), DATA_DIR,
 * PERMIT_SIGNER_KEY (instant launches).
 */
import { parseEther, type Hex } from "viem";
import { launchRuntime } from "../runtime";
import { adminClients, deployLaunch, finalizeLaunch, publishMirror, updateRoot } from "./onchain";
import { envStr } from "../env";

const [cmd, slug, ...rest] = process.argv.slice(2);
if (!cmd || !slug) {
  console.error("usage: admin.ts <create|create-instant|build|deploy|resolve|update-root|finalize|publish> <slug> ...");
  process.exit(1);
}
const rt = launchRuntime();
const now = () => Math.floor(Date.now() / 1000);

function onchainClients() {
  const adminKey = envStr("LAUNCH_ADMIN_KEY") as Hex | undefined;
  const deploymentPath = envStr("LAUNCH_DEPLOYMENT");
  if (!adminKey || !deploymentPath || !rt.rpcUrl) throw new Error("LAUNCH_ADMIN_KEY, LAUNCH_DEPLOYMENT and LAUNCH_RPC_URL are required");
  return adminClients({ rpcUrl: rt.rpcUrl, chainId: rt.chainId, adminKey, deploymentPath });
}

switch (cmd) {
  case "create": {
    const [name, symbol, cap = "0.01", fresh = "0.02", regHours = "24", windowMin = "30", lockMin = "60", disputeMin = "30", verifiedCap, minBalance = "0.0005", maxAgeHours = "168"] = rest;
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
        // Verified humans (Base Verify) get verifiedCap; defaults to the normal cap.
        verifiedCapWei: parseEther(verifiedCap ?? cap).toString(),
        freshMaxNonce: 0,
        freshMaxAgeHours: Number(maxAgeHours),
      },
      window: { delayAfterBuildSec: Number(disputeMin) * 60, lengthSec: Number(windowMin) * 60, lockSec: Number(lockMin) * 60 },
      // Registering costs nothing but a signature; a minimum balance makes registering 100k fresh keys cost money.
      minBalanceWei: parseEther(minBalance).toString(),
    });
    console.log(JSON.stringify(rt.service.publicView(rec), null, 2));
    break;
  }
  case "create-instant": {
    const [name, symbol, cap = "0.01", fresh = cap, startsIn = "30", windowMin = "30", lockMin = "60", maxAgeHours = "168"] = rest;
    if (!name || !symbol) throw new Error("name and symbol are required");
    rt.service.create({
      slug,
      chainId: rt.chainId,
      name,
      symbol,
      mode: "instant",
      registrationClosesAt: now(),
      tiers: {
        capWei: parseEther(cap).toString(),
        freshPoolCapWei: parseEther(fresh).toString(),
        verifiedCapWei: parseEther(cap).toString(),
        freshMaxNonce: 0,
        freshMaxAgeHours: Number(maxAgeHours),
      },
      window: { delayAfterBuildSec: Math.round(Number(startsIn) * 60), lengthSec: Number(windowMin) * 60, lockSec: Number(lockMin) * 60 },
    });
    console.log(JSON.stringify(await deployLaunch(rt.service, slug, onchainClients()), null, 2));
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
    console.log(JSON.stringify(await deployLaunch(rt.service, slug, onchainClients()), null, 2));
    break;
  }
  case "update-root": {
    console.log(`root updated: ${await updateRoot(rt.service, slug, onchainClients())}`);
    break;
  }
  case "publish": {
    console.log(`wrote ${await publishMirror(rt.service, slug)}`);
    break;
  }
  case "finalize": {
    console.log(`finalized: ${await finalizeLaunch(rt.service, slug, onchainClients())}`);
    break;
  }
  default:
    throw new Error(`unknown command ${cmd}`);
}
