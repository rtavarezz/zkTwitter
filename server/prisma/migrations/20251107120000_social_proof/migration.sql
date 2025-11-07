-- AlterTable
ALTER TABLE "User" ADD COLUMN "socialProofLevel" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "socialClaimHash" TEXT;
ALTER TABLE "User" ADD COLUMN "socialVerifiedAt" DATETIME;

-- CreateTable
CREATE TABLE "UsedNonce" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "sessionNonce" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "UsedNonce_sessionNonce_key" ON "UsedNonce"("sessionNonce");

CREATE TABLE "Config" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

CREATE TABLE "VerifiedLeaf" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leaf" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "VerifiedLeaf_leaf_key" ON "VerifiedLeaf"("leaf");
