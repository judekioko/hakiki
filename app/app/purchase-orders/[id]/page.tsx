import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num } from "@/lib/money";
import { currencyDigits, formatDate, formatNumber, toDateInput } from "@/lib/format";
import { businessContext } from "@/lib/form-options";
import { PO_DISPLAY, displayStatus, orderProgress } from "@/lib/purchase-orders";
import { deleteGoodsReceipt, deletePurchaseOrder, setPurchaseOrderStatus } from "@/lib/actions/purchase-orders";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/bits";
import { PrintButton } from "@/components/print-button";
import { SubmitButton } from "@/components/forms";
import { GoodsReceiptForm } from "@/components/goods-receipt-form";

export const metadata = { title: "Purchase order" };

function StatusButton({ id, status, children, variant }: { id: string; status: string; children: React.ReactNode; variant?: "secondary" | "ghost" }) {
  return (
    <form action={setPurchaseOrderStatus}>
      <input type="hidden" name="orderId" value={id} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton variant={variant ?? "secondary"} size="sm">
        {children}
      </SubmitButton>
    </form>
  );
}

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { business } = await requireBusiness();
  const { id } = await params;
  const order = await prisma.purchaseOrder.findFirst({
    where: { id, businessId: business.id },
    include: {
      supplier: true,
      receipts: { orderBy: { receivedDate: "desc" }, include: { lines: true } },
      bills: { select: { id: true, invoiceNumber: true, invoiceDate: true, totalAmount: true } },
    },
  });
  if (!order) notFound();

  const { lines, progress } = await orderProgress(order.id);
  const { fmt, pack } = businessContext(business);
  const status = displayStatus(order.status, progress);
  const display = PO_DISPLAY[status];
  const dp = currencyDigits(business.currency);
  const locked = order.receipts.length + order.bills.length > 0;
  const progressOf = (lineId: string) => progress.find((p) => p.id === lineId)!;
  const anyOutstandingReceipt = progress.some((p) => p.ordered - p.received > 0.0005);
  const anyUnbilled = progress.some((p) => Math.max(p.received, 0) - p.billed > 0.0005 || (order.receipts.length === 0 && p.ordered - p.billed > 0.0005));
  const lineNames = new Map(lines.map((l) => [l.id, l.description]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <Link href="/app/purchase-orders" className="text-sm text-slate-500 hover:underline">
            ← Purchase orders
          </Link>
          <Badge tone={display.tone}>{display.label}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {order.status === "DRAFT" || (order.status === "ORDERED" && !locked) ? (
            <LinkButton href={`/app/purchase-orders/${order.id}/edit`} variant="secondary">
              Edit
            </LinkButton>
          ) : null}
          {order.status === "DRAFT" ? <StatusButton id={order.id} status="ORDERED">Place order</StatusButton> : null}
          {order.status === "ORDERED" && anyUnbilled ? (
            <LinkButton href={`/app/invoices/new?po=${order.id}`}>Record supplier bill</LinkButton>
          ) : null}
          {order.status === "ORDERED" ? <StatusButton id={order.id} status="CLOSED">Close order</StatusButton> : null}
          {order.status === "CLOSED" ? <StatusButton id={order.id} status="ORDERED">Reopen</StatusButton> : null}
          <PrintButton />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <article className="rounded-lg border border-slate-200 bg-white p-6 sm:p-8 lg:col-span-2 print:col-span-3 print:border-0 print:p-0">
          <header className="flex flex-wrap justify-between gap-6 border-b border-slate-200 pb-6">
            <div>
              <h1 className="text-xl font-bold text-slate-900">{business.name}</h1>
              {business.address ? <p className="text-sm text-slate-600">{business.address}</p> : null}
              <p className="text-sm text-slate-600">{[business.phone, business.email].filter(Boolean).join(" · ")}</p>
              {business.kraPin ? (
                <p className="text-sm text-slate-600">
                  {pack.taxIdLabel}: {business.kraPin}
                </p>
              ) : null}
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold tracking-tight text-slate-900">PURCHASE ORDER</p>
              <p className="font-mono text-sm">{order.number}</p>
              <p className="mt-2 text-sm text-slate-600">Date: {formatDate(order.orderDate)}</p>
              {order.expectedDate ? <p className="text-sm text-slate-600">Expected: {formatDate(order.expectedDate)}</p> : null}
            </div>
          </header>

          <section className="py-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Supplier</p>
            <Link href={`/app/suppliers/${order.supplierId}`} className="font-semibold text-slate-900 hover:underline">
              {order.supplier.name}
            </Link>
            {order.supplier.phone ? <p className="text-sm text-slate-600">{order.supplier.phone}</p> : null}
            {order.supplier.kraPin ? (
              <p className="text-sm text-slate-600">
                {pack.taxIdLabel}: {order.supplier.kraPin}
              </p>
            ) : null}
            {order.reference ? <p className="text-sm text-slate-600">Ref: {order.reference}</p> : null}
          </section>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2">Description</th>
                <th className="py-2 text-right">Ordered</th>
                <th className="py-2 text-right print:hidden">Received</th>
                <th className="py-2 text-right print:hidden">Billed</th>
                <th className="py-2 text-right">Price</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const p = progressOf(l.id);
                const short = order.status === "ORDERED" && p.received > 0 && p.received + 0.0005 < p.ordered;
                return (
                  <tr key={l.id} className="border-b border-slate-100">
                    <td className="py-2">{l.description}</td>
                    <td className="py-2 text-right">{formatNumber(p.ordered, p.ordered % 1 ? 2 : 0)}</td>
                    <td className={`py-2 text-right print:hidden ${short ? "text-amber-700" : ""}`}>{formatNumber(p.received, p.received % 1 ? 2 : 0)}</td>
                    <td className="py-2 text-right print:hidden">{formatNumber(p.billed, p.billed % 1 ? 2 : 0)}</td>
                    <td className="py-2 text-right">{formatNumber(num(l.unitPrice), dp)}</td>
                    <td className="py-2 text-right">{formatNumber(num(l.lineTotal), dp)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <dl className="ml-auto mt-4 w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Subtotal</dt>
              <dd>{fmt(num(order.subtotal))}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">{pack.vatName}</dt>
              <dd>{fmt(num(order.taxTotal))}</dd>
            </div>
            <div className="flex justify-between border-t border-slate-300 pt-1 text-base font-bold">
              <dt>Total</dt>
              <dd>{fmt(num(order.total))}</dd>
            </div>
          </dl>
          {order.notes ? <p className="mt-6 text-sm text-slate-600">{order.notes}</p> : null}
        </article>

        <aside className="space-y-6 print:hidden">
          {order.status === "ORDERED" && anyOutstandingReceipt ? (
            <Card>
              <CardHeader>
                <CardTitle>Goods received</CardTitle>
              </CardHeader>
              <CardBody>
                <GoodsReceiptForm
                  key={progress.map((p) => p.received).join("-")}
                  orderId={order.id}
                  today={toDateInput(new Date())}
                  lines={lines.map((l) => ({
                    id: l.id,
                    description: l.description,
                    ordered: progressOf(l.id).ordered,
                    received: progressOf(l.id).received,
                  }))}
                />
                <p className="mt-3 text-xs text-slate-500">
                  Receiving records what arrived. Stock and the amount you owe the supplier are booked when you record the bill.
                </p>
              </CardBody>
            </Card>
          ) : null}

          {order.receipts.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Deliveries</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="divide-y divide-slate-100 text-sm">
                  {order.receipts.map((r) => (
                    <li key={r.id} className="space-y-1 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">
                          {r.number} · {formatDate(r.receivedDate)}
                        </span>
                        <form action={deleteGoodsReceipt}>
                          <input type="hidden" name="receiptId" value={r.id} />
                          <SubmitButton variant="ghost" size="sm" pendingText="...">
                            Delete
                          </SubmitButton>
                        </form>
                      </div>
                      <ul className="text-xs text-slate-500">
                        {r.lines.map((l) => (
                          <li key={l.id}>
                            {formatNumber(num(l.quantity), num(l.quantity) % 1 ? 2 : 0)} × {lineNames.get(l.orderLineId)}
                          </li>
                        ))}
                      </ul>
                      {r.note ? <p className="text-xs text-slate-500">{r.note}</p> : null}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          {order.bills.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Supplier bills</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="divide-y divide-slate-100 text-sm">
                  {order.bills.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-2 py-2">
                      <Link href={`/app/invoices/${b.id}`} className="hover:underline">
                        {b.invoiceNumber} · {formatDate(b.invoiceDate)}
                      </Link>
                      <span>{fmt(num(b.totalAmount))}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {(order.status === "DRAFT" || order.status === "ORDERED") && !locked ? (
              <StatusButton id={order.id} status="CANCELLED" variant="ghost">
                Cancel order
              </StatusButton>
            ) : null}
            {(order.status === "DRAFT" || order.status === "CANCELLED") && !locked ? (
              <form action={deletePurchaseOrder}>
                <input type="hidden" name="orderId" value={order.id} />
                <SubmitButton variant="ghost" size="sm">
                  Delete
                </SubmitButton>
              </form>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
