#!/bin/bash
set -e

CIRCUIT_NAME="socialProof"
BUILD_DIR="../build"
CIRCUIT_DIR="../social"

echo "Compiling ${CIRCUIT_NAME} circuit..."

mkdir -p $BUILD_DIR

# Compile circuit with circomlib include path
circom ${CIRCUIT_DIR}/${CIRCUIT_NAME}.circom \
  --r1cs \
  --wasm \
  --sym \
  --c \
  -l ../node_modules \
  -o $BUILD_DIR

echo "Circuit compiled successfully!"
echo "  R1CS: ${BUILD_DIR}/${CIRCUIT_NAME}.r1cs"
echo "  WASM: ${BUILD_DIR}/${CIRCUIT_NAME}_js/${CIRCUIT_NAME}.wasm"
echo "  Symbols: ${BUILD_DIR}/${CIRCUIT_NAME}.sym"
