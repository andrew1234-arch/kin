"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { http } from "viem";
import { createConfig, WagmiProvider } from "wagmi";
import { baseAccount, injected } from "wagmi/connectors";
import { launchChain, LAUNCH_RPC_URL } from "@/lib/config";

const wagmiConfig = createConfig({
  chains: [launchChain],
  connectors: [injected(), baseAccount({ appName: "Kin" })],
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
