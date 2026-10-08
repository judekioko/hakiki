
-- AlterTable
ALTER TABLE "SalesInvoice" ADD COLUMN     "currency" TEXT,
ADD COLUMN     "exchangeRate" DECIMAL(18,8),
ADD COLUMN     "foreignSubtotal" DECIMAL(14,2),
ADD COLUMN     "foreignTaxTotal" DECIMAL(14,2),
ADD COLUMN     "foreignTotal" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "SalesInvoiceLine" ADD COLUMN     "foreignLineTotal" DECIMAL(14,2),
ADD COLUMN     "foreignTaxAmount" DECIMAL(14,2),
ADD COLUMN     "foreignUnitPrice" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "currency" TEXT,
ADD COLUMN     "exchangeRate" DECIMAL(18,8),
ADD COLUMN     "foreignTotalAmount" DECIMAL(14,2),
ADD COLUMN     "foreignVatAmount" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "BillLine" ADD COLUMN     "foreignLineTotal" DECIMAL(14,2),
ADD COLUMN     "foreignTaxAmount" DECIMAL(14,2),
ADD COLUMN     "foreignUnitPrice" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "CreditNote" ADD COLUMN     "isFx" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SupplierCredit" ADD COLUMN     "isFx" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExchangeRate_businessId_currency_date_idx" ON "ExchangeRate"("businessId", "currency", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_businessId_currency_date_key" ON "ExchangeRate"("businessId", "currency", "date");

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

