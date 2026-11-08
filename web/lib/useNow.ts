"use client";

import { useEffect, useState } from "react";

/** Unix seconds, ticking once a second. null on the server and before mount, so SSR output never depends on the clock. */
export function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
