#![cfg(test)]

use super::*;
// The real contract (for test setup only — see Cargo.toml's [dev-dependencies]
// and types.rs's doc comment on why `lib.rs` never depends on this crate
// directly). Aliased since `super::*` already brings in our own thin
// `types::AttestationVerifierClient`.
use attestation_verifier::{
    AttestationVerifier, AttestationVerifierClient as RealVerifierClient, TeeType,
};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{contract, contractimpl, Bytes, Env};
use types::ReflectorPriceData;

// Same real Intel-signed TDX v4 quote used in attestation-verifier's own
// tests (Automata's public test vector) — duplicated here so this crate's
// tests don't depend on attestation-verifier's private test module. See
// that crate's test.rs for full provenance notes.
const PAYLOAD_HEX: &str = "040002008100000000000000939a7233f79c4ca9940a0db3957f0607000000000000000000000000000000000000000008010800000000000000000000000000bfb360ac8e6233a1bca1433caf7382d95c165b4a77fb00bf1435e5a08f300cdfead5ee68461afd9b6c728dce7534602d00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000e700060000000000409c0cd3e63d9ea54d817cf851983a220131262664ac8cd02cc6a2e19fd291d2fdd0cc035d7789b982a43a92a4424c99000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c9ebdab3e239d7e06653ca5c3b2b686385c6817453a67f5b4876de0c9bf4d68d4aa142c26c1fd00bd676b47f409466001a4261e5e82bf4a4e91912bd84456385fbbf38748c4ab30310a48930841ca0d3baf411dc6bccd0b832c38a140739d235b55db2600cf494f40728e5d6b20af62002dc89e79ba37a009e30ff060f81fe21b672c85a0596d579d6439fa943584941000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e6114531e581b991d60bcef955343dd7253297f404eabeeb5bcd968ac695ddd6afddde1485cd20dd00af75ef4ee483af08eae025bfd2781a1057538bfbe2d977";
const SIGNATURE_HEX: &str = "8a33e55bc52328456cdfd05f708f75050ae26494eacb0d8f528087d5da9baf984af11c6ae38fe09a8eb259b47fd95e15fe221050855f6e58d528e2e168a21cdd";
const PUBKEY_HEX: &str = "04afb6e3b0503046658a28afaf3cf1a6c24360a222fa45c68dd7b8906795e40335ef2d5ed805aa7e2c0ff58632d6ec402cbe1e597d098b36cde2950c62e4a84a43";
const MRTD_HEX: &str = "409c0cd3e63d9ea54d817cf851983a220131262664ac8cd02cc6a2e19fd291d2fdd0cc035d7789b982a43a92a4424c99";
// All-zero in this fixture — see attestation-verifier's test.rs for why.
const RTMR3_HEX: &str = "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

fn real_quote(env: &Env) -> (Bytes, BytesN<64>, BytesN<65>, Bytes, Bytes) {
    let payload = hex::decode(PAYLOAD_HEX).unwrap();
    let signature = hex::decode(SIGNATURE_HEX).unwrap();
    let pubkey = hex::decode(PUBKEY_HEX).unwrap();
    let mrtd = hex::decode(MRTD_HEX).unwrap();
    let rtmr3 = hex::decode(RTMR3_HEX).unwrap();
    (
        Bytes::from_slice(env, &payload),
        BytesN::<64>::from_array(env, &signature.try_into().unwrap()),
        BytesN::<65>::from_array(env, &pubkey.try_into().unwrap()),
        Bytes::from_slice(env, &mrtd),
        Bytes::from_slice(env, &rtmr3),
    )
}

/// A minimal, test-only stand-in for Reflector's oracle contract. Only
/// `lastprice` needs to match the real interface (see types.rs); `set_price`
/// is a test hook with no counterpart on the real contract.
#[contract]
struct MockOracle;

#[contractimpl]
impl MockOracle {
    pub fn set_price(env: Env, asset: ReflectorAsset, price: i128) {
        env.storage().temporary().set(&asset, &price);
    }

    pub fn lastprice(env: Env, asset: ReflectorAsset) -> Option<ReflectorPriceData> {
        let price: Option<i128> = env.storage().temporary().get(&asset);
        price.map(|price| ReflectorPriceData { price, timestamp: 0 })
    }
}

struct TestCtx<'a> {
    vault: SettlementVaultClient<'a>,
    enclave_id: BytesN<32>,
    engine: Address,
    token_a: Address,
    token_a_client: TokenClient<'a>,
    token_b: Address,
    token_b_client: TokenClient<'a>,
    party_a: Address,
    party_b: Address,
}

fn create_token<'a>(env: &'a Env, admin: &Address) -> (Address, TokenClient<'a>, StellarAssetClient<'a>) {
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let address = sac.address();
    (
        address.clone(),
        TokenClient::new(env, &address),
        StellarAssetClient::new(env, &address),
    )
}

/// `oracle` / `max_deviation_bps` let price-deviation tests opt in; plain
/// balance/attestation tests pass `(None, 0)` to disable that guard.
fn setup<'a>(env: &'a Env, oracle: Option<Address>, max_deviation_bps: u32) -> TestCtx<'a> {
    env.mock_all_auths();

    let verifier_id = env.register(AttestationVerifier, ());
    let verifier = RealVerifierClient::new(env, &verifier_id);
    let (payload, signature, pubkey, mrtd, rtmr3) = real_quote(env);
    let verifier_admin = Address::generate(env);
    verifier.initialize(&verifier_admin, &mrtd, &rtmr3, &pubkey);

    let engine = Address::generate(env);
    let enclave_id = BytesN::<32>::from_array(env, &[1u8; 32]);
    verifier.register_verified_enclave(&TeeType::IntelTdx, &payload, &signature, &enclave_id, &engine);

    let vault_id = env.register(SettlementVault, ());
    let vault = SettlementVaultClient::new(env, &vault_id);
    let vault_admin = Address::generate(env);
    let oracle_address = oracle.unwrap_or_else(|| Address::generate(env));
    vault.initialize(&vault_admin, &verifier_id, &oracle_address, &max_deviation_bps);

    let token_admin = Address::generate(env);
    let (token_a, token_a_client, token_a_issuer) = create_token(env, &token_admin);
    let (token_b, token_b_client, token_b_issuer) = create_token(env, &token_admin);

    let party_a = Address::generate(env);
    let party_b = Address::generate(env);
    token_a_issuer.mint(&party_a, &1_000_000);
    token_b_issuer.mint(&party_b, &1_000_000);

    TestCtx {
        vault,
        enclave_id,
        engine,
        token_a,
        token_a_client,
        token_b,
        token_b_client,
        party_a,
        party_b,
    }
}

#[test]
fn deposit_credits_internal_balance_and_moves_real_tokens() {
    let env = Env::default();
    let ctx = setup(&env, None, 0);

    ctx.vault.deposit(&ctx.party_a, &ctx.token_a, &500);

    assert_eq!(ctx.vault.balance_of(&ctx.token_a, &ctx.party_a), 500);
    assert_eq!(ctx.token_a_client.balance(&ctx.party_a), 1_000_000 - 500);
    assert_eq!(ctx.token_a_client.balance(&ctx.vault.address), 500);
}

#[test]
fn withdraw_returns_tokens_and_rejects_insufficient_balance() {
    let env = Env::default();
    let ctx = setup(&env, None, 0);
    ctx.vault.deposit(&ctx.party_a, &ctx.token_a, &500);

    ctx.vault.withdraw(&ctx.party_a, &ctx.token_a, &200);
    assert_eq!(ctx.vault.balance_of(&ctx.token_a, &ctx.party_a), 300);
    assert_eq!(ctx.token_a_client.balance(&ctx.party_a), 1_000_000 - 300);

    let result = ctx.vault.try_withdraw(&ctx.party_a, &ctx.token_a, &1_000);
    assert!(result.is_err());
}

/// The core of the project: a verified engine settling a matched trade
/// atomically swaps both parties' internal balances.
#[test]
fn settle_swaps_balances_when_engine_is_verified() {
    let env = Env::default();
    let ctx = setup(&env, None, 0);
    ctx.vault.deposit(&ctx.party_a, &ctx.token_a, &1_000);
    ctx.vault.deposit(&ctx.party_b, &ctx.token_b, &2_000);

    ctx.vault.settle(
        &ctx.enclave_id,
        &ctx.engine,
        &ctx.token_a,
        &ctx.party_a,
        &1_000,
        &ctx.token_b,
        &ctx.party_b,
        &2_000,
    );

    assert_eq!(ctx.vault.balance_of(&ctx.token_a, &ctx.party_a), 0);
    assert_eq!(ctx.vault.balance_of(&ctx.token_a, &ctx.party_b), 1_000);
    assert_eq!(ctx.vault.balance_of(&ctx.token_b, &ctx.party_b), 0);
    assert_eq!(ctx.vault.balance_of(&ctx.token_b, &ctx.party_a), 2_000);

    // settle only moves the internal ledger, never the underlying tokens —
    // the vault must still custody exactly what was deposited.
    assert_eq!(ctx.token_a_client.balance(&ctx.vault.address), 1_000);
    assert_eq!(ctx.token_b_client.balance(&ctx.vault.address), 2_000);
}

/// This is the check SDF's own prototype left undone: settlement must fail
/// against an enclave_id nobody ever verified.
#[test]
fn settle_rejects_unregistered_enclave() {
    let env = Env::default();
    let ctx = setup(&env, None, 0);
    ctx.vault.deposit(&ctx.party_a, &ctx.token_a, &1_000);
    ctx.vault.deposit(&ctx.party_b, &ctx.token_b, &2_000);

    let fake_enclave = BytesN::<32>::from_array(&env, &[99u8; 32]);
    let result = ctx.vault.try_settle(
        &fake_enclave,
        &ctx.engine,
        &ctx.token_a,
        &ctx.party_a,
        &1_000,
        &ctx.token_b,
        &ctx.party_b,
        &2_000,
    );
    assert!(result.is_err());
}

#[test]
fn settle_rejects_caller_who_is_not_the_registered_engine() {
    let env = Env::default();
    let ctx = setup(&env, None, 0);
    ctx.vault.deposit(&ctx.party_a, &ctx.token_a, &1_000);
    ctx.vault.deposit(&ctx.party_b, &ctx.token_b, &2_000);

    let impostor = Address::generate(&env);
    let result = ctx.vault.try_settle(
        &ctx.enclave_id,
        &impostor,
        &ctx.token_a,
        &ctx.party_a,
        &1_000,
        &ctx.token_b,
        &ctx.party_b,
        &2_000,
    );
    assert!(result.is_err());
}

#[test]
fn settle_accepts_trade_within_oracle_price_tolerance() {
    let env = Env::default();
    env.mock_all_auths();
    let oracle_id = env.register(MockOracle, ());
    let oracle = MockOracleClient::new(&env, &oracle_id);
    let ctx = setup(&env, Some(oracle_id), 100); // 1% tolerance

    oracle.set_price(&ReflectorAsset::Stellar(ctx.token_a.clone()), &100);
    oracle.set_price(&ReflectorAsset::Stellar(ctx.token_b.clone()), &100);

    ctx.vault.deposit(&ctx.party_a, &ctx.token_a, &1_000);
    ctx.vault.deposit(&ctx.party_b, &ctx.token_b, &1_000);

    // Equal price, equal amounts -> exactly fair, well within tolerance.
    ctx.vault.settle(
        &ctx.enclave_id,
        &ctx.engine,
        &ctx.token_a,
        &ctx.party_a,
        &1_000,
        &ctx.token_b,
        &ctx.party_b,
        &1_000,
    );

    assert_eq!(ctx.vault.balance_of(&ctx.token_a, &ctx.party_b), 1_000);
}

/// Second, independent guard: even a genuinely-registered engine can't
/// settle a trade priced wildly off Reflector's reference — defense in
/// depth if a registered engine's signing key is ever compromised.
#[test]
fn settle_rejects_trade_too_far_from_oracle_price() {
    let env = Env::default();
    env.mock_all_auths();
    let oracle_id = env.register(MockOracle, ());
    let oracle = MockOracleClient::new(&env, &oracle_id);
    let ctx = setup(&env, Some(oracle_id), 100); // 1% tolerance

    oracle.set_price(&ReflectorAsset::Stellar(ctx.token_a.clone()), &100);
    oracle.set_price(&ReflectorAsset::Stellar(ctx.token_b.clone()), &100);

    ctx.vault.deposit(&ctx.party_a, &ctx.token_a, &1_000);
    ctx.vault.deposit(&ctx.party_b, &ctx.token_b, &2_000);

    // Same price for both tokens, but amounts imply a 2x mismatch in value
    // exchanged — far beyond the 1% tolerance.
    let result = ctx.vault.try_settle(
        &ctx.enclave_id,
        &ctx.engine,
        &ctx.token_a,
        &ctx.party_a,
        &1_000,
        &ctx.token_b,
        &ctx.party_b,
        &2_000,
    );
    assert!(result.is_err());
    // Balances must be untouched by the failed settlement.
    assert_eq!(ctx.vault.balance_of(&ctx.token_a, &ctx.party_a), 1_000);
    assert_eq!(ctx.vault.balance_of(&ctx.token_b, &ctx.party_b), 2_000);
}
