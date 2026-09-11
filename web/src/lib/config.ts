// Every address here is a real, deployed testnet contract -- see the repo
// root README.md for how each was built, verified, and proven live.
export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const RPC_URL = "https://soroban-testnet.stellar.org";
export const HORIZON_URL = "https://horizon-testnet.stellar.org";

// The TEE-connected SettlementVault: settle() on this instance can only be
// called by the matching-engine's own dstack-derived key, checked against
// the AttestationVerifier below (see services/matching-engine + README's
// "matching-engine" section).
export const SETTLEMENT_VAULT_ID =
  "CB3QWKRBV2L6XGG6EQC4JCTW3QK3GX22FT2A6AXVFSVKOLATGNUKLIOH";
export const ATTESTATION_VERIFIER_ID =
  "CCF2V4ZFJV3PB7BTCIM2YFK4LXFZGP4ZX55XVCUJSQ6HBQIUFQQ5MIMQ";
export const MATCHING_ENGINE_ENCLAVE_ID =
  "4444444444444444444444444444444444444444444444444444444444444444";
export const MATCHING_ENGINE_ENGINE_ADDRESS =
  "GBYCHHAKPZO2MG552GJRCSFFWPUUFLHBDNB5DVHQQKBXLZBTKHASYUPZ";
// The matching-engine CVM's own HTTP API (order submission / order book).
// Only reachable while that CVM is running -- it's stopped between demos to
// avoid idle Phala Cloud cost, see README.
export const MATCHING_ENGINE_URL =
  "https://c836dd6d40b3795d1d6c7638216ae038b52fd130.dstack-pha-prod5.phala.network";

// Reflector's "External CEX & DEX" oracle -- prices real assets by symbol
// (Asset::Other), unlike its "Stellar Mainnet DEX" pool (Asset::Stellar),
// which turned out not to track native XLM or this testnet USDC directly.
// Verified live before wiring this in (see conversation/session notes) --
// XLM and USDC both return real, sane prices from this pool.
export const REFLECTOR_ORACLE_ID =
  "CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63";
export const REFLECTOR_DECIMALS = 14;

export interface TokenInfo {
  code: string;
  sacId: string;
  /** Symbol Reflector's Other(Symbol) variant expects for this asset. */
  reflectorSymbol: string;
  decimals: number;
}

// Real, recognizable testnet assets -- not synthetic demo tokens -- so the
// app trades something a viewer already knows the meaning of.
export const NATIVE_XLM: TokenInfo = {
  code: "XLM",
  sacId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  reflectorSymbol: "XLM",
  decimals: 7,
};

export const TESTNET_USDC: TokenInfo = {
  code: "USDC",
  sacId: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  reflectorSymbol: "USDC",
  decimals: 7,
};

export const TRADABLE_TOKENS: TokenInfo[] = [NATIVE_XLM, TESTNET_USDC];
