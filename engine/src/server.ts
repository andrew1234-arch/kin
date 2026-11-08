/**
 * Kin engine HTTP API (Bun). Everything a judge needs works without login.
 *
 *   GET  /health
 *   GET  /scan/:token?cap=<eth>&fresh=<eth>          Kin Scan on Base mainnet (cached)
 *   GET  /launches                                    public launch list
 *   GET  /launches/:slug                              public launch state
 *   GET  /launches/:slug/messages/register?wallet=    exact text to sign
 *   GET  /launches/:slug/messages/dispute?wallet=&reason=
 *   POST /launches/:slug/register   {wallet, signature}
 *   GET  /launches/:slug/allowlist                    entries + proofs (the version that is onchain)
 *   GET  /launches/:slug/proof/:wallet
 *   GET  /launches/:slug/wallets/:wallet               registered? tier, cap, proof, disputes
 *   GET  /launches/:slug/evidence.json[?version=n]    the evidence file, byte for byte
 *   POST /launches/:slug/disputes   {wallet, reason, signature}
 *   GET  /launches/:slug/verify/message?wallet=        Base Verify SIWE message to sign (verified-human tier)
 *   POST /launches/:slug/verify     {wallet, nonce, signature}  → verified | not_verified (+redirectUrl) | traits_not_satisfied
 *   POST /sandbox/runs                                start an attack run (rate limited)
 *   GET  /sandbox/runs/:id                            run state + events
 *   GET  /sandbox/runs/:id/stream                     server-sent events
 *   GET  /sandbox/latest                              most recent finished run
 *   GET  /replay                                      latest replay report, or 404 "not-computed"
 *
 * Env: PORT, CORS_ORIGIN, TRUST_PROXY, BASE_RPC_URL (scan), LAUNCH_* (launches), SANDBOX_* (sandbox), DATA_DIR.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress, isAddress, type Hex } from "viem";
import { scanOptionsFromEnv } from "./config";
import { historyFromEnv } from "./data/history";
import { Rpc } from "./data/rpc";
import { disputeMessage, registrationMessage } from "./launch/registration";
import { LaunchError } from "./launch/service";
import { dataDir } from "./paths";
import { launchRuntime } from "./runtime";
import { sandboxConfigFromEnv } from "./sandbox/config";
import { runSandbox, type SandboxEvent, type SandboxResult } from "./sandbox/relayer";
import { scanToken, type ScanResult } from "./scan/scan";
import { envNum, envStr } from "./env";

const PORT = envNum("PORT", 8787, { min: 1, integer: true });
const CORS = envStr("CORS_ORIGIN") ?? "*";
const launches = launchRuntime();

// ------------------------------------------------------------------ helpers

const headers = { "access-control-allow-origin": CORS, "access-control-allow-headers": "content-type" };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers, ...extra } });
const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => json({ error, ...extra }, status);

const hits = new Map<string, number[]>();
function rateLimited(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
}
/**
 * The client address for rate limits. X-Forwarded-For is set by whoever sends the request, so it is only used
 * when TRUST_PROXY=1 (the engine runs behind a proxy that overwrites it), and then only the entry that proxy
 * appended (the last one). Otherwise the socket address.
 */
const TRUST_PROXY = envStr("TRUST_PROXY") === "1";
const ipOf = (req: Request, server: { requestIP(r: Request): { address: string } | null }) => {
  const socket = server.requestIP(req)?.address ?? "unknown";
  if (!TRUST_PROXY) return socket;
  return req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || socket;
};

// ------------------------------------------------------------------ scan

const scanCache = new Map<string, { at: number; result: ScanResult }>();
const scanInflight = new Map<string, Promise<ScanResult>>();
const SCAN_TTL_MS = envNum("SCAN_CACHE_SECONDS", 600, { min: 0 }) * 1000;
const scanDir = join(dataDir(), "scans");
mkdirSync(scanDir, { recursive: true });

async function scan(token: string, cap?: string, fresh?: string): Promise<ScanResult> {
  const key = `${token.toLowerCase()}:${cap ?? ""}:${fresh ?? ""}`;
  const hit = scanCache.get(key);
  if (hit && Date.now() - hit.at < SCAN_TTL_MS) return hit.result;
  const running = scanInflight.get(key);
  if (running) return running;
  const p = (async () => {
    const rpc = Rpc.fromEnv("BASE_RPC_URL");
    const result = await scanToken(rpc, historyFromEnv(rpc), token, scanOptionsFromEnv({ capEth: cap, freshCapEth: fresh }));
    scanCache.set(key, { at: Date.now(), result });
    writeFileSync(join(scanDir, `${result.token}.json`), JSON.stringify(result));
    return result;
  })().finally(() => scanInflight.delete(key));
  scanInflight.set(key, p);
  return p;
}

// ------------------------------------------------------------------ sandbox

interface Run {
  id: string;
  status: "running" | "done" | "failed";
  startedAt: number;
  events: SandboxEvent[];
  result: SandboxResult | null;
  error: string | null;
  listeners: Set<(e: SandboxEvent) => void>;
}
const runs = new Map<string, Run>();
const sandboxDir = join(dataDir(), "sandbox");
mkdirSync(sandboxDir, { recursive: true });
let activeRun: string | null = null;
const SANDBOX_MAX_PER_DAY = envNum("SANDBOX_MAX_RUNS_PER_DAY", 40, { min: 0, integer: true });
const SANDBOX_IP_COOLDOWN_MS = envNum("SANDBOX_IP_COOLDOWN_SECONDS", 120, { min: 0 }) * 1000;

function startRun(): Run {
  const cfg = sandboxConfigFromEnv();
  const id = `run-${Date.now().toString(36)}`;
  const run: Run = { id, status: "running", startedAt: Date.now(), events: [], result: null, error: null, listeners: new Set() };
  runs.set(id, run);
  activeRun = id;
  const emit = (e: SandboxEvent) => {
    run.events.push(e);
    run.listeners.forEach((l) => l(e));
  };
  runSandbox(cfg, emit)
    .then((r) => {
      run.status = "done";
      run.result = r;
    })
    .catch((err) => {
      run.status = "failed";
      run.error = (err as Error).message;
      emit({ type: "error", message: run.error });
    })
    .finally(() => {
      activeRun = null;
      const { listeners: _l, ...persist } = run;
      writeFileSync(join(sandboxDir, `${id}.json`), JSON.stringify(persist));
    });
  return run;
}

function latestRun(): unknown {
  for (const r of [...runs.values()].reverse()) if (r.status === "done") return { ...r, listeners: undefined };
  const files = readdirSync(sandboxDir).filter((f) => f.endsWith(".json")).sort().reverse();
  for (const f of files) {
    const r = JSON.parse(readFileSync(join(sandboxDir, f), "utf8"));
    if (r.status === "done") return r;
  }
  return null;
}

function runsToday() {
  const since = Date.now() - 86_400_000;
  return readdirSync(sandboxDir).filter((f) => {
    const t = parseInt(f.replace(/^run-|\.json$/g, ""), 36);
    return t > since;
  }).length + (activeRun ? 1 : 0);
}

function sse(run: Run): Response {
  let unsubscribe = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (e: SandboxEvent) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      run.events.forEach(send);
      if (run.status !== "running") {
        controller.close();
        return;
      }
      const l = (e: SandboxEvent) => {
        send(e);
        if (e.type === "result" || e.type === "error") {
          run.listeners.delete(l);
          controller.close();
        }
      };
      run.listeners.add(l);
      unsubscribe = () => run.listeners.delete(l);
    },
    cancel() {
      unsubscribe();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", ...headers },
  });
}

// ------------------------------------------------------------------ router

const server = Bun.serve({
  port: PORT,
  idleTimeout: 120,
  async fetch(req, srv) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...headers, "access-control-allow-methods": "GET,POST" } });
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const ip = ipOf(req, srv);
    try {
      if (parts[0] === "health") {
        return json({
          ok: true,
          scan: !!envStr("BASE_RPC_URL"),
          launches: !!envStr("LAUNCH_RPC_URL"),
          baseVerify: !!envStr("BASE_VERIFY_SECRET_KEY"),
          sandbox: !!envStr("SANDBOX_RPC_URL") && !!envStr("SANDBOX_RELAYER_KEY"),
        });
      }

      // ---- scan
      if (parts[0] === "scan" && parts[1] && req.method === "GET") {
        if (!envStr("BASE_RPC_URL")) return fail(503, "Scan is not configured on this server (BASE_RPC_URL)");
        if (!isAddress(parts[1])) return fail(400, "not a token address");
        if (rateLimited(`scan:${ip}`, 10, 60_000)) return fail(429, "too many scans; try again in a minute");
        const cap = url.searchParams.get("cap") ?? undefined;
        const fresh = url.searchParams.get("fresh") ?? undefined;
        for (const v of [cap, fresh]) if (v !== undefined && !/^\d+(\.\d+)?$/.test(v)) return fail(400, "cap must be a number of ETH");
        return json(await scan(getAddress(parts[1]), cap, fresh));
      }

      // ---- launches
      if (parts[0] === "launches") {
        const svc = launches.service;
        if (!parts[1]) return json(launches.store.list().map((r) => svc.publicView(r)));
        const slug = parts[1];
        if (!parts[2] && req.method === "GET") return json(svc.publicView(svc.get(slug)));
        if (parts[2] === "messages" && req.method === "GET") {
          const rec = svc.get(slug);
          const w = url.searchParams.get("wallet") ?? "";
          if (!isAddress(w)) return fail(400, "wallet required");
          if (parts[3] === "register") return json({ message: registrationMessage(slug, w, rec.chainId) });
          if (parts[3] === "dispute") return json({ message: disputeMessage(slug, w, rec.chainId, (url.searchParams.get("reason") ?? "").trim()) });
        }
        if (parts[2] === "verify" && parts[3] === "message" && req.method === "GET") {
          if (rateLimited(`vmsg:${ip}`, 20, 60_000)) return fail(429, "slow down");
          return json(svc.verifyMessage(slug, url.searchParams.get("wallet") ?? ""));
        }
        if (parts[2] === "verify" && !parts[3] && req.method === "POST") {
          if (rateLimited(`verify:${ip}`, 10, 60_000)) return fail(429, "slow down");
          const body = (await req.json()) as { wallet: string; nonce: string; signature: Hex };
          return json(await svc.submitVerification(slug, body.wallet, body.nonce, body.signature));
        }
        if (parts[2] === "register" && req.method === "POST") {
          if (rateLimited(`reg:${ip}`, 30, 60_000)) return fail(429, "slow down");
          const body = (await req.json()) as { wallet: string; signature: Hex };
          return json(await svc.register(slug, body.wallet, body.signature));
        }
        if (parts[2] === "allowlist" && req.method === "GET") return json(await svc.entries(slug));
        if (parts[2] === "wallets" && parts[3] && req.method === "GET") return json(await svc.walletStatus(slug, parts[3]));
        if (parts[2] === "proof" && parts[3] && req.method === "GET") return json(await svc.proof(slug, parts[3]));
        if (parts[2] === "evidence.json" && req.method === "GET") {
          const v = url.searchParams.get("version");
          return new Response(await svc.evidence(slug, v ? Number(v) : undefined), {
            headers: { "content-type": "application/json", ...headers },
          });
        }
        if (parts[2] === "disputes" && req.method === "POST") {
          if (rateLimited(`disp:${ip}`, 10, 60_000)) return fail(429, "slow down");
          const body = (await req.json()) as { wallet: string; reason: string; signature: Hex };
          return json(await svc.dispute(slug, body.wallet, body.reason, body.signature));
        }
      }

      // ---- sandbox
      if (parts[0] === "sandbox") {
        if (parts[1] === "latest") return json(latestRun());
        if (parts[1] === "runs" && !parts[2] && req.method === "POST") {
          if (!envStr("SANDBOX_RPC_URL") || !envStr("SANDBOX_RELAYER_KEY")) return fail(503, "Sandbox is not configured on this server");
          if (activeRun) return fail(429, "a run is in progress; watch it instead", { runningId: activeRun });
          if (rateLimited(`sbx:${ip}`, 1, SANDBOX_IP_COOLDOWN_MS)) return fail(429, "one run per visitor every few minutes");
          if (runsToday() >= SANDBOX_MAX_PER_DAY) return fail(429, "daily run budget used; the latest run is shown instead");
          const run = startRun();
          return json({ id: run.id }, 202);
        }
        if (parts[1] === "runs" && parts[2]) {
          const run = runs.get(parts[2]);
          if (!run) {
            const f = join(sandboxDir, `${parts[2]}.json`);
            if (existsSync(f)) return json(JSON.parse(readFileSync(f, "utf8")));
            return fail(404, "run not found");
          }
          if (parts[3] === "stream") return sse(run);
          return json({ ...run, listeners: undefined });
        }
      }

      // ---- replay
      if (parts[0] === "replay") {
        const f = join(dataDir(), "replay", "latest.json");
        if (!existsSync(f)) return fail(404, "not-computed");
        return new Response(readFileSync(f), { headers: { "content-type": "application/json", ...headers } });
      }

      return fail(404, "not found");
    } catch (e) {
      if (e instanceof LaunchError) return fail(e.status, e.message);
      console.error(e);
      return fail(500, (e as Error).message);
    }
  },
});
console.log(`kin engine listening on :${server.port}`);
