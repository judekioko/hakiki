
-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "accruesServices" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "GoodsReceipt" ADD COLUMN     "accruesServices" BOOLEAN NOT NULL DEFAULT false;

