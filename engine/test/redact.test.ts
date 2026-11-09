import { expect, test } from "bun:test";
import { publicError, redactSecrets } from "../src/redact";

test("RPC keys never survive into stored or served text", () => {
  const msg = 'The request took too long to respond.\n\nURL: https://base-sepolia.g.alchemy.com/v2/alch_AbCdEf123456\nRequest body: {"x":1}';
  expect(publicError({ message: msg })).toBe("The request took too long to respond.");
  expect(publicError({ shortMessage: "Timed out", message: msg })).toBe("Timed out");
  const json = JSON.stringify({ error: msg, rpc: "https://mainnet.infura.io/v3/0123456789abcdef", q: "https://rpc.example.org/?apikey=s3cr3t&x=1" });
  const out = redactSecrets(json);
  expect(out).not.toContain("alch_AbCdEf123456");
  expect(out).not.toContain("0123456789abcdef");
  expect(out).not.toContain("s3cr3t");
  expect(out).toContain("https://base-sepolia.g.alchemy.com/v2/<redacted>");
  // Explorer links and addresses are untouched.
  const link = "https://sepolia.basescan.org/tx/0x1acb23ab0987ade8fb10172f2e072bb7be0d804c91633c72542d1b8bb1a4993c";
  expect(redactSecrets(link)).toBe(link);
});
