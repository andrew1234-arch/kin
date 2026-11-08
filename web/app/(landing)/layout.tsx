import { SiteFooter } from "@/components/SiteFooter";
import { SiteNav } from "@/components/SiteNav";

/** Marketing pages (home, how it works): a fixed light design, whatever the visitor's theme. */
export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteNav surface="light" />
      <main className="landing s-light">{children}</main>
      <SiteFooter />
    </>
  );
}
