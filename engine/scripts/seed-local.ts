/**
 * Seeds a LOCAL stack (anvil + engine server) with demo launches, through the same API and admin code
 * used on Base Sepolia. Never point this at a live network: it mints balances with anvil_setBalance.
 *
 *   demo-live : 6 bundle wallets (one funder), 2 aged wallets, 3 fresh wallets register; the allowlist is
 *               built, the launch deployed, window buys made (the bundle hits its shared cap; each fresh wallet
 *               buys its third of the fresh pool), then finalized.
 *   demo-open : registration open, for registering from a browser wallet.
 *
 * Env: API_URL, RPC_URL, ADMIN_KEY, DEPLOYMENT, DATA_DIR (same as the server's).
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Hex,
  type PrivateKeyAccount,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { kinRouterAbi } from "../src/abi/kin";
import { registrationMessage } from "../src/launch/registration";
import { adminClients, deployLaunch, finalizeLaunch } from "../src/launch/onchain";
import { launchRuntime } from "../src/runtime";
import { chainFor } from "../src/sandbox/relayer";

const API = process.env.API_URL ?? "http://127.0.0.1:8787";
const RPC = process.env.RPC_URL!;
const ADMIN = process.env.ADMIN_KEY as Hex;
const chain = chainFor(31337, RPC);
const pub = createPublicClient({ chain, transport: http(RPC) }) as PublicClient;
if ((await pub.getChainId()) !== 31337) throw new Error("seed-local only runs against anvil");
const rt = launchRuntime();
const c = adminClients({ rpcUrl: RPC, chainId: 31337, adminKey: ADMIN, deploymentPath: process.env.DEPLOYMENT! });
const now = async () => Number((await pub.getBlock()).timestamp);
const setBalance = (a: string, eth: string) =>
  pub.request({ method: "anvil_setBalance" as never, params: [a, `0x${parseEther(eth).toString(16)}`] as never });
const wc = (a: PrivateKeyAccount) => createWalletClient({ chain, transport: http(RPC), account: a });
const post = async (path: string, body: unknown) => {
  const r = await fetch(API + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
};

async function register(slug: string, a: PrivateKeyAccount) {
  const signature = await a.signMessage({ message: registrationMessage(slug, a.address, 31337) });
  await post(`/launches/${slug}/register`, { wallet: a.address, signature });
}

// ---------------------------------------------------------------- demo-live
const live = "demo-live";
const ts = await now();
rt.service.create({
  slug: live,
  chainId: 31337,
  name: "Kin Demo",
  symbol: "KDEMO",
  registrationClosesAt: ts + 3600,
  tiers: {
    capWei: parseEther("0.01").toString(),
    freshPoolCapWei: parseEther("0.006").toString(),
    verifiedCapWei: parseEther("0.01").toString(),
    freshMaxNonce: 0,
    freshMaxAgeHours: 168,
  },
  window: { delayAfterBuildSec: 20, lengthSec: 90, lockSec: 30 },
});

const funder = privateKeyToAccount(generatePrivateKey());
await setBalance(funder.address, "5");
const bundle = Array.from({ length: 6 }, () => privateKeyToAccount(generatePrivateKey()));
for (const b of bundle) await pub.waitForTransactionReceipt({ hash: await wc(funder).sendTransaction({ to: b.address, value: parseEther("0.05") }) });
const aged = Array.from({ length: 2 }, () => privateKeyToAccount(generatePrivateKey()));
for (const a of aged) {
  await setBalance(a.address, "1");
  await pub.waitForTransactionReceipt({ hash: await wc(a).sendTransaction({ to: a.address, value: 1n }) });
}
const fresh = Array.from({ length: 3 }, () => privateKeyToAccount(generatePrivateKey()));
for (const f of fresh) await setBalance(f.address, "1");

for (const a of [...bundle, ...aged, ...fresh]) await register(live, a);
console.log(`[${live}] 11 wallets registered through the API`);
const built = await rt.service.build(live);
console.log(`[${live}] allowlist v${built.version}: root ${built.root}`, built.stats);
const onchain = await deployLaunch(rt.service, live, c);
console.log(`[${live}] deployed: pool ${onchain.poolId}, window opens at ${onchain.windowStart}`);

while ((await now()) < onchain.windowStart) await Bun.sleep(1000);
const key = await c.pub.readContract({ address: c.factory, abi: (await import("../src/abi/kin")).kinLaunchFactoryAbi, functionName: "launchKey", args: [(await c.pub.readContract({ address: c.factory, abi: (await import("../src/abi/kin")).kinLaunchFactoryAbi, functionName: "launchCount" })) - 1n] });
const dep = JSON.parse(await Bun.file(process.env.DEPLOYMENT!).text());

async function buy(a: PrivateKeyAccount, eth: string) {
  const proof = await (await fetch(`${API}/launches/${live}/proof/${a.address}`)).json();
  try {
    const hash = await wc(a).writeContract({
      address: dep.kinRouter,
      abi: kinRouterAbi,
      functionName: "swapExactIn",
      args: [key, true, parseEther(eth), 0n, { entityId: proof.entityId, entityCap: BigInt(proof.cap), proof: proof.proof }, BigInt(onchain.windowEnd)],
      value: parseEther(eth),
      gas: 600_000n,
    });
    return (await pub.waitForTransactionReceipt({ hash })).status;
  } catch (e) {
    return `error: ${(e as Error).message.split("\n")[0]}`;
  }
}
const outcomes: string[] = [];
for (const b of bundle) outcomes.push(`bundle ${await buy(b, "0.003")}`);
for (const a of aged) outcomes.push(`aged ${await buy(a, "0.005")}`);
for (const f of fresh) outcomes.push(`fresh ${await buy(f, "0.002")}`); // 0.006 pool / 3 wallets
console.log(`[${live}] window buys:`, outcomes.join(", "));

while ((await now()) < onchain.windowEnd) await Bun.sleep(1000);
console.log(`[${live}] finalized: ${await finalizeLaunch(rt.service, live, c)}`);

// ---------------------------------------------------------------- demo-open
const open = "demo-open";
rt.service.create({
  slug: open,
  chainId: 31337,
  name: "Kin Open Demo",
  symbol: "KOPEN",
  registrationClosesAt: (await now()) + 7 * 86400,
  tiers: {
    capWei: parseEther("0.01").toString(),
    freshPoolCapWei: parseEther("0.02").toString(),
    verifiedCapWei: parseEther("0.03").toString(), // verified humans (Base Verify, when enabled) get more
    freshMaxNonce: 0,
    freshMaxAgeHours: 168,
  },
  window: { delayAfterBuildSec: 1800, lengthSec: 1800, lockSec: 3600 },
});
for (const a of aged) await register(open, a);
console.log(`[${open}] registration open`);
