"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { KinLogo } from "@/components/KinLogo";
import { WalletButton } from "@/components/WalletButton";

const LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/launch", label: "Launches" },
  { href: "/scan", label: "Kin Scan" },
  { href: "/sandbox", label: "Sandbox" },
];

/**
 * One header for the whole site. It takes the colours of the page it sits on (`surface`): the landing passes
 * "light"; app pages follow the visitor's light or dark theme. The only filled button is "Launch with Kin".
 */
export function SiteNav({ surface }: { surface?: "light" }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  // The sheet locks page scroll and closes on Escape or when the viewport grows past the breakpoint.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const mq = window.matchMedia("(min-width: 900px)");
    const onMq = () => mq.matches && setOpen(false);
    window.addEventListener("keydown", onKey);
    mq.addEventListener("change", onMq);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onMq);
    };
  }, [open]);

  // /launch/new belongs to the "Launch with Kin" button, not to "Launches".
  const isActive = (href: string) => pathname !== "/launch/new" && (pathname === href || pathname.startsWith(href + "/"));

  return (
    <header className={`site-nav${surface === "light" ? " s-light" : ""}`}>
      <div className="site-nav-inner">
        <Link href="/" className="site-logo" aria-label="Kin home">
          <KinLogo height={28} />
        </Link>

        <nav className="site-nav-links" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={isActive(l.href) ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="site-nav-end">
          <div className="site-nav-wallet">
            <WalletButton />
          </div>
          <Link href="/launch/new" className="btn btn-primary btn-sm site-nav-cta">
            Launch with Kin
          </Link>
          <button
            type="button"
            className="site-nav-burger"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="site-sheet"
            onClick={() => setOpen((o) => !o)}
          >
            <span />
            <span />
          </button>
        </div>
      </div>

      <div id="site-sheet" className="site-sheet" hidden={!open}>
        <nav aria-label="Main">
          <Link href="/" onClick={() => setOpen(false)}>
            Home
          </Link>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
          <Link href="/replay" onClick={() => setOpen(false)}>
            Replay
          </Link>
        </nav>
        <div className="site-sheet-end">
          <WalletButton />
          <Link href="/launch/new" className="btn btn-primary" onClick={() => setOpen(false)}>
            Launch with Kin
          </Link>
        </div>
      </div>
    </header>
  );
}
