/**
 * Minimal JSON-RPC client with per-method call counting, so Gate A can report exactly how many
 * requests indexing a token takes. Endpoints come from the environment only.
 */
import { envNum, envRequired } from "../env";

export class Rpc {
  readonly calls = new Map<string, number>();
  private inflight = 0;
  private queue: (() => void)[] = [];

  constructor(
    readonly url: string,
    private readonly opts: { concurrency?: number; retries?: number } = {},
  ) {}

  static fromEnv(name = "BASE_RPC_URL", concurrency = envNum("RPC_CONCURRENCY", 8, { min: 1, integer: true })): Rpc {
    return new Rpc(envRequired(name), { concurrency });
  }

  totalCalls(): number {
    let n = 0;
    for (const v of this.calls.values()) n += v;
    return n;
  }

  /** While set, every call waits: the endpoint said "too many requests", so the whole client backs off together. */
  private pausedUntil = 0;

  async call<T>(method: string, params: unknown[]): Promise<T> {
    await this.acquire();
    try {
      const retries = this.opts.retries ?? 8;
      for (let attempt = 0; ; attempt++) {
        const wait = this.pausedUntil - Date.now();
        if (wait > 0) await sleep(wait);
        this.calls.set(method, (this.calls.get(method) ?? 0) + 1);
        try {
          const res = await fetch(this.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
            signal: AbortSignal.timeout(30_000),
          });
          if (res.status === 429) {
            // Rate limited (Alchemy's free plan caps compute units per second): pause everyone, honouring Retry-After.
            const after = Number(res.headers.get("retry-after"));
            const ms = Number.isFinite(after) && after > 0 ? after * 1000 : Math.min(8000, 600 * 2 ** attempt);
            this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms + Math.random() * 400);
            throw new RetryableError("HTTP 429: the data provider is rate limiting this server");
          }
          if (res.status >= 500) throw new RetryableError(`HTTP ${res.status}`);
          const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
          if (body.error) {
            // Alchemy also reports throughput limits as JSON-RPC errors (code 429 or -32005).
            if (body.error.code === 429 || /compute units|rate limit|too many requests/i.test(body.error.message)) {
              this.pausedUntil = Math.max(this.pausedUntil, Date.now() + Math.min(8000, 600 * 2 ** attempt));
              throw new RetryableError(`${method}: rate limited`);
            }
            throw new RpcError(method, body.error.code, body.error.message);
          }
          return body.result as T;
        } catch (e) {
          if (attempt >= retries || e instanceof RpcError) throw e;
          await sleep(Math.min(8000, 300 * 2 ** attempt) * (0.75 + Math.random() / 2));
        }
      }
    } finally {
      this.release();
    }
  }

  private async acquire() {
    const limit = this.opts.concurrency ?? 8;
    if (this.inflight < limit) {
      this.inflight++;
      return;
    }
    await new Promise<void>((r) => this.queue.push(r));
    this.inflight++;
  }

  private release() {
    this.inflight--;
    this.queue.shift()?.();
  }
}

export class RpcError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    message: string,
  ) {
    super(`${method}: ${code} ${message}`);
  }
}
class RetryableError extends Error {}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const hex = (n: bigint | number) => "0x" + BigInt(n).toString(16);
