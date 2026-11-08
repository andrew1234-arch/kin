import { Suspense } from "react";
import { ScanClient } from "./ScanClient";

export const metadata = { title: "Kin Scan" };

export default function ScanPage() {
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Tool · Reads Base mainnet</p>
          <h1>Kin Scan</h1>
          <p className="lede">
            Paste any Base token. See its early buyers grouped into entities by shared funding, every link backed by
            transaction hashes, and what Kin&apos;s caps would have done.
          </p>
        </div>
      </header>
      <Suspense>
        <ScanClient />
      </Suspense>
    </>
  );
}
