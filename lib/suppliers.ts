import "server-only";
import { prisma } from "./prisma";
import { normaliseAlias } from "./matching";

export async function findOrCreateSupplier(businessId: string, name: string, kraPin?: string | null) {
  if (kraPin) {
    const byPin = await prisma.supplier.findFirst({ where: { businessId, kraPin } });
    if (byPin) return byPin;
  }
  const byName = await prisma.supplier.findFirst({
    where: { businessId, name: { equals: name.trim(), mode: "insensitive" } },
  });
  if (byName) {
    if (kraPin && !byName.kraPin) {
      return prisma.supplier.update({ where: { id: byName.id }, data: { kraPin } });
    }
    return byName;
  }
  return prisma.supplier.create({
    data: { businessId, name: name.trim(), kraPin: kraPin ?? null, aliases: [normaliseAlias(name)] },
  });
}

// Remember how a supplier's name appears on statements, and link every payment with that name.
export async function learnAlias(businessId: string, supplierId: string, counterparty: string) {
  const alias = normaliseAlias(counterparty);
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier || supplier.businessId !== businessId) return;
  if (!supplier.aliases.includes(alias)) {
    await prisma.supplier.update({ where: { id: supplierId }, data: { aliases: { push: alias } } });
  }
  await prisma.payment.updateMany({
    where: { businessId, supplierId: null, counterparty: { equals: counterparty, mode: "insensitive" } },
    data: { supplierId },
  });
}

// Map of normalised statement name → supplier id, for linking freshly imported payments.
export async function aliasIndex(businessId: string) {
  const suppliers = await prisma.supplier.findMany({ where: { businessId }, select: { id: true, aliases: true } });
  const index = new Map<string, string>();
  for (const s of suppliers) for (const a of s.aliases) index.set(a, s.id);
  return index;
}
