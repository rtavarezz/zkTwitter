/**
 * Proves you follow at least N verified users without revealing which specific users.
 *
 * Privacy guarantee: The list of who you follow is private input. The verifier only
 * learns the count (e.g., "follows 5+ verified users"), not the identities.
 *
 * Uses Merkle proofs for efficient verification - each followee is proven to be in
 * the verified users tree without revealing the full tree or specific paths.
 *
 * Called by: frontend/src/pages/SocialProof.tsx (client-side proof generation)
 * Verified by: server/src/routes/social.ts (backend cryptographic verification)
 */
pragma circom 2.1.5;

include "../primitives/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "./merkleMembership.circom";

template SocialProof(N_MAX, MERKLE_DEPTH) {
    /* Public inputs - visible to verifier */
    signal input selfNullifier;           // User's unique identity
    signal input sessionNonce;            // Prevents proof replay
    signal input verifiedRoot;            // Merkle root of verified users tree
    signal input minVerifiedNeeded;       // Threshold (e.g., must follow 2+ verified users)

    /* Private inputs - hidden from verifier */
    signal input followeeLeaves[N_MAX];           // Hashes of users you follow (NEVER revealed)
    signal input followeeIsPresent[N_MAX];        // Boolean flags for which slots are active
    signal input merkleSiblings[N_MAX][MERKLE_DEPTH];  // Merkle proof siblings
    signal input merklePathBits[N_MAX][MERKLE_DEPTH];  // Path indices in tree

    /* Public outputs */
    signal output isQualified;            // 1 if meets threshold, 0 otherwise
    signal output claimHash;              // Binds proof to identity and session

    // Declare signals outside loop per Circom 2.x requirements
    component membership[N_MAX];
    signal rootDiff[N_MAX];
    signal accum[N_MAX + 1];
    accum[0] <== 0;  // Start counter at 0

    // Step 1: Verify each followee with Merkle proof and count verified follows
    for (var i = 0; i < N_MAX; i++) {
        // Constrain followeeIsPresent to be boolean (0 or 1)
        followeeIsPresent[i] * (followeeIsPresent[i] - 1) === 0;

        // Run Merkle inclusion proof for this followee
        // Proves: followeeLeaves[i] is in the verified users Merkle tree
        membership[i] = MerkleMembership(MERKLE_DEPTH);
        membership[i].leaf <== followeeLeaves[i];
        for (var d = 0; d < MERKLE_DEPTH; d++) {
            membership[i].pathElements[d] <== merkleSiblings[i][d];
            membership[i].pathIndex[d] <== merklePathBits[i][d];
        }

        rootDiff[i] <== membership[i].root - verifiedRoot;

        // If followeeIsPresent[i] == 1, force Merkle root to match verified tree root
        // If followeeIsPresent[i] == 0, this constraint is satisfied for any root
        rootDiff[i] * followeeIsPresent[i] === 0;

        // Accumulate count of verified follows
        accum[i + 1] <== accum[i] + followeeIsPresent[i];
    }

    signal verifiedCount;
    verifiedCount <== accum[N_MAX];  // Total number of verified follows

    // Step 2: Check if verified count meets threshold
    component meetsThreshold = GreaterEqThan(32);
    meetsThreshold.in[0] <== verifiedCount;
    meetsThreshold.in[1] <== minVerifiedNeeded;
    isQualified <== meetsThreshold.out;  // 1 if count >= threshold, 0 otherwise

    // Step 3: Compute claimHash to bind proof to identity and session
    // Prevents proof stealing and replay attacks
    component claimHasher = PoseidonHasher(4);
    claimHasher.inputs[0] <== selfNullifier;
    claimHasher.inputs[1] <== sessionNonce;
    claimHasher.inputs[2] <== verifiedRoot;
    claimHasher.inputs[3] <== minVerifiedNeeded;
    claimHash <== claimHasher.out;
}

component main {public [selfNullifier, sessionNonce, verifiedRoot, minVerifiedNeeded]} = SocialProof(32, 20);
