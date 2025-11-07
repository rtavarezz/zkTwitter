/**
 * Proves membership in a generation (Gen Z, Millennial, etc.) without revealing exact birth year.
 *
 * Privacy guarantee: Birth year is a private input and never leaves the prover's device.
 * The verifier only learns which generation you belong to, not your exact age.
 *
 * Called by: frontend/src/pages/GenerationProof.tsx (client-side proof generation)
 * Verified by: server/src/routes/generation.ts (backend cryptographic verification)
 */
pragma circom 2.1.5;

include "../primitives/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "./generationConfig.circom";
include "./birthYearParser.circom";

template GenerationMembership(MAX_GENERATIONS) {
    /* Public inputs - visible to verifier, used in proof verification */
    signal input selfNullifier;           // User's unique identity from Self protocol
    signal input sessionNonce;            // Prevents proof replay attacks
    signal input generationConfigHash;    // Hash of generation boundaries (e.g., Gen Z: 1997-2012)
    signal input targetGenerationId;      // Claimed generation (0=GenZ, 1=Millennial, 2=GenX, etc.)

    /* Private inputs: known only to prover, hidden from verifier */
    signal input generationConfig[MAX_GENERATIONS * 3];  // [id, minYear, maxYear] tuples
    signal input birthYear;               // Actual birth year (NEVER revealed to backend or DB)
    signal input birthYearSalt;           // Salt for cryptographic commitment

    /* Public outputs - computed by circuit, included in proof */
    signal output isMember;               // 1 if in range, 0 otherwise
    signal output claimHash;              // Binds proof to identity and session
    signal output birthYearCommitment;    // Poseidon(birthYear, salt) hides exact age

    // Step 1: Validate generation config and extract target generation's min/max years
    component config = GenerationConfig(MAX_GENERATIONS);
    for (var i = 0; i < MAX_GENERATIONS * 3; i++) {
        config.ranges[i] <== generationConfig[i];
    }
    config.targetId <== targetGenerationId;
    config.configHash === generationConfigHash;  // Verify hash to prevent config tampering

    // Step 2: Parse and validate birth year from private input
    component parser = BirthYearParser();
    parser.yearField <== birthYear;

    // Step 3: Range check - verify birth year falls within target generation bounds
    // Example: Gen Z (1997-2012) → check if birthYear >= 1997 AND birthYear <= 2012
    component gtMin = GreaterEqThan(12);
    gtMin.in[0] <== parser.year;
    gtMin.in[1] <== config.minYear;

    component ltMax = LessEqThan(12);
    ltMax.in[0] <== parser.year;
    ltMax.in[1] <== config.maxYear;

    signal rangeCheck1 <== gtMin.out * ltMax.out;  // AND via multiplication
    isMember <== rangeCheck1;  // 1 if in range, 0 otherwise

    // Step 4: Compute birthYearCommitment = Poseidon(birthYear, salt)
    // This cryptographic commitment hides the exact birth year from the verifier
    component commitmentHasher = PoseidonHasher(2);
    commitmentHasher.inputs[0] <== parser.year;
    commitmentHasher.inputs[1] <== birthYearSalt;
    birthYearCommitment <== commitmentHasher.out;

    // Step 5: Compute claimHash to bind proof to identity and prevent attacks
    // claimHash = Poseidon(commitment, selfNullifier, generationId, nonce, configHash)
    // Prevents: proof stealing (selfNullifier binding), replay (nonce), config tampering
    component claimHasher = PoseidonHasher(5);
    claimHasher.inputs[0] <== birthYearCommitment;
    claimHasher.inputs[1] <== selfNullifier;
    claimHasher.inputs[2] <== targetGenerationId;
    claimHasher.inputs[3] <== sessionNonce;
    claimHasher.inputs[4] <== generationConfigHash;
    claimHash <== claimHasher.out;
}

component main {public [selfNullifier, sessionNonce, generationConfigHash, targetGenerationId]} = GenerationMembership(5);
