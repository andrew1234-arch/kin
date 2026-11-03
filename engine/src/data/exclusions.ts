import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ExclusionList {
  source: { repo: string; commit: string; file: string; license: string };
  rules: Record<string, unknown>;
  count: number;
  addresses: { address: string; chainId: number; label: string; nameTag: string }[];
}

/** Labelled addresses (exchanges, bridges, routers) that must never create a cluster link. */
export function loadExclusions(path = join(import.meta.dir, "../../data/exclusions.json")) {
  const list = JSON.parse(readFileSync(path, "utf8")) as ExclusionList;
  const set = new Set(list.addresses.map((a) => a.address.toLowerCase()));
  return { list, set };
}
