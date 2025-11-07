pragma circom 2.1.5;

include "circomlib/circuits/comparators.circom";

template BirthYearParser() {
    signal input yearField;
    signal output year;

    // Self encodes year as a numeric field element (YYYY format)
    // Validate it's a reasonable year (1900-2100)
    component gtLowerBound = GreaterEqThan(12);
    gtLowerBound.in[0] <== yearField;
    gtLowerBound.in[1] <== 1900;
    gtLowerBound.out === 1;

    component ltUpperBound = LessEqThan(12);
    ltUpperBound.in[0] <== yearField;
    ltUpperBound.in[1] <== 2100;
    ltUpperBound.out === 1;

    year <== yearField;
}
