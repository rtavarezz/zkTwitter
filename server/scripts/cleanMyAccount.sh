#!/bin/bash

# This deletes all users with your specific selfNullifier

# Change to server directory (parent of scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"
cd "$SERVER_DIR" || exit 1

NULLIFIER="8222833695484793693655664972457592856023758319486951690260161616247704983785"
DB_PATH="prisma/dev.db"

echo "Cleaning up accounts with nullifier: ${NULLIFIER:0:20}..."

# Delete all users with this nullifier
sqlite3 "$DB_PATH" "DELETE FROM User WHERE selfNullifier = '$NULLIFIER';"

# Verify deletion
COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM User WHERE selfNullifier = '$NULLIFIER';")

if [ "$COUNT" -eq 0 ]; then
    echo "Successfully cleaned up! You can now register with a fresh account."
else
    echo "Warning: $COUNT account(s) still exist with this nullifier"
fi

echo ""
echo "Current users in database:"
sqlite3 "$DB_PATH" "SELECT handle, humanStatus FROM User;"
