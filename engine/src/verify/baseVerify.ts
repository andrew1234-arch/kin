/**
 * Base Verify integration: the "verified human" tier.
 *
 * Source: Base's official demo and docs, github.com/base/base-verify-demo @ 70053381a43b63b0c377618ba1a2818b355f9351
 *   - docs/api.md: POST {api}/base_verify_token with {signature, message}, `Authorization: Bearer <secret>`;
 *     200 {token, action, wallet} | 404 verification_not_found | 400 traits not satisfied | 401 unauthorized;
 *     mini app redirect `https://verify.base.dev?redirect_uri=…&providers=…`
 *   - lib/config.ts: API root https://verify.base.dev/v1 and web app https://verify.base.dev (defaults)
 *   - lib/signature-generator.ts: a SIWE message whose resources carry `urn:verify:provider:<p>`,
 *     `urn:verify:provider:<p>:<trait>:<op>:<value>` and `urn:verify:action:<action>`
 *   - docs/core-concepts.md: the token is deterministic per provider account and action, so the same account
 *     verifying from a second wallet returns the same token; that is the sybil check.
 * Both of Base Verify's variants need a secret key, obtained through Base's interest form. Without
 * BASE_VERIFY_SECRET_KEY the tier is simply off.
 *
 * Kin builds the SIWE message itself (provider, traits, action, nonce), so a user can't loosen the requirements
 * the docs warn about; it accepts a signature only for a message it issued, once, before it expires.
 * Each launch is its own action, so one verified account can verify exactly one wallet per launch.
 */
import { createSiweMessage, generateSiweNonce } from "viem/siwe";
import { getAddress, keccak256, toBytes, type Address, type Hex } from "viem";
import { ConfigError, envNum, envStr } from "../env";

export interface BaseVerifyConfig {
  secretKey: string;
  apiUrl: string;
  webAppUrl: string;
  /** Where the Kin web app lives; the SIWE domain and the mini-app redirect come from it. */
  appUrl: string;
  provider: string;
  /** Trait requirements, e.g. { coinbase_one_active: "true" } or { followers: "gte:1000" }. */
  traits: Record<string, string>;
  siweChainId: number;
  messageTtlSec: number;
}

export function baseVerifyConfigFromEnv(): BaseVerifyConfig | null {
  const secretKey = envStr("BASE_VERIFY_SECRET_KEY");
  if (!secretKey) return null;
  const appUrl = envStr("KIN_APP_URL");
  if (!appUrl) throw new ConfigError("BASE_VERIFY_SECRET_KEY is set but KIN_APP_URL (the web app's public URL) is not");
  const traits: Record<string, string> = {};
  for (const pair of (envStr("BASE_VERIFY_TRAITS") ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const i = pair.indexOf("=");
    if (i <= 0) throw new ConfigError(`BASE_VERIFY_TRAITS entry "${pair}" must look like name=value`);
    traits[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return {
    secretKey,
    apiUrl: (envStr("BASE_VERIFY_API_URL") ?? "https://verify.base.dev/v1").replace(/\/$/, ""),
    webAppUrl: (envStr("BASE_VERIFY_WEBAPP_URL") ?? "https://verify.base.dev").replace(/\/$/, ""),
    appUrl: appUrl.replace(/\/$/, ""),
    provider: envStr("BASE_VERIFY_PROVIDER") ?? "coinbase",
    traits,
    siweChainId: envNum("BASE_VERIFY_SIWE_CHAIN_ID", 8453, { min: 1, integer: true }),
    messageTtlSec: envNum("BASE_VERIFY_MESSAGE_TTL_SECONDS", 600, { min: 30, integer: true }),
  };
}

/** One action per launch: one verified account → one verified wallet per launch. Lowercase with underscores. */
export const verifyAction = (slug: string) => `kin_launch_${slug.replace(/[^a-z0-9]/g, "_")}`;

export type VerifyOutcome =
  | { kind: "verified"; tokenHash: Hex }
  | { kind: "not_verified"; redirectUrl: string }
  | { kind: "traits_not_satisfied" };

export class BaseVerifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface Issued {
  wallet: Address;
  slug: string;
  message: string;
  expiresAt: number;
}

export class BaseVerifyClient {
  private readonly issued = new Map<string, Issued>(); // nonce -> message

  constructor(
    readonly cfg: BaseVerifyConfig,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The exact SIWE message the wallet must sign. */
  issueMessage(slug: string, walletIn: string): { message: string; nonce: string; expiresAt: number } {
    this.sweep();
    const wallet = getAddress(walletIn);
    const nonce = generateSiweNonce();
    const issuedAt = new Date(this.now());
    const expirationTime = new Date(this.now() + this.cfg.messageTtlSec * 1000);
    const p = this.cfg.provider;
    const resources = [
      `urn:verify:provider:${p}`,
      ...Object.entries(this.cfg.traits).map(([k, v]) => {
        const m = v.match(/^(eq|gt|gte|lt|lte|in):(.+)$/);
        return m ? `urn:verify:provider:${p}:${k}:${m[1]}:${m[2]}` : `urn:verify:provider:${p}:${k}:eq:${v}`;
      }),
      `urn:verify:action:${verifyAction(slug)}`,
    ];
    const message = createSiweMessage({
      domain: new URL(this.cfg.appUrl).host,
      address: wallet,
      statement: `Verify for the Kin launch "${slug}" to get the verified-human cap`,
      uri: this.cfg.appUrl,
      version: "1",
      chainId: this.cfg.siweChainId,
      nonce,
      issuedAt,
      expirationTime,
      resources,
    });
    this.issued.set(nonce, { wallet, slug, message, expiresAt: expirationTime.getTime() });
    return { message, nonce, expiresAt: Math.floor(expirationTime.getTime() / 1000) };
  }

  /**
   * Check a signed message with Base Verify. The message must be one this client issued for this launch and
   * wallet, unexpired; each nonce is usable once.
   */
  async verify(slug: string, walletIn: string, nonce: string, signature: Hex): Promise<VerifyOutcome> {
    const wallet = getAddress(walletIn);
    const issued = this.issued.get(nonce);
    if (!issued || issued.slug !== slug || issued.wallet !== wallet) {
      throw new BaseVerifyError("unknown or mismatched verification message; request a new one", 400);
    }
    this.issued.delete(nonce);
    if (this.now() > issued.expiresAt) throw new BaseVerifyError("the verification message expired; request a new one", 400);

    const res = await this.fetchFn(`${this.cfg.apiUrl}/base_verify_token`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.secretKey}` },
      body: JSON.stringify({ signature, message: issued.message }),
    });
    const body = (await res.json().catch(() => ({}))) as { token?: string; action?: string; wallet?: string; error?: string; message?: string };
    if (res.status === 200) {
      if (!body.token) throw new BaseVerifyError("Base Verify returned no token", 502);
      if (body.action !== verifyAction(slug)) throw new BaseVerifyError(`Base Verify answered for action "${body.action}"`, 502);
      if (!body.wallet || getAddress(body.wallet) !== wallet) throw new BaseVerifyError("Base Verify answered for another wallet", 502);
      // Only a hash of the token is kept: enough to block a second wallet, nothing more.
      return { kind: "verified", tokenHash: keccak256(toBytes(`${verifyAction(slug)}:${body.token}`)) };
    }
    if (res.status === 404) {
      const q = new URLSearchParams({ redirect_uri: `${this.cfg.appUrl}/launch/${slug}`, providers: this.cfg.provider });
      return { kind: "not_verified", redirectUrl: `${this.cfg.webAppUrl}?${q}` };
    }
    if (res.status === 400 && /traits_not_satisfied/.test(body.message ?? body.error ?? "")) return { kind: "traits_not_satisfied" };
    if (res.status === 401) throw new BaseVerifyError("Base Verify rejected the server's key", 503);
    throw new BaseVerifyError(`Base Verify error ${res.status}: ${body.error ?? body.message ?? ""}`.trim(), 502);
  }

  private sweep() {
    const t = this.now();
    for (const [n, i] of this.issued) if (i.expiresAt < t) this.issued.delete(n);
  }
}
