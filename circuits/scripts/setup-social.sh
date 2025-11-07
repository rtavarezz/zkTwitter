#!/bin/bash
set -e

CIRCUIT_NAME="socialProof"
BUILD_DIR="../build"

echo "Running Groth16 trusted setup for ${CIRCUIT_NAME}..."

# Step 1: Powers of Tau (use existing or download)
if [ ! -f "${BUILD_DIR}/powersOfTau28_hez_final_18.ptau" ]; then
  echo "Downloading Powers of Tau file..."
  curl -o ${BUILD_DIR}/powersOfTau28_hez_final_18.ptau https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_18.ptau
fi

# Step 2: Generate initial zkey
echo "Generating initial zkey..."
npx snarkjs groth16 setup \
  ${BUILD_DIR}/${CIRCUIT_NAME}.r1cs \
  ${BUILD_DIR}/powersOfTau28_hez_final_18.ptau \
  ${BUILD_DIR}/${CIRCUIT_NAME}_0000.zkey

# Step 3: Contribute to ceremony (for demo, single contribution is OK)
echo "Contributing to trusted setup ceremony..."
echo "zkTwitterDemo" | npx snarkjs zkey contribute \
  ${BUILD_DIR}/${CIRCUIT_NAME}_0000.zkey \
  ${BUILD_DIR}/${CIRCUIT_NAME}_final.zkey \
  --name="Demo Contributor" \
  -v

# Step 4: Export verification key
echo "Exporting verification key..."
npx snarkjs zkey export verificationkey \
  ${BUILD_DIR}/${CIRCUIT_NAME}_final.zkey \
  ${BUILD_DIR}/${CIRCUIT_NAME}_verification_key.json

echo "Setup complete!"
echo "  Final zkey: ${BUILD_DIR}/${CIRCUIT_NAME}_final.zkey"
echo "  Verification key: ${BUILD_DIR}/${CIRCUIT_NAME}_verification_key.json"
