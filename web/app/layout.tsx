import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kin — fair launches on Base",
  description: "Token launches on Base that cap entities, not wallets.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="nav">
          <a href="/" className="brand">kin</a>
          <nav>
            <a href="/scan">Scan</a>
            <a href="/sandbox">Sandbox</a>
            <a href="/replay">Replay</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
