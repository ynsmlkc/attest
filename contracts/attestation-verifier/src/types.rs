use soroban_sdk::{contracttype, Address, BytesN, Vec, Bytes};

/// Which TEE technology produced this quote. Intel TDX is the one SDF's own
/// dark pool prototype (and Phala Cloud) actually uses — see
/// stellaridea2.md §2. SGX is kept as a second variant since Automata's
/// DCAP tooling supports both and the verification math is closely related.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TeeType {
    IntelTdx,
    IntelSgx,
}

#[contracttype]
pub enum DataKey {
    /// MRTD — proves "a genuine TDX chip running dstack's OS", but is
    /// IDENTICAL across every app on the same dstack version (it measures
    /// the virtual firmware, not application code). Set once at
    /// `initialize` time by the admin. Stored as `Bytes` (not a fixed-size
    /// BytesN) because it's compared directly against a slice of the raw
    /// signed payload — see `lib.rs::check_payload`.
    ExpectedMeasurement,
    /// RTMR3 — the measurement that actually differs per application (it
    /// covers the docker-compose/app-compose content), confirmed empirically
    /// on 2026-09-10: two different apps on the same dstack build produced
    /// identical MRTD but different RTMR3. Checking MRTD alone only proves
    /// "some app is running on a genuine TDX+dstack CVM", not "this specific
    /// app" — RTMR3 is the field that actually pins the running code.
    ExpectedAppMeasurement,
    /// Registered verified enclaves: enclave_id -> registration record.
    VerifiedEnclave(BytesN<32>),
    /// Reserved for the full signature-chain-to-Root-CA stretch goal
    /// (attest-hackathon-plan.md §3/§5) — not used by the current
    /// single-signature check.
    #[allow(dead_code)]
    SignatureChain(BytesN<32>),
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct VerifiedEnclave {
    pub tee_type: TeeType,
    pub verified_at: u64,
    /// The Stellar address this enclave's operator will sign settlement
    /// transactions with. SettlementVault checks a caller against this
    /// field (via `AttestationVerifier::get_engine_address`) before
    /// trusting it to move vault balances — see settlement-vault crate.
    pub engine_address: Address,
}

/// Placeholder for the full certificate chain a quote's signing key would
/// carry up to Intel's Root CA. Not consulted by the current single-
/// signature check (see attest-hackathon-plan.md's Root-CA stretch goal) —
/// kept here so the type is ready when that work starts.
#[allow(dead_code)]
pub type SignatureChain = Vec<Bytes>;
