#![no_std]

mod types;

use soroban_sdk::auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation};
use soroban_sdk::{
    contract, contracterror, contractimpl, token, vec, Address, Bytes, BytesN, Env, IntoVal,
    Symbol,
};
use types::{
    AggregatorClient, AttestationVerifierClient, BalanceKey, DataKey, DexDistribution, Protocol,
    ReflectorAsset, ReflectorClient, SignedOrder, SoroswapRouterClient,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    /// `enclave_id` isn't a registered, attestation-verified TEE —
    /// exactly the check SDF's own prototype left undone (stellaridea2.md
    /// §0/§3.2).
    EnclaveNotRegistered = 3,
    /// The caller isn't the wallet that enclave registered as its operator.
    EngineMismatch = 4,
    InsufficientBalance = 5,
    /// The settled trade's implied value sits further from Reflector's
    /// reference price than `max_deviation_bps` allows.
    PriceDeviationTooHigh = 6,
    Overflow = 7,
    InvalidAmount = 8,
    /// The price-deviation check is enabled but one of the traded tokens has
    /// no Reflector symbol registered (`set_reflector_symbol`), so the guard
    /// can't run. Fails closed rather than silently skipping.
    PriceSymbolNotConfigured = 9,
    /// The order's party never registered an order-signing key
    /// (`set_order_key`), so its signature can't be checked.
    OrderKeyNotSet = 10,
    /// The order's `ts` is too old, or implausibly far in the future.
    OrderExpired = 11,
    /// Settling this fill would exceed the amount the trader signed for.
    OrderOverfilled = 12,
    /// The fill gives the trader worse than their signed limit price.
    OrderPriceViolated = 13,
    /// The two orders aren't each other's opposite (tokens don't line up).
    OrderMismatch = 14,
    /// `settle_external` was called before the admin set the aggregator and
    /// router (`set_dex`).
    DexNotConfigured = 15,
    /// The external swap returned less than the trader's signed minimum.
    InsufficientOutput = 16,
}

/// Last line of every signed order (message v3). Signing it is the trader's
/// consent to the matching engine sending an unmatched remainder to external
/// liquidity -- there is no per-order switch, it is how this venue works, and
/// the wallet prompt shows it. The limit price still binds every such fill
/// (`consume_order`). Must stay byte-identical to `ROUTING_CLAUSE` in
/// services/matching-engine/index.js and web/src/lib/orderSigning.ts.
const ROUTING_CLAUSE: &[u8] = b"\nrouting:pool first, then Soroswap at your limit or better";

/// An order older than this is rejected on-chain. Also bounds how long the
/// per-order `Filled` record must stay alive (see `ORDER_RECORD_TTL`).
const MAX_ORDER_AGE_MS: u64 = 7 * 24 * 60 * 60 * 1000;
/// Tolerated clock skew for an order stamped slightly ahead of the ledger.
const MAX_ORDER_FUTURE_MS: u64 = 10 * 60 * 1000;
/// Ledgers (~5s each) to keep `Filled`/`OrderKey` entries alive: comfortably
/// longer than MAX_ORDER_AGE_MS, so an entry can't be archived (and read
/// back as "0 filled") while its order is still valid.
const ORDER_RECORD_TTL: u32 = 30 * 17_280;

const ADMIN: &str = "admin";
const VERIFIER: &str = "verifier";
const ORACLE: &str = "oracle";
const MAX_DEV_BPS: &str = "max_dev";
const AGGREGATOR: &str = "aggregator";
const DEX_ROUTER: &str = "dex_router";

#[contract]
pub struct SettlementVault;

#[contractimpl]
impl SettlementVault {
    /// `attestation_verifier` is the deployed AttestationVerifier contract
    /// `settle` will check enclaves against. `price_oracle` is a Reflector
    /// (or Reflector-compatible SEP-40) contract; `max_deviation_bps` bounds
    /// how far a settled trade's implied value may sit from that oracle's
    /// reference price before `settle` rejects it — a second, independent
    /// guard in case a registered engine's signing key is ever compromised.
    /// Pass `0` to disable the price check (e.g. for demo tokens Reflector
    /// doesn't track).
    pub fn initialize(
        env: Env,
        admin: Address,
        attestation_verifier: Address,
        price_oracle: Address,
        max_deviation_bps: u32,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&ADMIN) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&ADMIN, &admin);
        env.storage()
            .instance()
            .set(&VERIFIER, &attestation_verifier);
        env.storage().instance().set(&ORACLE, &price_oracle);
        env.storage()
            .instance()
            .set(&MAX_DEV_BPS, &max_deviation_bps);
        Ok(())
    }

    /// Deposits `amount` of `token` into the vault, credited to
    /// `depositor`'s internal balance. A real SEP-41 token transfer —
    /// deposits and withdrawals are public on-chain activity (same as
    /// PNLX's and SDF's own dark pool design); only the *matching* that
    /// happens between deposit and withdrawal is private, inside the TEE.
    pub fn deposit(env: Env, depositor: Address, token: Address, amount: i128) -> Result<(), Error> {
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        depositor.require_auth();
        token::Client::new(&env, &token).transfer(
            &depositor,
            &env.current_contract_address(),
            &amount,
        );
        Self::add_balance(&env, &token, &depositor, amount)
    }

    /// Withdraws `amount` of `token` from `owner`'s internal balance back
    /// to their wallet.
    pub fn withdraw(env: Env, owner: Address, token: Address, amount: i128) -> Result<(), Error> {
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        owner.require_auth();
        Self::sub_balance(&env, &token, &owner, amount)?;
        token::Client::new(&env, &token).transfer(
            &env.current_contract_address(),
            &owner,
            &amount,
        );
        Ok(())
    }

    /// Tells `check_price_deviation` which Reflector symbol (its
    /// `Other(Symbol)` pool — see `ReflectorSymbol`'s doc comment for why
    /// not `Stellar(Address)`) to look `token` up under. Admin-only: an
    /// attacker who could set an arbitrary symbol for someone else's token
    /// could point the price check at an unrelated, favorable market.
    pub fn set_reflector_symbol(env: Env, token: Address, symbol: Symbol) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::ReflectorSymbol(token), &symbol);
        Ok(())
    }

    /// Links `key` (an ed25519 public key) as the key `party` signs orders
    /// with. Authorized by `party`'s own Address, so nobody can set or change
    /// it for someone else. For a normal wallet, `key` is simply the raw
    /// public key behind the G... address, so Freighter's `signMessage`
    /// (SEP-0053) signatures verify against it.
    pub fn set_order_key(env: Env, party: Address, key: BytesN<32>) {
        party.require_auth();
        let k = DataKey::OrderKey(party);
        env.storage().persistent().set(&k, &key);
        env.storage()
            .persistent()
            .extend_ttl(&k, ORDER_RECORD_TTL, ORDER_RECORD_TTL);
    }

    pub fn get_order_key(env: Env, party: Address) -> Option<BytesN<32>> {
        env.storage().persistent().get(&DataKey::OrderKey(party))
    }

    /// Settles a matched trade the TEE computed off-chain: `order_a.party`
    /// gives `fill_a` of `order_a.give_token`, `order_b.party` gives `fill_b`
    /// of `order_b.give_token`, and the vault atomically swaps their internal
    /// balances. Supports partial fills: an order can be settled across
    /// several calls until its signed `give_amount` is used up.
    ///
    /// Two independent gates:
    /// 1. **The engine** -- `enclave_id` must be genuinely verified
    ///    (`AttestationVerifier::is_registered`) AND `engine` must be that
    ///    enclave's registered operator (`get_engine_address`). This is the
    ///    whole point of the project: SDF's prototype left contract-level
    ///    attestation verification undone.
    /// 2. **The traders** -- each order carries the trader's own SEP-0053
    ///    signature, verified here against the key they registered
    ///    (`set_order_key`). The vault tracks how much of each order is
    ///    already filled and enforces its limit price, so even a compromised
    ///    engine key can only ever execute what traders signed for.
    ///
    /// `max_deviation_bps` (set at `initialize`) remains a third guard
    /// against off-market trades.
    #[allow(clippy::too_many_arguments)]
    pub fn settle(
        env: Env,
        enclave_id: BytesN<32>,
        engine: Address,
        order_a: SignedOrder,
        fill_a: i128,
        order_b: SignedOrder,
        fill_b: i128,
    ) -> Result<(), Error> {
        if fill_a <= 0 || fill_b <= 0 {
            return Err(Error::InvalidAmount);
        }
        // The two orders must be each other's opposite.
        if order_a.give_token != order_b.want_token || order_b.give_token != order_a.want_token {
            return Err(Error::OrderMismatch);
        }
        let token_a = order_a.give_token.clone();
        let token_b = order_b.give_token.clone();
        // A same-asset trade is only ever a legitimate no-op self-match
        // (give X, receive X back) when both sides move the same amount —
        // README's self-match demo (5 XLM <-> 5 XLM) relies on exactly this.
        // token_a == token_b with differing amounts would otherwise let a
        // buggy/compromised engine transfer value between the two parties
        // while looking like a real two-asset swap.
        if token_a == token_b && fill_a != fill_b {
            return Err(Error::InvalidAmount);
        }
        engine.require_auth();

        Self::check_engine(&env, &enclave_id, &engine)?;

        // Each side gives `fill_x` and receives the other side's fill.
        Self::consume_order(&env, &enclave_id, &order_a, fill_a, fill_b)?;
        Self::consume_order(&env, &enclave_id, &order_b, fill_b, fill_a)?;

        Self::check_price_deviation(&env, &token_a, fill_a, &token_b, fill_b)?;

        // Atomic swap of internal balances — no real token movement here,
        // deposits/withdrawals already moved the underlying assets.
        Self::sub_balance(&env, &token_a, &order_a.party, fill_a)?;
        Self::add_balance(&env, &token_a, &order_b.party, fill_a)?;
        Self::sub_balance(&env, &token_b, &order_b.party, fill_b)?;
        Self::add_balance(&env, &token_b, &order_a.party, fill_b)?;

        Ok(())
    }

    /// Points `settle_external` at the Soroswap Aggregator and the Soroswap
    /// router its Soroswap adapter calls (`get_adapters` protocol 0). Admin-
    /// only and stored, never taken from a caller: the vault authorizes token
    /// transfers on these contracts' behalf, so an attacker-chosen address
    /// here would be a straight theft path.
    pub fn set_dex(env: Env, aggregator: Address, router: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage().instance().set(&AGGREGATOR, &aggregator);
        env.storage().instance().set(&DEX_ROUTER, &router);
        Ok(())
    }

    /// Routes (part of) a trader's signed order to external liquidity through
    /// the Soroswap Aggregator instead of matching it against another trader.
    /// The unmatched remainder of `order` gives `amount_in` of its
    /// `give_token`; the vault swaps it for the order's `want_token` and
    /// credits whatever it actually received, which is also the return value.
    ///
    /// Same two gates as `settle`: the attested engine, and the trader's own
    /// signature (`consume_order`). The signed limit price becomes the swap's
    /// minimum output, so the engine cannot accept a worse price than the
    /// trader signed -- it can only choose a *higher* `amount_out_min`.
    /// Everything privacy-relevant to know: unlike `settle`, this swap is an
    /// ordinary public on-chain trade.
    ///
    /// Only a single-hop Soroswap leg is built, by the vault itself (the
    /// engine doesn't supply the route), so the auth the vault grants for the
    /// token transfer is exactly `token_in.transfer(vault -> pair)`, with
    /// `pair` read from the admin-set router.
    #[allow(clippy::too_many_arguments)]
    pub fn settle_external(
        env: Env,
        enclave_id: BytesN<32>,
        engine: Address,
        order: SignedOrder,
        amount_in: i128,
        amount_out_min: i128,
        deadline: u64,
    ) -> Result<i128, Error> {
        if amount_in <= 0 || amount_out_min <= 0 {
            return Err(Error::InvalidAmount);
        }
        engine.require_auth();
        Self::check_engine(&env, &enclave_id, &engine)?;

        let aggregator: Address = env
            .storage()
            .instance()
            .get(&AGGREGATOR)
            .ok_or(Error::DexNotConfigured)?;
        let router: Address = env
            .storage()
            .instance()
            .get(&DEX_ROUTER)
            .ok_or(Error::DexNotConfigured)?;

        let token_in = order.give_token.clone();
        let token_out = order.want_token.clone();
        if token_in == token_out {
            return Err(Error::OrderMismatch);
        }

        // Trader signed for this size and at least this price.
        Self::consume_order(&env, &enclave_id, &order, amount_in, amount_out_min)?;
        Self::sub_balance(&env, &token_in, &order.party, amount_in)?;

        let vault = env.current_contract_address();
        let path = vec![&env, token_in.clone(), token_out.clone()];
        let pair = SoroswapRouterClient::new(&env, &router).router_pair_for(&token_in, &token_out);

        // Credit what actually arrived, not what the aggregator reports. Read
        // before granting auth: the grant must sit right before the call it
        // covers, with no other cross-contract call in between.
        let out_token = token::Client::new(&env, &token_out);
        let before = out_token.balance(&vault);

        let distribution = vec![
            &env,
            DexDistribution {
                protocol_id: Protocol::Soroswap,
                path: path.clone(),
                parts: 1,
                bytes: None,
            },
        ];

        // What the vault must grant. Verified against the host's auth
        // tracker (soroban-env-host `InvocationTracker`), not guessed:
        //  * The aggregator is the vault's *direct* callee, so its own
        //    `to.require_auth()` is satisfied implicitly and never advances
        //    the tracker -- the tree must NOT be rooted at the aggregator.
        //  * The Soroswap leg makes the aggregator call
        //    router.swap_exact_tokens_for_tokens(amount, 0, path, vault, deadline)
        //    -- the first call that needs a real grant -- so that is the root,
        //    and the router's pull `token_in.transfer(vault -> pair)` is its child.
        //  * A grant only lives until the vault's *next* sub-call returns, so
        //    no other cross-contract call may sit between this and the
        //    aggregator call below.
        env.authorize_as_current_contract(vec![
            &env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: router,
                    fn_name: Symbol::new(&env, "swap_exact_tokens_for_tokens"),
                    args: (amount_in, 0_i128, path, vault.clone(), deadline).into_val(&env),
                },
                sub_invocations: vec![
                    &env,
                    InvokerContractAuthEntry::Contract(SubContractInvocation {
                        context: ContractContext {
                            contract: token_in.clone(),
                            fn_name: Symbol::new(&env, "transfer"),
                            args: (vault.clone(), pair, amount_in).into_val(&env),
                        },
                        sub_invocations: vec![&env],
                    }),
                ],
            }),
        ]);

        AggregatorClient::new(&env, &aggregator).swap_exact_tokens_for_tokens(
            &token_in,
            &token_out,
            &amount_in,
            &amount_out_min,
            &distribution,
            &vault,
            &deadline,
        );
        let received = out_token.balance(&vault) - before;
        if received < amount_out_min {
            return Err(Error::InsufficientOutput);
        }

        Self::check_price_deviation(&env, &token_in, amount_in, &token_out, received)?;
        Self::add_balance(&env, &token_out, &order.party, received)?;
        Ok(received)
    }

    pub fn balance_of(env: Env, token: Address, owner: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(BalanceKey { token, owner }))
            .unwrap_or(0)
    }

    fn add_balance(env: &Env, token: &Address, owner: &Address, amount: i128) -> Result<(), Error> {
        let key = DataKey::Balance(BalanceKey {
            token: token.clone(),
            owner: owner.clone(),
        });
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        let updated = current.checked_add(amount).ok_or(Error::Overflow)?;
        env.storage().persistent().set(&key, &updated);
        Ok(())
    }

    fn sub_balance(env: &Env, token: &Address, owner: &Address, amount: i128) -> Result<(), Error> {
        let key = DataKey::Balance(BalanceKey {
            token: token.clone(),
            owner: owner.clone(),
        });
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if current < amount {
            return Err(Error::InsufficientBalance);
        }
        env.storage().persistent().set(&key, &(current - amount));
        Ok(())
    }

    /// Gate 1, shared by `settle` and `settle_external`: `enclave_id` is a
    /// genuinely attested enclave and `engine` is its registered operator.
    fn check_engine(env: &Env, enclave_id: &BytesN<32>, engine: &Address) -> Result<(), Error> {
        let verifier: Address = env
            .storage()
            .instance()
            .get(&VERIFIER)
            .ok_or(Error::NotInitialized)?;
        let verifier_client = AttestationVerifierClient::new(env, &verifier);
        if !verifier_client.is_registered(enclave_id) {
            return Err(Error::EnclaveNotRegistered);
        }
        if verifier_client.get_engine_address(enclave_id).as_ref() != Some(engine) {
            return Err(Error::EngineMismatch);
        }
        Ok(())
    }

    /// Verifies one side's signed order and records the fill against it:
    /// the trader's signature over the canonical order text, freshness, the
    /// remaining unfilled amount, and the signed limit price.
    fn consume_order(
        env: &Env,
        enclave_id: &BytesN<32>,
        order: &SignedOrder,
        give_fill: i128,
        receive_fill: i128,
    ) -> Result<(), Error> {
        if order.give_amount <= 0 || order.want_amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let now_ms = env.ledger().timestamp().saturating_mul(1000);
        if order.ts > now_ms.saturating_add(MAX_ORDER_FUTURE_MS)
            || now_ms.saturating_sub(order.ts) > MAX_ORDER_AGE_MS
        {
            return Err(Error::OrderExpired);
        }

        let key: BytesN<32> = env
            .storage()
            .persistent()
            .get(&DataKey::OrderKey(order.party.clone()))
            .ok_or(Error::OrderKeyNotSet)?;
        let digest = order_digest(env, &env.current_contract_address(), enclave_id, order);
        // Traps (fails the whole transaction) on a bad signature.
        env.crypto()
            .ed25519_verify(&key, &Bytes::from_array(env, &digest.to_array()), &order.signature);

        // Never settle more than the trader signed for...
        let filled_key = DataKey::Filled(digest);
        let filled: i128 = env.storage().persistent().get(&filled_key).unwrap_or(0);
        let new_filled = filled.checked_add(give_fill).ok_or(Error::Overflow)?;
        if new_filled > order.give_amount {
            return Err(Error::OrderOverfilled);
        }
        // ...or at a worse price than they signed for:
        // receive/give >= want_amount/give_amount.
        let got = receive_fill
            .checked_mul(order.give_amount)
            .ok_or(Error::Overflow)?;
        let needed = give_fill
            .checked_mul(order.want_amount)
            .ok_or(Error::Overflow)?;
        if got < needed {
            return Err(Error::OrderPriceViolated);
        }

        env.storage().persistent().set(&filled_key, &new_filled);
        env.storage()
            .persistent()
            .extend_ttl(&filled_key, ORDER_RECORD_TTL, ORDER_RECORD_TTL);
        Ok(())
    }

    /// Compares notional value exchanged on each side
    /// (`amount * reference_price`) against Reflector's reference prices.
    /// Skipped only when the check is disabled (`max_deviation_bps == 0`)
    /// or Reflector has no current price under a registered symbol —
    /// it's a defense-in-depth guard, not the primary trust anchor
    /// (attestation is), so a temporary oracle gap degrades gracefully.
    /// A token with NO registered Reflector symbol is different: that's an
    /// admin configuration gap, and it is rejected
    /// (`PriceSymbolNotConfigured`) so a newly added asset can't bypass the
    /// guard just because nobody called `set_reflector_symbol` for it.
    ///
    /// 2026-09-13 fix: queries Reflector's `Other(Symbol)` pool (via
    /// `set_reflector_symbol`'s admin-set mapping), not `Stellar(Address)`
    /// — that pool doesn't track this project's actual traded assets at
    /// all (see `ReflectorSymbol`'s doc comment in types.rs), which made
    /// this guard a silent no-op for every real trade before this fix.
    fn check_price_deviation(
        env: &Env,
        token_a: &Address,
        amount_a: i128,
        token_b: &Address,
        amount_b: i128,
    ) -> Result<(), Error> {
        let max_deviation_bps: u32 = env.storage().instance().get(&MAX_DEV_BPS).unwrap_or(0);
        if max_deviation_bps == 0 {
            return Ok(());
        }
        let oracle: Address = match env.storage().instance().get(&ORACLE) {
            Some(o) => o,
            None => return Ok(()),
        };

        let symbol_a: Option<Symbol> = env
            .storage()
            .instance()
            .get(&DataKey::ReflectorSymbol(token_a.clone()));
        let symbol_b: Option<Symbol> = env
            .storage()
            .instance()
            .get(&DataKey::ReflectorSymbol(token_b.clone()));
        // Fail closed: with the check enabled, a token the admin never
        // mapped to a Reflector symbol must not silently bypass the only
        // second line of defense against a compromised engine key.
        let (symbol_a, symbol_b) = match (symbol_a, symbol_b) {
            (Some(a), Some(b)) => (a, b),
            _ => return Err(Error::PriceSymbolNotConfigured),
        };

        let oracle_client = ReflectorClient::new(env, &oracle);
        let price_a = oracle_client.lastprice(&ReflectorAsset::Other(symbol_a));
        let price_b = oracle_client.lastprice(&ReflectorAsset::Other(symbol_b));

        let (price_a, price_b) = match (price_a, price_b) {
            (Some(a), Some(b)) => (a.price, b.price),
            _ => return Ok(()),
        };

        let value_a = amount_a.checked_mul(price_a).ok_or(Error::Overflow)?;
        let value_b = amount_b.checked_mul(price_b).ok_or(Error::Overflow)?;
        let diff = (value_a - value_b).abs();
        let larger = value_a.max(value_b);
        let max_diff = larger
            .checked_mul(max_deviation_bps as i128)
            .ok_or(Error::Overflow)?
            / 10_000;

        if diff > max_diff {
            return Err(Error::PriceDeviationTooHigh);
        }
        Ok(())
    }
}

/// Appends raw ASCII to `m`.
fn push_bytes(m: &mut Bytes, s: &[u8]) {
    m.append(&Bytes::from_slice(m.env(), s));
}

/// Appends a Soroban `String` (an address's strkey here) to `m`.
fn push_string(m: &mut Bytes, s: &soroban_sdk::String) {
    let len = s.len() as usize;
    let mut buf = [0u8; 96];
    s.copy_into_slice(&mut buf[..len]);
    push_bytes(m, &buf[..len]);
}

/// Appends `n` in decimal, exactly as JavaScript prints an integer Number.
fn push_decimal(m: &mut Bytes, mut n: u128) {
    let mut buf = [0u8; 40];
    let mut i = buf.len();
    loop {
        i -= 1;
        buf[i] = b'0' + (n % 10) as u8;
        n /= 10;
        if n == 0 {
            break;
        }
    }
    push_bytes(m, &buf[i..]);
}

/// Appends `bytes` as lowercase hex.
fn push_hex(m: &mut Bytes, bytes: &[u8]) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for b in bytes {
        push_bytes(m, &[HEX[(b >> 4) as usize], HEX[(b & 0x0f) as usize]]);
    }
}

/// SHA-256 of what a trader actually signs (message v3): SEP-0053's
/// `"Stellar Signed Message:\n" + message`, where `message` is the same
/// human-readable order text the web client shows in Freighter and the
/// matching engine independently rebuilds (`canonicalOrderMessage` in
/// services/matching-engine/index.js and web/src/lib/orderSigning.ts -- all
/// three MUST stay byte-identical). Binding the vault and enclave ids into
/// the text means a signature is only ever valid for this deployment.
///
/// Doubles as the order's unique id for fill tracking.
pub fn order_digest(
    env: &Env,
    vault: &Address,
    enclave_id: &BytesN<32>,
    order: &SignedOrder,
) -> BytesN<32> {
    let mut m = Bytes::new(env);
    push_bytes(&mut m, b"Stellar Signed Message:\nAttest order v3\nvault:");
    push_string(&mut m, &vault.to_string());
    push_bytes(&mut m, b"\nenclave:");
    push_hex(&mut m, &enclave_id.to_array());
    push_bytes(&mut m, b"\nparty:");
    push_string(&mut m, &order.party.to_string());
    push_bytes(&mut m, b"\ngive:");
    push_string(&mut m, &order.give_token.to_string());
    push_bytes(&mut m, b":");
    push_decimal(&mut m, order.give_amount as u128);
    push_bytes(&mut m, b"\nwant:");
    push_string(&mut m, &order.want_token.to_string());
    push_bytes(&mut m, b":");
    push_decimal(&mut m, order.want_amount as u128);
    push_bytes(&mut m, b"\nts:");
    push_decimal(&mut m, order.ts as u128);
    push_bytes(&mut m, ROUTING_CLAUSE);
    env.crypto().sha256(&m).to_bytes()
}

mod test;
