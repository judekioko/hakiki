
-- CreateEnum
CREATE TYPE "MpesaEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "MpesaTxStatus" AS ENUM ('PENDING', 'RECORDED', 'FAILED', 'NEEDS_ATTENTION');

-- CreateTable
CREATE TABLE "MpesaConfig" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "environment" "MpesaEnvironment" NOT NULL DEFAULT 'SANDBOX',
    "shortcode" TEXT NOT NULL,
    "shortcodeType" TEXT NOT NULL DEFAULT 'PAYBILL',
    "consumerKeyEnc" TEXT NOT NULL,
    "consumerSecretEnc" TEXT NOT NULL,
    "passkeyEnc" TEXT,
    "callbackToken" TEXT NOT NULL,
    "moneyAccountId" TEXT,
    "urlsRegisteredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MpesaConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MpesaTransaction" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "MpesaTxStatus" NOT NULL DEFAULT 'PENDING',
    "transId" TEXT,
    "checkoutRequestId" TEXT,
    "amount" DECIMAL(14,2),
    "phone" TEXT,
    "billRef" TEXT,
    "invoiceId" TEXT,
    "receiptId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MpesaTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MpesaConfig_businessId_key" ON "MpesaConfig"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "MpesaTransaction_checkoutRequestId_key" ON "MpesaTransaction"("checkoutRequestId");

-- CreateIndex
CREATE INDEX "MpesaTransaction_businessId_createdAt_idx" ON "MpesaTransaction"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MpesaTransaction_businessId_transId_key" ON "MpesaTransaction"("businessId", "transId");

-- AddForeignKey
ALTER TABLE "MpesaConfig" ADD CONSTRAINT "MpesaConfig_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MpesaTransaction" ADD CONSTRAINT "MpesaTransaction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

