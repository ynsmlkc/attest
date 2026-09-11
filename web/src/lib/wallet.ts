import freighter from "@stellar/freighter-api";
import { NETWORK_PASSPHRASE } from "./config";

export async function isFreighterInstalled(): Promise<boolean> {
  try {
    const { isConnected } = await freighter.isConnected();
    return isConnected;
  } catch {
    return false;
  }
}

export async function connectWallet(): Promise<string> {
  const result = await freighter.requestAccess();
  if (result.error) throw new Error(result.error.message ?? String(result.error));
  return result.address;
}

/** Matches the `SignTransactionLike` shape `contract.Client` expects. */
export async function signTransaction(
  xdr: string,
  opts?: { networkPassphrase?: string; address?: string },
) {
  const result = await freighter.signTransaction(xdr, {
    networkPassphrase: opts?.networkPassphrase ?? NETWORK_PASSPHRASE,
    address: opts?.address,
  });
  if (result.error) throw new Error(result.error.message ?? String(result.error));
  return { signedTxXdr: result.signedTxXdr, signerAddress: result.signerAddress };
}
