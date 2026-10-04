// Demo business: a hardware shop with sales, stock, supplier bills, payments, payroll and opening balances.
// Everything is posted through the same ledger code the app uses. Safe to re-run: it rebuilds the demo.
// Run with: npm run seed:demo (uses the react-server condition so server-only modules can load).
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { ensureBooks } from "../lib/books";
import { accountIdsByKey, postPayRun, postPayment, postReceipt, postSalesInvoice, replaceEntry } from "../lib/ledger";
import { calculateKenyaPayslip } from "../lib/payroll";
import type { ExemptReason, PaymentSource } from "../lib/generated/prisma/client";

const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "Demo@1234";
const BUSINESS_NAME = "Duka Bora Hardware Ltd";

const d = (iso: string) => new Date(`${iso}T09:30:00+03:00`);
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

type SupplierSeed = { key: string; name: string; kraPin?: string; phone?: string; aliases: string[] };
const suppliers: SupplierSeed[] = [
  { key: "mabati", name: "Mabati Centre Ltd", kraPin: "P051234567A", phone: "0712345678", aliases: ["MABATI CENTRE LTD"] },
  { key: "simba", name: "Simba Cement Distributors", kraPin: "P052345678B", phone: "0722345678", aliases: ["SIMBA CEMENT DISTRIBUTORS"] },
  { key: "kplc", name: "Kenya Power", kraPin: "P000600207M", aliases: ["KPLC PREPAID"] },
  { key: "jua", name: "Jua Kali Welders", phone: "0733345678", aliases: ["JUA KALI WELDERS"] },
  { key: "safi", name: "Safi Transporters", kraPin: "A012345678C", phone: "0700111222", aliases: ["SAFI TRANSPORTERS"] },
];

type PaymentSeed = {
  ref: string;
  date: string;
  amount: number;
  to: string;
  supplier?: string;
  source?: PaymentSource;
  exempt?: ExemptReason;
  category?: string;
  invoice?: { no: string; date: string; vat?: number; category?: string; stock?: { sku: string; qty: number } };
};

const payments: PaymentSeed[] = [
  { ref: "TA11K2L3M1", date: "2026-01-08", amount: 44080, to: "MABATI CENTRE LTD", supplier: "mabati", invoice: { no: "KRAMW011202601080001", date: "2026-01-08", stock: { sku: "MAB-30-3", qty: 40 } } },
  { ref: "TA21K2L3M2", date: "2026-01-15", amount: 3200, to: "KPLC PREPAID", supplier: "kplc", invoice: { no: "KRAMW004202601150442", date: "2026-01-15", vat: 441.38, category: "6200" } },
  { ref: "TB31K2L3M3", date: "2026-02-03", amount: 125280, to: "SIMBA CEMENT DISTRIBUTORS", supplier: "simba", source: "BANK", invoice: { no: "KRAMW022202602020107", date: "2026-02-02", stock: { sku: "CEM-50", qty: 150 } } },
  { ref: "TB41K2L3M4", date: "2026-02-19", amount: 18000, to: "JUA KALI WELDERS", supplier: "jua" },
  { ref: "TC51K2L3M5", date: "2026-03-05", amount: 26000, to: "MABATI CENTRE LTD", supplier: "mabati" },
  { ref: "TC61K2L3M6", date: "2026-03-28", amount: 4100, to: "KPLC PREPAID", supplier: "kplc", invoice: { no: "KRAMW004202603280913", date: "2026-03-28", vat: 565.52, category: "6200" } },
  { ref: "TD81K2L3M8", date: "2026-04-22", amount: 35000, to: "SAFI TRANSPORTERS", supplier: "safi" },
  { ref: "TE91K2L3M9", date: "2026-05-06", amount: 100224, to: "SIMBA CEMENT DISTRIBUTORS", supplier: "simba", source: "BANK", invoice: { no: "KRAMW022202605060355", date: "2026-05-07", stock: { sku: "CEM-50", qty: 120 } } },
  { ref: "TE01K2L3N0", date: "2026-05-20", amount: 12500, to: "JUA KALI WELDERS", supplier: "jua" },
  { ref: "TF11K2L3N1", date: "2026-06-09", amount: 21000, to: "KRA INSTALMENT TAX JUNE", source: "BANK", exempt: "TAX_STATUTORY", category: "6950" },
  { ref: "TF21K2L3N2", date: "2026-06-18", amount: 55100, to: "MABATI CENTRE LTD", supplier: "mabati", invoice: { no: "KRAMW011202606180024", date: "2026-06-18", stock: { sku: "MAB-30-3", qty: 50 } } },
  { ref: "TG31K2L3N3", date: "2026-07-02", amount: 28000, to: "SAFI TRANSPORTERS", supplier: "safi" },
  { ref: "TG41K2L3N4", date: "2026-07-25", amount: 9800, to: "GRACE MUTHONI" },
  { ref: "TH51K2L3N5", date: "2026-08-12", amount: 45000, to: "SIMBA CEMENT DISTRIBUTORS", supplier: "simba", source: "BANK" },
  { ref: "TH61K2L3N6", date: "2026-08-30", amount: 3650, to: "KPLC PREPAID", supplier: "kplc" },
  { ref: "TI71K2L3N7", date: "2026-09-04", amount: 1850, to: "M-PESA CHARGES", exempt: "INTEREST_BANK_CHARGES" },
  { ref: "TI81K2L3N8", date: "2026-09-16", amount: 77140, to: "MABATI CENTRE LTD", supplier: "mabati", invoice: { no: "KRAMW011202609160071", date: "2026-09-15", stock: { sku: "MAB-30-3", qty: 70 } } },
];

// An invoice that has arrived but not been matched yet, so Auto-match has something to do.
const looseInvoice = { supplier: "jua", no: "KRAMW031202605200008", date: "2026-05-21", total: 12500, vat: 0 };

async function main() {
  await prisma.user.deleteMany({ where: { email: DEMO_EMAIL } });
  await prisma.business.deleteMany({ where: { name: BUSINESS_NAME, memberships: { none: {} } } });

  const user = await prisma.user.create({
    data: { email: DEMO_EMAIL, name: "Wanjiru Kamau", passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10) },
  });
  const business = await prisma.business.create({
    data: {
      name: BUSINESS_NAME,
      kraPin: "P051998877Q",
      country: "KE",
      currency: "KES",
      address: "Kenyatta Avenue, Nakuru",
      phone: "0711 222 333",
      email: "sales@dukabora.example.com",
      invoiceFooter: "Pay by M-Pesa Paybill 247247, account = invoice number. Thank you for your business.",
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });

  // ---- Suppliers, money out and supplier bills (recorded before the books exist, then back-posted) ----
  const supplierIds = new Map<string, string>();
  for (const s of suppliers) {
    const created = await prisma.supplier.create({
      data: { businessId: business.id, name: s.name, kraPin: s.kraPin, phone: s.phone, aliases: s.aliases },
    });
    supplierIds.set(s.key, created.id);
  }
  const supplierName = (key: string) => suppliers.find((s) => s.key === key)!.name;

  await ensureBooks({ ...business, booksReadyAt: null });
  const accounts = await prisma.account.findMany({ where: { businessId: business.id } });
  const byCode = (code: string) => accounts.find((a) => a.code === code)!.id;
  const keys = await accountIdsByKey(business.id);
  const { postBill } = await import("../lib/ledger");

  // ---- Products and opening stock ----
  const defaultVat = await prisma.taxRate.findFirst({ where: { businessId: business.id, isDefault: true } });
  const itemSeeds = [
    { name: "Mabati iron sheet 3m (gauge 30)", sku: "MAB-30-3", unit: "pcs", sale: 1450, cost: 950, qty: 700, reorder: 60 },
    { name: "Cement 50kg (Simba)", sku: "CEM-50", unit: "bag", sale: 950, cost: 720, qty: 1000, reorder: 100 },
    { name: "Roofing nails 1kg", sku: "NAIL-1", unit: "kg", sale: 350, cost: 200, qty: 250, reorder: 40 },
  ];
  const items: Record<string, string> = {};
  for (const s of itemSeeds) {
    const item = await prisma.item.create({
      data: {
        businessId: business.id,
        name: s.name,
        sku: s.sku,
        unit: s.unit,
        kind: "INVENTORY",
        salePrice: s.sale,
        purchasePrice: s.cost,
        taxRateId: defaultVat?.id,
        reorderLevel: s.reorder,
      },
    });
    items[s.sku] = item.id;
    const movement = await prisma.stockMovement.create({
      data: {
        businessId: business.id,
        itemId: item.id,
        date: d("2026-01-01"),
        quantity: s.qty,
        unitCost: s.cost,
        sourceType: "STOCK_ADJUSTMENT",
        note: "Opening stock",
      },
    });
    await prisma.stockMovement.update({ where: { id: movement.id }, data: { sourceId: movement.id } });
    await replaceEntry(business.id, "STOCK_ADJUSTMENT", movement.id, {
      date: movement.date,
      memo: `Opening stock: ${s.qty} × ${s.name}`,
      lines: [
        { accountId: keys.INVENTORY, debit: s.qty * s.cost },
        { accountId: keys.OPENING_BALANCE, credit: s.qty * s.cost },
      ],
    });
  }
  const delivery = await prisma.item.create({
    data: { businessId: business.id, name: "Delivery within Nakuru", kind: "SERVICE", salePrice: 1500, taxRateId: defaultVat?.id },
  });

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
        categoryAccountId: p.category ? byCode(p.category) : null,
      },
    });
    if (p.invoice && p.supplier) {
      // Stock purchases are entered line by line: quantity × buying price + 16% VAT.
      const stockItem = p.invoice.stock ? itemSeeds.find((i) => i.sku === p.invoice!.stock!.sku)! : null;
      const stockLine =
        stockItem && p.invoice.stock
          ? {
              itemId: items[stockItem.sku],
              description: stockItem.name,
              quantity: p.invoice.stock.qty,
              unitPrice: stockItem.cost,
              taxRate: 16,
              taxRateId: defaultVat?.id ?? null,
              accountId: keys.INVENTORY,
              lineTotal: p.invoice.stock.qty * stockItem.cost,
              taxAmount: Math.round(p.invoice.stock.qty * stockItem.cost * 16) / 100,
            }
          : null;
      const invoice = await prisma.invoice.create({
        data: {
          businessId: business.id,
          supplierId,
          invoiceNumber: p.invoice.no,
          supplierName: supplierName(p.supplier),
          supplierPin: suppliers.find((s) => s.key === p.supplier)!.kraPin ?? null,
          invoiceDate: day(p.invoice.date),
          totalAmount: p.amount,
          vatAmount: stockLine ? stockLine.taxAmount : (p.invoice.vat ?? 0),
          categoryAccountId: p.invoice.category ? byCode(p.invoice.category) : null,
          status: "VERIFIED",
          lines: stockLine ? { create: [stockLine] } : undefined,
        },
      });
      await prisma.allocation.create({ data: { paymentId: payment.id, invoiceId: invoice.id, amount: p.amount } });
      await postBill(invoice.id);
    }
    await postPayment(payment.id);
  }
  const loose = await prisma.invoice.create({
    data: {
      businessId: business.id,
      supplierId: supplierIds.get(looseInvoice.supplier)!,
      invoiceNumber: looseInvoice.no,
      supplierName: supplierName(looseInvoice.supplier),
      invoiceDate: day(looseInvoice.date),
      totalAmount: looseInvoice.total,
      vatAmount: looseInvoice.vat,
      categoryAccountId: byCode("6400"),
      description: "Welding of display racks",
    },
  });
  await postBill(loose.id);

  // ---- Opening balances ----
  await replaceEntry(business.id, "MANUAL", "demo-opening-balances", {
    date: d("2026-01-01"),
    memo: "Opening balances at 1 January 2026",
    lines: [
      { accountId: keys.BANK, debit: 620_000 },
      { accountId: keys.MOBILE_MONEY, debit: 185_000 },
      { accountId: keys.CASH, debit: 15_000 },
      { accountId: byCode("1500"), debit: 240_000 },
      { accountId: keys.OPENING_BALANCE, credit: 1_060_000 },
    ],
  });

  // ---- Customers, sales invoices and money received ----
  const customers = {
    baraka: await prisma.customer.create({
      data: { businessId: business.id, name: "Baraka Builders Ltd", taxId: "P051777666B", phone: "0722000111", aliases: ["BARAKA BUILDERS LTD"] },
    }),
    njeri: await prisma.customer.create({
      data: { businessId: business.id, name: "Njeri Retail Stores", phone: "0733000222", aliases: ["NJERI RETAIL STORES", "MARY NJERI"] },
    }),
    kilimani: await prisma.customer.create({
      data: { businessId: business.id, name: "Kilimani Apartments Project", email: "accounts@kilimani.example.com", aliases: ["KILIMANI APARTMENTS"] },
    }),
  };

  type Line = { item: string | null; desc: string; qty: number; price: number };
  const sale = async (
    number: string,
    customerId: string,
    issue: string,
    due: string,
    lines: Line[],
    status: "SENT" | "DRAFT" = "SENT"
  ) => {
    const rate = defaultVat ? Number(defaultVat.rate) : 0;
    const priced = lines.map((l, i) => {
      const lineTotal = Math.round(l.qty * l.price * 100) / 100;
      return {
        itemId: l.item,
        description: l.desc,
        quantity: l.qty,
        unitPrice: l.price,
        taxRate: rate,
        taxRateId: defaultVat?.id ?? null,
        accountId: keys.SALES,
        lineTotal,
        taxAmount: Math.round(lineTotal * rate) / 100,
        position: i,
      };
    });
    const subtotal = priced.reduce((s, l) => s + l.lineTotal, 0);
    const taxTotal = Math.round(priced.reduce((s, l) => s + l.taxAmount, 0) * 100) / 100;
    const invoice = await prisma.salesInvoice.create({
      data: {
        businessId: business.id,
        customerId,
        number,
        issueDate: day(issue),
        dueDate: day(due),
        status,
        subtotal,
        taxTotal,
        total: subtotal + taxTotal,
        lines: { create: priced },
      },
    });
    await postSalesInvoice(invoice.id);
    return invoice;
  };
  const receive = async (ref: string, date: string, amount: number, payer: string, customerId: string | null, invoiceId?: string, source: PaymentSource = "MPESA") => {
    const receipt = await prisma.receipt.create({
      data: { businessId: business.id, customerId, source, reference: ref, receivedAt: d(date), amount, payer },
    });
    if (invoiceId) await prisma.receiptAllocation.create({ data: { receiptId: receipt.id, invoiceId, amount } });
    await postReceipt(receipt.id);
  };

  const rotation = [customers.baraka, customers.njeri, customers.kilimani];
  const iso = (m: number, dd: number) => `2026-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  let number = 1;
  for (let month = 1; month <= 9; month++) {
    for (let k = 0; k < 3; k++) {
      const dayOfMonth = 3 + k * 9;
      const issue = iso(month, dayOfMonth);
      const due = dayOfMonth + 14 > 28 ? iso(month + 1, dayOfMonth + 14 - 28) : iso(month, dayOfMonth + 14);
      const customer = rotation[(month + k) % 3];
      const invoice = await sale(`INV-${String(number++).padStart(4, "0")}`, customer.id, issue, due, [
        { item: items["MAB-30-3"], desc: "Mabati iron sheet 3m (gauge 30)", qty: 20 + k * 5, price: 1450 },
        { item: items["CEM-50"], desc: "Cement 50kg (Simba)", qty: 30 + k * 5, price: 950 },
        { item: items["NAIL-1"], desc: "Roofing nails 1kg", qty: 5, price: 350 },
        { item: delivery.id, desc: "Delivery within Nakuru", qty: 1, price: 1500 },
      ]);
      // Everything up to August is paid in full; September is partly outstanding.
      const paidInFull = month < 9 || k === 0;
      if (paidInFull || k === 1) {
        const amount = paidInFull ? Number(invoice.total) : Math.round(Number(invoice.total) / 2);
        const received = new Date(day(issue).getTime() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        await receive(`RC${invoice.number.slice(4)}`, received, amount, customer.name.toUpperCase(), customer.id, invoice.id, k === 2 ? "BANK" : "MPESA");
      }
    }
  }
  // An overdue job that has not been paid at all, and a draft not yet sent.
  await sale(`INV-${String(number++).padStart(4, "0")}`, customers.kilimani.id, "2026-08-05", "2026-09-04", [
    { item: items["CEM-50"], desc: "Cement 50kg (Simba)", qty: 80, price: 930 },
    { item: items["MAB-30-3"], desc: "Mabati iron sheet 3m (gauge 30)", qty: 50, price: 1400 },
    { item: delivery.id, desc: "Delivery within Nakuru", qty: 2, price: 1500 },
  ]);
  await sale(`INV-${String(number++).padStart(4, "0")}`, customers.njeri.id, "2026-10-01", "2026-10-15", [{ item: items["NAIL-1"], desc: "Roofing nails 1kg", qty: 15, price: 350 }], "DRAFT");

  // Over-the-counter cash sales, and a payment nobody has matched yet.
  await receive("TJ11RCV005", "2026-09-28", 17400, "WALK-IN CUSTOMERS", null);

  // ---- Payroll ----
  const staff = [
    { name: "Peter Otieno", jobTitle: "Store manager", basic: 45000, allowances: 5000, taxId: "A009988776K" },
    { name: "Esther Wambui", jobTitle: "Sales attendant", basic: 28000, allowances: 4000, taxId: "A008877665L" },
    { name: "John Kiprono", jobTitle: "Driver / loader", basic: 18000, allowances: 2000, taxId: "A007766554M" },
  ];
  const employees = [];
  for (const e of staff) {
    employees.push(
      await prisma.employee.create({
        data: { businessId: business.id, name: e.name, jobTitle: e.jobTitle, basicSalary: e.basic, allowances: e.allowances, taxId: e.taxId, startDate: day("2025-03-01") },
      })
    );
  }
  for (const [period, payDate] of [["2026-07", "2026-07-31"], ["2026-08", "2026-08-31"], ["2026-09", "2026-09-30"]]) {
    const run = await prisma.payRun.create({
      data: {
        businessId: business.id,
        period,
        payDate: day(payDate),
        status: "APPROVED",
        payslips: {
          create: employees.map((e) => {
            const calc = calculateKenyaPayslip(Number(e.basicSalary), Number(e.allowances));
            return {
              employeeId: e.id,
              basicSalary: Number(e.basicSalary),
              allowances: Number(e.allowances),
              gross: calc.gross,
              taxableIncome: calc.taxableIncome,
              incomeTax: calc.incomeTax,
              employeeDeductions: calc.employeeDeductions,
              employerContributions: calc.employerContributions,
              net: calc.net,
              breakdown: calc.lines,
            };
          }),
        },
      },
      include: { payslips: true },
    });
    await postPayRun(run.id);
    const net = run.payslips.reduce((s, p) => s + Number(p.net), 0);
    const salaryPayment = await prisma.payment.create({
      data: {
        businessId: business.id,
        source: "BANK",
        reference: `SAL${period.replace("-", "")}`,
        paidAt: d(payDate),
        amount: Math.round(net * 100) / 100,
        counterparty: `Salaries ${period}`,
        exemptReason: "SALARIES",
        categoryAccountId: keys.SALARIES_PAYABLE,
      },
    });
    await postPayment(salaryPayment.id);
  }

  console.log(`Demo ready: ${DEMO_EMAIL} / ${DEMO_PASSWORD} (business "${business.name}")`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
