# zkTwitter Generation Membership Circuit

Privacy-preserving generation verification circuit that proves a user belongs to a specific generation (Gen Z, Millennial, etc.) without revealing their exact birth date. The repo also contains an experimental selective-social-proof circuit that proves a user follows ≥ N verified humans without revealing who those accounts are.

## Overview

This circuit consumes Self Protocol's passport verification proof and adds zkTwitter-specific logic:

- **Verifies** the user's birth year falls within the target generation range
- **Binds** the proof to a specific user session (prevents replay)
- **Hashes** the generation config (prevents silent table swaps)
- **Outputs** a claim hash tying the generation to the user without revealing DOB

## Architecture

```
Self Passport Proof → Self Verifier (off-circuit) → Birth Year
                                                        ↓
                        zkTwitter Circuit: Check Year ∈ Generation Range
                                                        ↓
                        Proof: "User is Gen Z" (no raw DOB exposed)
```

## Circuit Files

- `generation/generationMembership.circom` - Main circuit
- `generation/generationConfig.circom` - Config validation and bounds selection
- `generation/birthYearParser.circom` - Birth year validation
- `social/socialProof.circom` - Checks ≥N verified follows and emits a claim hash
- `social/merkleMembership.circom` - Poseidon Merkle inclusion helper
- `primitives/poseidon.circom` - Poseidon hash wrapper
- `primitives/comparators.circom` - Range check utilities

## Setup

### Prerequisites

```bash
# Install circom compiler
curl -L https://github.com/iden3/circom/releases/download/v2.1.5/circom-linux-amd64 -o circom
chmod +x circom
sudo mv circom /usr/local/bin/

# Install dependencies
npm install
```

### Compile Circuit

```bash
npm run compile
```

### Run Trusted Setup

```bash
npm run setup
```

This downloads powers of tau and generates the proving/verification keys.

## Usage

### 1. Generate Witness Data

First, capture a Self proof from your backend:

```bash
cd ../server
npm run build-generation-witness
```

This creates `server/tmp/generation-witness/<timestamp>_generation_witness.json`.

### 2. Build Circuit Input

```bash
npm run build-input
```

Converts the witness JSON into circuit input format at `build/input.json`.

### 3. Generate Proof

```bash
npm run prove
```

Outputs:
- `build/proof.json` - The zk-SNARK proof
- `build/public.json` - Public signals (claim hash, etc.)

## Circuit Inputs/Outputs

### Generation Circuit

**Public inputs**
- `selfNullifier` - Self Protocol nullifier (prevents duplicate passports)
- `sessionNonce` - Session-specific nonce (prevents replay attacks)
- `generationConfigHash` - Poseidon hash of generation table
- `targetGenerationId` - Which generation to prove (0=Gen Z, 1=Millennial, etc.)

**Private inputs**
- `generationConfig[15]` - Flattened generation table [id, min, max, ...]
- `birthYear` - User's birth year (from Self disclosure)
- `userIdentifier` - User ID from Self

**Outputs**
- `isMember` - 1 if birth year ∈ generation range, 0 otherwise
- `claimHash` - Poseidon(userIdentifier, selfNullifier, generationId, sessionNonce)

### Selective Social Proof Circuit

**Public inputs**
- `selfNullifier`
- `sessionNonce`
- `verifiedRoot` - Poseidon Merkle root of all verified accounts (Poseidon(selfNullifier))
- `minVerifiedNeeded` - Threshold for the N+ badge being claimed

**Private inputs**
- `followeeLeaves[N_MAX]` - Poseidon hashes of the verified accounts you follow
- `followeeIsPresent[N_MAX]` - Slot selectors (0 = unused, 1 = active)
- `merkleSiblings[N_MAX][DEPTH]` - Poseidon siblings for the verified-leaf path
- `merklePathBits[N_MAX][DEPTH]` - Direction bits for each level

**Outputs**
- `isQualified` - Becomes 1 when the counted verified follows ≥ `minVerifiedNeeded`
- `claimHash` - Poseidon(selfNullifier, sessionNonce, verifiedRoot, minVerifiedNeeded)

### Building the Social Proof Artifacts

The proving artifacts for `socialProof` are too large for git history, so each developer generates them locally.

1. `cd circuits/scripts`
2. Run `./compile-social.sh` to emit `build/socialProof_js/socialProof.wasm`
3. Run `./setup-social.sh` to produce `build/socialProof_final.zkey` and `build/socialProof_verification_key.json`
4. Copy the artifacts into the runtime targets:
   - `cp ../build/socialProof_js/socialProof.wasm ../../frontend/public/circuits/`
   - `cp ../build/socialProof_final.zkey ../../frontend/public/circuits/`
   - `cp ../build/socialProof_verification_key.json ../../server/circuits/social_proof_verification_key.json`

Only the verification key stays in git; `.zkey` files live in `.gitignore`, so rerun these steps whenever you clean the repo.

## Generation Config

Currently supports 5 generations (hardcoded for demo):

```javascript
Gen Z:       1997-2012 (id: 0)
Millennial:  1981-1996 (id: 1)
Gen X:       1965-1980 (id: 2)
Boomer:      1946-1964 (id: 3)
Silent:      1928-1945 (id: 4)
```

The config is hashed with Poseidon and verified inside the circuit to prevent tampering.

## Security Properties

1. **No DOB Leakage**: Birth year stays private, only range membership is proven
2. **Replay Protection**: Session nonce binds proof to specific login/registration
3. **Config Integrity**: Generation table hash prevents silent parameter changes
4. **Passport Uniqueness**: Self nullifier prevents same passport creating multiple proofs

## Integration with Backend

After generating a proof, send it to your backend:

```javascript
POST /proofs/generation
{
  "proof": { ... },
  "publicSignals": [ ... ],
  "claimHash": "0x..."
}
```

Backend verifies the proof using `verification_key.json` and stores the `claimHash`.

## Next Steps

- [ ] Implement Solidity verifier for on-chain verification
- [ ] Add SP1 zkVM wrapper for recursive proof aggregation
- [ ] Support dynamic generation configs (multi-version)
- [ ] Add expiry checks from Self passport data
- [ ] Ship browser witness builder + artifact pinning for social proof
- [ ] Automate Poseidon Merkle tree recomputation / rotation
