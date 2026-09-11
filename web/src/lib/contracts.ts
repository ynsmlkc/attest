import {
  Account,
  Contract,
  TransactionBuilder,
  contract,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import type { AssembledTransaction, SentTransaction } from "@stellar/stellar-sdk/contract";
import * as SorobanRpc from "@stellar/stellar-sdk/rpc";
import { Buffer } from "buffer";

// Minimal method shapes for the two deployed contracts this app calls --
// just the subset actually used here, matching the real generated bindings
// (`stellar contract bindings typescript`) argument names/types exactly.
interface SettlementVaultApi {
  balance_of(args: { token: string; owner: string }): Promise<AssembledTransaction<bigint>>;
  deposit(args: {
    depositor: string;
    token: string;
    amount: bigint;
  }): Promise<AssembledTransaction<unknown> & { signAndSend(): Promise<SentTransaction<unknown>> }>;
  withdraw(args: {
    owner: string;
    token: string;
    amount: bigint;
  }): Promise<AssembledTransaction<unknown> & { signAndSend(): Promise<SentTransaction<unknown>> }>;
}

interface AttestationVerifierApi {
  is_registered(args: { enclave_id: Buffer }): Promise<AssembledTransaction<boolean>>;
  get_engine_address(args: {
    enclave_id: Buffer;
  }): Promise<AssembledTransaction<string | undefined>>;
}
import {
  ATTESTATION_VERIFIER_ID,
  NETWORK_PASSPHRASE,
  REFLECTOR_DECIMALS,
  REFLECTOR_ORACLE_ID,
  RPC_URL,
  SETTLEMENT_VAULT_ID,
  type TokenInfo,
} from "./config";
import { signTransaction } from "./wallet";

function clientOptions(publicKey?: string) {
  return {
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    publicKey: publicKey ?? contract.NULL_ACCOUNT,
    signTransaction: publicKey ? signTransaction : undefined,
  };
}

async function vaultClient(publicKey?: string) {
  return contract.Client.from<SettlementVaultApi>({
    contractId: SETTLEMENT_VAULT_ID,
    ...clientOptions(publicKey),
  });
}

async function verifierClient(publicKey?: string) {
  return contract.Client.from<AttestationVerifierApi>({
    contractId: ATTESTATION_VERIFIER_ID,
    ...clientOptions(publicKey),
  });
}

export async function getVaultBalance(token: TokenInfo, owner: string): Promise<bigint> {
  const client = await vaultClient();
  const tx = await client.balance_of({ token: token.sacId, owner });
  return tx.result;
}

export async function deposit(token: TokenInfo, depositor: string, amount: bigint) {
  const client = await vaultClient(depositor);
  const tx = await client.deposit({ depositor, token: token.sacId, amount });
  return tx.signAndSend();
}

export async function withdraw(token: TokenInfo, owner: string, amount: bigint) {
  const client = await vaultClient(owner);
  const tx = await client.withdraw({ owner, token: token.sacId, amount });
  return tx.signAndSend();
}

export async function isEnclaveRegistered(enclaveIdHex: string): Promise<boolean> {
  const client = await verifierClient();
  const tx = await client.is_registered({
    enclave_id: Buffer.from(enclaveIdHex, "hex"),
  });
  return tx.result;
}

export async function getEngineAddress(enclaveIdHex: string): Promise<string | null> {
  const client = await verifierClient();
  const tx = await client.get_engine_address({
    enclave_id: Buffer.from(enclaveIdHex, "hex"),
  });
  return tx.result ?? null;
}

/**
 * Direct read-only Soroban RPC simulate() call to Reflector's lastprice --
 * doesn't go through contract.Client/Spec since Reflector isn't part of
 * this app's own deployed contracts (no local wasm to derive a spec from,
 * and Client.from() would need to fetch its spec from chain on every page
 * load). ScVal encoding built manually to match the real interface: verified
 * against reflector-network/reflector-contract's published source (see repo
 * README's Reflector notes) -- Asset::Other(Symbol) is a two-value enum
 * vector, and PriceData{ price: i128, timestamp: u64 } comes back as a map.
 */
export async function getReflectorPrice(symbol: string): Promise<number | null> {
  const server = new SorobanRpc.Server(RPC_URL);
  const assetScVal = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Other"),
    nativeToScVal(symbol, { type: "symbol" }),
  ]);
  // A local, never-submitted placeholder account -- simulateTransaction
  // doesn't need a real, funded source account to run a read-only call
  // (confirmed the same way contract.Client's own NULL_ACCOUNT default
  // works, tested directly against a real deployed contract).
  const account = new Account(contract.NULL_ACCOUNT, "0");
  const op = new Contract(REFLECTOR_ORACLE_ID).call("lastprice", assetScVal);
  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) return null;
  if (!SorobanRpc.Api.isSimulationSuccess(sim) || !sim.result) return null;

  const native = scValToNative(sim.result.retval) as
    | { price: bigint; timestamp: bigint }
    | undefined;
  if (!native) return null;
  return Number(native.price) / 10 ** REFLECTOR_DECIMALS;
}
