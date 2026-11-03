import Link from "next/link";
import { WalletButton } from "@/components/WalletButton";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="nav">
        <Link href="/" className="brand" aria-label="Kin home">
          <span className="brand-mark" aria-hidden>
            ◎
          </span>
          kin
        </Link>
        <nav className="nav-links">
          <Link href="/scan">Scan</Link>
          <Link href="/sandbox">Sandbox</Link>
          <Link href="/launch">Launches</Link>
          <Link href="/replay">Replay</Link>
        </nav>
        <WalletButton />
      </header>
      <main>{children}</main>
      <footer className="footer">
        <p>
          Kin makes bundling expensive and visible. It does not stop it. Launches run on Base Sepolia; Scan reads Base
          mainnet.
        </p>
      </footer>
    </>
  );
}
