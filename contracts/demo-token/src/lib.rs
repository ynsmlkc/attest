#![no_std]

//! A minimal SEP-41-shaped token — NOT one of Attest's deliverables. Exists
//! only so the live testnet SettlementVault demo (see repo README) has two
//! real, independently transferable balances without needing classic
//! Stellar trustline setup. Implements just the subset of the token
//! interface `soroban_sdk::token::Client` actually calls
//! (`transfer`, `balance`), which is enough for SettlementVault's
//! `deposit`/`withdraw` to work against it unmodified.

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
enum DataKey {
    Admin,
    Balance(Address),
}

#[contract]
pub struct DemoToken;

#[contractimpl]
impl DemoToken {
    pub fn initialize(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    pub fn mint(env: Env, to: Address, amount: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        let key = DataKey::Balance(to);
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(current + amount));
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        let from_key = DataKey::Balance(from);
        let from_balance: i128 = env.storage().persistent().get(&from_key).unwrap_or(0);
        assert!(from_balance >= amount, "insufficient balance");
        env.storage()
            .persistent()
            .set(&from_key, &(from_balance - amount));

        let to_key = DataKey::Balance(to);
        let to_balance: i128 = env.storage().persistent().get(&to_key).unwrap_or(0);
        env.storage().persistent().set(&to_key, &(to_balance + amount));
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(id))
            .unwrap_or(0)
    }
}
