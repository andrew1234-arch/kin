import { chainLabel } from "@/lib/chains";

/** A provenance tag: says where the numbers next to it come from (mainnet, testnet, local chain, simulation). */
export function Source({ chainId, kind }: { chainId?: number; kind?: string }) {
  const c = chainId !== undefined ? chainLabel(chainId) : null;
  return (
    <span className={`source source-${c?.tone ?? "info"}`}>
      <i aria-hidden="true" />
      {kind ?? c?.kind}
      {c && (
        <span className="source-sub">
          {" "}
          · {c.name}
        </span>
      )}
    </span>
  );
}
