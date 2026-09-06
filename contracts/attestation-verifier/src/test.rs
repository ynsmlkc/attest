#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::Env;

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
