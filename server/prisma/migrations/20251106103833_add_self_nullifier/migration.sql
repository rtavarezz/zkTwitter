-- AlterTable
ALTER TABLE "User" ADD COLUMN "selfNullifier" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_selfNullifier_key" ON "User"("selfNullifier");
