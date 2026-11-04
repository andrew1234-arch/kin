/**
 * A configuration or usage problem (missing or malformed setting, bad argument). CLIs exit with code 2 for
 * it and write nothing; anything else is an unexpected error.
 */
export class ConfigError extends Error {}

/**
 * Environment access for the engine. An empty or whitespace-only value counts as unset, because
 * .env.example ships blank keys and `KEY=` must not mean "the empty string". Numbers are validated:
 * a malformed value fails loudly instead of becoming NaN or 0.
 */
export function envStr(key: string): string | undefined {
  const v = process.env[key];
  return v === undefined || v.trim() === "" ? undefined : v.trim();
}

export function envRequired(key: string, hint = "see engine/.env.example"): string {
  const v = envStr(key);
  if (v === undefined) throw new ConfigError(`${key} is not set (${hint})`);
  return v;
}

export function envNum(key: string, def: number, opts: { min?: number; integer?: boolean } = {}): number {
  const v = envStr(key);
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isFinite(n) || (opts.integer && !Number.isInteger(n)) || (opts.min !== undefined && n < opts.min)) {
    throw new ConfigError(`${key}=${v} is not a valid ${opts.integer ? "integer" : "number"}${opts.min !== undefined ? ` >= ${opts.min}` : ""}`);
  }
  return n;
}

/** A strictly positive integer as bigint (e.g. a block-range chunk size). */
export function envPositiveBigInt(key: string, def: bigint): bigint {
  const v = envStr(key);
  if (v === undefined) return def;
  if (!/^\d+$/.test(v) || BigInt(v) <= 0n) throw new ConfigError(`${key}=${v} must be a positive integer`);
  return BigInt(v);
}
