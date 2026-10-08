
-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE 'OPENING_BALANCE';

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "openingDate" DATE;

-- AlterTable
ALTER TABLE "SalesInvoice" ADD COLUMN     "isOpening" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "isOpening" BOOLEAN NOT NULL DEFAULT false;

