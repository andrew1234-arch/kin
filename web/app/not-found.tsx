import Link from "next/link";
import { KinMark } from "@/components/KinMark";

export const metadata = { title: "Not found", robots: { index: false } };

export default function NotFound() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
          <KinMark size={48} />
        </div>
        <h1 style={{ margin: "0 0 8px" }}>Page not found</h1>
        <p className="muted">This page doesn&apos;t exist. If you followed a launch link, the launch may not have been created yet.</p>
        <p style={{ marginTop: 24 }}>
          <Link href="/" className="btn">
            Back to Kin
          </Link>
        </p>
      </div>
    </main>
  );
}
