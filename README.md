# Attest

On-chain TEE attestation verification for Soroban — the piece SDF's own
dark pool research prototype flagged as missing. Full background:
`stellaridea2.md` (idea folder) and `attest-hackathon-plan.md`.

## Status

**Day 1-2 of the 12-13 day pre-hackathon build** (see `attest-hackathon-plan.md` §3).

- `contracts/attestation-verifier` — deployed and tested on testnet:
  `CDIDFYVVTEKQSXTQ5H26I47JYIQMUQBIVDLMRXMBYXIT752CJWRRU2NY`
- `initialize`, `verify_quote`, `register_verified_enclave`, `is_registered`
  all implemented. Both `verify_quote` and `register_verified_enclave` are
  proven — live, on testnet, not just in unit tests — against a real,
  Intel-signed TDX v4 attestation quote (Automata's public test vector):
  - the real quote's signature verifies via Soroban's native
    `secp256r1_verify` (CAP-0051) — the correct primitive, confirmed
    against Intel's public DCAP docs (ECDSA over NIST P-256)
  - the measurement compared against is extracted directly from the raw
    signed payload (offset 184, 48 bytes — TDX's MRTD register is
    SHA-384-sized, not 32 as an earlier draft assumed), not trusted from a
    separate caller-supplied field
  - a tampered payload or wrong measurement is genuinely rejected, checked
    live on testnet
  - `register_verified_enclave` runs the same check internally before
    writing storage — it can no longer be called with unverified data (an
    earlier draft had this gap: registration didn't check anything)
  - along the way: Intel's raw quote signature was in ECDSA high-s form;
    Soroban's `secp256r1_verify` requires low-s (anti-malleability, same
    convention as Bitcoin/Ethereum). Whoever relays a quote on-chain needs
    to normalize `s` first — see `test.rs` doc comment.
- **Not yet done:** full signature-chain-to-Root-CA (stretch goal),
  `SettlementVault` contract, TEE deployment on Phala Cloud, `report_data`
  binding (currently unused — meant to tie a quote to one specific running
  instance, not just "a" TDX enclave with the right code).

## Build

```bash
stellar contract build
cargo test --manifest-path contracts/attestation-verifier/Cargo.toml
```

## License

MIT
