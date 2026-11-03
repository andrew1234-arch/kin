import { Suspense } from "react";
import { ScanClient } from "./ScanClient";

export const metadata = { title: "Kin Scan" };

export default function ScanPage() {
  return (
    <>
      <h1>Kin Scan</h1>
      <p className="lede">
        Paste any Base token. See its early buyers grouped into entities by shared funding, every link backed by
        transaction hashes, and what Kin&apos;s caps would have done.
      </p>
      <Suspense>
        <ScanClient />
      </Suspense>
    </>
  );
}
