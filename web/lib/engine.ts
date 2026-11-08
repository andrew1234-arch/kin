"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { API_URL } from "./config";
import type { LaunchView, SandboxRun } from "./types";

/** GET /health on the engine. */
export interface EngineHealth {
  ok: boolean;
  scan: boolean;
  launches: boolean;
  baseVerify: boolean;
  sandbox: boolean;
}

/** The parts of GET /replay the landing page shows. */
export interface ReplaySummary {
  ranAt: string;
  sample: { chainId: number; selection: string };
  aggregates: {
    launchesScanned: number;
    launchesWithMultiWalletEntity: number;
    launchesWithMultiWalletEntityPct: number | null;
    medianMultiWalletShareOfEarlyBps: number | null;
  };
}

export type EngineSnapshot =
  | { status: "unconfigured" }
  | { status: "loading" }
  | { status: "offline"; error: string }
  | {
      status: "ok";
      health: EngineHealth;
      launches: LaunchView[];
      sandbox: SandboxRun | null;
      /** null when the engine has not computed a replay (404 not-computed). */
      replay: ReplaySummary | null;
      /** Per-endpoint failures that did not take the whole engine down. */
      errors: string[];
    };

const optional = <T,>(p: Promise<T>, errors: string[], what: string, notFoundOk = false) =>
  p.catch((e: unknown) => {
    if (!(notFoundOk && e instanceof ApiError && e.status === 404)) errors.push(`${what}: ${(e as Error).message}`);
    return null;
  });

let cached: Promise<EngineSnapshot> | null = null;

function load(): Promise<EngineSnapshot> {
  if (!API_URL) return Promise.resolve({ status: "unconfigured" });
  cached ??= (async (): Promise<EngineSnapshot> => {
    let health: EngineHealth;
    try {
      health = await api<EngineHealth>("/health");
    } catch (e) {
      cached = null; // let a later mount retry
      return { status: "offline", error: (e as Error).message };
    }
    const errors: string[] = [];
    const [launches, sandbox, replay] = await Promise.all([
      optional(api<LaunchView[]>("/launches"), errors, "launches"),
      optional(api<SandboxRun | null>("/sandbox/latest"), errors, "sandbox"),
      optional(api<ReplaySummary>("/replay"), errors, "replay", true),
    ]);
    return { status: "ok", health, launches: launches ?? [], sandbox, replay, errors };
  })();
  return cached;
}

/** One fetch of the engine's public state, shared by every section on the page. */
export function useEngine(): EngineSnapshot {
  const [snap, setSnap] = useState<EngineSnapshot>({ status: "loading" });
  useEffect(() => {
    let live = true;
    load().then((s) => live && setSnap(s));
    return () => {
      live = false;
    };
  }, []);
  return snap;
}

/** The launch that shows the most of the workflow: deployed, else with an allowlist, else the newest. */
export function featuredLaunch(launches: LaunchView[]): LaunchView | null {
  return (
    launches.find((l) => l.onchain && l.allowlist) ??
    launches.find((l) => l.allowlist) ??
    [...launches].sort((a, b) => b.createdAt - a.createdAt)[0] ??
    null
  );
}

export { chainLabel } from "./chains";
