import { API_URL, LAUNCH_MIRROR } from "./config";
import type { LaunchView, WalletStatus } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_URL) throw new ApiError("The Kin engine API is not configured for this site.", 503);
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Could not reach the Kin engine API.", 503);
  }
  if (!res.ok) {
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {}
    throw new ApiError(typeof body.error === "string" ? body.error : res.statusText, res.status, body);
  }
  return (await res.json()) as T;
}

export const post = <T>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) });

interface Mirror {
  launch: LaunchView;
  entries: NonNullable<WalletStatus["entry"]>[];
}
const mirrors = new Map<string, Promise<Mirror | null>>();

/** The published static copy of a launch (NEXT_PUBLIC_LAUNCH_MIRROR), or null if none is configured or reachable. */
export function launchMirror(slug: string): Promise<Mirror | null> {
  if (!LAUNCH_MIRROR) return Promise.resolve(null);
  let p = mirrors.get(slug);
  if (!p) {
    p = fetch(`${LAUNCH_MIRROR}/${encodeURIComponent(slug)}.json`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Mirror>) : null))
      .catch(() => null);
    mirrors.set(slug, p);
  }
  return p;
}

/** A wallet's entry from the mirror, shaped like the engine's wallet status. */
export async function walletFromMirror(slug: string, wallet: string): Promise<WalletStatus | null> {
  const m = await launchMirror(slug);
  if (!m) return null;
  const entry = m.entries.find((e) => e.wallet.toLowerCase() === wallet.toLowerCase()) ?? null;
  return {
    wallet,
    registered: !!entry,
    registeredAt: null,
    verified: entry?.tier === "verified",
    entry,
    entityMembers: entry ? m.entries.filter((e) => e.entityId === entry.entityId).length : null,
    disputes: [],
  } as WalletStatus;
}
