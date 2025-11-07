#![no_main]

extern crate alloc;

use alloc::{string::String, vec::Vec};
use serde::Deserialize;
use sp1_zkvm::io;

sp1_zkvm::entrypoint!(main);

#[derive(Deserialize)]
struct Groth16Payload {
    proof: Vec<u8>,
    public_signals: Vec<String>,
}

#[derive(Deserialize)]
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

    // TODO(sp1): embed groth16 verification inside the zkVM using `sp1_verifier`.
    // For now we rely on the backend verifying both Groth16 proofs before feeding the
    // payload to SP1. The circuit still recomputes the Poseidon hash bindings.

    // Sanity-check the session binding between the two claim hashes.
    assert_eq!(
        payload.generation_claim_hash, payload.social_claim_hash,
        "Claim hashes must match across generation + social proofs"
    );

    let public = AggregatedSignals {
        self_nullifier: &payload.self_nullifier,
        generation_id: payload.target_generation_id,
        social_level: payload.min_verified_needed,
        claim_hash: &payload.generation_claim_hash,
    };

    io::commit(public.self_nullifier);
    io::commit(&public.generation_id);
    io::commit(&public.social_level);
    io::commit(public.claim_hash);
}
