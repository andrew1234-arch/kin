/**
 * RPC endpoints carry API keys in their URLs (Alchemy and Infura in the path, others as a query parameter), and
 * client errors quote the URL. Nothing the engine stores or serves may contain one.
 */
export function redactSecrets(s: string): string {
  return s
    .replace(/(https?:\/\/[^\s"'\\/]+\/v[0-9]\/)[A-Za-z0-9_-]{8,}/g, "$1<redacted>")
    .replace(/([?&](?:api[-_]?key|key|token|access[-_]?token)=)[^&\s"'\\]+/gi, "$1<redacted>")
    .replace(/\balch_[A-Za-z0-9_-]{6,}/g, "<redacted>");
}

/** An error as one short, safe line for users and logs: viem's short message when there is one, never a URL's key. */
export function publicError(e: unknown): string {
  const err = e as { shortMessage?: unknown; message?: unknown } | null;
  const raw =
    typeof err?.shortMessage === "string" ? err.shortMessage : typeof err?.message === "string" ? err.message : String(e);
  return redactSecrets(raw.split("\n")[0]!.trim());
}
