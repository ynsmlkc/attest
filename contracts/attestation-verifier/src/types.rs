use soroban_sdk::{contracttype, Bytes, BytesN, Vec};

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

/// A hardware attestation quote, as produced by the TEE. This is the thing
/// SDF's prototype currently verifies client-side (in the browser) — this
/// contract verifies it on-chain instead. See stellaridea2.md §3.2, §4.1.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttestationQuote {
    pub tee_type: TeeType,
    /// Hash of the code running inside the enclave (MRTD for TDX / MRENCLAVE
    /// for SGX). This is what `verify_quote` checks against the expected,
    /// allow-listed measurement of the real matching engine code.
    pub measurement: BytesN<32>,
    /// Application-specific data bound into the quote — e.g. a hash of the
    /// enclave's ephemeral TLS/signing public key, so the caller can prove
    /// "this specific attested enclave, not just some TDX enclave somewhere,
    /// generated this."
    pub report_data: BytesN<64>,
    /// Raw certificate chain from the quote's signing key up to Intel's
    /// Root CA. Real content/format TODO — see M1 in attest-hackathon-plan.md
    /// day 3-5: this starts as a single-signature check and is extended
    /// toward a full chain as time allows.
    pub signature_chain: Vec<Bytes>,
    pub timestamp: u64,
}

#[contracttype]
pub enum DataKey {
    /// Measurement hash we consider "the real matching engine" — set once
    /// at deploy/config time by the contract admin.
    ExpectedMeasurement,
    /// Registered verified enclaves: report_data hash -> registration record.
    VerifiedEnclave(BytesN<32>),
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct VerifiedEnclave {
    pub tee_type: TeeType,
    pub verified_at: u64,
}
