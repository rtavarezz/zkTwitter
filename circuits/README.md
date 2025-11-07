# zkTwitter Generation Membership Circuit

Privacy-preserving generation verification circuit that proves a user belongs to a specific generation (Gen Z, Millennial, etc.) without revealing their exact birth date.

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

### Public Inputs
- `selfNullifier` - Self Protocol nullifier (prevents duplicate passports)
- `sessionNonce` - Session-specific nonce (prevents replay attacks)
- `generationConfigHash` - Poseidon hash of generation table
- `targetGenerationId` - Which generation to prove (0=Gen Z, 1=Millennial, etc.)

### Private Inputs
- `generationConfig[15]` - Flattened generation table [id, min, max, ...]
- `birthYear` - User's birth year (from Self disclosure)
- `userIdentifier` - User ID from Self

### Outputs
- `isMember` - 1 if birth year ∈ generation range, 0 otherwise
- `claimHash` - Poseidon(userIdentifier, selfNullifier, generationId, sessionNonce)

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
