
# SP1 Integration: Aggregating Generation + Social Proofs

## TL;DR
SP1 combines two Groth16 proofs (generation and social) into a single recursive proof, reducing verification overhead and simplifying future on-chain verification.

## What This Does
Currently, zkTwitter checks two Groth16 proofs per user (generation and social). SP1 lets us aggregate both into a single recursive proof, cutting down verification overhead and making on-chain verification easier.

Flow: User generates both Groth16 proofs in the browser. Backend verifies them with snarkjs, then calls the SP1 program to aggregate metadata into one proof. The SP1 proof attests "I saw two valid generation and social proofs with matching session bindings."

## Status: Demo Mode
The integration works end-to-end in demo mode.

- **Backend verification**: Before SP1, the backend verifies both Groth16 proofs with snarkjs and the verification keys in `server/circuits/`. Invalid proofs are rejected in `/sp1/prove` before SP1 runs.

- **SP1 program validation**: The zkVM program checks structure and bindings—proofs are non-empty, public signals exist, claim hashes match, nullifiers bind, session nonce is present, generation ID and social level are in range. It then commits the aggregated public values (`selfNullifier`, `generationId`, `socialLevel`, `claimHash`).

- **Not yet**: The SP1 program does not re-verify Groth16 proofs inside the zkVM. It trusts the backend to check them first. This is cryptographically sound as long as the backend verifies proofs, but not a full recursive proof yet.

---

## How It Works

### Architecture

```
User generates both Groth16 proofs in browser  
→ POSTs to `/sp1/prove`  
→ Backend verifies both proofs (snarkjs)  
→ If valid, backend calls SP1 CLI  
→ SP1 CLI runs zkVM program  
→ zkVM checks structure, bindings, and commits aggregated public values  
→ CLI returns `{ proof, public_values, vk_hash }`  
→ Backend returns artifact to frontend  
→ Frontend calls `/sp1/verify`  
→ Backend persists aggregated badge
```

### What's Implemented

- **Infrastructure**: SP1 workspace at `sp1/` with zkVM program (`programs/aggregator/`) and host CLI (`cli/aggregator-cli/`). Backend routes at `/sp1/context`, `/sp1/prove`, `/sp1/verify`. Frontend page at `/sp1`. CLI can prove locally or via network (if you have PROVE tokens).
- **Backend Groth16 verification**: `/sp1/prove` loads both verification keys and runs snarkjs before SP1. Only valid proofs are aggregated. See `server/src/routes/sp1.ts` lines 143-170.
- **SP1 program validation**: `sp1/programs/aggregator/src/main.rs` checks all bindings and structure, then commits the four public values.
- **Error handling**: If `SP1_PROVER_BIN` is unset, backend returns a structured 503 so the frontend shows "SP1 not configured yet" instead of crashing.

### Proof Modes
The CLI supports four `--proof` modes:
- **Core**: STARK proof, fast to generate but large. Good for dev.
- **Compressed**: Constant-size STARK, smaller than core, similar proving time. Default for most use.
- **Groth16**: SNARK (~260 bytes), onchain verification ~270k gas, needs trusted setup. Best for on-chain.
- **Plonk**: SNARK (~868 bytes), no trusted setup, onchain ~300k gas, slowest. Use if you want no trust assumptions.

### Network Modes
- **Local**: Proves on your CPU. No PROVE tokens. Slow (30 min–2 hr). Use for testing.
- **Reserved**: Uses Succinct's hosted capacity. Needs PROVE tokens and `NETWORK_PRIVATE_KEY`. Faster, pay per proof.
- **Mainnet**: Succinct's auction-based prover network. Needs PROVE tokens and `NETWORK_PRIVATE_KEY`. Fast; production mode.

---

## Directory Layout

```
sp1/
├── programs/
│   └── aggregator/          SP1 zkVM program
│       ├── src/main.rs      Core aggregation logic
│       └── Cargo.toml       Dependencies
├── cli/
│   └── aggregator-cli/      Host-side binary
│       ├── src/main.rs      CLI implementation
│       └── Cargo.toml       SP1 SDK + dependencies
├── fixtures/
│   └── sample_input.json    Test payload
├── Cargo.toml               Workspace definition
└── README.md                Setup instructions
```

The zkVM program is in `programs/aggregator` (no-std Rust, runs in SP1 RISC-V VM). Input via stdin, output is committed public values.

The CLI wraps the SP1 SDK with two commands: `execute` (runs logic only, no proof) and `prove` (generates proof; slow unless using network).

---

## Usage

### Build the CLI
```bash
cd sp1
cargo build --release -p aggregator-cli
```
Builds both the zkVM program and CLI (ELF embedded via `include_elf!`). Takes a few minutes.

### Test Execution Without Proving
```bash
cargo run --release -p aggregator-cli -- execute fixtures/sample_input.json
```
Runs the zkVM logic only (no proof). Use to check input format and logic.

### Generate a Proof Locally
```bash
cargo run --release -p aggregator-cli -- prove fixtures/sample_input.json \
  --network local \
  --proof compressed
```
Creates a real SP1 proof on your CPU (slow, 30min–2hr). Output: `{ proof, public_values, vk_hash, metadata }`.

### Generate a Proof via Network
```bash
export NETWORK_PRIVATE_KEY="0x..."
cargo run --release -p aggregator-cli -- prove fixtures/sample_input.json \
  --network mainnet \
  --proof groth16
```
Submits a proof request to Succinct. Much faster, but needs PROVE tokens on Ethereum mainnet.

### Wire Up the Backend
```bash
export SP1_PROVER_BIN="$PWD/sp1/target/release/aggregator-cli"
export SP1_NETWORK="local"
export SP1_PROOF_MODE="compressed"

cd server
npm run dev
```
Backend shells out to CLI when `/sp1/prove` is called. If `SP1_PROVER_BIN` is unset, `/sp1/prove` returns 503.

---

## Next Steps

### Embed Groth16 Verification Inside SP1
Move Groth16 verification into the zkVM for true recursion. Steps:
- Add `sp1-verifier` to `sp1/programs/aggregator/Cargo.toml`:
  ```toml
  sp1-verifier = "5.2"
  ```
- Embed the verification keys:
  ```rust
  const GENERATION_VKEY: &[u8] = include_bytes!("../../../server/circuits/verification_key.json");
  const SOCIAL_VKEY: &[u8] = include_bytes!("../../../server/circuits/social_proof_verification_key.json");
  ```
- Call the verifier in the zkVM:
  ```rust
  let gen_vkey = serde_json::from_slice(GENERATION_VKEY).expect("Invalid gen vkey");
  let gen_valid = Groth16Verifier::verify(
      &gen_vkey,
      &payload.generation.proof,
      &payload.generation.public_signals
  );
  assert!(gen_valid, "Invalid generation proof");
  ```
  Repeat for the social proof. Rebuild with `cargo sp1 build --package aggregator --release`.

Proving time increases 2-3x, but SP1 now cryptographically proves both Groth16 proofs.

### Verify SP1 Proofs on Backend
Before persisting, backend should verify the SP1 proof:
- **Option A**: Write a Rust CLI (using sp1-sdk) to verify `{ proof, public_values, vk_hash }`, shell out from Node.
- **Option B**: Use Succinct's hosted verifier REST API.
Add verification before the DB transaction in `/sp1/verify`.

### Get PROVE Tokens for Network Proving
Local proving is slow. For production, use network proving:
1. Generate an Ethereum keypair (`cast wallet new`).
2. Get PROVE tokens on Ethereum mainnet (see Succinct docs).
3. Deposit PROVE tokens at https://explorer.succinct.xyz.
4. Export `NETWORK_PRIVATE_KEY` with your key.
5. Set `SP1_NETWORK=mainnet` and `SP1_PROOF_MODE=compressed` or `groth16`.
Costs depend on program complexity and market rates (see explorer).

---

## Security Model

**Demo mode**: Security relies on backend cryptographically verifying Groth16 proofs (snarkjs) before SP1. The zkVM checks structure and bindings. Trust assumption: backend must be honest and not bypassed.

**Production mode**: After embedding Groth16 verification in SP1, the SP1 proof itself attests the Groth16 proofs are valid. Backend just needs to verify the SP1 proof before persisting. No trust required in the backend for Groth16 verification. This is the full recursive proof model.

---

## Frontend Flow

User flow for SP1 aggregation:
1. User completes Self verification (`selfNullifier` stored).
2. User generates generation proof (`generationId`, `generationClaimHash` stored).
3. User generates social proof (`socialProofLevel`, `socialClaimHash` stored).
4. User visits `/sp1`.
5. Page calls `GET /sp1/context` (gets `{ selfNullifier, generationConfig, socialConfig, sessionNonce }`).
6. Page re-runs both circuits client-side with previous inputs to generate fresh Groth16 proofs.
7. Page calls `POST /sp1/prove` with both proofs, session nonce, claim hashes.
8. Backend verifies proofs, calls SP1 CLI.
9. CLI generates SP1 proof, returns `{ proof, public_values, vk_hash, metadata }`.
10. Backend returns artifact to frontend.
11. Frontend displays success and metadata.
12. Frontend calls `POST /sp1/verify` with artifact.
13. Backend checks session nonce, nullifier, persists badge.
14. Timeline/profile show SP1 aggregated badge.

Frontend must re-generate both proofs because SP1 needs the full Groth16 proof bytes.

---

## Files Modified for SP1 Integration

**Backend**:
- `server/src/routes/sp1.ts`: New routes for context, prove, verify. Groth16 verification before SP1.
- `server/src/services/sp1.ts`: Service for CLI calls.
- `server/src/index.ts`: Registers `/sp1` routes.

**Frontend**:
- `client/src/pages/Sp1Proof.tsx`: SP1 flow page.
- `client/src/App.tsx`: `/sp1` route and nav.

**Rust**:
- `sp1/programs/aggregator/src/main.rs`: zkVM validation logic.
- `sp1/cli/aggregator-cli/src/main.rs`: Host CLI.
- `sp1/Cargo.toml`: Workspace.
- `sp1/fixtures/sample_input.json`: Test data.

**Docs**:
- `sp1/README.md`: Setup/build.