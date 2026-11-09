"use client";

import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createConnector } from "wagmi";
import { launchChain, LAUNCH_RPC_URL } from "./config";

/**
 * Test wallets: three keys generated in this browser, so anyone (a judge on a phone included) can try Kin on
 * Base Sepolia without installing a wallet. "You" is the wallet the faucet funds; the two "extra wallets" are the
 * ones a bundler would fund from it. The keys never leave this browser and only ever hold test ETH.
 */
export type Role = "main" | "a" | "b";
export const ROLES: Role[] = ["main", "a", "b"];
export const ROLE_LABEL: Record<Role, string> = { main: "You", a: "Extra wallet 1", b: "Extra wallet 2" };

export interface TestWallets {
  keys: Record<Role, Hex>;
  createdAt: number;
}

const KEY = "kin:test-wallets:v1";
const listeners = new Set<() => void>();

export function loadTestWallets(): TestWallets | null {
  try {
    const raw = localStorage.getItem(KEY);
    const t = raw ? (JSON.parse(raw) as TestWallets) : null;
    return t && ROLES.every((r) => /^0x[0-9a-fA-F]{64}$/.test(t.keys?.[r] ?? "")) ? t : null;
  } catch {
    return null;
  }
}

export function createTestWallets(): TestWallets {
  const t: TestWallets = {
    keys: { main: generatePrivateKey(), a: generatePrivateKey(), b: generatePrivateKey() },
    createdAt: Math.floor(Date.now() / 1000),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    // storage blocked: the wallets last for this visit only
  }
  listeners.forEach((f) => f());
  return t;
}

export function forgetTestWallets() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
  listeners.forEach((f) => f());
}

export function onTestWalletsChange(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

export const addressOf = (k: Hex): Address => privateKeyToAccount(k).address;

export const publicClient = createPublicClient({ chain: launchChain, transport: http(LAUNCH_RPC_URL || undefined) });

export function walletFor(k: Hex) {
  return createWalletClient({ account: privateKeyToAccount(k), chain: launchChain, transport: http(LAUNCH_RPC_URL || undefined) });
}

/**
 * A wagmi connector for the "You" test wallet, so the rest of the site (launch pages, profile, claims) works with
 * it like any other wallet. Transactions and signatures are made locally with the key.
 */
export function testWalletConnector() {
  type Provider = { request(args: { method: string; params?: unknown }): Promise<unknown> };
  return createConnector<Provider>((config) => {
    const key = () => loadTestWallets()?.keys.main ?? null;
    const FLAG = "kin:test-wallet:connected";
    const setConnected = (on: boolean) => {
      try {
        if (on) localStorage.setItem(FLAG, "1");
        else localStorage.removeItem(FLAG);
      } catch {}
    };
    const wasConnected = () => {
      try {
        return localStorage.getItem(FLAG) === "1";
      } catch {
        return false;
      }
    };
    return {
      id: "kinTestWallet",
      name: "Test wallet (no extension)",
      type: "kinTestWallet",
      async connect(params?: { chainId?: number }) {
        let k = key();
        if (!k) k = createTestWallets().keys.main;
        setConnected(true);
        const accounts = [addressOf(k)];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { accounts, chainId: params?.chainId ?? launchChain.id } as any;
      },
      async disconnect() {
        setConnected(false);
      },
      async getAccounts() {
        const k = key();
        return k ? [addressOf(k)] : [];
      },
      async getChainId() {
        return launchChain.id;
      },
      async isAuthorized() {
        return wasConnected() && !!key();
      },
      async getClient() {
        const k = key();
        if (!k) throw new Error("No test wallet in this browser");
        return walletFor(k);
      },
      async getProvider() {
        return {
          request: async ({ method, params }: { method: string; params?: unknown }) => {
            const k = key();
            if (method === "eth_accounts" || method === "eth_requestAccounts") return k ? [addressOf(k)] : [];
            if (method === "eth_chainId") return `0x${launchChain.id.toString(16)}`;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return publicClient.request({ method, params } as any);
          },
        };
      },
      async switchChain({ chainId }: { chainId: number }) {
        const chain = config.chains.find((c) => c.id === chainId);
        if (!chain) throw new Error(`The test wallet only works on ${launchChain.name}`);
        return chain;
      },
      onAccountsChanged() {},
      onChainChanged() {},
      onDisconnect() {
        setConnected(false);
        config.emitter.emit("disconnect");
      },
    };
  });
}
