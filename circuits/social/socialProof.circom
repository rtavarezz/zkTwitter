// Proves "I follow at least N verified users" without revealing which ones.
pragma circom 2.1.5;

include "../primitives/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "./merkleMembership.circom";

template SocialProof(N_MAX, MERKLE_DEPTH) {
    // Public inputs
    signal input selfNullifier;
    signal input sessionNonce;
    signal input verifiedRoot;
    signal input minVerifiedNeeded;

    // Private inputs
    signal input followeeLeaves[N_MAX];
    signal input followeeIsPresent[N_MAX];
    signal input merkleSiblings[N_MAX][MERKLE_DEPTH];
    signal input merklePathBits[N_MAX][MERKLE_DEPTH];

    // Public outputs
    signal output isQualified;
    signal output claimHash;

    // Declare all signals/components outside loop (Circom 2.x requirement)
    component membership[N_MAX];
    signal rootDiff[N_MAX];
    signal accum[N_MAX + 1];
    accum[0] <== 0;

    for (var i = 0; i < N_MAX; i++) {
        // Enforce followee selector is boolean
        followeeIsPresent[i] * (followeeIsPresent[i] - 1) === 0;

        // Run Merkle inclusion for each provided leaf
        membership[i] = MerkleMembership(MERKLE_DEPTH);
        membership[i].leaf <== followeeLeaves[i];
        for (var d = 0; d < MERKLE_DEPTH; d++) {
            membership[i].pathElements[d] <== merkleSiblings[i][d];
            membership[i].pathIndex[d] <== merklePathBits[i][d];
        }

        rootDiff[i] <== membership[i].root - verifiedRoot;

        // If this slot is marked active (1) we force the root to match
        rootDiff[i] * followeeIsPresent[i] === 0;

        accum[i + 1] <== accum[i] + followeeIsPresent[i];
    }

    signal verifiedCount;
    verifiedCount <== accum[N_MAX];

    component meetsThreshold = GreaterEqThan(32);
    meetsThreshold.in[0] <== verifiedCount;
    meetsThreshold.in[1] <== minVerifiedNeeded;

    isQualified <== meetsThreshold.out;

    component claimHasher = PoseidonHasher(4);
    claimHasher.inputs[0] <== selfNullifier;
    claimHasher.inputs[1] <== sessionNonce;
    claimHasher.inputs[2] <== verifiedRoot;
    claimHasher.inputs[3] <== minVerifiedNeeded;
    claimHash <== claimHasher.out;
}

component main {public [selfNullifier, sessionNonce, verifiedRoot, minVerifiedNeeded]} = SocialProof(32, 20);
