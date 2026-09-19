use soroban_sdk::{contractclient, contracttype, Address, BytesN, Env, Symbol, Vec};

/// Thin, locally-declared mirror of AttestationVerifier's public interface —
/// deliberately *not* a real dependency on the attestation-verifier crate.
/// Depending on another `#[contract]` crate directly pulls its `#[no_mangle]`
/// WASM exports into this contract's own binary (both contracts define
/// `initialize`, and the linker rejects the resulting duplicate symbol).
/// Declaring just the interface via `#[contractclient]` avoids that, and
/// this can still call whichever AttestationVerifier contract is actually
/// deployed at the configured address (Soroban cross-contract calls are
/// selector-based, not compile-time-linked).
#[contractclient(name = "AttestationVerifierClient")]
#[allow(dead_code)]
pub trait AttestationVerifierInterface {
    fn is_registered(env: Env, enclave_id: BytesN<32>) -> bool;
    fn get_engine_address(env: Env, enclave_id: BytesN<32>) -> Option<Address>;
}

/// Reflector's own Asset shape (reflector-network/reflector-contract) —
/// reproduced here (not imported from a published crate; Reflector doesn't
/// ship one) because the field layout must match exactly for XDR
/// compatibility with the real deployed oracle. Verified against Reflector's
/// GitHub source on 2026-09-08.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReflectorAsset {
    Stellar(Address),
    Other(Symbol),
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ReflectorPriceData {
    pub price: i128,
    pub timestamp: u64,
}

/// Minimal stub of Reflector's SEP-40-compliant oracle interface — just the
/// one entry point SettlementVault needs. Generates `ReflectorClient`, which
/// can call the *real* deployed Reflector contract (this trait isn't a
/// contract of its own; it only exists to shape the cross-contract call).
#[contractclient(name = "ReflectorClient")]
#[allow(dead_code)]
pub trait ReflectorOracle {
    fn lastprice(env: Env, asset: ReflectorAsset) -> Option<ReflectorPriceData>;
}

#[contracttype]
pub struct BalanceKey {
    pub token: Address,
    pub owner: Address,
}

#[contracttype]
pub enum DataKey {
    Admin,
    AttestationVerifier,
    /// Reflector oracle contract address used by the price-deviation guard
    /// in `settle` — see attest-hackathon-plan.md §2.5.
    PriceOracle,
    /// Max allowed deviation (basis points) between a settled trade's
    /// implied value and Reflector's reference price. `0` disables the
    /// check entirely.
    MaxDeviationBps,
    Balance(BalanceKey),
    /// 2026-09-13 finding, fixed same day: `check_price_deviation` used to
    /// query Reflector via `ReflectorAsset::Stellar(token_address)`, but
    /// that pool doesn't track native XLM or this project's testnet USDC at
    /// all (confirmed live: `lastprice` returns `None` for both) — so the
    /// price-deviation guard was silently a no-op for the only two assets
    /// this vault actually settles. Reflector's "External CEX & DEX" pool
    /// (`ReflectorAsset::Other(Symbol)`) does track them by symbol — same
    /// fix already applied to the web frontend (see
    /// web/src/lib/priceHistory.ts). Since a token's Reflector symbol isn't
    /// derivable from its SAC address on-chain, the admin sets it here per
    /// token via `set_reflector_symbol`; tokens with no symbol set fall
    /// back to skipping the check for that pair (same graceful-degrade
    /// behavior as a token Reflector has no price for at all).
    ReflectorSymbol(Address),
    /// The ed25519 public key a party signs its orders with, registered by
    /// the party itself via `set_order_key` (authorized by their Address).
    /// Stored because Soroban's `Address` is opaque -- a contract can't
    /// recover the raw pubkey from a G... address, so the party links one.
    OrderKey(Address),
    /// How much of a signed order (keyed by its digest) has already been
    /// settled, in `give_token` units. Prevents replay / overfill.
    Filled(BytesN<32>),
}

/// An order exactly as the trader signed it (SEP-0053, via Freighter's
/// `signMessage`). `settle` re-derives the signed text on-chain and verifies
/// `signature` itself, so a matching engine -- even a compromised one --
/// cannot settle anything the trader didn't sign for. `ts` is the signing
/// time in milliseconds since the Unix epoch.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignedOrder {
    pub party: Address,
    pub give_token: Address,
    pub give_amount: i128,
    pub want_token: Address,
    pub want_amount: i128,
    pub ts: u64,
    pub signature: BytesN<64>,
}

/// Soroswap Aggregator's own types (soroswap/aggregator,
/// contracts/aggregator/src/models.rs) -- reproduced because the XDR shape
/// must match exactly; `Protocol` is a plain integer enum on the wire
/// (`get_adapters` returns `"protocol_id": 0`).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Protocol {
    Soroswap = 0,
    Phoenix = 1,
    Aqua = 2,
    Comet = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DexDistribution {
    pub protocol_id: Protocol,
    pub path: Vec<Address>,
    pub parts: u32,
    pub bytes: Option<Vec<BytesN<32>>>,
}

/// The one aggregator entry point `settle_external` uses. Like the other
/// thin clients here, declared locally instead of depending on the crate.
#[contractclient(name = "AggregatorClient")]
#[allow(dead_code)]
pub trait SoroswapAggregator {
    #[allow(clippy::too_many_arguments)]
    fn swap_exact_tokens_for_tokens(
        env: Env,
        token_in: Address,
        token_out: Address,
        amount_in: i128,
        amount_out_min: i128,
        distribution: Vec<DexDistribution>,
        to: Address,
        deadline: u64,
    ) -> Vec<Vec<i128>>;
}

/// Soroswap's router -- only the pure view `settle_external` needs to learn
/// which pair contract a swap will pull `token_in` into.
#[contractclient(name = "SoroswapRouterClient")]
#[allow(dead_code)]
pub trait SoroswapRouter {
    fn router_pair_for(env: Env, token_a: Address, token_b: Address) -> Address;
}
