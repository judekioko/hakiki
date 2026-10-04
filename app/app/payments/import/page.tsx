import { requireBusiness } from "@/lib/business";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ImportForm } from "@/components/forms";

export const metadata = { title: "Import statement" };

export default async function ImportPage() {
  const { business } = await requireBusiness();
  const batches = await prisma.importBatch.findMany({
    where: { businessId: business.id },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Import a statement" description="Bring in the money your business paid out, then match it to invoices." />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardBody>
            <ImportForm />
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Getting the CSV</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm text-slate-600">
            <p>
              <strong className="text-slate-800">M-Pesa till or paybill:</strong> on the M-Pesa business portal, open
              the account statement for the period and export it. If it downloads as Excel, open it and save as CSV.
            </p>
            <p>
              <strong className="text-slate-800">Bank:</strong> download the statement from internet banking as CSV or
              Excel (then save as CSV).
            </p>
            <p>
              Hakiki finds the date, reference, description and paid-out columns by their names, so most layouts work.
              If a file is not recognised, check that it has a date column and a withdrawn/debit column.
            </p>
            <p>Personal M-Pesa statements come as PDFs and are not supported yet. Add those payments by hand.</p>
            <p>
              <a href="/samples/mpesa-sample.csv" download className="font-medium text-teal-700 underline">
                Download a sample M-Pesa CSV
              </a>{" "}
              to see the expected layout.
            </p>
          </CardBody>
        </Card>
      </div>

      {batches.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Recent imports</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="divide-y divide-slate-100 text-sm">
              {batches.map((b) => (
                <li key={b.id} className="flex justify-between gap-3 py-2">
                  <span className="truncate text-slate-800">{b.fileName}</span>
                  <span className="shrink-0 text-slate-500">
                    {b.imported} added · {b.skipped} skipped · {formatDate(b.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
