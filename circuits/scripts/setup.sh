#!/bin/bash
set -e

CIRCUIT_NAME="generationMembership"
BUILD_DIR="../build"
# Circuit now has ~3.3k signals, so run against a 2^19 powers of tau file we keep checked in.
PTAU_FILE="powersOfTau28_hez_final_19.ptau"

echo "Setting up trusted setup for ${CIRCUIT_NAME}..."

cd $BUILD_DIR

# Download powers of tau if not present
if [ ! -f $PTAU_FILE ]; then
    echo "Expected $PTAU_FILE to exist in build/. Please download it manually (32MB+) once and re-run."
    exit 1
fi

# Generate zkey
echo "Generating zkey..."
snarkjs groth16 setup ${CIRCUIT_NAME}.r1cs $PTAU_FILE ${CIRCUIT_NAME}_0000.zkey

# Contribute to ceremony (single contribution for development)
echo "Contributing to ceremony..."
snarkjs zkey contribute ${CIRCUIT_NAME}_0000.zkey ${CIRCUIT_NAME}_final.zkey \
  --name="First contribution" -v -e="random entropy"

# Export verification key
echo "Exporting verification key..."
snarkjs zkey export verificationkey ${CIRCUIT_NAME}_final.zkey verification_key.json

echo "Setup complete!"
echo "  Final zkey: ${BUILD_DIR}/${CIRCUIT_NAME}_final.zkey"
echo "  Verification key: ${BUILD_DIR}/verification_key.json"
