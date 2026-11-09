import type { Metadata } from "next";
import { LaunchForm } from "./LaunchForm";

export const metadata: Metadata = {
  title: "Launch a token",
  description: "Launch a token on Kin in one step: wallets funded by the same source share one buy limit. Base Sepolia, free.",
  alternates: { canonical: "/launch/new" },
};

export default function NewLaunchPage() {
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Live on Base Sepolia · free</p>
          <h1>Launch a token</h1>
          <p className="lede">Name it, set the limit per buyer, and launch. Kin deploys the pool and gives you a page to share.</p>
        </div>
      </header>
      <LaunchForm />
    </>
  );
}
