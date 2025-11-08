# zkTwitter: Generation + Social-Proof Design

## Goal

Prove "I'm Gen Z" without revealing birth year and "I follow N+ verified accounts" without revealing who. Both proofs bind to Self passport via `selfNullifier`.

## Overview

Self verifies passport via TEE and on-chain registry. zkTwitter adds two circuits (generation + social) plus SP1 aggregation. Circuit details in [circuits/README.md](circuits/README.md).

## 1. Self Protocol Integration

Self mobile app scans passport -> TEE verifies signature -> on-chain registry stores commitment -> backend gets verified selfNullifier + birthYear during login. See [server/src/routes/auth.ts](server/src/routes/auth.ts).

Trust model: We trust Self's TEE and on-chain verification. Keeps our circuit simple (1k constraints vs 1-2M).

## 2. Generation Proof

```
Client                          Backend
  |                               |
  | GET /generation/context       |
  |------------------------------>|
  |      sessionNonce             |
  |<------------------------------|
  |                               |
  | Generate proof (snarkjs)      |
  | Private: birthYear            |
  | Public: selfNullifier, nonce  |
  |                               |
  | POST /generation/verify       |
  |------------------------------>|
  |          proof + signals      |
  |                               |
  |                        Verify Groth16
  |                        Check birthYear matches
  |                        Check nonce unused
  |                        Store generationId
  |                               |
  |           success             |
  |<------------------------------|
```

Circuit: [circuits/generation/generationMembership.circom](circuits/generation/generationMembership.circom)
Backend: [server/src/routes/generation.ts](server/src/routes/generation.ts)

## 3. Social Proof

```
Client                          Backend
  |                               |
  | GET /social/context           |
  |------------------------------>|
  |  verifiedRoot, nonce, minN    |
  |<------------------------------|
  |                               |
  | Build merkle witnesses        |
  | for followees                 |
  |                               |
  | Generate proof (snarkjs)      |
  | Proves N+ verified followees  |
  |                               |
  | POST /social/verify           |
  |------------------------------>|
  |          proof + signals      |
  |                               |
  |                        Verify Groth16
  |                        Check nonce unused
  |                        Store socialProofLevel
  |                               |
  |           success             |
  |<------------------------------|
```

Circuit: [circuits/social/socialProof.circom](circuits/social/socialProof.circom)
Backend: [server/src/routes/social.ts](server/src/routes/social.ts)

## 4. SP1 Aggregation

```
Client                          Backend                     SP1 CLI                zkVM
  |                               |                           |                      |
  | Generate gen + social proofs  |                           |                      |
  | (same sessionNonce)           |                           |                      |
  |                               |                           |                      |
  | POST /sp1/prove               |                           |                      |
  |------------------------------>|                           |                      |
  |        both proofs            |                           |                      |
  |                               |                           |                      |
  |                        Verify social proof                |                      |
  |                        Pack JSON payload                  |                      |
  |                               |                           |                      |
  |                               | Spawn aggregator-cli      |                      |
  |                               |-------------------------->|                      |
  |                               |                           |                      |
  |                               |                           | Load ELF             |
  |                               |                           | Build SP1Stdin       |
  |                               |                           |--------------------->|
  |                               |                           |                      |
  |                               |                           |         Validate structure
  |                               |                           |         Check nullifiers match
  |                               |                           |         Check nonce matches
  |                               |                           |         Commit public values
  |                               |                           |                      |
  |                               |                           | Generate proof       |
  |                               |                           | (execute: mock)      |
  |                               |                           | (groth16: 30min-2hr) |
  |                               |                           |<---------------------|
  |                               |                           |                      |
  |                               | Return SP1 artifact       |                      |
  |                               |<--------------------------|                      |
  |                               |                           |                      |
  |          SP1 proof data       |                           |                      |
  |<------------------------------|                           |                      |
  |                               |                           |                      |
  | POST /sp1/verify              |                           |                      |
  |------------------------------>|                           |                      |
  |                               |                           |                      |
  |                        Check nonce unused                 |                      |
  |                        Store gen + social                 |                      |
  |                               |                           |                      |
  |           success             |                           |                      |
  |<------------------------------|                           |                      |
```

zkVM: [sp1/programs/aggregator/src/main.rs](sp1/programs/aggregator/src/main.rs)
CLI: [sp1/cli/aggregator-cli/src/main.rs](sp1/cli/aggregator-cli/src/main.rs)
Backend: [server/src/routes/sp1.ts](server/src/routes/sp1.ts)

Demo mode: backend verifies Groth16 proofs, zkVM validates structure only (trusts backend).
Production: embed sp1-verifier in zkVM to verify proofs inside zkVM itself (no backend trust).

### Production TODOs
- Embed Groth16 verification in zkVM (removes backend trust)
- Use Succinct prover network (SP1_NETWORK=mainnet, reduces 30min to 5min)
- Cache ProverClient in daemon (saves 5-10s per request)
- Deploy SP1 verifier contract

## 5. Security

### Replay Prevention
sessionNonce in all proofs, backend checks nonce not reused. claimHash binds proof to (nullifier, nonce, metadata) tuple.

### Fake Birth Year Prevention
Backend stores birthYear from Self login. Generation circuit proves range membership, backend cross-checks stored birthYear matches claimed generation. User can't lie without changing selfNullifier (tied to passport).

### Config Tampering Prevention
generationConfigHash in public inputs, circuit recomputes and asserts match. Backend only accepts correct hash.

### Nullifier Reuse Prevention
Backend rejects duplicate selfNullifiers. Self verified nullifier uniqueness on-chain during registration.

## 6. References
- [circuits/README.md](circuits/README.md) - circuit specs, build scripts, threat model
- [server/src/routes/generation.ts](server/src/routes/generation.ts) - generation proof flow
- [server/src/routes/social.ts](server/src/routes/social.ts) - social proof flow
- [server/src/routes/sp1.ts](server/src/routes/sp1.ts) - SP1 aggregation flow
- [server/prisma/seed.ts](server/prisma/seed.ts) - sample accounts with all badge combinations
