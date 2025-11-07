pragma circom 2.1.5;

include "../primitives/poseidon.circom";
include "../primitives/comparators.circom";
include "./generationConfig.circom";
include "./birthYearParser.circom";

template GenerationMembership(MAX_GENERATIONS) {
    // Public inputs
    signal input selfNullifier;
    signal input sessionNonce;
    signal input generationConfigHash;
    signal input targetGenerationId;

    // Private inputs
    signal input generationConfig[MAX_GENERATIONS * 3];  // [id, minYear, maxYear] per generation
    signal input birthYear;
    signal input userIdentifier;

    // Public outputs
    signal output isMember;
    signal output claimHash;

    // 1. Validate and hash generation config
    component config = GenerationConfig(MAX_GENERATIONS);
    for (var i = 0; i < MAX_GENERATIONS * 3; i++) {
        config.ranges[i] <== generationConfig[i];
    }
    config.targetId <== targetGenerationId;

    // Enforce config hash matches public input
    config.configHash === generationConfigHash;

    // 2. Parse and validate birth year
    component parser = BirthYearParser();
    parser.yearField <== birthYear;

    // 3. Check birth year is within generation bounds
    component gtMin = GreaterEqThan(12);
    gtMin.in[0] <== parser.year;
    gtMin.in[1] <== config.minYear;

    component ltMax = LessEqThan(12);
    ltMax.in[0] <== parser.year;
    ltMax.in[1] <== config.maxYear;

    // Both bounds must be satisfied
    signal rangeCheck1 <== gtMin.out * ltMax.out;
    isMember <== rangeCheck1;

    // 4. Compute claim hash binding user to generation
    component claimHasher = PoseidonHasher(4);
    claimHasher.inputs[0] <== userIdentifier;
    claimHasher.inputs[1] <== selfNullifier;
    claimHasher.inputs[2] <== targetGenerationId;
    claimHasher.inputs[3] <== sessionNonce;
    claimHash <== claimHasher.out;
}

component main {public [selfNullifier, sessionNonce, generationConfigHash, targetGenerationId]} = GenerationMembership(5);
