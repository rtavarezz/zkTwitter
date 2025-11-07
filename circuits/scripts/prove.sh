#!/bin/bash
set -e

CIRCUIT_NAME="generationMembership"
BUILD_DIR="../build"

echo "Generating proof..."

cd $BUILD_DIR

# Generate witness using snarkjs
echo "Computing witness..."
snarkjs wtns calculate \
  ${CIRCUIT_NAME}_js/${CIRCUIT_NAME}.wasm \
  input.json \
  witness.wtns

# Generate proof
echo "Generating zk-SNARK proof..."
snarkjs groth16 prove \
  ${CIRCUIT_NAME}_final.zkey \
  witness.wtns \
  proof.json \
  public.json

# Verify proof
echo "Verifying proof..."
snarkjs groth16 verify \
  verification_key.json \
  public.json \
  proof.json

echo "Proof generated and verified successfully!"
echo "  Proof: ${BUILD_DIR}/proof.json"
echo "  Public signals: ${BUILD_DIR}/public.json"
