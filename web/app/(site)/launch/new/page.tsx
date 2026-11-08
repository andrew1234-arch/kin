import type { Metadata } from "next";
import { LaunchConfigurator } from "./LaunchConfigurator";

export const metadata: Metadata = {
  title: "Launch with Kin",
  description:
    "Configure a Kin fair launch on Base Sepolia: entity cap, fresh-wallet pool, registration, dispute, window and lock. Kin generates the exact operator commands.",
  alternates: { canonical: "/launch/new" },
};

export default function NewLaunchPage() {
  return <LaunchConfigurator />;
}
