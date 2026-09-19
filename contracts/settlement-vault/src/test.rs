#![cfg(test)]

extern crate std;

use super::*;
// The real contract (for test setup only — see Cargo.toml's [dev-dependencies]
// and types.rs's doc comment on why `lib.rs` never depends on this crate
// directly). Aliased since `super::*` already brings in our own thin
// `types::AttestationVerifierClient`.
use attestation_verifier::{
    AttestationVerifier, AttestationVerifierClient as RealVerifierClient, TeeType,
};
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{contract, contractimpl, vec, Bytes, Env, Symbol, Vec};
use types::{DexDistribution, ReflectorPriceData};

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

/// Fixed signing time for orders, and the ledger time tests run at.
const NOW_S: u64 = 1_800_000_000;
const TS_MS: u64 = NOW_S * 1000;

struct TestCtx<'a> {
    env: &'a Env,
    sk_a: SigningKey,
    sk_b: SigningKey,
    vault: SettlementVaultClient<'a>,
    vault_admin: Address,
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
    env.ledger().set_timestamp(NOW_S);

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
    // Both parties also hold a bit of the other side's token, for tests that
    // need same-token trades on both legs (e.g. a same-asset self-match).
    token_a_issuer.mint(&party_b, &1_000_000);
    token_b_issuer.mint(&party_a, &1_000_000);

    // Each party links the ed25519 key it signs orders with.
    let sk_a = SigningKey::from_bytes(&[7u8; 32]);
    let sk_b = SigningKey::from_bytes(&[9u8; 32]);
    vault.set_order_key(&party_a, &BytesN::from_array(env, &sk_a.verifying_key().to_bytes()));
    vault.set_order_key(&party_b, &BytesN::from_array(env, &sk_b.verifying_key().to_bytes()));

    TestCtx {
        env,
        sk_a,
        sk_b,
        vault,
        vault_admin,
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


/// Builds an order signed exactly the way Freighter's SEP-0053
/// `signMessage` would: ed25519 over SHA-256("Stellar Signed Message:\n" +
/// text), which is what `order_digest` computes.
fn sign_order(
    ctx: &TestCtx,
    sk: &SigningKey,
    party: &Address,
    give: &Address,
    give_amount: i128,
    want: &Address,
    want_amount: i128,
    ts: u64,
) -> SignedOrder {
    let env = ctx.env;
    let mut o = SignedOrder {
        party: party.clone(),
        give_token: give.clone(),
        give_amount,
        want_token: want.clone(),
        want_amount,
        ts,
        signature: BytesN::from_array(env, &[0u8; 64]),
    };
    let digest = order_digest(env, &ctx.vault.address, &ctx.enclave_id, &o);
    o.signature = BytesN::from_array(env, &sk.sign(&digest.to_array()).to_bytes());
    o
}

impl TestCtx<'_> {
    /// party_a's order: gives `token_a`, wants `token_b`.
    fn order_a(&self, give_amount: i128, want_amount: i128) -> SignedOrder {
        sign_order(self, &self.sk_a, &self.party_a, &self.token_a, give_amount, &self.token_b, want_amount, TS_MS)
    }
    /// party_b's order: gives `token_b`, wants `token_a`.
    fn order_b(&self, give_amount: i128, want_amount: i128) -> SignedOrder {
        sign_order(self, &self.sk_b, &self.party_b, &self.token_b, give_amount, &self.token_a, want_amount, TS_MS)
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
        &ctx.order_a(1_000, 2_000),
        &1_000,
        &ctx.order_b(2_000, 1_000),
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
        &ctx.order_a(1_000, 2_000),
        &1_000,
        &ctx.order_b(2_000, 1_000),
        &2_000,
    );
    assert_eq!(result, Err(Ok(Error::EnclaveNotRegistered)));
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
        &ctx.order_a(1_000, 2_000),
        &1_000,
        &ctx.order_b(2_000, 1_000),
        &2_000,
    );
    assert_eq!(result, Err(Ok(Error::EngineMismatch)));
}

/// A same-token settle is only ever a harmless no-op self-match when both
/// sides move an equal amount; a differing amount would otherwise let a
/// buggy/compromised engine transfer value between two parties while
/// looking like a real swap.
#[test]
fn settle_rejects_same_token_with_differing_amounts() {
    let env = Env::default();
    let ctx = setup(&env, None, 0);
    ctx.vault.deposit(&ctx.party_a, &ctx.token_a, &1_000);
    ctx.vault.deposit(&ctx.party_b, &ctx.token_a, &2_000);

    let oa = sign_order(&ctx, &ctx.sk_a, &ctx.party_a, &ctx.token_a, 1_000, &ctx.token_a, 1_000, TS_MS);
    let ob = sign_order(&ctx, &ctx.sk_b, &ctx.party_b, &ctx.token_a, 2_000, &ctx.token_a, 1_000, TS_MS);
    let result = ctx.vault.try_settle(&ctx.enclave_id, &ctx.engine, &oa, &1_000, &ob, &2_000);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

/// The symmetric case (same token, equal amounts — README's 5 XLM <-> 5 XLM
/// self-match demo) must still be allowed: it nets to zero for both parties.
#[test]
fn settle_allows_same_token_self_match_with_equal_amounts() {
    let env = Env::default();
    let ctx = setup(&env, None, 0);
    ctx.vault.deposit(&ctx.party_a, &ctx.token_a, &1_000);
    ctx.vault.deposit(&ctx.party_b, &ctx.token_a, &1_000);

    let oa = sign_order(&ctx, &ctx.sk_a, &ctx.party_a, &ctx.token_a, 500, &ctx.token_a, 500, TS_MS);
    let ob = sign_order(&ctx, &ctx.sk_b, &ctx.party_b, &ctx.token_a, 500, &ctx.token_a, 500, TS_MS);
    ctx.vault.settle(&ctx.enclave_id, &ctx.engine, &oa, &500, &ob, &500);

    assert_eq!(ctx.vault.balance_of(&ctx.token_a, &ctx.party_a), 1_000);
    assert_eq!(ctx.vault.balance_of(&ctx.token_a, &ctx.party_b), 1_000);
}

/// An order can be settled across several calls (partial fills) until its
/// signed size is used up -- and not a unit beyond it.
#[test]
fn settle_supports_partial_fills_and_rejects_overfill() {
    let env = Env::default();
    let ctx = setup(&env, None, 0);
    ctx.vault.deposit(&ctx.party_a, &ctx.token_a, &1_000);
    ctx.vault.deposit(&ctx.party_b, &ctx.token_b, &2_000);

    // A: give 1000 a for >= 2000 b. B: give 2000 b for >= 1000 a.
    let oa = ctx.order_a(1_000, 2_000);
    let ob = ctx.order_b(2_000, 1_000);

    ctx.vault.settle(&ctx.enclave_id, &ctx.engine, &oa, &400, &ob, &800);
    ctx.vault.settle(&ctx.enclave_id, &ctx.engine, &oa, &600, &ob, &1_200);
    assert_eq!(ctx.vault.balance_of(&ctx.token_a, &ctx.party_b), 1_000);
    assert_eq!(ctx.vault.balance_of(&ctx.token_b, &ctx.party_a), 2_000);

    // Fully used: replaying the same signed orders must fail, even for 1 unit.
    ctx.vault.deposit(&ctx.party_a, &ctx.token_a, &10);
    ctx.vault.deposit(&ctx.party_b, &ctx.token_b, &20);
    let replay = ctx.vault.try_settle(&ctx.enclave_id, &ctx.engine, &oa, &1, &ob, &2);
    assert_eq!(replay, Err(Ok(Error::OrderOverfilled)));
}

/// Even a verified engine can't give a trader worse than their signed
/// limit price -- the engine key alone can't move their funds off-market.
#[test]
fn settle_rejects_fill_worse_than_signed_limit_price() {
    let env = Env::default();
    let ctx = setup(&env, None, 0);
    ctx.vault.deposit(&ctx.party_a, &ctx.token_a, &1_000);
    ctx.vault.deposit(&ctx.party_b, &ctx.token_b, &2_000);

    // A insisted on >= 2 b per a; the engine tries to pay only 1.5.
    let result = ctx.vault.try_settle(
        &ctx.enclave_id,
        &ctx.engine,
        &ctx.order_a(1_000, 2_000),
        &1_000,
        &ctx.order_b(2_000, 1_000),
        &1_500,
    );
    assert_eq!(result, Err(Ok(Error::OrderPriceViolated)));
    assert_eq!(ctx.vault.balance_of(&ctx.token_a, &ctx.party_a), 1_000);
}

/// The signature is checked on-chain: an order altered after signing (here,
/// a bigger give_amount than the trader signed) must not verify.
#[test]
fn settle_rejects_order_altered_after_signing() {
    let env = Env::default();
    let ctx = setup(&env, None, 0);
    ctx.vault.deposit(&ctx.party_a, &ctx.token_a, &1_000);
    ctx.vault.deposit(&ctx.party_b, &ctx.token_b, &2_000);

    let mut oa = ctx.order_a(500, 1_000);
    oa.give_amount = 1_000; // signature still covers 500
    let result = ctx.vault.try_settle(
        &ctx.enclave_id,
        &ctx.engine,
        &oa,
        &1_000,
        &ctx.order_b(2_000, 1_000),
        &2_000,
    );
    assert!(result.is_err());
    assert_eq!(ctx.vault.balance_of(&ctx.token_a, &ctx.party_a), 1_000);
}

/// A signature from someone else's key must not authorize this party.
#[test]
fn settle_rejects_signature_from_a_different_key() {
    let env = Env::default();
    let ctx = setup(&env, None, 0);
    ctx.vault.deposit(&ctx.party_a, &ctx.token_a, &1_000);
    ctx.vault.deposit(&ctx.party_b, &ctx.token_b, &2_000);

    // party_a's order, but signed with party_b's key.
    let forged = sign_order(&ctx, &ctx.sk_b, &ctx.party_a, &ctx.token_a, 1_000, &ctx.token_b, 2_000, TS_MS);
    let result = ctx.vault.try_settle(
        &ctx.enclave_id,
        &ctx.engine,
        &forged,
        &1_000,
        &ctx.order_b(2_000, 1_000),
        &2_000,
    );
    assert!(result.is_err());
}

#[test]
fn settle_rejects_party_without_a_registered_order_key() {
    let env = Env::default();
    let ctx = setup(&env, None, 0);
    let stranger = Address::generate(&env);
    let sk = SigningKey::from_bytes(&[3u8; 32]);
    ctx.vault.deposit(&ctx.party_b, &ctx.token_b, &2_000);

    let unkeyed = sign_order(&ctx, &sk, &stranger, &ctx.token_a, 1_000, &ctx.token_b, 2_000, TS_MS);
    let result = ctx.vault.try_settle(
        &ctx.enclave_id,
        &ctx.engine,
        &unkeyed,
        &1_000,
        &ctx.order_b(2_000, 1_000),
        &2_000,
    );
    assert_eq!(result, Err(Ok(Error::OrderKeyNotSet)));
}

#[test]
fn settle_rejects_expired_order() {
    let env = Env::default();
    let ctx = setup(&env, None, 0);
    ctx.vault.deposit(&ctx.party_a, &ctx.token_a, &1_000);
    ctx.vault.deposit(&ctx.party_b, &ctx.token_b, &2_000);

    let eight_days_ms = 8 * 24 * 60 * 60 * 1000;
    let stale = sign_order(&ctx, &ctx.sk_a, &ctx.party_a, &ctx.token_a, 1_000, &ctx.token_b, 2_000, TS_MS - eight_days_ms);
    let result = ctx.vault.try_settle(
        &ctx.enclave_id,
        &ctx.engine,
        &stale,
        &1_000,
        &ctx.order_b(2_000, 1_000),
        &2_000,
    );
    assert_eq!(result, Err(Ok(Error::OrderExpired)));
}

#[test]
fn settle_rejects_orders_that_are_not_each_others_opposite() {
    let env = Env::default();
    let ctx = setup(&env, None, 0);
    ctx.vault.deposit(&ctx.party_a, &ctx.token_a, &1_000);
    ctx.vault.deposit(&ctx.party_b, &ctx.token_b, &2_000);

    // B wants some third token, not A's.
    let third = Address::generate(&env);
    let ob = sign_order(&ctx, &ctx.sk_b, &ctx.party_b, &ctx.token_b, 2_000, &third, 1_000, TS_MS);
    let result = ctx.vault.try_settle(
        &ctx.enclave_id,
        &ctx.engine,
        &ctx.order_a(1_000, 2_000),
        &1_000,
        &ob,
        &2_000,
    );
    assert_eq!(result, Err(Ok(Error::OrderMismatch)));
}

/// The signed text is rebuilt on-chain byte for byte; this pins its exact
/// format independently of the builder, since the web client and the
/// matching engine must produce the very same string.
#[test]
fn order_digest_matches_the_documented_message_format() {
    let env = Env::default();
    let ctx = setup(&env, None, 0);
    let o = ctx.order_a(1_000, 2_000);

    let text = std::format!(
        "Stellar Signed Message:\nAttest order v3\nvault:{}\nenclave:{}\nparty:{}\ngive:{}:1000\nwant:{}:2000\nts:{}\nrouting:pool first, then Soroswap at your limit or better",
        ctx.vault.address.to_string(),
        "01".repeat(32),
        ctx.party_a.to_string(),
        ctx.token_a.to_string(),
        ctx.token_b.to_string(),
        TS_MS,
    );
    let expected = env.crypto().sha256(&Bytes::from_slice(&env, text.as_bytes())).to_bytes();
    assert_eq!(order_digest(&env, &ctx.vault.address, &ctx.enclave_id, &o), expected);
}

fn register_symbols(ctx: &TestCtx, env: &Env) {
    ctx.vault.set_reflector_symbol(&ctx.token_a, &Symbol::new(env, "XLM"));
    ctx.vault.set_reflector_symbol(&ctx.token_b, &Symbol::new(env, "USDC"));
}

#[test]
fn settle_accepts_trade_within_oracle_price_tolerance() {
    let env = Env::default();
    env.mock_all_auths();
    let oracle_id = env.register(MockOracle, ());
    let oracle = MockOracleClient::new(&env, &oracle_id);
    let ctx = setup(&env, Some(oracle_id), 100); // 1% tolerance

    // The guard looks assets up under Reflector's Other(Symbol) pool (see
    // types.rs's ReflectorSymbol doc comment) — the admin must register
    // each token's symbol before the check can see a price for it at all.
    register_symbols(&ctx, &env);
    oracle.set_price(&ReflectorAsset::Other(Symbol::new(&env, "XLM")), &100);
    oracle.set_price(&ReflectorAsset::Other(Symbol::new(&env, "USDC")), &100);

    ctx.vault.deposit(&ctx.party_a, &ctx.token_a, &1_000);
    ctx.vault.deposit(&ctx.party_b, &ctx.token_b, &1_000);

    // Equal price, equal amounts -> exactly fair, well within tolerance.
    ctx.vault.settle(
        &ctx.enclave_id,
        &ctx.engine,
        &ctx.order_a(1_000, 1_000),
        &1_000,
        &ctx.order_b(1_000, 1_000),
        &1_000,
    );

    assert_eq!(ctx.vault.balance_of(&ctx.token_a, &ctx.party_b), 1_000);
}

/// Third, independent guard: even a genuinely-registered engine with validly
/// signed orders can't settle a trade priced wildly off Reflector's
/// reference -- protects traders who signed a limit that's simply too loose.
#[test]
fn settle_rejects_trade_too_far_from_oracle_price() {
    let env = Env::default();
    env.mock_all_auths();
    let oracle_id = env.register(MockOracle, ());
    let oracle = MockOracleClient::new(&env, &oracle_id);
    let ctx = setup(&env, Some(oracle_id), 100); // 1% tolerance

    register_symbols(&ctx, &env);
    oracle.set_price(&ReflectorAsset::Other(Symbol::new(&env, "XLM")), &100);
    oracle.set_price(&ReflectorAsset::Other(Symbol::new(&env, "USDC")), &100);

    ctx.vault.deposit(&ctx.party_a, &ctx.token_a, &1_000);
    ctx.vault.deposit(&ctx.party_b, &ctx.token_b, &2_000);

    // Same price for both tokens, but amounts imply a 2x mismatch in value
    // exchanged — far beyond the 1% tolerance (both signed limits allow it).
    let result = ctx.vault.try_settle(
        &ctx.enclave_id,
        &ctx.engine,
        &ctx.order_a(1_000, 1_000),
        &1_000,
        &ctx.order_b(2_000, 1_000),
        &2_000,
    );
    assert_eq!(result, Err(Ok(Error::PriceDeviationTooHigh)));
    // Balances must be untouched by the failed settlement.
    assert_eq!(ctx.vault.balance_of(&ctx.token_a, &ctx.party_a), 1_000);
    assert_eq!(ctx.vault.balance_of(&ctx.token_b, &ctx.party_b), 2_000);
}

/// With the price check enabled, a token the admin never mapped to a
/// Reflector symbol must be rejected, not silently waved through.
#[test]
fn settle_rejects_token_without_reflector_symbol_when_check_enabled() {
    let env = Env::default();
    env.mock_all_auths();
    let oracle_id = env.register(MockOracle, ());
    let ctx = setup(&env, Some(oracle_id), 100);

    // Only token_a gets a symbol; token_b is left unconfigured.
    ctx.vault
        .set_reflector_symbol(&ctx.token_a, &Symbol::new(&env, "XLM"));

    ctx.vault.deposit(&ctx.party_a, &ctx.token_a, &1_000);
    ctx.vault.deposit(&ctx.party_b, &ctx.token_b, &2_000);

    let result = ctx.vault.try_settle(
        &ctx.enclave_id,
        &ctx.engine,
        &ctx.order_a(1_000, 2_000),
        &1_000,
        &ctx.order_b(2_000, 1_000),
        &2_000,
    );
    assert_eq!(result, Err(Ok(Error::PriceSymbolNotConfigured)));
    assert_eq!(ctx.vault.balance_of(&ctx.token_a, &ctx.party_a), 1_000);
    assert_eq!(ctx.vault.balance_of(&ctx.token_b, &ctx.party_b), 2_000);
}

// --- settle_external, against stand-ins for Soroswap's router + aggregator.
// Only the logic is covered here (limits, crediting the measured output,
// fill tracking). Whether the vault's `authorize_as_current_contract` tree
// satisfies the REAL router/token auth checks can only be proven against the
// live contracts -- see docs/external-liquidity.md.

#[contract]
struct MockRouter;

#[contractimpl]
impl MockRouter {
    /// Pays `amount_in * rate` of the output token (default 2x).
    pub fn set_rate(env: Env, rate: i128) {
        env.storage().instance().set(&1u32, &rate);
    }

    pub fn router_pair_for(env: Env, _a: Address, _b: Address) -> Address {
        env.current_contract_address()
    }

    pub fn swap_exact_tokens_for_tokens(
        env: Env,
        amount_in: i128,
        _amount_out_min: i128,
        path: Vec<Address>,
        to: Address,
        _deadline: u64,
    ) -> Vec<i128> {
        to.require_auth();
        let rate: i128 = env.storage().instance().get(&1u32).unwrap_or(2);
        let me = env.current_contract_address();
        TokenClient::new(&env, &path.get(0).unwrap()).transfer(&to, &me, &amount_in);
        let out = amount_in * rate;
        TokenClient::new(&env, &path.get(path.len() - 1).unwrap()).transfer(&me, &to, &out);
        vec![&env, amount_in, out]
    }
}

#[contract]
struct MockAggregator;

#[contractimpl]
impl MockAggregator {
    pub fn set_router(env: Env, router: Address) {
        env.storage().instance().set(&2u32, &router);
    }

    #[allow(clippy::too_many_arguments)]
    pub fn swap_exact_tokens_for_tokens(
        env: Env,
        _token_in: Address,
        _token_out: Address,
        amount_in: i128,
        _amount_out_min: i128,
        distribution: Vec<DexDistribution>,
        to: Address,
        deadline: u64,
    ) -> Vec<Vec<i128>> {
        to.require_auth();
        let router: Address = env.storage().instance().get(&2u32).unwrap();
        let leg = distribution.get(0).unwrap();
        let res = MockRouterClient::new(&env, &router)
            .swap_exact_tokens_for_tokens(&amount_in, &0, &leg.path, &to, &deadline);
        vec![&env, res]
    }
}

/// Registers the mock DEX with token_b liquidity and points the vault at it.
fn with_dex<'a>(env: &'a Env, ctx: &TestCtx<'a>) -> MockRouterClient<'a> {
    let router_id = env.register(MockRouter, ());
    let agg_id = env.register(MockAggregator, ());
    MockAggregatorClient::new(env, &agg_id).set_router(&router_id);
    StellarAssetClient::new(env, &ctx.token_b).mint(&router_id, &1_000_000);
    ctx.vault.set_dex(&agg_id, &router_id);
    MockRouterClient::new(env, &router_id)
}

const FAR_FUTURE: u64 = NOW_S + 3600;

#[test]
fn settle_external_swaps_and_credits_the_measured_output() {
    let env = Env::default();
    let ctx = setup(&env, None, 0);
    with_dex(&env, &ctx);
    ctx.vault.deposit(&ctx.party_a, &ctx.token_a, &1_000);

    // A gives 1000 a for >= 1500 b; the DEX pays 2x, so 2000 b arrive.
    let received = ctx.vault.settle_external(
        &ctx.enclave_id,
        &ctx.engine,
        &ctx.order_a(1_000, 1_500),
        &1_000,
        &1_500,
        &FAR_FUTURE,
    );

    assert_eq!(received, 2_000);
    assert_eq!(ctx.vault.balance_of(&ctx.token_a, &ctx.party_a), 0);
    // The trader gets everything that arrived, surplus over the minimum too.
    assert_eq!(ctx.vault.balance_of(&ctx.token_b, &ctx.party_a), 2_000);
    // The underlying tokens really moved: the vault now custodies token_b.
    assert_eq!(ctx.token_b_client.balance(&ctx.vault.address), 2_000);
}

#[test]
fn settle_external_rejects_output_below_the_signed_minimum() {
    let env = Env::default();
    let ctx = setup(&env, None, 0);
    let router = with_dex(&env, &ctx);
    router.set_rate(&1); // DEX pays only 1000 b, trader signed for >= 1500
    ctx.vault.deposit(&ctx.party_a, &ctx.token_a, &1_000);

    let result = ctx.vault.try_settle_external(
        &ctx.enclave_id,
        &ctx.engine,
        &ctx.order_a(1_000, 1_500),
        &1_000,
        &1_500,
        &FAR_FUTURE,
    );
    assert_eq!(result, Err(Ok(Error::InsufficientOutput)));
    assert_eq!(ctx.vault.balance_of(&ctx.token_a, &ctx.party_a), 1_000);
}

/// The engine may ask for a higher minimum, never a lower one than signed.
#[test]
fn settle_external_rejects_a_minimum_below_the_signed_limit_price() {
    let env = Env::default();
    let ctx = setup(&env, None, 0);
    with_dex(&env, &ctx);
    ctx.vault.deposit(&ctx.party_a, &ctx.token_a, &1_000);

    let result = ctx.vault.try_settle_external(
        &ctx.enclave_id,
        &ctx.engine,
        &ctx.order_a(1_000, 1_500),
        &1_000,
        &1_499,
        &FAR_FUTURE,
    );
    assert_eq!(result, Err(Ok(Error::OrderPriceViolated)));
}

#[test]
fn settle_external_requires_dex_config_engine_and_signature() {
    let env = Env::default();
    let ctx = setup(&env, None, 0);
    ctx.vault.deposit(&ctx.party_a, &ctx.token_a, &1_000);
    let order = ctx.order_a(1_000, 1_500);

    let unconfigured =
        ctx.vault.try_settle_external(&ctx.enclave_id, &ctx.engine, &order, &1_000, &1_500, &FAR_FUTURE);
    assert_eq!(unconfigured, Err(Ok(Error::DexNotConfigured)));

    with_dex(&env, &ctx);
    let impostor = Address::generate(&env);
    let wrong_engine =
        ctx.vault.try_settle_external(&ctx.enclave_id, &impostor, &order, &1_000, &1_500, &FAR_FUTURE);
    assert_eq!(wrong_engine, Err(Ok(Error::EngineMismatch)));

    let mut forged = order.clone();
    forged.give_amount = 2_000; // signature covers 1000
    let bad_sig =
        ctx.vault.try_settle_external(&ctx.enclave_id, &ctx.engine, &forged, &1_000, &1_500, &FAR_FUTURE);
    assert!(bad_sig.is_err());
}

#[test]
fn settle_external_partial_fills_cannot_exceed_the_signed_size() {
    let env = Env::default();
    let ctx = setup(&env, None, 0);
    with_dex(&env, &ctx);
    ctx.vault.deposit(&ctx.party_a, &ctx.token_a, &1_000);
    let order = ctx.order_a(1_000, 1_500);

    ctx.vault.settle_external(&ctx.enclave_id, &ctx.engine, &order, &400, &600, &FAR_FUTURE);
    ctx.vault.settle_external(&ctx.enclave_id, &ctx.engine, &order, &600, &900, &FAR_FUTURE);
    assert_eq!(ctx.vault.balance_of(&ctx.token_b, &ctx.party_a), 2_000);

    ctx.vault.deposit(&ctx.party_a, &ctx.token_a, &10);
    let over = ctx.vault.try_settle_external(&ctx.enclave_id, &ctx.engine, &order, &1, &2, &FAR_FUTURE);
    assert_eq!(over, Err(Ok(Error::OrderOverfilled)));
}
