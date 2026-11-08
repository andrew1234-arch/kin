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

  static fromEnv(name = "BASE_RPC_URL"): Rpc {
    return new Rpc(envRequired(name), { concurrency: envNum("RPC_CONCURRENCY", 8, { min: 1, integer: true }) });
  }

  totalCalls(): number {
    let n = 0;
    for (const v of this.calls.values()) n += v;
    return n;
  }

  async call<T>(method: string, params: unknown[]): Promise<T> {
    await this.acquire();
    try {
      const retries = this.opts.retries ?? 4;
      for (let attempt = 0; ; attempt++) {
        this.calls.set(method, (this.calls.get(method) ?? 0) + 1);
        try {
          const res = await fetch(this.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          });
          if (res.status === 429 || res.status >= 500) throw new RetryableError(`HTTP ${res.status}`);
          const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
          if (body.error) throw new RpcError(method, body.error.code, body.error.message);
          return body.result as T;
        } catch (e) {
          if (attempt >= retries || e instanceof RpcError) throw e;
          await sleep(250 * 2 ** attempt);
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
