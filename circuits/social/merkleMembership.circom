pragma circom 2.1.5;

include "../primitives/poseidon.circom";

template MerkleMembership(DEPTH) {
    signal input leaf;
    signal input pathElements[DEPTH];
    signal input pathIndex[DEPTH];
    signal output root;

    // Declare all signals/components outside loop
    signal nodes[DEPTH + 1];
    signal left[DEPTH];
    signal right[DEPTH];
    signal leftSelector[DEPTH];
    signal rightSelector[DEPTH];
    component hasher[DEPTH];

    nodes[0] <== leaf;

    for (var i = 0; i < DEPTH; i++) {
        // Force selector to be boolean
        pathIndex[i] * (pathIndex[i] - 1) === 0;

        // Break down into quadratic constraints
        leftSelector[i] <== (1 - pathIndex[i]) * nodes[i];
        left[i] <== leftSelector[i] + pathIndex[i] * pathElements[i];

        rightSelector[i] <== pathIndex[i] * nodes[i];
        right[i] <== rightSelector[i] + (1 - pathIndex[i]) * pathElements[i];

        hasher[i] = PoseidonHasher(2);
        hasher[i].inputs[0] <== left[i];
        hasher[i].inputs[1] <== right[i];
        nodes[i + 1] <== hasher[i].out;
    }

    root <== nodes[DEPTH];
}
