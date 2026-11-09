import Link from "next/link";
import { KinLogo } from "@/components/KinLogo";
import { LAUNCH_EXPLORER, SCAN_EXPLORER } from "@/lib/config";
import { REPO_URL } from "@/lib/site";

/** Footer for every page. External destinations are only listed when they exist (explorers come from env). */
export function SiteFooter() {
  return (
    <footer className="s-dark site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <Link href="/" className="site-logo" aria-label="Kin home">
            <KinLogo height={30} />
          </Link>
          <p>Fair token launches on Base. Wallets funded by the same source share one purchase limit.</p>
        </div>

        <nav aria-label="Product">
          <p className="eyebrow">Product</p>
          <Link href="/flow">The flow</Link>
          <Link href="/launch">Launches</Link>
          <Link href="/launch/new">Launch with Kin</Link>
          <Link href="/how-it-works">How it works</Link>
        </nav>
        <nav aria-label="Tools">
          <p className="eyebrow">Tools</p>
          <Link href="/scan">Kin Scan</Link>
          <Link href="/replay">Replay</Link>
          <Link href="/me">Profile</Link>
        </nav>
        <nav aria-label="Source">
          <p className="eyebrow">Source</p>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href={`${REPO_URL}/tree/HEAD/contracts/src`} target="_blank" rel="noreferrer">
            Contracts
          </a>
          {LAUNCH_EXPLORER && (
            <a href={LAUNCH_EXPLORER} target="_blank" rel="noreferrer">
              Launch chain explorer
            </a>
          )}
          {SCAN_EXPLORER && (
            <a href={SCAN_EXPLORER} target="_blank" rel="noreferrer">
              Base explorer
            </a>
          )}
        </nav>
      </div>
      <div className="site-footer-base">
        <span>Kin makes bundling expensive and visible. It does not stop it.</span>
        <span>Launches target Base Sepolia. Kin Scan reads Base mainnet. Not deployed to Base mainnet.</span>
      </div>
    </footer>
  );
}
