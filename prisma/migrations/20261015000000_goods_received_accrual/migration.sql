
-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE 'GOODS_RECEIPT';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "usesGrni" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "GoodsReceipt" ADD COLUMN     "accrued" BOOLEAN NOT NULL DEFAULT false;

