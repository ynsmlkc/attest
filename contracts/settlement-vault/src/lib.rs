#![no_std]

mod types;

use soroban_sdk::{contract, contracterror, contractimpl, token, Address, BytesN, Env};
use types::{AttestationVerifierClient, BalanceKey, DataKey, ReflectorAsset, ReflectorClient};

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
}

const ADMIN: &str = "admin";
const VERIFIER: &str = "verifier";
const ORACLE: &str = "oracle";
const MAX_DEV_BPS: &str = "max_dev";

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

    /// Settles a matched trade the TEE computed off-chain: `party_a` gives
    /// `amount_a` of `token_a`, `party_b` gives `amount_b` of `token_b`, and
    /// the vault atomically swaps their internal balances.
    ///
    /// Gated on `enclave_id` being genuinely verified
    /// (`AttestationVerifier::is_registered`) AND `engine` matching that
    /// enclave's registered operator address (`get_engine_address`) — this
    /// is the whole point of the project: SDF's prototype left contract-
    /// level attestation verification undone. `max_deviation_bps` (set at
    /// `initialize`) is a second, independent guard against a compromised
    /// engine key settling trades at an off-market price.
    #[allow(clippy::too_many_arguments)]
    pub fn settle(
        env: Env,
        enclave_id: BytesN<32>,
        engine: Address,
        token_a: Address,
        party_a: Address,
        amount_a: i128,
        token_b: Address,
        party_b: Address,
        amount_b: i128,
    ) -> Result<(), Error> {
        if amount_a <= 0 || amount_b <= 0 {
            return Err(Error::InvalidAmount);
        }
        engine.require_auth();

        let verifier: Address = env
            .storage()
            .instance()
            .get(&VERIFIER)
            .ok_or(Error::NotInitialized)?;
        let verifier_client = AttestationVerifierClient::new(&env, &verifier);
        if !verifier_client.is_registered(&enclave_id) {
            return Err(Error::EnclaveNotRegistered);
        }
        if verifier_client.get_engine_address(&enclave_id) != Some(engine) {
            return Err(Error::EngineMismatch);
        }

        Self::check_price_deviation(&env, &token_a, amount_a, &token_b, amount_b)?;

        // Atomic swap of internal balances — no real token movement here,
        // deposits/withdrawals already moved the underlying assets.
        Self::sub_balance(&env, &token_a, &party_a, amount_a)?;
        Self::add_balance(&env, &token_a, &party_b, amount_a)?;
        Self::sub_balance(&env, &token_b, &party_b, amount_b)?;
        Self::add_balance(&env, &token_b, &party_a, amount_b)?;

        Ok(())
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

    /// Compares notional value exchanged on each side
    /// (`amount * reference_price`) against Reflector's reference prices.
    /// If either asset has no Reflector price (e.g. a demo token Reflector
    /// doesn't track) or the check is disabled (`max_deviation_bps == 0`),
    /// this is skipped — it's a defense-in-depth guard, not the primary
    /// trust anchor (attestation is), so it degrades gracefully rather than
    /// blocking settlement outright.
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

        let oracle_client = ReflectorClient::new(env, &oracle);
        let price_a = oracle_client.lastprice(&ReflectorAsset::Stellar(token_a.clone()));
        let price_b = oracle_client.lastprice(&ReflectorAsset::Stellar(token_b.clone()));

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

mod test;
