
-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE 'SUPPLIER_CREDIT';

-- CreateTable
CREATE TABLE "SupplierCredit" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "billId" TEXT,
    "number" TEXT NOT NULL,
    "creditDate" DATE NOT NULL,
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT,
    "returnStock" BOOLEAN NOT NULL DEFAULT false,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierCreditLine" (
    "id" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "itemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "taxRate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "taxRateId" TEXT,
    "accountId" TEXT NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SupplierCreditLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierCreditAllocation" (
    "id" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierCreditAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierCredit_businessId_creditDate_idx" ON "SupplierCredit"("businessId", "creditDate");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierCredit_businessId_number_key" ON "SupplierCredit"("businessId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierCreditAllocation_creditId_billId_key" ON "SupplierCreditAllocation"("creditId", "billId");

-- AddForeignKey
ALTER TABLE "SupplierCredit" ADD CONSTRAINT "SupplierCredit_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCredit" ADD CONSTRAINT "SupplierCredit_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCredit" ADD CONSTRAINT "SupplierCredit_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCreditLine" ADD CONSTRAINT "SupplierCreditLine_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "SupplierCredit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCreditLine" ADD CONSTRAINT "SupplierCreditLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCreditAllocation" ADD CONSTRAINT "SupplierCreditAllocation_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "SupplierCredit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCreditAllocation" ADD CONSTRAINT "SupplierCreditAllocation_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

