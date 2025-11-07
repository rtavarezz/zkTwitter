-- Migration: Remove plaintext birthYear, add ZK commitment fields
-- This enforces ZK privacy by preventing backend from knowing exact age

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "handle" TEXT NOT NULL,
    "selfNullifier" TEXT,
    "avatarUrl" TEXT,
    "humanStatus" TEXT NOT NULL,
    "disclosed" TEXT NOT NULL DEFAULT '{}',
    "birthYearCommitment" TEXT,
    "birthYearSalt" TEXT,
    "generationId" INTEGER,
    "generationProofHash" TEXT,
    "socialProofLevel" INTEGER NOT NULL DEFAULT 0,
    "socialClaimHash" TEXT,
    "socialVerifiedAt" DATETIME,
    "verifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Copy data from old table (excluding birthYear)
INSERT INTO "new_User" (
    "id", "handle", "selfNullifier", "avatarUrl", "humanStatus", "disclosed",
    "generationId", "generationProofHash", "socialProofLevel", "socialClaimHash",
    "socialVerifiedAt", "verifiedAt", "createdAt"
)
SELECT
    "id", "handle", "selfNullifier", "avatarUrl", "humanStatus", "disclosed",
    "generationId", "generationProofHash", "socialProofLevel", "socialClaimHash",
    "socialVerifiedAt", "verifiedAt", "createdAt"
FROM "User";

DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";

-- Recreate indexes
CREATE UNIQUE INDEX "User_handle_key" ON "User"("handle");
CREATE UNIQUE INDEX "User_selfNullifier_key" ON "User"("selfNullifier");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
