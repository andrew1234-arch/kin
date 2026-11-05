/**
 * DEV ONLY: a local stand-in for Base Verify's POST /v1/base_verify_token, for testing the verified-human flow
 * without a real key. Behaves as base/base-verify-demo docs/api.md describes: 404 until the wallet is marked
 * verified, then 200 {token, action, wallet} with a token that depends on the account and action only.
 *
 *   PORT=8790 bun run scripts/mock-base-verify.ts
 *   curl "http://127.0.0.1:8790/mock/verify?wallet=0x…&account=alice"   # mark a wallet as verified for an account
 */
import { getAddress, verifyMessage, type Hex } from "viem";
import { parseSiweMessage } from "viem/siwe";

const accounts = new Map<string, string>();
const server = Bun.serve({
  port: Number(process.env.PORT ?? 8790),
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/mock/verify") {
      accounts.set(getAddress(url.searchParams.get("wallet")!), url.searchParams.get("account") ?? "account-1");
      return Response.json({ ok: true });
    }
    if (url.pathname !== "/v1/base_verify_token" || req.method !== "POST") return new Response("not found", { status: 404 });
    if (!req.headers.get("authorization")?.startsWith("Bearer ")) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { message, signature } = (await req.json()) as { message: string; signature: Hex };
    const siwe = parseSiweMessage(message);
    const wallet = getAddress(siwe.address!);
    if (!(await verifyMessage({ address: wallet, message, signature }))) return Response.json({ error: "invalid_signature" }, { status: 400 });
    const account = accounts.get(wallet);
    if (!account) return Response.json({ error: "verification_not_found" }, { status: 404 });
    const action = (siwe.resources ?? []).find((r) => r.startsWith("urn:verify:action:"))?.slice("urn:verify:action:".length);
    return Response.json({ token: `mock-${account}-${action}`, action, wallet });
  },
});
console.log(`mock Base Verify on :${server.port}`);
