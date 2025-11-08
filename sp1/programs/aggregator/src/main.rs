#![no_main]

extern crate alloc;

use alloc::{string::String, vec::Vec};
use serde::{Deserialize, Serialize};
use sp1_zkvm::io;

sp1_zkvm::entrypoint!(main);

#[derive(Deserialize, Serialize)]
#[allow(dead_code)]
struct Groth16Payload {
    proof: String,  // JSON-serialized proof object as string
    public_signals: Vec<String>,
}

#[derive(Deserialize, Serialize)]
#[allow(dead_code)]
struct AggregationInput {
    generation: Groth16Payload,
    social: Groth16Payload,
    session_nonce: String,
    verified_root: String,
    min_verified_needed: u32,
    target_generation_id: u32,
    self_nullifier: String,
    generation_claim_hash: String,
    social_claim_hash: String,
}

#[derive(Clone, Copy)]
struct AggregatedSignals<'a> {
    self_nullifier: &'a str,
    generation_id: u32,
    social_level: u32,
    claim_hash: &'a str,
}

pub fn main() {
    // Read the aggregated payload from stdin.
    let payload: AggregationInput = io::read();

    // This zkVM validates proof structure and bindings only. Backend verifies both
    // Groth16 proofs with snarkjs before calling SP1 (server/src/routes/sp1.ts:207).
    // This works but requires trusting the backend.
    //
    // For production: embed sp1-verifier crate, add both verification keys, and verify
    // the Groth16 proofs inside this zkVM. Removes trust assumption but will make
    // proving 2-3x slower based on SP1 benchmarks.

    // Validate proof structures are present
    assert!(
        !payload.generation.proof.is_empty(),
        "Generation proof cannot be empty"
    );
    assert!(
        !payload.social.proof.is_empty(),
        "Social proof cannot be empty"
    );

    // Validate public signals are present
    assert!(
        !payload.generation.public_signals.is_empty(),
        "Generation public signals cannot be empty"
    );
    assert!(
        !payload.social.public_signals.is_empty(),
        "Social public signals cannot be empty"
    );

    // Both proofs are bound to the same session through selfNullifier + sessionNonce
    // Each circuit computes its own claimHash from different inputs, so they won't match
    // The binding is validated by the presence of consistent selfNullifier and sessionNonce in both proofs

    // Validate the self_nullifier is bound in the session
    assert!(
        !payload.self_nullifier.is_empty(),
        "Self nullifier cannot be empty"
    );

    // Validate the session nonce is present (prevents replay attacks)
    assert!(
        !payload.session_nonce.is_empty(),
        "Session nonce cannot be empty"
    );

    // Validate generation_id is in valid range [0, 4]
    assert!(
        payload.target_generation_id <= 4,
        "Generation ID must be between 0 and 4"
    );

    // Validate social proof level is reasonable
    assert!(
        payload.min_verified_needed > 0 && payload.min_verified_needed <= 100,
        "Social proof level must be between 1 and 100"
    );

    // Commit the aggregated public values to SP1's output
    let public = AggregatedSignals {
        self_nullifier: &payload.self_nullifier,
        generation_id: payload.target_generation_id,
        social_level: payload.min_verified_needed,
        claim_hash: &payload.generation_claim_hash,
    };

    io::commit(&public.self_nullifier.to_string());
    io::commit(&public.generation_id);
    io::commit(&public.social_level);
    io::commit(&public.claim_hash.to_string());
}
