import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { num } from "@/lib/money";
import { formatNumber } from "@/lib/format";
import { businessContext } from "@/lib/form-options";
import { stockLevels } from "@/lib/inventory";
import { PageHeader } from "@/components/page-header";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState, LinkButton } from "@/components/bits";
import { StatCard } from "@/components/stat-card";

export const metadata = { title: "Products & services" };

const KIND_LABEL = { INVENTORY: "Stocked", NON_STOCK: "Product", SERVICE: "Service" } as const;

export default async function ItemsPage() {
  const { business } = await requireBusiness();
  const { fmt } = businessContext(business);
  const [items, stock] = await Promise.all([
    prisma.item.findMany({ where: { businessId: business.id }, orderBy: [{ isArchived: "asc" }, { name: "asc" }] }),
    stockLevels(business.id),
  ]);
  const stockById = new Map(stock.map((s) => [s.id, s]));
  const stockValue = stock.reduce((s, x) => s + x.value, 0);
  const low = stock.filter((s) => s.reorderLevel !== null && s.onHand <= s.reorderLevel);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products & services"
        description="What you sell and buy. Stocked products track quantity and cost."
        action={<LinkButton href="/app/items/new">Add item</LinkButton>}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Stock value (at average cost)" value={fmt(stockValue)} />
        <StatCard label="Stocked products" value={String(stock.length)} />
        <StatCard label="At or below reorder level" value={String(low.length)} />
      </div>
      {items.length === 0 ? (
        <EmptyState title="No items yet">
          <p>Add the products and services you sell to fill invoices quickly and track stock.</p>
        </EmptyState>
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Item</Th>
              <Th>Type</Th>
              <Th className="text-right">Selling price</Th>
              <Th className="text-right">On hand</Th>
              <Th className="text-right">Avg cost</Th>
              <Th className="text-right">Value</Th>
            </Tr>
          </Thead>
          <Tbody>
            {items.map((item) => {
              const s = stockById.get(item.id);
              const isLow = s && s.reorderLevel !== null && s.onHand <= s.reorderLevel;
              return (
                <Tr key={item.id} className={item.isArchived ? "opacity-50" : undefined}>
                  <Td>
                    <Link href={`/app/items/${item.id}`} className="font-medium text-slate-900 hover:underline">
                      {item.name}
                    </Link>
                    {item.sku ? <p className="text-xs text-slate-500">{item.sku}</p> : null}
                  </Td>
                  <Td>
                    <Badge>{KIND_LABEL[item.kind]}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-right">{fmt(num(item.salePrice))}</Td>
                  <Td className="whitespace-nowrap text-right">
                    {s ? (
                      <span className={isLow ? "font-semibold text-rose-700" : undefined}>
                        {formatNumber(s.onHand, s.onHand % 1 ? 2 : 0)} {item.unit ?? ""}
                      </span>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-right">{s ? fmt(s.averageCost) : "—"}</Td>
                  <Td className="whitespace-nowrap text-right">{s ? fmt(s.value) : "—"}</Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      )}
    </div>
  );
}
