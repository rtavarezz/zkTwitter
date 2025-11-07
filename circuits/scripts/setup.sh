#!/bin/bash
set -e

CIRCUIT_NAME="generationMembership"
BUILD_DIR="../build"
PTAU_FILE="powersOfTau28_hez_final_10.ptau"  # 2^10 = 1024 constraints (we have 941)

echo "Setting up trusted setup for ${CIRCUIT_NAME}..."

cd $BUILD_DIR

# Download powers of tau if not present
if [ ! -f $PTAU_FILE ]; then
    echo "Downloading powers of tau (2MB)..."
    curl -L https://hermez.s3-eu-west-1.amazonaws.com/$PTAU_FILE -o $PTAU_FILE
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
