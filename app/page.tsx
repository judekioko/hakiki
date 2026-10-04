import Link from "next/link";
import { Logo } from "@/components/logo";
import { getSession } from "@/lib/session";
import { APP_NAME } from "@/lib/brand";
import { COUNTRIES } from "@/lib/countries";

const features = [
  {
    title: "Invoices that get paid by mobile money",
    body: "Send tax invoices with your paybill or till on them. When the money lands in M-Pesa, MTN MoMo or the bank, Hakiki matches it to the invoice.",
  },
  {
    title: "Import statements, skip the typing",
    body: "Upload a mobile money or bank statement. Money out becomes expenses, money in becomes customer payments, and repeat names are recognised next time.",
  },
  {
    title: "VAT and tax invoices, done right",
    body: "Your country's VAT rates are built in, plus a check that every expense is backed by a valid supplier tax invoice: eTIMS, EFRIS, EBM and others.",
  },
  {
    title: "Stock that keeps itself",
    body: "Purchases add stock at cost and sales remove it, so you always know what is on the shelf, what it is worth and what to reorder.",
  },
  {
    title: "Payroll in minutes",
    body: "Kenyan PAYE, SHIF, NSSF and Housing Levy are calculated for you. Elsewhere, set your country's bands once. Payslips print in one click.",
  },
  {
    title: "Real books for your accountant",
    body: "Double-entry ledger, profit & loss, balance sheet, trial balance, VAT summary and aged debtors. Accountants can manage every client from one login.",
  },
];

export default async function LandingPage() {
  const session = await getSession();

  return (
    <div className="bg-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo href="/" />
        <nav className="flex items-center gap-2">
          {session ? (
            <Link href="/app" className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800">
              Open dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                Sign in
              </Link>
              <Link href="/signup" className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800">
                Start free
              </Link>
            </>
          )}
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pt-16">
        <p className="inline-flex rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-800">
          Built for {COUNTRIES.length} African countries
        </p>
        <h1 className="mt-5 max-w-3xl text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Accounting that speaks mobile money, VAT and payroll the African way.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-slate-600">
          {APP_NAME} runs your invoices, expenses, stock, payroll and tax in one place, in your own currency. It reads
          your mobile money statements so the books mostly keep themselves.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/signup" className="rounded-md bg-teal-700 px-5 py-3 text-sm font-semibold text-white hover:bg-teal-800">
            Start free
          </Link>
          <Link href="#features" className="rounded-md border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            See what it does
          </Link>
        </div>
        <div className="mt-10 flex flex-wrap gap-2">
          {COUNTRIES.map((c) => (
            <span key={c.code} className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600">
              {c.name} · {c.currency}
            </span>
          ))}
        </div>
      </section>

      <section id="features" className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-bold text-slate-900">Everything a growing business needs</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-xl border border-slate-200 bg-white p-6">
                <h3 className="font-semibold text-slate-900">{f.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-slate-200 bg-teal-800 text-white">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-4 py-12 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h2 className="text-xl font-bold">Your books, ready for the tax return.</h2>
            <p className="mt-1 text-teal-100">Set up in five minutes. Bring last year&apos;s statements and catch up in an afternoon.</p>
          </div>
          <Link href="/signup" className="rounded-md bg-white px-5 py-3 text-sm font-semibold text-teal-800 hover:bg-teal-50">
            Create your account
          </Link>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-4 py-8 text-xs text-slate-500 sm:px-6">
        {APP_NAME} is not affiliated with any tax authority and does not yet file returns or connect to national
        e-invoicing systems. Tax rates are defaults; confirm them with your tax adviser.
      </footer>
    </div>
  );
}
