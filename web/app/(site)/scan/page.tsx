import { Suspense } from "react";
import { LaunchScan } from "./LaunchScan";
import { ScanClient } from "./ScanClient";

export const metadata = {
  title: "Kin Scan",
  description: "Every Kin launch, buyer by buyer: which wallets Kin linked by funding and how much of each shared limit was used. Plus a funding scan for any token on Base.",
};

export default function ScanPage() {
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Kin Scan</p>
          <h1>Who bought, really</h1>
          <p className="lede">
            Pick a Kin launch. See every wallet that got a limit, which ones Kin linked by their funding, and how much of each
            shared limit was used, read from the pool.
          </p>
        </div>
      </header>
      <Suspense>
        <LaunchScan />
      </Suspense>

      <section className="scan-bonus" aria-labelledby="bonus-title">
        <p className="eyebrow">Bonus · Base mainnet</p>
        <h2 id="bonus-title">Scan any token on Base</h2>
        <p className="muted">
          Paste a token that launched without Kin. See its early buyers grouped by shared funding, and what Kin&apos;s limit would
          have done.
        </p>
        <Suspense>
          <ScanClient />
        </Suspense>
      </section>
    </>
  );
}
