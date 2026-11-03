/**
 * Deterministic JSON: object keys sorted, bigint as decimal string, no whitespace.
 * The evidence file is published byte-for-byte as produced here, so anyone can recompute
 * keccak256(file) and compare it with the evidenceHash committed in KinHook.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = normalize(x);
    }
    return out;
  }
  return v;
}
