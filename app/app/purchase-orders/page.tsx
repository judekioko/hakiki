import Link from "next/link";
import { requireBusiness } from "@/lib/business";
import { businessContext } from "@/lib/form-options";
import { formatDate } from "@/lib/format";
import { num } from "@/lib/money";
import { PO_DISPLAY, orderSummaries, type PoDisplayStatus } from "@/lib/purchase-orders";
import { PageHeader } from "@/components/page-header";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState, FilterTabs, LinkButton } from "@/components/bits";

export const metadata = { title: "Purchase orders" };

const FILTERS: { value: string; label: string; match: (s: PoDisplayStatus) => boolean }[] = [
  { value: "open", label: "Open", match: (s) => s === "DRAFT" || s === "ORDERED" || s === "PART_RECEIVED" || s === "RECEIVED" },
  { value: "COMPLETE", label: "Complete", match: (s) => s === "COMPLETE" },
  { value: "closed", label: "Closed / cancelled", match: (s) => s === "CLOSED" || s === "CANCELLED" },
  { value: "all", label: "All", match: () => true },
];

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { business } = await requireBusiness();
  const { fmt } = businessContext(business);
  const { status: statusParam } = await searchParams;
  const filter = FILTERS.find((f) => f.value === statusParam) ?? FILTERS[0];

  const rows = await orderSummaries(business.id);
  const shown = rows.filter((r) => filter.match(r.status));
  const onOrder = rows.filter((r) => r.status === "ORDERED" || r.status === "PART_RECEIVED").reduce((s, r) => s + num(r.order.total), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Purchase orders"
        description={`${fmt(onOrder)} on order and not yet fully received`}
        action={<LinkButton href="/app/purchase-orders/new">New purchase order</LinkButton>}
      />
      <FilterTabs
        basePath="/app/purchase-orders"
        current={filter.value}
        options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: rows.filter((r) => f.match(r.status)).length }))}
      />
      {shown.length === 0 ? (
        <EmptyState title={rows.length === 0 ? "No purchase orders yet" : "Nothing in this view"}>
          {rows.length === 0 ? (
            <p>Order from a supplier here, record deliveries as they arrive, then turn the order into the supplier bill.</p>
          ) : null}
        </EmptyState>
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Number</Th>
              <Th>Supplier</Th>
              <Th>Ordered</Th>
              <Th>Expected</Th>
              <Th className="text-right">Total</Th>
              <Th>Status</Th>
            </Tr>
          </Thead>
          <Tbody>
            {shown.map(({ order, status }) => (
              <Tr key={order.id}>
                <Td>
                  <Link href={`/app/purchase-orders/${order.id}`} className="font-medium text-slate-900 hover:underline">
                    {order.number}
                  </Link>
                </Td>
                <Td>{order.supplier.name}</Td>
                <Td className="whitespace-nowrap">{formatDate(order.orderDate)}</Td>
                <Td className="whitespace-nowrap">{order.expectedDate ? formatDate(order.expectedDate) : "—"}</Td>
                <Td className="whitespace-nowrap text-right">{fmt(num(order.total))}</Td>
                <Td>
                  <Badge tone={PO_DISPLAY[status].tone}>{PO_DISPLAY[status].label}</Badge>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </div>
  );
}
