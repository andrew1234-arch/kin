import { SiteFooter } from "@/components/SiteFooter";
import { SiteNav } from "@/components/SiteNav";

/** App pages (scan, sandbox, launches, receipts, replay): shared nav and footer, a centred content column. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteNav />
      <main className="page">{children}</main>
      <SiteFooter />
    </>
  );
}
