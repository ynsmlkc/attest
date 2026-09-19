import { useCallback, useEffect, useState } from "react";
import { connectWallet, getAllowedAddress } from "./wallet";

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reload should not log the user out: if this site is already approved in
  // Freighter, pick the wallet back up silently.
  useEffect(() => {
    let cancelled = false;
    getAllowedAddress().then((addr) => {
      if (!cancelled && addr) setAddress((cur) => cur ?? addr);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const addr = await connectWallet();
      setAddress(addr);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect wallet");
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => setAddress(null), []);

  return { address, connecting, error, connect, disconnect };
}
