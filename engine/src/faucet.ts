import { chainTransport } from "./data/transport";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, formatEther, getAddress, isAddress, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { envNum, envStr } from "./env";
import { dataDir } from "./paths";
import { chainFor } from "./sandbox/relayer";

/**
 * Test-ETH faucet for the launch chain (Base Sepolia), so a judge can try a launch without hunting for a faucet.
 *   FAUCET_KEY           private key of the faucet wallet (unset = faucet off). Its address is added to the
 *                        funding exclusions (see config.ts), so wallets it funds are not linked to each other.
 *   FAUCET_DRIP_ETH      sent per request (default 0.0005: a test drive at the default demo cap, plus gas)
 *   FAUCET_DAILY_DRIPS   total drips per UTC day (default 60)
 *   FAUCET_PER_IP        drips per IP per 24 h (default 4: a judge's test wallet plus their own)
 * A wallet gets one drip per 24 h, and none if it already holds a drip's worth.
 */
export class FaucetError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

interface Drip {
  wallet: Address;
  ip: string;
  hash: Hex;
  at: number;
  wei: string;
}

export function faucetFromEnv() {
  const key = envStr("FAUCET_KEY") as Hex | undefined;
  const rpcUrl = envStr("LAUNCH_RPC_URL");
  if (!key || !rpcUrl) return null;
  return new Faucet({
    key,
    rpcUrl,
    chainId: envNum("LAUNCH_CHAIN_ID", 84532, { min: 1, integer: true }),
    dripWei: parseEther(envStr("FAUCET_DRIP_ETH") ?? "0.0005"),
    dailyDrips: envNum("FAUCET_DAILY_DRIPS", 60, { min: 0, integer: true }),
    perIp: envNum("FAUCET_PER_IP", 4, { min: 1, integer: true }),
    file: join(dataDir(), "faucet.jsonl"),
  });
}

export class Faucet {
  private readonly account;
  private readonly pub;
  private readonly wallet;
  private readonly drips: Drip[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly o: { key: Hex; rpcUrl: string; chainId: number; dripWei: bigint; dailyDrips: number; perIp: number; file: string },
  ) {
    this.account = privateKeyToAccount(o.key);
    const chain = chainFor(o.chainId, o.rpcUrl);
    this.pub = createPublicClient({ chain, transport: chainTransport(o.rpcUrl, o.chainId) });
    this.wallet = createWalletClient({ chain, transport: chainTransport(o.rpcUrl, o.chainId), account: this.account });
    if (existsSync(o.file)) {
      for (const line of readFileSync(o.file, "utf8").split("\n")) if (line.trim()) this.drips.push(JSON.parse(line) as Drip);
    } else {
      mkdirSync(join(o.file, ".."), { recursive: true });
    }
  }

  get address() {
    return this.account.address;
  }

  async info() {
    const balance = await this.pub.getBalance({ address: this.account.address });
    const today = this.drips.filter((d) => d.at >= startOfUtcDay()).length;
    return {
      enabled: true,
      address: this.account.address,
      chainId: this.o.chainId,
      balanceWei: balance.toString(),
      dripWei: this.o.dripWei.toString(),
      dripsLeftToday: Math.max(0, this.o.dailyDrips - today),
      // How many more drips the balance covers, leaving a little for gas.
      dripsInBalance: Number(balance / (this.o.dripWei + parseEther("0.00001"))),
    };
  }

  /** Send one drip. Requests are serialised so concurrent drips never reuse a nonce. */
  drip(walletIn: string, ip: string): Promise<{ hash: Hex; wei: string; wallet: Address }> {
    const run = this.queue.then(() => this.dripNow(walletIn, ip));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async dripNow(walletIn: string, ip: string) {
    if (!isAddress(walletIn)) throw new FaucetError("not a wallet address");
    const wallet = getAddress(walletIn);
    const now = Math.floor(Date.now() / 1000);
    const day = now - 86_400;
    if (this.drips.some((d) => d.wallet === wallet && d.at > day)) throw new FaucetError("this wallet already got test ETH today", 429);
    if (this.drips.filter((d) => d.ip === ip && d.at > day).length >= this.o.perIp) {
      throw new FaucetError("this connection has used its test ETH for today", 429);
    }
    if (this.drips.filter((d) => d.at >= startOfUtcDay()).length >= this.o.dailyDrips) {
      throw new FaucetError("the faucet's daily budget is used up; try again after 00:00 UTC", 429);
    }
    const have = await this.pub.getBalance({ address: wallet });
    if (have >= this.o.dripWei) throw new FaucetError(`this wallet already has ${formatEther(have)} ETH, enough to test`, 409);
    const balance = await this.pub.getBalance({ address: this.account.address });
    if (balance < this.o.dripWei + parseEther("0.00001")) throw new FaucetError("the faucet is empty; the team has been notified", 503);
    const hash = await this.wallet.sendTransaction({ to: wallet, value: this.o.dripWei, chain: this.wallet.chain, account: this.account });
    await this.pub.waitForTransactionReceipt({ hash });
    const row: Drip = { wallet, ip, hash, at: now, wei: this.o.dripWei.toString() };
    this.drips.push(row);
    appendFileSync(this.o.file, JSON.stringify(row) + "\n");
    console.log(`faucet: ${formatEther(this.o.dripWei)} ETH to ${wallet} (${hash})`);
    return { hash, wei: row.wei, wallet };
  }
}

function startOfUtcDay() {
  const d = new Date();
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
}
