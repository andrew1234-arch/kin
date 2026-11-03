"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Copy } from "@/components/bits";
import { Receipt } from "@/components/Receipt";

export default function ReceiptPage() {
  const { slug } = useParams<{ slug: string }>();
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const snippet = `<iframe src="${origin}/embed/receipt/${slug}" width="460" height="420" style="border:0" title="Kin Fairness Receipt"></iframe>`;
  return (
    <>
      <h1>Fairness Receipt</h1>
      <p className="lede">
        What happened in the launch window, recorded onchain, next to the allowlist it was enforced against.
      </p>
      <Receipt slug={slug} />
      <h2>Embed</h2>
      <p className="muted small">Put the receipt on a project site or in a post. It reads the chain live.</p>
      <div className="card">
        <pre className="mono small break" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
          {snippet}
        </pre>
        <div className="row" style={{ marginTop: 10 }}>
          <Copy text={snippet} />
          <Link className="btn btn-ghost btn-sm" href={`/launch/${slug}`}>
            Back to the launch
          </Link>
        </div>
      </div>
    </>
  );
}
