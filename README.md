# Attest

On-chain TEE attestation verification for Soroban — the piece SDF's own
dark pool research prototype flagged as missing. Full background:
`stellaridea2.md` (idea folder) and `attest-hackathon-plan.md`.

## Status

**Day 1-2 of the 12-13 day pre-hackathon build** (see `attest-hackathon-plan.md` §3).

- `contracts/attestation-verifier` — deployed and tested on testnet:
  `CAXDXPHXI7IV2W2YLJW3AYDRRLKCX5T3DZR6ZS6YZMRUKXGS7VLMBQ4N`
- `initialize`, `verify_quote`, `register_verified_enclave`, `is_registered`
  all implemented and callable. `verify_quote` does a real ECDSA
  secp256r1 check via Soroban's native `secp256r1_verify` host function —
  confirmed to be the correct primitive: Intel DCAP quotes are signed with
  NIST P-256, and Soroban has supported secp256r1 natively since CAP-0051.
- **Not yet done:** verifying against a real captured Intel attestation
  quote (next), full signature-chain-to-Root-CA (stretch goal),
  `SettlementVault` contract, TEE deployment on Phala Cloud.

## Build

```bash
stellar contract build
cargo test --manifest-path contracts/attestation-verifier/Cargo.toml
```

## License

MIT
