#![no_std]

mod types;

use soroban_sdk::{contract, contracterror, contractimpl, Address, Bytes, BytesN, Env};
use types::{DataKey, VerifiedEnclave};
pub use types::TeeType;

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
    /// RTMR3 (the app-specific measurement) didn't match — the quote is
    /// from a genuine TDX+dstack CVM (MRTD checked out), but running
    /// different code than what was registered as trusted.
    AppMeasurementMismatch = 5,
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
/// Byte offset of RTMR3 within the signed payload — verified 2026-09-10 by
/// computing it from the TD Report Body field layout (TEE_TCB_SVN(16) +
/// MRSEAM(48) + MRSIGNERSEAM(48) + SEAMATTRIBUTES(8) + TDATTRIBUTES(8) +
/// XFAM(8) + MRTD(48) + MRCONFIGID(48) + MROWNER(48) + MROWNERCONFIG(48) +
/// RTMR0(48) + RTMR1(48) + RTMR2(48) = 520, relative to the payload, i.e.
/// after the 48-byte quote header) and cross-checking the resulting slice
/// against Phala's own independently-reported `tcb_info.rtmr3` for a real
/// deployed CVM — exact match. Unlike MRTD (identical across every app on
/// the same dstack build), RTMR3 covers the docker-compose/app-compose
/// content and so differs per application — this is the field that actually
/// proves *which* code is running, not just that *some* code is running on
/// genuine TDX+dstack hardware.
const RTMR3_OFFSET: u32 = 520;
const RTMR3_LEN: u32 = 48;

#[contract]
pub struct AttestationVerifier;

#[contractimpl]
impl AttestationVerifier {
    /// Sets the admin, the two measurements a quote must match, and the
    /// Intel signing public key quotes must verify against.
    ///
    /// `expected_measurement` (MRTD) proves genuine TDX+dstack hardware;
    /// `expected_app_measurement` (RTMR3) proves *which* application is
    /// running on it — checking MRTD alone isn't enough, since it's
    /// identical across every app on the same dstack build (confirmed
    /// empirically 2026-09-10 — see `RTMR3_OFFSET`'s doc comment).
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
        expected_app_measurement: Bytes,
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
        env.storage().instance().set(
            &DataKey::ExpectedAppMeasurement,
            &expected_app_measurement,
        );
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
    /// Verification of the quote itself is deliberately permissionless —
    /// *anyone* holding a genuinely valid, Intel-signed quote can register
    /// it. But `engine_address` — the wallet SettlementVault will later
    /// trust to move funds on this enclave's behalf — does require auth:
    /// otherwise anyone could register a valid quote with someone else's
    /// address attached, squatting the enclave_id before its real operator
    /// gets to.
    pub fn register_verified_enclave(
        env: Env,
        tee_type: TeeType,
        payload: Bytes,
        signature: BytesN<64>,
        enclave_id: BytesN<32>,
        engine_address: Address,
    ) -> Result<(), Error> {
        engine_address.require_auth();
        Self::check_payload(&env, &payload, &signature)?;

        let record = VerifiedEnclave {
            tee_type,
            verified_at: env.ledger().timestamp(),
            engine_address,
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

    /// The wallet address authorized to act on a registered enclave's
    /// behalf, or `None` if `enclave_id` was never registered.
    /// SettlementVault::settle calls this and requires the caller to match.
    pub fn get_engine_address(env: Env, enclave_id: BytesN<32>) -> Option<Address> {
        env.storage()
            .persistent()
            .get::<_, VerifiedEnclave>(&DataKey::VerifiedEnclave(enclave_id))
            .map(|record| record.engine_address)
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

        let expected_app_measurement: Bytes = env
            .storage()
            .instance()
            .get(&DataKey::ExpectedAppMeasurement)
            .ok_or(Error::NotInitialized)?;
        let actual_app_measurement = payload.slice(RTMR3_OFFSET..RTMR3_OFFSET + RTMR3_LEN);
        if actual_app_measurement != expected_app_measurement {
            return Err(Error::AppMeasurementMismatch);
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
