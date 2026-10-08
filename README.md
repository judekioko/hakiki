# Hakiki

**Accounting for African businesses.** Invoices, mobile money and bank reconciliation, VAT, stock and payroll in one
place, in the business's own currency.

## Features

- **Countries:** 15 country packs (Kenya, Uganda, Tanzania, Rwanda, Ethiopia, Nigeria, Ghana, South Africa, Zambia,
  Malawi, Egypt, Côte d'Ivoire, Senegal, Cameroon, DR Congo). Each sets currency, VAT rates, tax ID wording, the national
  e-invoicing system name and mobile money providers (`lib/countries.ts`). Rates are editable defaults.
- **Double-entry ledger:** every document posts its own journal entry, rebuilt whenever the document changes
  (`lib/ledger.ts`). Chart of accounts, account ledgers, manual journals.
- **Sales:** customers, tax invoices (draft / sent / void), printable invoices, money received. Receipts are matched to
  invoices automatically by amount, customer and invoice number.
- **Credit notes:** reverse a sale (and its tax) in full or in part, optionally returning stock. A credit note issued
  against an invoice is applied to it automatically; unused credit can be applied to another invoice of the same customer.
- **Audit trail:** every create, edit, void, delete and approval is logged with who did it and when (`lib/audit.ts`,
  `/app/audit`). Entries are append-only.
- **Closing the books:** lock everything up to a date (Accounting → Close the books). Documents, journals, stock
  adjustments and pay runs dated in a closed period cannot be added, edited, voided or deleted, statement imports skip
  closed-period rows, and the ledger itself refuses the write (`lib/period-lock.ts`). Only owners can reopen.
- **Bank reconciliation:** for each bank, mobile money or cash account, enter a statement's closing date and balance, tick
  off the ledger lines that appear on it, and finish once the difference is zero. Cleared lines are protected from
  edits, voids and deletes until the reconciliation is undone (`lib/reconcile.ts`).
- **Quotations:** draft, send, mark accepted or declined (sent ones show as expired after their valid-until date), then
  convert to a draft invoice in one click. Nothing posts to the books until the invoice is sent.
- **Recurring invoices:** weekly, monthly, quarterly or yearly schedules that issue invoices as drafts or already sent.
  Each invoice is priced afresh, missed runs are caught up, and invoices that would fall in closed books are dated the
  first open day. Due schedules run when someone opens the app; for unattended runs call
  `GET /api/cron/recurring` with `Authorization: Bearer $CRON_SECRET` from a scheduler.
- **Purchase orders:** order from a supplier, record deliveries (goods received notes, partial deliveries supported),
  and raise the supplier bill from the order with quantities prefilled from what arrived and has not been billed.
  Ordered, received and billed are tracked per line. Orders and deliveries post nothing; stock and the payable are
  booked when the bill is recorded.
- **Supplier credit notes:** record a credit from a supplier (goods returned, overcharge, discount), optionally taking
  returned stock out of inventory. It reverses the bill's cost and input tax, is applied to the bill it corrects, and
  reduces the bill's balance in payables ageing and payment matching.
- **Customer statements:** a printable statement per customer for any date range (balance brought forward, invoices,
  payments, credit notes, running balance), the unpaid invoices with ageing, and one-click WhatsApp / email messages.
  The balances use the same rules as the ledger, so all customers' statements add up to accounts receivable.
- **Payment reminders:** a list of customers with overdue invoices (most overdue first) with a friendly, firm or final
  notice prepared for each, sent from your own WhatsApp or email. Each send is recorded, so the list shows when and how
  often a customer was last reminded, and you can filter to those not chased in the last week.
- **Purchases:** supplier bills (single total or line items), money paid out, suppliers, and the supplier tax-invoice
  check (eTIMS, EFRIS, EBM...) with WhatsApp requests for missing invoices.
- **Statement import:** bank and mobile money CSVs. Money out becomes payments, money in becomes receipts. Columns are
  detected by header name; re-imports skip known references.
- **Stock:** stocked items, purchases in at cost, sales out at weighted average cost, adjustments, reorder alerts.
- **Payroll:** Kenyan PAYE, SHIF, NSSF and Housing Levy built in (`lib/payroll.ts`); other countries use tax bands and
  deductions the business configures. Pay runs, approval, payslips, salary and statutory payments.
- **Reports:** profit & loss, balance sheet, trial balance, VAT summary, aged receivables and payables, tax-invoice
  backing report with CSV export.
- **Accountants:** one login can manage several businesses.

## Stack

Next.js 16 (App Router, server actions, `proxy.ts`), Prisma 7 with `@prisma/adapter-pg`, PostgreSQL, Tailwind CSS 4,
JWT session cookies (`jose`).

## Running locally

```bash
npm install
npm run dev:all        # embedded Postgres on :5433 + Next.js on :3001
```

On Windows PowerShell, use `npm.cmd` if `npm` is blocked by the execution policy.

First time only, in a second terminal:

```bash
npx prisma migrate deploy
npm run seed:demo      # optional sample business: demo@example.com / Demo@1234
```

`.env` needs `DATABASE_URL` and `SESSION_SECRET` (see `.env.example`).

### Schema changes

`prisma migrate dev` needs an interactive terminal. Without one:

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > prisma/migrations/<timestamp>_<name>/migration.sql
npx prisma migrate deploy
```

## Not built yet

- Direct connection to national e-invoicing systems (eTIMS, EFRIS, EBM) and mobile money APIs (M-Pesa Daraja, MoMo).
- PDF statement import.
- Multi-currency transactions within one business.

Hakiki is not affiliated with any tax authority. Tax rates and payroll rules are defaults to confirm with an adviser.
