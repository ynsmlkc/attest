import { useCallback, useState } from "react";
import { connectWallet } from "./wallet";

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
