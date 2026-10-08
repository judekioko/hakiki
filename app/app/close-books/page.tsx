import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { formatDate, toDateInput } from "@/lib/format";
import { financialYear, currentFinancialYear } from "@/lib/periods";
import { openFrom } from "@/lib/period-lock";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CloseBooksForm } from "@/components/close-books-form";

export const metadata = { title: "Close the books" };

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function CloseBooksPage() {
  const { business } = await requireBusiness();
  const locked = business.lockedThrough;

  const today = new Date();
  const lastMonthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1) - DAY_MS);
  const lastYear = financialYear(currentFinancialYear(business.yearEndMonth, today) - 1, business.yearEndMonth);
  // The period end is the first instant after the year (Nairobi midnight); the last day itself is a day earlier.
  const lastYearEnd = new Date(lastYear.end.getTime() + 3 * 60 * 60 * 1000 - DAY_MS);
  const suggestions = [
    { label: "end of last month", value: toDateInput(lastMonthEnd) },
    { label: `end of ${lastYear.label}`, value: toDateInput(lastYearEnd) },
  ];

  // Drafts dated inside the closed period can no longer be sent, so point them out.
  const [draftInvoices, draftCredits, draftPayRuns] = locked
    ? await Promise.all([
        prisma.salesInvoice.count({ where: { businessId: business.id, status: "DRAFT", issueDate: { lte: locked } } }),
        prisma.creditNote.count({ where: { businessId: business.id, status: "DRAFT", issueDate: { lte: locked } } }),
        prisma.payRun.count({ where: { businessId: business.id, status: "DRAFT", payDate: { lte: locked } } }),
      ])
    : [0, 0, 0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Close the books"
        description="Lock a finished period so figures you have reported or filed cannot change by accident."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm text-slate-600">
            {locked ? (
              <>
                <p>
                  <Badge tone="amber">Closed</Badge> through <strong className="text-slate-900">{formatDate(locked)}</strong>. New entries can be
                  dated from {formatDate(openFrom(locked))} onwards.
                </p>
                {draftInvoices + draftCredits + draftPayRuns > 0 ? (
                  <p className="rounded-md bg-amber-50 p-3 text-amber-800">
                    {[
                      draftInvoices ? `${draftInvoices} draft invoice${draftInvoices === 1 ? "" : "s"}` : null,
                      draftCredits ? `${draftCredits} draft credit note${draftCredits === 1 ? "" : "s"}` : null,
                      draftPayRuns ? `${draftPayRuns} draft pay run${draftPayRuns === 1 ? "" : "s"}` : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}{" "}
                    dated in the closed period can no longer be issued. Change their dates or delete them.
                  </p>
                ) : null}
              </>
            ) : (
              <p>
                <Badge>Open</Badge> Every period can still be changed.
              </p>
            )}
            <p>Once a period is closed:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Invoices, credit notes, bills, payments, receipts, journals, stock adjustments and pay runs dated in it cannot be added, edited, voided or deleted.</li>
              <li>Bank statement lines dated in it are skipped on import, and are not matched automatically.</li>
              <li>To correct something, post an adjustment dated in an open period.</li>
              <li>Closing and reopening are recorded in the audit trail. Only the owner can reopen.</li>
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{locked ? "Change closing date" : "Close a period"}</CardTitle>
          </CardHeader>
          <CardBody>
            {business.role === "STAFF" ? (
              <p className="text-sm text-slate-600">Only an owner or accountant can close or reopen the books.</p>
            ) : (
              <CloseBooksForm
                current={locked ? toDateInput(locked) : null}
                suggestions={suggestions}
                canReopen={business.role === "OWNER"}
                max={toDateInput(today)}
              />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
