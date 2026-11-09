import { Suspense } from "react";
import { ScanHub } from "./ScanHub";

export const metadata = {
  title: "Kin Scan",
  description:
    "Paste any token. For a Kin launch: every wallet that got a limit, which ones Kin linked by funding, and how much of each shared limit was used. For any other token on Base: which early buyers shared a funder, and what Kin would have refused.",
};

export default function ScanPage() {
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Kin Scan</p>
          <h1>Who bought, really</h1>
          <p className="lede">
            Paste any token. You see its buyers grouped by who funded them: for a Kin launch, the limits the pool enforced; for
            any other token on Base, what Kin would have stopped.
          </p>
        </div>
      </header>
      <Suspense>
        <ScanHub />
      </Suspense>
    </>
  );
}
