import { SandboxClient } from "./SandboxClient";

export const metadata = { title: "Kin attack sandbox" };

export default function SandboxPage() {
  return (
    <>
      <h1>Attack sandbox</h1>
      <p className="lede">
        One funder funds 20 fresh wallets. All 20 register, then all 20 try to buy the moment the window opens: once on
        a Kin pool, once on a plain pool with the same settings. Every step is a real transaction on Base Sepolia.
      </p>
      <SandboxClient />
    </>
  );
}
