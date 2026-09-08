#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::Env;

/// Bytes below were extracted directly from a REAL Intel-signed TDX v4
/// quote (Automata's public test vector:
/// automata-network/tdx-attestation-sdk, tdx_v4_quote.bin):
///   - PAYLOAD_HEX = header (48B) + TD report body (584B), bytes 0..632
///     of the quote file — exactly what Intel's attestation key signs.
///   - SIGNATURE_HEX = the 64-byte (r||s) ECDSA signature, bytes 636..700,
///     normalized to low-s (Soroban's secp256r1_verify rejects high-s
///     signatures as an anti-malleability measure; Intel's raw quote
///     wasn't in that form, so whoever relays a quote on-chain needs to
///     normalize `s` first — same convention Bitcoin/Ethereum use).
///   - PUBKEY_HEX = the quote's ephemeral attestation public key, bytes
///     700..764, with the SEC1 0x04 uncompressed-point prefix added.
///   - MRTD_HEX = the TD measurement register, bytes 184..232 of the
///     payload (48 bytes — TDX's MRTD is SHA-384-sized, not 32 like an
///     earlier draft of this contract incorrectly assumed).
const PAYLOAD_HEX: &str = "040002008100000000000000939a7233f79c4ca9940a0db3957f0607000000000000000000000000000000000000000008010800000000000000000000000000bfb360ac8e6233a1bca1433caf7382d95c165b4a77fb00bf1435e5a08f300cdfead5ee68461afd9b6c728dce7534602d00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000e700060000000000409c0cd3e63d9ea54d817cf851983a220131262664ac8cd02cc6a2e19fd291d2fdd0cc035d7789b982a43a92a4424c99000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c9ebdab3e239d7e06653ca5c3b2b686385c6817453a67f5b4876de0c9bf4d68d4aa142c26c1fd00bd676b47f409466001a4261e5e82bf4a4e91912bd84456385fbbf38748c4ab30310a48930841ca0d3baf411dc6bccd0b832c38a140739d235b55db2600cf494f40728e5d6b20af62002dc89e79ba37a009e30ff060f81fe21b672c85a0596d579d6439fa943584941000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e6114531e581b991d60bcef955343dd7253297f404eabeeb5bcd968ac695ddd6afddde1485cd20dd00af75ef4ee483af08eae025bfd2781a1057538bfbe2d977";
const SIGNATURE_HEX: &str = "8a33e55bc52328456cdfd05f708f75050ae26494eacb0d8f528087d5da9baf984af11c6ae38fe09a8eb259b47fd95e15fe221050855f6e58d528e2e168a21cdd";
const PUBKEY_HEX: &str = "04afb6e3b0503046658a28afaf3cf1a6c24360a222fa45c68dd7b8906795e40335ef2d5ed805aa7e2c0ff58632d6ec402cbe1e597d098b36cde2950c62e4a84a43";
const MRTD_HEX: &str = "409c0cd3e63d9ea54d817cf851983a220131262664ac8cd02cc6a2e19fd291d2fdd0cc035d7789b982a43a92a4424c99";

struct RealQuote {
    payload: Bytes,
    signature: BytesN<64>,
    pubkey: BytesN<65>,
    mrtd: Bytes,
}

fn real_quote(env: &Env) -> RealQuote {
    let payload_bytes = hex::decode(PAYLOAD_HEX).unwrap();
    let signature_bytes = hex::decode(SIGNATURE_HEX).unwrap();
    let pubkey_bytes = hex::decode(PUBKEY_HEX).unwrap();
    let mrtd_bytes = hex::decode(MRTD_HEX).unwrap();

    RealQuote {
        payload: Bytes::from_slice(env, &payload_bytes),
        signature: BytesN::<64>::from_array(env, &signature_bytes.try_into().unwrap()),
        pubkey: BytesN::<65>::from_array(env, &pubkey_bytes.try_into().unwrap()),
        mrtd: Bytes::from_slice(env, &mrtd_bytes),
    }
}

fn setup(env: &Env) -> (AttestationVerifierClient<'_>, RealQuote) {
    env.mock_all_auths();
    let contract_id = env.register(AttestationVerifier, ());
    let client = AttestationVerifierClient::new(env, &contract_id);
    let quote = real_quote(env);

    let admin = Address::generate(env);
    client.initialize(&admin, &quote.mrtd, &quote.pubkey);

    (client, quote)
}

#[test]
fn initialize_rejects_double_init() {
    let env = Env::default();
    let (client, quote) = setup(&env);
    let admin = Address::generate(&env);
    let result = client.try_initialize(&admin, &quote.mrtd, &quote.pubkey);
    assert!(result.is_err());
}

/// The whole point of the project: a real, Intel-signed quote — checked
/// against the real measurement extracted from that same payload, not a
/// caller-supplied claim about it — verifies successfully through the
/// contract's actual public entry point.
#[test]
fn verify_quote_accepts_a_real_intel_signed_quote() {
    let env = Env::default();
    let (client, quote) = setup(&env);

    let ok = client.verify_quote(&quote.payload, &quote.signature);
    assert!(ok);
}

/// A quote claiming the right signature but the wrong measurement must be
/// rejected — this is the check that was previously vacuous (comparing two
/// caller-supplied values against each other) before this fix.
#[test]
fn verify_quote_rejects_wrong_measurement() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(AttestationVerifier, ());
    let client = AttestationVerifierClient::new(&env, &contract_id);
    let quote = real_quote(&env);

    let admin = Address::generate(&env);
    let wrong_measurement = Bytes::from_array(&env, &[0u8; 48]);
    client.initialize(&admin, &wrong_measurement, &quote.pubkey);

    let result = client.try_verify_quote(&quote.payload, &quote.signature);
    assert!(result.is_err());
}

/// Closes the bug where `register_verified_enclave` stored anything handed
/// to it without checking a signature at all.
#[test]
fn register_verified_enclave_requires_a_valid_quote() {
    let env = Env::default();
    let (client, quote) = setup(&env);
    let enclave_id = BytesN::<32>::from_array(&env, &[7u8; 32]);
    let engine = Address::generate(&env);

    assert!(!client.is_registered(&enclave_id));

    client.register_verified_enclave(
        &TeeType::IntelTdx,
        &quote.payload,
        &quote.signature,
        &enclave_id,
        &engine,
    );
    assert!(client.is_registered(&enclave_id));
    assert_eq!(client.get_engine_address(&enclave_id), Some(engine));
}

#[test]
fn get_engine_address_returns_none_for_unknown_enclave() {
    let env = Env::default();
    let (client, _quote) = setup(&env);
    let enclave_id = BytesN::<32>::from_array(&env, &[42u8; 32]);

    assert_eq!(client.get_engine_address(&enclave_id), None);
}

#[test]
fn register_verified_enclave_rejects_fake_data() {
    let env = Env::default();
    let (client, quote) = setup(&env);
    let enclave_id = BytesN::<32>::from_array(&env, &[9u8; 32]);

    // Same signature/pubkey but a tampered payload (first byte flipped) —
    // must fail, not silently register.
    let mut tampered = quote.payload.clone();
    let flipped = tampered.get(0).unwrap() ^ 0xFF;
    tampered.set(0, flipped);
    let engine = Address::generate(&env);

    let result = client.try_register_verified_enclave(
        &TeeType::IntelTdx,
        &tampered,
        &quote.signature,
        &enclave_id,
        &engine,
    );
    assert!(result.is_err());
    assert!(!client.is_registered(&enclave_id));
}
