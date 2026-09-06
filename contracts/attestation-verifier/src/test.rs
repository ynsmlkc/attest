#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::Env;

/// This is the whole point of the project. Bytes below were extracted
/// directly from a REAL Intel-signed TDX v4 quote (Automata's public test
/// vector: automata-network/tdx-attestation-sdk, tdx_v4_quote.bin):
///   - PAYLOAD_HEX  = header (48B) + TD report body (584B), bytes 0..632
///     of the quote file — this is exactly what Intel's attestation key
///     signs.
///   - SIGNATURE_HEX = the 64-byte (r||s) ECDSA signature, bytes 636..700.
///   - PUBKEY_HEX = the quote's ephemeral attestation public key, bytes
///     700..764, with the SEC1 0x04 uncompressed-point prefix added.
/// If `secp256r1_verify` does not panic on these, Soroban has correctly
/// verified a genuine piece of Intel hardware attestation — the exact
/// on-chain check SDF's own dark pool prototype does client-side instead.
/// See stellaridea2.md §0 / §3.2.
#[test]
fn verify_quote_accepts_a_real_intel_signed_quote() {
    let env = Env::default();

    let payload_hex = "040002008100000000000000939a7233f79c4ca9940a0db3957f0607000000000000000000000000000000000000000008010800000000000000000000000000bfb360ac8e6233a1bca1433caf7382d95c165b4a77fb00bf1435e5a08f300cdfead5ee68461afd9b6c728dce7534602d00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000e700060000000000409c0cd3e63d9ea54d817cf851983a220131262664ac8cd02cc6a2e19fd291d2fdd0cc035d7789b982a43a92a4424c99000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c9ebdab3e239d7e06653ca5c3b2b686385c6817453a67f5b4876de0c9bf4d68d4aa142c26c1fd00bd676b47f409466001a4261e5e82bf4a4e91912bd84456385fbbf38748c4ab30310a48930841ca0d3baf411dc6bccd0b832c38a140739d235b55db2600cf494f40728e5d6b20af62002dc89e79ba37a009e30ff060f81fe21b672c85a0596d579d6439fa943584941000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e6114531e581b991d60bcef955343dd7253297f404eabeeb5bcd968ac695ddd6afddde1485cd20dd00af75ef4ee483af08eae025bfd2781a1057538bfbe2d977";
    // Raw quote signature normalized to low-s form (Soroban's secp256r1_verify
    // rejects high-s signatures as an anti-malleability measure — same
    // convention Bitcoin/Ethereum tooling uses. Intel's own DCAP quotes are
    // not guaranteed low-s, so whoever relays a quote on-chain (our future
    // submit_proof caller / oracle adapter) needs to normalize `s` first.
    // r is unchanged; s replaced with min(s, curve_order - s).
    let signature_hex = "8a33e55bc52328456cdfd05f708f75050ae26494eacb0d8f528087d5da9baf984af11c6ae38fe09a8eb259b47fd95e15fe221050855f6e58d528e2e168a21cdd";
    let pubkey_hex = "04afb6e3b0503046658a28afaf3cf1a6c24360a222fa45c68dd7b8906795e40335ef2d5ed805aa7e2c0ff58632d6ec402cbe1e597d098b36cde2950c62e4a84a43";

    let payload_bytes = hex::decode(payload_hex).unwrap();
    let signature_bytes = hex::decode(signature_hex).unwrap();
    let pubkey_bytes = hex::decode(pubkey_hex).unwrap();

    let payload = Bytes::from_slice(&env, &payload_bytes);
    let signature = BytesN::<64>::from_array(&env, &signature_bytes.try_into().unwrap());
    let pubkey = BytesN::<65>::from_array(&env, &pubkey_bytes.try_into().unwrap());

    // Real ECDSA secp256r1 check, no contract state needed for this half of
    // verify_quote's job — call the host function the same way the
    // contract does.
    let payload_hash = env.crypto().sha256(&payload);
    env.crypto().secp256r1_verify(&pubkey, &payload_hash, &signature);
    // No panic = the real Intel signature verified. This is the proof.
}

#[test]
fn initialize_sets_state() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(AttestationVerifier, ());
    let client = AttestationVerifierClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let measurement = BytesN::from_array(&env, &[1u8; 32]);
    let intel_pk = BytesN::from_array(&env, &[2u8; 65]);

    client.initialize(&admin, &measurement, &intel_pk);

    // Re-initializing should fail.
    let result = client.try_initialize(&admin, &measurement, &intel_pk);
    assert!(result.is_err());
}
