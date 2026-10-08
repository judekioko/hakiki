
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JournalSource" ADD VALUE 'TRANSFER';
ALTER TYPE "JournalSource" ADD VALUE 'FX_REVALUATION';

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "currency" TEXT;

-- AlterTable
ALTER TABLE "JournalLine" ADD COLUMN     "foreignAmount" DECIMAL(16,2);

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "exchangeRate" DECIMAL(18,8),
ADD COLUMN     "foreignAmount" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "exchangeRate" DECIMAL(18,8),
ADD COLUMN     "foreignAmount" DECIMAL(14,2);

-- CreateTable
CREATE TABLE "MoneyTransfer" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "fromAccountId" TEXT NOT NULL,
    "toAccountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "fromAmount" DECIMAL(16,2) NOT NULL,
    "toAmount" DECIMAL(16,2) NOT NULL,
    "fromRate" DECIMAL(18,8),
    "toRate" DECIMAL(18,8),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoneyTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MoneyTransfer_businessId_date_idx" ON "MoneyTransfer"("businessId", "date");

-- AddForeignKey
ALTER TABLE "MoneyTransfer" ADD CONSTRAINT "MoneyTransfer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyTransfer" ADD CONSTRAINT "MoneyTransfer_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyTransfer" ADD CONSTRAINT "MoneyTransfer_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

