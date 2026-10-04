-- DropForeignKey
ALTER TABLE "JournalLine" DROP CONSTRAINT "JournalLine_accountId_fkey";

-- DropForeignKey
ALTER TABLE "Payslip" DROP CONSTRAINT "Payslip_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "SalesInvoice" DROP CONSTRAINT "SalesInvoice_customerId_fkey";

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

