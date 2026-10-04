import Link from "next/link";
import { Logo } from "@/components/logo";
import { getSession } from "@/lib/session";
import { APP_NAME } from "@/lib/brand";

const steps = [
  {
    title: "Import your payments",
    body: "Upload your M-Pesa business or bank statement as CSV, or record cash payments. Money coming in is ignored.",
  },
  {
    title: "Add supplier eTIMS invoices",
    body: "Snap a photo or attach the PDF. Hakiki matches each invoice to the payment it belongs to: same amount, nearby date, same supplier.",
  },
  {
    title: "Chase the gaps",
    body: "See every payment with no invoice and the tax it could cost you. Send each supplier one WhatsApp listing what they owe you.",
  },
];

const features = [
  ["Tax at risk, in shillings", "Unbacked expenses × your tax rate, so you know what a missing invoice actually costs."],
  ["Learns your suppliers", "Match a statement name once and future imports link to that supplier automatically."],
  ["Instalments and lump sums", "One invoice paid in parts, or one payment covering several invoices, both reconcile."],
  ["Not every payment needs one", "Mark salaries, statutory payments, bank charges and transfers as not needing an invoice, with a reason."],
  ["Built for accountants too", "Switch between client businesses and print a year-end report for each."],
  ["Proof kept with the record", "The invoice photo or PDF stays attached to the payment it backs."],
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
        <p className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
          From the 2026 year of income, KRA disallows expenses without an eTIMS invoice
        </p>
        <h1 className="mt-5 max-w-3xl text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Find the expenses KRA will reject before you file.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-slate-600">
          {APP_NAME} matches every M-Pesa and bank payment your business makes to a supplier eTIMS invoice. It shows
          what is missing, what it could cost in tax, and who to chase.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/signup" className="rounded-md bg-teal-700 px-5 py-3 text-sm font-semibold text-white hover:bg-teal-800">
            Check my expenses free
          </Link>
          <Link href="#how" className="rounded-md border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            How it works
          </Link>
        </div>

        <div className="mt-12 grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-5 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Paid to suppliers</p>
            <p className="mt-1 text-2xl font-semibold">KES 4,820,000</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Without an eTIMS invoice</p>
            <p className="mt-1 text-2xl font-semibold text-rose-700">KES 1,135,500</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Tax at risk (30%)</p>
            <p className="mt-1 text-2xl font-semibold text-rose-700">KES 340,650</p>
          </div>
          <p className="text-xs text-slate-500 sm:col-span-3">Example figures for illustration.</p>
        </div>
      </section>

      <section id="how" className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-bold text-slate-900">How it works</h2>
          <ol className="mt-8 grid gap-6 md:grid-cols-3">
            {steps.map((step, i) => (
              <li key={step.title} className="rounded-xl border border-slate-200 bg-white p-6">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-700 text-sm font-bold text-white">
                  {i + 1}
                </span>
                <h3 className="mt-4 font-semibold text-slate-900">{step.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-2xl font-bold text-slate-900">Built for how Kenyan businesses actually pay</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(([title, body]) => (
            <div key={title}>
              <h3 className="font-semibold text-slate-900">{title}</h3>
              <p className="mt-1 text-sm text-slate-600">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-slate-200 bg-teal-800 text-white">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-4 py-12 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h2 className="text-xl font-bold">2026 returns are due by 30 June 2027.</h2>
            <p className="mt-1 text-teal-100">Every month you wait is another month of invoices to chase.</p>
          </div>
          <Link href="/signup" className="rounded-md bg-white px-5 py-3 text-sm font-semibold text-teal-800 hover:bg-teal-50">
            Start free
          </Link>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-4 py-8 text-xs text-slate-500 sm:px-6">
        {APP_NAME} is not affiliated with the Kenya Revenue Authority. It does not file returns or issue eTIMS invoices.
        Confirm tax treatment with your tax adviser.
      </footer>
    </div>
  );
}
