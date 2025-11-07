# SP1 Aggregation Scaffold

This folder wires up the Succinct SP1 zkVM so we can collapse the Self passport → generation proof → social proof pipeline into a single recursive proof. The full flow requires the Succinct toolchain plus funded PROVE tokens, so the backend falls back to a mocked response when the prover binary is missing. Once you have access to the prover network, follow these steps and the existing `/sp1/*` routes/front-end page will begin producing real proofs.

## Directory Layout

```
sp1/
├── README.md                # this file
├── Cargo.toml               # workspace definition
├── programs/
│   └── aggregator/          # SP1 zkVM program that checks the two Groth16 proofs
└── cli/
    └── aggregator-cli/      # host-side binary that feeds inputs & requests proofs
```

The SP1 program itself lives in `programs/aggregator`. It reads a single JSON blob from stdin, verifies the hash commitments for the generation + social proofs, and commits `{ selfNullifier, generationId, socialProofLevel, claimHash }` to the public values list. **TODO:** wire in `sp1_verifier::Groth16Verifier` so the program fully re-verifies both Groth16 proofs inside SP1. The scaffolding is in place (see `TODO(sp1): embed groth16 verification`) but we need a bit more time to finish the wiring.

The host binary (`cli/aggregator-cli`) wraps `sp1_sdk` and exposes two subcommands:

| Command              | Description                                                                     |
| -------------------- | ------------------------------------------------------------------------------- |
| `cargo run --request`| Registers the program with Succinct and executes it locally for smoke testing.  |
| `cargo run --prove`  | Requests a compressed proof from the prover network (requires PROVE deposit).   |

You can point the backend to the CLI via the `SP1_PROVER_BIN` env var. If unset, `/sp1/prove` will short-circuit with a structured 503 so the front end can display “SP1 prover not configured yet”.

## Setup Instructions

1. **Install toolchain**
   ```bash
   cd sp1
   rustup component add rust-src
   cargo install cargo-sp1
   ```
2. **Build the zkVM program**
   ```bash
   cd sp1
   cargo sp1 build --package aggregator
   # ELF ends up at target/sp1/aggregator
   ```
3. **Configure prover network (optional but recommended)**
   - Generate a requester key (`cast wallet new`) and deposit PROVE per the [Succinct quickstart](https://docs.succinct.xyz/docs/sp1/prover-network/quickstart).
   - Export `NETWORK_PRIVATE_KEY` before running the CLI.
4. **Prove locally**
   ```bash
   cd sp1
   cargo run -p aggregator-cli -- request ./fixtures/sample_input.json
   ```
5. **Request a real proof**
   ```bash
   cd sp1
   NETWORK_PRIVATE_KEY=0x... cargo run -p aggregator-cli -- prove ./fixtures/sample_input.json
   ```
   The CLI writes `{ proofBytes, publicValues, vkeyHash }` to stdout, which matches what `/sp1/prove` expects.

6. **Wire backend**
   ```bash
   export SP1_PROVER_BIN="$PWD/target/release/aggregator-cli"
   export SP1_VKEY_HASH="..." # CLI prints this on setup
   npm run dev
   ```

At this point, the `/sp1/context` endpoint hands the browser the same config used by the Groth16 circuits, `/sp1/prove` shells out to the CLI, and `/sp1/verify` uses the returned payload to persist the aggregated badge. All that’s missing is a funded prover account (and the TODO that re-verifies the Groth16 proofs inside SP1, which is tagged in the source so we can land it soon).
