#![no_std]

mod types;

use soroban_sdk::{contract, contracterror, contractimpl, Address, Bytes, BytesN, Env};
use types::{DataKey, TeeType, VerifiedEnclave};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    MeasurementMismatch = 3,
    /// `payload` isn't the length a real Intel DCAP v4 quote's signed
    /// portion should be — see `PAYLOAD_LEN`.
    BadPayloadLength = 4,
}

const ADMIN: &str = "admin";
const INTEL_KEY: &str = "intel_pk";

// --- Intel DCAP Quote v4 layout constants ---
// Empirically verified against a real Intel-signed quote (Automata's public
// TDX v4 test vector) on 2026-09-06 — see contracts/attestation-verifier
// commit history / attest-hackathon-plan.md. These are protocol constants,
// not guesses: header(48 bytes) + TD Report 1.0 body(584 bytes) = 632 bytes
// is exactly what Intel's attestation key signs.
const PAYLOAD_LEN: u32 = 632;
/// Byte offset of MRTD (the TD measurement register) within the signed
/// payload. TDX's MRTD is SHA-384-sized — 48 bytes, not 32.
const MRTD_OFFSET: u32 = 184;
const MRTD_LEN: u32 = 48;

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
    /// path is proven against a real quote (it has been — see tests).
    pub fn initialize(
        env: Env,
        admin: Address,
        expected_measurement: Bytes,
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

    /// Verifies a raw attestation quote payload: checks it's genuinely
    /// signed by the configured Intel key, AND that the measurement
    /// embedded *in that signed payload* (not a caller-supplied claim about
    /// it) matches the one configured at `initialize`.
    ///
    /// This is the on-chain check SDF's own prototype left client-side —
    /// see stellaridea2.md §0/§3.2. `payload` must be the exact 632-byte
    /// signed portion of a real Intel DCAP v4 quote (header + TD report
    /// body); `signature` is the 64-byte (r||s) ECDSA secp256r1 signature,
    /// normalized to low-s (see test.rs for why that normalization step is
    /// required — Intel's raw quotes aren't guaranteed low-s).
    pub fn verify_quote(env: Env, payload: Bytes, signature: BytesN<64>) -> Result<bool, Error> {
        Self::check_payload(&env, &payload, &signature)?;
        Ok(true)
    }

    /// Registers an enclave as verified — but only after independently
    /// re-running the exact same check `verify_quote` does. This closes the
    /// gap SDF's paper flagged: a caller can't skip verification and get an
    /// enclave registered anyway, because this function does the checking
    /// itself rather than trusting that the caller already called
    /// `verify_quote` honestly.
    ///
    /// Deliberately permissionless (no `require_auth`) — that's the point:
    /// *anyone* holding a genuinely valid, Intel-signed quote can register
    /// it. Trust comes from the signature check, not from who's calling.
    pub fn register_verified_enclave(
        env: Env,
        tee_type: TeeType,
        payload: Bytes,
        signature: BytesN<64>,
        enclave_id: BytesN<32>,
    ) -> Result<(), Error> {
        Self::check_payload(&env, &payload, &signature)?;

        let record = VerifiedEnclave {
            tee_type,
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

    /// Shared verification core for `verify_quote` and
    /// `register_verified_enclave` — one place, so the two can never drift
    /// out of sync (that drift is exactly what caused the earlier bug where
    /// registration didn't actually check anything).
    fn check_payload(env: &Env, payload: &Bytes, signature: &BytesN<64>) -> Result<(), Error> {
        if payload.len() != PAYLOAD_LEN {
            return Err(Error::BadPayloadLength);
        }

        let expected_measurement: Bytes = env
            .storage()
            .instance()
            .get(&DataKey::ExpectedMeasurement)
            .ok_or(Error::NotInitialized)?;
        let actual_measurement = payload.slice(MRTD_OFFSET..MRTD_OFFSET + MRTD_LEN);
        if actual_measurement != expected_measurement {
            return Err(Error::MeasurementMismatch);
        }

        let intel_pk: BytesN<65> = env
            .storage()
            .instance()
            .get(&INTEL_KEY)
            .ok_or(Error::NotInitialized)?;

        // Real Intel DCAP quotes are ECDSA secp256r1-signed (NIST P-256).
        // Soroban has native secp256r1 verification (CAP-0051); it panics
        // on an invalid signature, so reaching the line after this call
        // means the signature genuinely checked out.
        let payload_hash = env.crypto().sha256(payload);
        env.crypto()
            .secp256r1_verify(&intel_pk, &payload_hash, signature);

        Ok(())
    }
}

mod test;
