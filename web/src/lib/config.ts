// Every address here is a real, deployed testnet contract -- see the repo
// root README.md for how each was built, verified, and proven live.
//
// The five deployment values below can be overridden per environment with
// VITE_* variables (see web/.env.example) -- e.g. to point a local dev server
// at a locally run matching engine and a scratch vault without editing this file.
export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const RPC_URL = "https://soroban-testnet.stellar.org";
export const HORIZON_URL = "https://horizon-testnet.stellar.org";

// The TEE-connected SettlementVault: settle() on this instance can only be
// called by the matching-engine's own dstack-derived key, checked against
// the AttestationVerifier below (see services/matching-engine + README's
// "matching-engine" section).
//
// Redeployed 2026-09-12 to a NEW verifier+vault pair: shipping the CORS/
// SEP-53/history-enrichment fixes required a real docker-compose.yml
// change, which changes RTMR3, which the old verifier's one-time
// initialize() could never accept (AlreadyInitialized). Same shape as the
// original RTMR3 fix -- see README's "Rebuild+push+redeploy" section for
// the full story, including the fresh quote extraction.
//
// Redeployed AGAIN 2026-09-13 to a new verifier+vault pair (contract code
// change this time, not just config): register_verified_enclave used to
// let anyone replay an already-public payload/signature with a *different*
// engine_address and hijack an already-registered enclave_id -- fixed by
// requiring the *existing* engine_address to also authorize any change to
// a registration that already exists. Confirmed live on testnet: a funded
// attacker identity replaying the real payload/signature with its own
// address was rejected outright (missing signing key for the real
// operator's address) before this even reached simulation. See
// docs/positioning.md for the residual first-registration race this
// doesn't close, and the report_data-binding fix that would.
//
// Redeployed AGAIN 2026-09-16 (matching-engine source change): /configure
// and /register had zero authentication -- anyone reachable could repoint
// which vault the engine settles against, or get the engine to sign an
// attacker-chosen register_verified_enclave call with its own real key.
// Fixed with an ADMIN_KEY header check (sealed env var, fails closed if
// unset). Also fixed: settle() didn't reject a same-token trade with
// differing amounts (could silently move value between two parties), and
// malformed order amounts could permanently jam the matching engine's
// order book. See error.md for the full list. New verifier's quote is the
// same real Phala CVM re-attested after the rebuild -- MRTD/RTMR3 confirmed
// against Phala's own reported tcb_info before trusting it on-chain, same
// as every previous cascade.
// Redeployed AGAIN 2026-09-19 (new vault + verifier): settle() now verifies
// each trader's signed order on-chain (SEP-53, message v3), supports partial
// fills, fails closed on tokens without a Reflector symbol, and can route an
// unmatched remainder to Soroswap (settle_external). The engine's code now
// ships inside its docker-compose.yml (see services/matching-engine/
// make-compose.js), so RTMR3 changed and the verifier was initialized with the
// fresh quote's MRTD/RTMR3 (both cross-checked against Phala's tcb_info); the
// engine's derived address stayed the same. Later the same day the engine moved
// from embedded-code compose to a pushed image pinned by digest
// (ynsmlkc/attest-matching-engine@sha256:10b17a4bece3c3430eea99d6ee9821b52ed6b7ac8151f253fbcbb6cd8c500474),
// which changed RTMR3 again -> this verifier/vault pair. Price guard: 500 bps, with
// XLM/USDC/EURC symbols set -- so external routing only clears when Soroswap's
// testnet pool is near Reflector's price (currently it is not).
export const SETTLEMENT_VAULT_ID =
  import.meta.env.VITE_VAULT_ID ?? "CBBD34JHVKXGNGODQQ2FWU2TSCBKP5XW2SPEL6JZKGA5OP3LNFS6ECFY";
export const ATTESTATION_VERIFIER_ID =
  import.meta.env.VITE_VERIFIER_ID ?? "CBMKSAL2QDOXVLM5AO5M2L6UWNQI76M5T735EOEXDSPQRQIB7AS2K3SZ";
export const MATCHING_ENGINE_ENCLAVE_ID =
  import.meta.env.VITE_ENCLAVE_ID ?? "4444444444444444444444444444444444444444444444444444444444444444";
export const MATCHING_ENGINE_ENGINE_ADDRESS =
  import.meta.env.VITE_ENGINE_ADDRESS ?? "GBYCHHAKPZO2MG552GJRCSFFWPUUFLHBDNB5DVHQQKBXLZBTKHASYUPZ";
// The matching-engine CVM's own HTTP API (order submission / order book).
// Only reachable while that CVM is running -- it's stopped between demos to
// avoid idle Phala Cloud cost, see README.
export const MATCHING_ENGINE_URL =
  import.meta.env.VITE_ENGINE_URL ?? "https://c836dd6d40b3795d1d6c7638216ae038b52fd130.dstack-pha-prod5.phala.network";

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
  name: string;
  sacId: string;
  /** Symbol Reflector's Other(Symbol) variant expects for this asset. */
  reflectorSymbol: string;
  decimals: number;
  /** Real logo, from Trust Wallet's public assets repo -- see web/README.md. */
  logo: string;
  /** Accent used for this token's monogram ring when `logo` fails to load. */
  tone: string;
}

// Real, recognizable testnet assets -- not synthetic demo tokens -- so the
// app trades something a viewer already knows the meaning of.
export const NATIVE_XLM: TokenInfo = {
  code: "XLM",
  name: "Stellar Lumens",
  sacId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  reflectorSymbol: "XLM",
  decimals: 7,
  logo: "/tokens/xlm.png",
  tone: "#DFA94F",
};

export const TESTNET_USDC: TokenInfo = {
  code: "USDC",
  name: "USD Coin",
  sacId: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  reflectorSymbol: "USDC",
  decimals: 7,
  logo: "/tokens/usdc.png",
  tone: "#5B8DB8",
};

// Circle's real testnet EURC -- issuer GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO
// (home_domain circle.com, confirmed live on Horizon), SAC id derived via
// `stellar contract id asset --asset EURC:<issuer> --network testnet` and
// confirmed live (symbol()/decimals() both resolve). Reflector's Other(EURC)
// pool returns a real live price (~1.15 USD/EURC) -- checked before wiring
// this in, same as XLM/USDC.
export const TESTNET_EURC: TokenInfo = {
  code: "EURC",
  name: "Euro Coin",
  sacId: "CCUUDM434BMZMYWYDITHFXHDMIVTGGD6T2I5UKNX5BSLXLW7HVR4MCGZ",
  reflectorSymbol: "EURC",
  decimals: 7,
  logo: "/tokens/eurc.png",
  tone: "#2F6FB0",
};

export const TRADABLE_TOKENS: TokenInfo[] = [NATIVE_XLM, TESTNET_USDC, TESTNET_EURC];

export function tokenBySac(sacId: string): TokenInfo | undefined {
  return TRADABLE_TOKENS.find((t) => t.sacId === sacId);
}

// Where "View source" / README links point. One place to change when the repo moves;
// also overridable per environment with VITE_REPO_URL (see web/.env.example).
export const REPO_URL = import.meta.env.VITE_REPO_URL ?? "https://github.com/ynsmlkc/attest";
