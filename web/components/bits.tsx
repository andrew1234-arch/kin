import { addrUrl, txUrl } from "@/lib/config";
import { short } from "@/lib/format";

export function Tx({ hash, explorer, label }: { hash: string; explorer: string; label?: string }) {
  const url = txUrl(explorer, hash);
  const text = label ?? short(hash, 5);
  return url ? (
    <a className="mono" href={url} target="_blank" rel="noreferrer">
      {text}
    </a>
  ) : (
    <span className="mono" title={hash}>
      {text}
    </span>
  );
}

export function Addr({ address, explorer, n = 4 }: { address: string; explorer: string; n?: number }) {
  const url = addrUrl(explorer, address);
  return url ? (
    <a className="mono" href={url} target="_blank" rel="noreferrer" title={address}>
      {short(address, n)}
    </a>
  ) : (
    <span className="mono" title={address}>
      {short(address, n)}
    </span>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "good" | "bad" | "accent" }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Notice({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" | "error" }) {
  return <div className={`notice notice-${tone}`}>{children}</div>;
}

export function Copy({ text }: { text: string }) {
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={(e) => {
        navigator.clipboard?.writeText(text);
        const b = e.currentTarget;
        b.textContent = "Copied";
        setTimeout(() => (b.textContent = "Copy"), 1200);
      }}
    >
      Copy
    </button>
  );
}
