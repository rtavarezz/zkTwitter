pragma circom 2.1.5;

include "../primitives/poseidon.circom";
include "circomlib/circuits/comparators.circom";

template GenerationConfig(MAX_GENERATIONS) {
    signal input ranges[MAX_GENERATIONS * 3];
    signal input targetId;

    signal output configHash;
    signal output minYear;
    signal output maxYear;

    component hasher = PoseidonHasher(MAX_GENERATIONS * 3);
    for (var i = 0; i < MAX_GENERATIONS * 3; i++) {
        hasher.inputs[i] <== ranges[i];
    }
    configHash <== hasher.out;

    component isTarget[MAX_GENERATIONS];
    for (var g = 0; g < MAX_GENERATIONS; g++) {
        isTarget[g] = IsEqual();
        isTarget[g].in[0] <== targetId;
        isTarget[g].in[1] <== ranges[g * 3];
    }

    signal minAccumulator[MAX_GENERATIONS];
    signal maxAccumulator[MAX_GENERATIONS];

    minAccumulator[0] <== isTarget[0].out * ranges[1];
    maxAccumulator[0] <== isTarget[0].out * ranges[2];

    for (var g = 1; g < MAX_GENERATIONS; g++) {
        minAccumulator[g] <== minAccumulator[g-1] + isTarget[g].out * ranges[g * 3 + 1];
        maxAccumulator[g] <== maxAccumulator[g-1] + isTarget[g].out * ranges[g * 3 + 2];
    }

    minYear <== minAccumulator[MAX_GENERATIONS - 1];
    maxYear <== maxAccumulator[MAX_GENERATIONS - 1];
}
