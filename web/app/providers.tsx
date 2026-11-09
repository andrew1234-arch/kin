"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { http } from "viem";
import { createConfig, WagmiProvider } from "wagmi";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { launchChain, LAUNCH_RPC_URL } from "@/lib/config";
import { testWalletConnector } from "@/lib/testWallets";

const wagmiConfig = createConfig({
  chains: [launchChain],
  connectors: [injected(), coinbaseWallet({ appName: "Kin", preference: { options: "eoaOnly" } }), testWalletConnector()],
  transports: { [launchChain.id]: http(LAUNCH_RPC_URL || undefined) },
  ssr: true,
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
