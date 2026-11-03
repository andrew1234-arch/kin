/**
 * Builds engine/data/exclusions.json: addresses that must never create a cluster link
 * (exchange hot wallets, bridges, routers, 4337 infrastructure).
 *
 * Source: dawsbot/eth-labels (MIT), data/csv/accounts.csv, pinned by commit.
 *   git clone https://github.com/dawsbot/eth-labels && git -C eth-labels checkout <commit>
 *   bun run scripts/build-exclusions.ts eth-labels/data/csv/accounts.csv <commit>
 *
 * Rules (recorded in the output so the evidence file can cite them):
 *  - Base (8453): every row whose label is in BASE_LABELS.
 *  - Ethereum (1): rows whose label is in ETH_LABELS. EOAs are the same key on every EVM chain,
 *    so a labelled exchange hot wallet on Ethereum is the same operator if it funds wallets on Base.
 *    Per-user deposit addresses, and rows with no name tag (bulk, undocumented), are dropped.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress } from "viem";

const BASE_LABELS = ["exchange", "gate", "coinbase", "phemex", "bridge", "router", "kyberswap"];
const ETH_LABELS = [
  // centralised exchanges
  "coinbase", "kraken", "okx", "kucoin", "bitfinex", "bitget", "mexc", "crypto-com", "gemini", "bitstamp",
  "upbit", "bithumb", "bitmart", "coinone", "deribit", "poloniex", "hotbit",
  // bridges
  "bridge", "stargate", "layerzero", "wormhole",
  // routers / aggregators
  "router", "1inch", "0x-protocol", "paraswap", "kyberswap",
  // account-abstraction infrastructure
  "erc-4337-bundler", "paymaster",
];
const isDepositAddress = (tag: string) => /\bDep:|:\s*Deposit(\s+\d+)?$/i.test(tag);

const [csvPath, commit] = process.argv.slice(2);
if (!csvPath || !commit) throw new Error("usage: build-exclusions.ts <accounts.csv> <eth-labels commit>");

const lines = readFileSync(csvPath, "utf8").trim().split("\n");
const header = parseCsvLine(lines[0]!);
const idx = (k: string) => header.indexOf(k);
const out = new Map<string, { address: string; chainId: number; label: string; nameTag: string }>();
for (const line of lines.slice(1)) {
  const f = parseCsvLine(line);
  const chainId = Number(f[idx("chainId")]);
  const label = f[idx("label")]!;
  const nameTag = f[idx("nameTag")] ?? "";
  const keep =
    (chainId === 8453 && BASE_LABELS.includes(label)) ||
    (chainId === 1 && ETH_LABELS.includes(label) && nameTag.trim() !== "" && !isDepositAddress(nameTag));
  if (!keep) continue;
  let address: string;
  try {
    address = getAddress(f[idx("address")]!);
  } catch {
    continue;
  }
  const key = address.toLowerCase();
  if (!out.has(key) || chainId === 8453) out.set(key, { address, chainId, label, nameTag });
}

const addresses = [...out.values()].sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
const file = {
  source: {
    repo: "https://github.com/dawsbot/eth-labels",
    commit,
    file: "data/csv/accounts.csv",
    license: "MIT (Copyright (c) 2022 Dawson Botsford)",
  },
  rules: { baseLabels: BASE_LABELS, ethereumLabels: ETH_LABELS, dropped: "Ethereum per-user deposit addresses and rows without a name tag" },
  count: addresses.length,
  addresses,
};
const dest = join(import.meta.dir, "../data/exclusions.json");
writeFileSync(dest, JSON.stringify(file, null, 1) + "\n");
console.log(`wrote ${addresses.length} addresses to ${dest}`);

function parseCsvLine(line: string): string[] {
  const res: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { res.push(cur); cur = ""; }
    else cur += c;
  }
  res.push(cur);
  return res;
}
