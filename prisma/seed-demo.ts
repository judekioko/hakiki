// Demo business with a realistic mix of backed, missing and exempt payments. Safe to re-run: it rebuilds the demo.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { PrismaClient, type ExemptReason, type PaymentSource } from "../lib/generated/prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "Demo@1234";

type SupplierSeed = { key: string; name: string; kraPin?: string; phone?: string; aliases: string[] };
const suppliers: SupplierSeed[] = [
  { key: "mabati", name: "Mabati Centre Ltd", kraPin: "P051234567A", phone: "0712345678", aliases: ["MABATI CENTRE LTD"] },
  { key: "simba", name: "Simba Cement Distributors", kraPin: "P052345678B", phone: "0722345678", aliases: ["SIMBA CEMENT DISTRIBUTORS"] },
  { key: "kplc", name: "Kenya Power", kraPin: "P000600207M", aliases: ["KPLC PREPAID"] },
  { key: "jua", name: "Jua Kali Welders", phone: "0733345678", aliases: ["JUA KALI WELDERS"] },
  { key: "safi", name: "Safi Transporters", kraPin: "A012345678C", phone: "0700111222", aliases: ["SAFI TRANSPORTERS"] },
];

const d = (iso: string) => new Date(`${iso}T09:30:00+03:00`);

type PaymentSeed = {
  ref: string;
  date: string;
  amount: number;
  to: string;
  supplier?: string;
  source?: PaymentSource;
  exempt?: ExemptReason;
  invoice?: { no: string; date: string; vat?: number; total?: number };
};

const payments: PaymentSeed[] = [
  { ref: "TA11K2L3M1", date: "2026-01-08", amount: 48500, to: "MABATI CENTRE LTD", supplier: "mabati", invoice: { no: "KRAMW011202601080001", date: "2026-01-08", vat: 6689.66 } },
  { ref: "TA21K2L3M2", date: "2026-01-15", amount: 3200, to: "KPLC PREPAID", supplier: "kplc", invoice: { no: "KRAMW004202601150442", date: "2026-01-15", vat: 441.38 } },
  { ref: "TB31K2L3M3", date: "2026-02-03", amount: 125000, to: "SIMBA CEMENT DISTRIBUTORS", supplier: "simba", source: "BANK", invoice: { no: "KRAMW022202602020107", date: "2026-02-02", vat: 17241.38 } },
  { ref: "TB41K2L3M4", date: "2026-02-19", amount: 18000, to: "JUA KALI WELDERS", supplier: "jua" },
  { ref: "TC51K2L3M5", date: "2026-03-05", amount: 62000, to: "MABATI CENTRE LTD", supplier: "mabati" },
  { ref: "TC61K2L3M6", date: "2026-03-28", amount: 4100, to: "KPLC PREPAID", supplier: "kplc", invoice: { no: "KRAMW004202603280913", date: "2026-03-28", vat: 565.52 } },
  { ref: "TD71K2L3M7", date: "2026-04-10", amount: 240000, to: "STAFF SALARIES APRIL", source: "BANK", exempt: "SALARIES" },
  { ref: "TD81K2L3M8", date: "2026-04-22", amount: 35000, to: "SAFI TRANSPORTERS", supplier: "safi" },
  { ref: "TE91K2L3M9", date: "2026-05-06", amount: 87500, to: "SIMBA CEMENT DISTRIBUTORS", supplier: "simba", source: "BANK", invoice: { no: "KRAMW022202605060355", date: "2026-05-07", vat: 12068.97 } },
  { ref: "TE01K2L3N0", date: "2026-05-20", amount: 12500, to: "JUA KALI WELDERS", supplier: "jua" },
  { ref: "TF11K2L3N1", date: "2026-06-09", amount: 21000, to: "KRA PAYE JUNE", source: "BANK", exempt: "TAX_STATUTORY" },
  { ref: "TF21K2L3N2", date: "2026-06-18", amount: 54000, to: "MABATI CENTRE LTD", supplier: "mabati", invoice: { no: "KRAMW011202606180024", date: "2026-06-18", vat: 7448.28 } },
  { ref: "TG31K2L3N3", date: "2026-07-02", amount: 28000, to: "SAFI TRANSPORTERS", supplier: "safi" },
  { ref: "TG41K2L3N4", date: "2026-07-25", amount: 9800, to: "GRACE MUTHONI" },
  { ref: "TH51K2L3N5", date: "2026-08-12", amount: 150000, to: "SIMBA CEMENT DISTRIBUTORS", supplier: "simba", source: "BANK" },
  { ref: "TH61K2L3N6", date: "2026-08-30", amount: 3650, to: "KPLC PREPAID", supplier: "kplc" },
  { ref: "TI71K2L3N7", date: "2026-09-04", amount: 1850, to: "M-PESA CHARGES", exempt: "INTEREST_BANK_CHARGES" },
  { ref: "TI81K2L3N8", date: "2026-09-16", amount: 71000, to: "MABATI CENTRE LTD", supplier: "mabati", invoice: { no: "KRAMW011202609160071", date: "2026-09-15", vat: 9793.10 } },
];

// An invoice that has arrived but not been matched yet, so Auto-match has something to do.
const looseInvoice = { supplier: "jua", no: "KRAMW031202605200008", date: "2026-05-21", total: 12500, vat: 0 };

async function main() {
  await prisma.user.deleteMany({ where: { email: DEMO_EMAIL } });
  await prisma.business.deleteMany({ where: { name: "Duka Bora Hardware Ltd", memberships: { none: {} } } });

  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      name: "Wanjiru Kamau",
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
    },
  });
  const business = await prisma.business.create({
    data: {
      name: "Duka Bora Hardware Ltd",
      kraPin: "P051998877Q",
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });

  const supplierIds = new Map<string, string>();
  for (const s of suppliers) {
    const created = await prisma.supplier.create({
      data: { businessId: business.id, name: s.name, kraPin: s.kraPin, phone: s.phone, aliases: s.aliases },
    });
    supplierIds.set(s.key, created.id);
  }
  const supplierName = (key: string) => suppliers.find((s) => s.key === key)!.name;

  for (const p of payments) {
    const supplierId = p.supplier ? supplierIds.get(p.supplier)! : null;
    const payment = await prisma.payment.create({
      data: {
        businessId: business.id,
        source: p.source ?? "MPESA",
        reference: p.ref,
        paidAt: d(p.date),
        amount: p.amount,
        counterparty: p.to,
        supplierId,
        exemptReason: p.exempt ?? null,
      },
    });
    if (p.invoice && p.supplier) {
      const total = p.invoice.total ?? p.amount;
      const invoice = await prisma.invoice.create({
        data: {
          businessId: business.id,
          supplierId,
          invoiceNumber: p.invoice.no,
          supplierName: supplierName(p.supplier),
          supplierPin: suppliers.find((s) => s.key === p.supplier)!.kraPin ?? null,
          invoiceDate: new Date(`${p.invoice.date}T00:00:00Z`),
          totalAmount: total,
          vatAmount: p.invoice.vat ?? 0,
          status: "VERIFIED",
        },
      });
      await prisma.allocation.create({ data: { paymentId: payment.id, invoiceId: invoice.id, amount: Math.min(total, p.amount) } });
    }
  }

  await prisma.invoice.create({
    data: {
      businessId: business.id,
      supplierId: supplierIds.get(looseInvoice.supplier)!,
      invoiceNumber: looseInvoice.no,
      supplierName: supplierName(looseInvoice.supplier),
      invoiceDate: new Date(`${looseInvoice.date}T00:00:00Z`),
      totalAmount: looseInvoice.total,
      vatAmount: looseInvoice.vat,
      description: "Welding of display racks",
    },
  });

  console.log(`Demo ready: ${DEMO_EMAIL} / ${DEMO_PASSWORD} (${payments.length} payments, business "${business.name}")`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
