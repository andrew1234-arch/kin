import { formatEther, formatUnits } from "viem";

export const short = (a: string, n = 4) => (a.length > 2 + n * 2 ? `${a.slice(0, 2 + n)}…${a.slice(-n)}` : a);

export function eth(wei: string | bigint, digits = 4): string {
  const v = Number(formatEther(BigInt(wei)));
  if (v === 0) return "0";
  if (v < 10 ** -digits) return `<${(10 ** -digits).toFixed(digits)}`;
  return v.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function tokens(amount: string | bigint, decimals = 18): string {
  const v = Number(formatUnits(BigInt(amount), decimals));
  return v.toLocaleString("en-US", { notation: v >= 1e6 ? "compact" : "standard", maximumFractionDigits: 2 });
}

export const pct = (bps: number | null | undefined, digits = 1) =>
  bps === null || bps === undefined ? "n/a" : `${(bps / 100).toFixed(digits)}%`;

export function duration(sec: number): string {
  if (sec < 0) sec = 0;
  if (sec < 90) return `${Math.round(sec)}s`;
  if (sec < 5400) return `${Math.round(sec / 60)} min`;
  if (sec < 172800) return `${Math.round(sec / 3600)} h`;
  return `${Math.round(sec / 86400)} days`;
}
