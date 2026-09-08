use soroban_sdk::{contractclient, contracttype, Address, BytesN, Env, Symbol};

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
}
