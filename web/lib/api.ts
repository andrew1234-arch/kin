import { API_URL } from "./config";

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
