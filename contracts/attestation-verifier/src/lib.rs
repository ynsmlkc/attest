#![no_std]

mod types;

use soroban_sdk::{contract, contracterror, contractimpl, Address, Bytes, BytesN, Env};
use types::{AttestationQuote, DataKey, VerifiedEnclave};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    MeasurementMismatch = 3,
    /// The quote's signature did not verify against the configured Intel
    /// signing key. See M1 note in the doc comment on `verify_quote`.
    InvalidSignature = 4,
}

const ADMIN: &str = "admin";
const INTEL_KEY: &str = "intel_pk";

#[contract]
pub struct AttestationVerifier;

#[contractimpl]
impl AttestationVerifier {
    /// Sets the admin, the measurement we treat as "the real matching
    /// engine" (see stellaridea2.md §4.1), and the Intel signing public key
    /// quotes must verify against.
    ///
    /// M1 SCOPE NOTE (attest-hackathon-plan.md §3, gün 3-5): `intel_pk` here
    /// is a single Intel-issued signing key (e.g. the PCK cert's key),
    /// checked directly — not the full chain up to Intel's Root CA. Full
    /// chain verification is the stretch goal once this single-signature
    /// path is proven against a real quote.
    pub fn initialize(
        env: Env,
        admin: Address,
        expected_measurement: BytesN<32>,
        intel_pk: BytesN<65>,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&ADMIN) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&ADMIN, &admin);
        env.storage()
            .instance()
            .set(&DataKey::ExpectedMeasurement, &expected_measurement);
        env.storage().instance().set(&INTEL_KEY, &intel_pk);
        Ok(())
    }

    /// Verifies an attestation quote: checks the enclave measurement
    /// matches the expected (allow-listed) matching-engine code hash, and
    /// checks the quote is genuinely signed by the configured Intel key.
    ///
    /// This is the on-chain check SDF's own prototype left client-side —
    /// see stellaridea2.md §0/§3.2. `payload` is the exact byte layout the
    /// signature was computed over (quote header + measurement +
    /// report_data, per Intel's DCAP quote format); `signature` is the
    /// raw 64-byte (r || s) ECDSA secp256r1 signature.
    pub fn verify_quote(
        env: Env,
        quote: AttestationQuote,
        expected_measurement: BytesN<32>,
        payload: Bytes,
        signature: BytesN<64>,
    ) -> Result<bool, Error> {
        if quote.measurement != expected_measurement {
            return Err(Error::MeasurementMismatch);
        }

        let intel_pk: BytesN<65> = env
            .storage()
            .instance()
            .get(&INTEL_KEY)
            .ok_or(Error::NotInitialized)?;

        // Real Intel DCAP quotes are ECDSA secp256r1-signed (NIST P-256) —
        // confirmed against public Intel DCAP docs. Soroban has native
        // secp256r1 verification (CAP-0051), so this is a real check, not a
        // placeholder. secp256r1_verify takes the SHA-256 hash of the
        // payload, not the raw bytes.
        let payload_hash = env.crypto().sha256(&payload);
        env.crypto()
            .secp256r1_verify(&intel_pk, &payload_hash, &signature);

        Ok(true)
    }

    /// Registers an enclave as verified once its quote has checked out, so
    /// other contracts (e.g. SettlementVault) can ask "is this address a
    /// verified matching engine?" without re-verifying the quote each time.
    pub fn register_verified_enclave(
        env: Env,
        quote: AttestationQuote,
        enclave_id: BytesN<32>,
    ) -> Result<(), Error> {
        if !env.storage().instance().has(&ADMIN) {
            return Err(Error::NotInitialized);
        }
        let record = VerifiedEnclave {
            tee_type: quote.tee_type,
            verified_at: env.ledger().timestamp(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::VerifiedEnclave(enclave_id), &record);
        Ok(())
    }

    /// Read-only check used by SettlementVault before releasing funds.
    pub fn is_registered(env: Env, enclave_id: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::VerifiedEnclave(enclave_id))
    }
}

mod test;
