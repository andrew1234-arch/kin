"use client";

import { useParams } from "next/navigation";
import { Receipt } from "@/components/Receipt";

export default function ReceiptEmbed() {
  const { slug } = useParams<{ slug: string }>();
  return (
    <div className="embed">
      <Receipt slug={slug} compact />
      <p className="small faint" style={{ margin: "8px 4px" }}>
        Verified by Kin · entity-capped launches on Base
      </p>
    </div>
  );
}
