import freighter from "@stellar/freighter-api";
import { Buffer } from "buffer";
import { MATCHING_ENGINE_ENCLAVE_ID, SETTLEMENT_VAULT_ID } from "./config";

/**
 * SEP-0053 order signing -- closes the gap flagged in docs/positioning.md:
 * the matching-engine used to accept a bare `{party, ...}` JSON body, so
 * anyone who knew a depositor's public address (visible on-chain from their
 * deposit() call anyway) could submit an order claiming to be them.
 *
 * Freighter's signMessage() was verified live (SHA256("Stellar Signed
 * Message:\n" + message) -> raw 64-byte ed25519, matching SEP-53 exactly)
 * against `Keypair.verify` before wiring this in -- not assumed from the
 * SEP text alone. The exact canonical string built here must match
 * `canonicalOrderMessage` in services/matching-engine/index.js byte for
 * byte, since the server rebuilds it independently to verify.
 *
 * v2 also binds the signature to one deploy (vault + enclave id) so a
 * captured order can't be replayed against a different engine instance.
 * These must equal the engine's own /configure values.
 *
 * v3 adds ROUTING_CLAUSE as the last line: signing it is the trader's consent
 * to the engine sending an unmatched remainder to Soroswap at their limit
 * price or better. It is fixed, not a per-order option -- that's how this
 * venue works, and Freighter shows the line at signing time. The vault
 * verifies the same text on-chain (its ROUTING_CLAUSE), and the engine
 * rebuilds it too: all three must match byte for byte.
 *
 * `ts` also doubles as this scheme's replay defense -- SEP-53 itself
 * specifies none -- the server rejects a `ts` outside a short window and
 * tracks signatures it's already seen inside that window.
 */
export interface OrderFields {
  party: string;
  giveToken: string;
  giveAmount: number;
  wantToken: string;
  wantAmount: number;
}

export const ROUTING_CLAUSE = "\nrouting:pool first, then Soroswap at your limit or better";

export function canonicalOrderMessage(o: OrderFields & { ts: number }): string {
  return `Attest order v3\nvault:${SETTLEMENT_VAULT_ID}\nenclave:${MATCHING_ENGINE_ENCLAVE_ID}\nparty:${o.party}\ngive:${o.giveToken}:${o.giveAmount}\nwant:${o.wantToken}:${o.wantAmount}\nts:${o.ts}${ROUTING_CLAUSE}`;
}

export async function signOrder(order: OrderFields): Promise<{ ts: number; signature: string }> {
  const ts = Date.now();
  const message = canonicalOrderMessage({ ...order, ts });
  const result = await freighter.signMessage(message, { address: order.party });
  if (result.error) throw new Error(result.error.message ?? String(result.error));
  const signedMessage = result.signedMessage;
  if (signedMessage === null) throw new Error("Freighter returned no signature");
  const signature = Buffer.isBuffer(signedMessage) ? signedMessage.toString("base64") : signedMessage;
  return { ts, signature };
}
