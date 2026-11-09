/**
 * One pool's buys as a row of slots: landed, rejected, pending, or (for a simulated pool) "would land".
 * Used by the sandbox (20 wallets) and the test drive (3 wallets), so both show the same picture.
 */
export type Slot = { tx?: string; status: "pending" | "landed" | "rejected" | "would-land" | "would-fail" } | null;

export function PoolChart(p: {
  title: string;
  subtitle: string;
  slots: Slot[];
  explorer: string;
  tone: "good" | "bad";
  labels?: string[];
}) {
  const landed = p.slots.filter((s) => s?.status === "landed" || s?.status === "would-land").length;
  const cols = Math.min(p.slots.length, 10);
  return (
    <div className="card">
      <div className="pool-head">
        <div>
          <h3 style={{ margin: 0 }}>{p.title}</h3>
          <div className="small muted">{p.subtitle}</div>
        </div>
        <div className="pool-score" style={{ color: `var(--${p.tone})` }}>
          {landed}/{p.slots.length}
        </div>
      </div>
      <div className={`slots${cols < 10 ? " slots-few" : ""}`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {p.slots.map((s, i) => {
          const name = p.labels?.[i] ?? `wallet ${i + 1}`;
          const cls = `slot ${s ? `slot-${s.status}` : ""}`;
          const mark = s?.status === "landed" || s?.status === "would-land" ? "✓" : s?.status === "rejected" || s?.status === "would-fail" ? "✕" : p.labels ? "" : i + 1;
          const body = (
            <>
              {mark}
              {p.labels && <span className="slot-label">{p.labels[i]}</span>}
            </>
          );
          const title = `${name}: ${s?.status.replace("-", " ") ?? "not yet"}`;
          return s?.tx && p.explorer ? (
            <a key={i} className={cls} href={`${p.explorer}/tx/${s.tx}`} target="_blank" rel="noreferrer" title={title}>
              {body}
            </a>
          ) : (
            <span key={i} className={cls} title={title}>
              {body}
            </span>
          );
        })}
      </div>
    </div>
  );
}
