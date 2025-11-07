pragma circom 2.1.5;

// Wrapper for circomlib Poseidon hash
// This will use the circomlib implementation at compile time
include "circomlib/circuits/poseidon.circom";

template PoseidonHasher(nInputs) {
    signal input inputs[nInputs];
    signal output out;

    component hasher = Poseidon(nInputs);
    for (var i = 0; i < nInputs; i++) {
        hasher.inputs[i] <== inputs[i];
    }
    out <== hasher.out;
}
