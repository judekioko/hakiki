import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { buildInvoiceRequestMessage } from "@/lib/invoice-request";
import { toWhatsAppNumber } from "@/lib/kra";
import { num, round2 } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { businessContext } from "@/lib/form-options";
import { requestInvoicesOnWhatsApp } from "@/lib/actions/suppliers";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { StatusBadge } from "@/components/bits";
import { SubmitButton, SupplierForm } from "@/components/forms";
import { loadPayments } from "@/lib/coverage";

export const metadata = { title: "Supplier" };

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireBusiness();
  const { fmt, taxIdLabel } = businessContext(business);
  const { id } = await params;
  const supplier = await prisma.supplier.findFirst({
    where: { id, businessId: business.id },
    include: { invoices: { orderBy: { invoiceDate: "desc" } } },
  });
  if (!supplier) notFound();

  const [rows, request] = await Promise.all([
    loadPayments(business.id, undefined, { supplierId: supplier.id }),
    buildInvoiceRequestMessage(business.id, supplier.id),
  ]);
  const unbacked = round2(rows.reduce((s, r) => s + r.unbacked, 0));
  const whatsApp = toWhatsAppNumber(supplier.phone);

  return (
    <div className="space-y-6">
      <PageHeader
        title={supplier.name}
        description={supplier.kraPin ? `${taxIdLabel} ${supplier.kraPin}` : `No ${taxIdLabel} saved`}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardBody>
              {rows.length === 0 ? (
                <p className="text-sm text-slate-500">No payments linked to this supplier yet.</p>
              ) : (
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Date</Th>
                      <Th>Reference</Th>
                      <Th className="text-right">Amount</Th>
                      <Th>Status</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {rows.map((r) => (
                      <Tr key={r.id}>
                        <Td className="whitespace-nowrap">
                          <Link href={`/app/payments/${r.id}`} className="hover:underline">
                            {formatDate(r.paidAt)}
                          </Link>
                        </Td>
                        <Td className="text-xs text-slate-500">{r.reference ?? "—"}</Td>
                        <Td className="whitespace-nowrap text-right">{fmt(r.amount)}</Td>
                        <Td>
                          <StatusBadge status={r.status} />
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Bills received</CardTitle>
            </CardHeader>
            <CardBody>
              {supplier.invoices.length === 0 ? (
                <p className="text-sm text-slate-500">None yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {supplier.invoices.map((inv) => (
                    <li key={inv.id} className="flex justify-between gap-3 py-2">
                      <Link href={`/app/invoices/${inv.id}`} className="font-mono text-xs text-slate-800 hover:underline">
                        {inv.invoiceNumber}
                      </Link>
                      <span className="text-slate-500">
                        {formatDate(inv.invoiceDate)} · {fmt(num(inv.totalAmount))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Request missing invoices</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              {request.missing.length === 0 ? (
                <p className="text-slate-500">Nothing to request. Every payment to {supplier.name} is backed.</p>
              ) : (
                <>
                  <p>
                    <strong className="text-rose-700">{fmt(unbacked)}</strong> across {request.missing.length}{" "}
                    payment{request.missing.length === 1 ? "" : "s"} has no invoice.
                  </p>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-sans text-xs text-slate-700">
                    {request.text}
                  </pre>
                  {whatsApp ? (
                    <form action={requestInvoicesOnWhatsApp}>
                      <input type="hidden" name="supplierId" value={supplier.id} />
                      <SubmitButton className="w-full" pendingText="Opening WhatsApp...">
                        Send on WhatsApp
                      </SubmitButton>
                    </form>
                  ) : (
                    <p className="text-xs text-slate-500">Save the supplier&apos;s WhatsApp number below to send this in one tap, or copy the message.</p>
                  )}
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <SupplierForm
                mode="edit"
                supplierId={supplier.id}
                defaults={{ name: supplier.name, kraPin: supplier.kraPin, phone: supplier.phone }}
              />
              {supplier.aliases.length > 0 ? (
                <div className="text-xs text-slate-500">
                  <p className="font-medium text-slate-600">Names on statements</p>
                  <p>{supplier.aliases.join(" · ")}</p>
                </div>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
