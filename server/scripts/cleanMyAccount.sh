#!/bin/bash

# Change to server directory (parent of scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"
cd "$SERVER_DIR" || exit 1

LATEST_PROOF=$(ls -1t tmp/self-proofs/*registration*.json 2>/dev/null | head -n1)
if [ -z "$LATEST_PROOF" ]; then
  echo "No self proof dumps found in tmp/self-proofs/. Run a signup first."
  exit 1
fi

NULLIFIER=$(jq -r '.verification.discloseOutput.nullifier // .proof.pubSignals[7]' "$LATEST_PROOF")

if [ -z "$NULLIFIER" ] || [ "$NULLIFIER" = "null" ]; then
  echo "Unable to extract nullifier from $LATEST_PROOF"
  exit 1
fi
DB_PATH="prisma/dev.db"

echo "Latest nullifier from $LATEST_PROOF:"
echo "  $NULLIFIER"
echo ""
ABS_DB_PATH="$SERVER_DIR/$DB_PATH"
echo "Run the following command to delete accounts tied to it:"
echo "  sqlite3 $ABS_DB_PATH \"DELETE FROM User WHERE selfNullifier = '$NULLIFIER';\""
echo ""
echo "Preview matching users:"
sqlite3 "$ABS_DB_PATH" "SELECT handle, humanStatus FROM User WHERE selfNullifier = '$NULLIFIER';"
