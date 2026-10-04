# Hakiki

**Every expense backed by an eTIMS invoice.**

From the 2026 year of income, KRA disallows any business expense that is not backed by an eTIMS invoice. Hakiki
matches the money a business pays out (M-Pesa and bank statements, cash) to the eTIMS invoices its suppliers issue. It
shows what is missing and what that could cost in tax, and lets you chase each supplier on WhatsApp.

It is aimed at small Kenyan businesses and the accountants and tax agents who prepare their returns.

## What it does

- **Import statements.** CSV exports from the M-Pesa business portal or any bank. Columns are detected by header name.
  Only money paid out is imported, and re-imports skip references already loaded.
- **Record eTIMS invoices.** Invoice number, supplier, KRA PIN, amounts and an optional photo or PDF of the original.
- **Match payments to invoices.** Auto-match links payments only when there is one clear match: same amount, close
  date and a matching name. Every payment also shows ranked suggestions. Instalments and lump-sum payments are handled
  through allocations.
- **Learn supplier names.** Once a statement name such as "MABATI CENTRE LTD" is linked to a supplier, future imports
  link to that supplier automatically.
- **Mark exemptions.** Salaries, statutory payments, bank charges, own transfers and similar payments can be marked as
  not needing an invoice, with a reason.
- **Overview.** Coverage %, missing amount, estimated tax at risk, biggest gaps, and a month-by-month chart.
- **Request missing invoices.** Opens WhatsApp with a message listing every payment that still needs an invoice from
  that supplier.
- **Year-end report.** Printable, plus a CSV export for working papers.
- **Accountant mode.** One login can manage several client businesses and switch between them.

## Stack

Next.js 16 (App Router, server actions, `proxy.ts`), Prisma 7 with `@prisma/adapter-pg`, PostgreSQL, Tailwind CSS 4,
and JWT session cookies (`jose`).

## Running locally

```bash
npm install
npm run dev:all        # embedded Postgres on :5433 + Next.js on :3001
```

On Windows PowerShell, if `npm` is blocked by the execution policy, use `npm.cmd` instead, e.g. `npm.cmd run dev:all`.

First time only, in a second terminal:

```bash
npx prisma migrate deploy
npm run seed:demo
```

Open http://localhost:3001.

Demo login: `demo@example.com` / `Demo@1234` (Duka Bora Hardware Ltd, a mix of backed, missing and exempt payments).
Local sign-up test account: `signup.test@example.com` / `Signup@1234`. A sample statement to import is at
`public/samples/mpesa-sample.csv`.

`.env` needs `DATABASE_URL` and `SESSION_SECRET` (see `.env.example`).

### Schema changes

`prisma migrate dev` needs an interactive terminal. To create a migration without one:

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > prisma/migrations/<timestamp>_<name>/migration.sql
npx prisma migrate deploy
```

## Not built yet

- Reading personal M-Pesa PDF statements.
- Scanning the eTIMS QR code, or checking invoices against KRA automatically. Today users check on iTax and mark the
  invoice as checked.
- Reading invoice photos with OCR to fill in the form.
- Team invites. Each user adds their own businesses.
- Billing and subscriptions.

Hakiki is not affiliated with KRA. It does not file returns or issue eTIMS invoices.
