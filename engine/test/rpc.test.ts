import { afterAll, expect, test } from "bun:test";
import { Rpc } from "../src/data/rpc";

// A JSON-RPC endpoint that rate limits: the first two requests get HTTP 429 (Retry-After: 1), then it answers.
let hits = 0;
const server = Bun.serve({
  port: 0,
  fetch() {
    hits++;
    if (hits <= 2) return new Response("slow down", { status: 429, headers: { "retry-after": "1" } });
    return Response.json({ jsonrpc: "2.0", id: 1, result: "0x2105" });
  },
});
afterAll(() => server.stop(true));

test("a rate-limited call waits for Retry-After and then succeeds", async () => {
  const rpc = new Rpc(`http://127.0.0.1:${server.port}`, { concurrency: 2 });
  const t0 = Date.now();
  expect(await rpc.call<string>("eth_chainId", [])).toBe("0x2105");
  expect(hits).toBe(3);
  expect(Date.now() - t0).toBeGreaterThanOrEqual(1900); // two pauses of about a second each
});
