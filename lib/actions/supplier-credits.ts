"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { blockedByLock } from "@/lib/lock-guard";
import { num, round2 } from "@/lib/money";
import { audit } from "@/lib/audit";
import { accountIdsByKey, postSupplierCredit } from "@/lib/ledger";
import { priceLines, totals } from "@/lib/document-lines";
import { documentLockMessage, lockMessage } from "@/lib/period-lock";
import { runAutoMatch } from "@/lib/auto-match";
import { firstError, linesSchema, parseJsonField, supplierCreditSchema } from "@/lib/validators";
import type { ActionState } from "./types";

function revalidateAll() {
  revalidatePath("/app", "layout");
}

async function billBalance(billId: string) {
  const bill = await prisma.invoice.findUnique({
    where: { id: billId },
    include: { allocations: { select: { amount: true } }, creditAllocations: { select: { amount: true } } },
  });
  if (!bill) return 0;
  const settled = [...bill.allocations, ...bill.creditAllocations].reduce((s, a) => s + num(a.amount), 0);
  return round2(num(bill.totalAmount) - settled);
}

// Takes as much of the credit off the bill as it still owes. Moves no money, so the ledger is untouched.
async function applyCredit(creditId: string, billId: string) {
  const credit = await prisma.supplierCredit.findUnique({ where: { id: creditId }, include: { allocations: true } });
  if (!credit || credit.status !== "ISSUED") return 0;
  const unused = round2(num(credit.total) - credit.allocations.reduce((s, a) => s + num(a.amount), 0));
  const amount = round2(Math.min(unused, await billBalance(billId)));
  if (amount <= 0.009) return 0;
  await prisma.supplierCreditAllocation.upsert({
    where: { creditId_billId: { creditId, billId } },
    create: { creditId, billId, amount },
    update: { amount: { increment: amount } },
  });
  return amount;
}

export async function saveSupplierCredit(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const parsed = supplierCreditSchema.safeParse({
    supplierId: formData.get("supplierId") ?? "",
    billId: formData.get("billId") ?? "",
    number: formData.get("number"),
    creditDate: formData.get("creditDate"),
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const data = parsed.data;
  const number = data.number.toUpperCase();

  const supplier = await prisma.supplier.findFirst({ where: { id: data.supplierId, businessId: business.id } });
  if (!supplier) return { error: "Supplier not found" };
  const bill = data.billId
    ? await prisma.invoice.findFirst({ where: { id: data.billId, businessId: business.id, supplierId: supplier.id } })
    : null;
  if (data.billId && !bill) return { error: "Choose a bill that belongs to this supplier" };

  const lineInput = parseJsonField(formData.get("lines"), linesSchema);
  if (lineInput.error) return { error: lineInput.error };
  const keys = await accountIdsByKey(business.id);
  const priced = await priceLines(business.id, lineInput.data!, "purchase", keys.UNCATEGORISED_EXPENSE, true);
  if (priced.error) return { error: priced.error };
  const sums = totals(priced.lines!);
  if (sums.total <= 0) return { error: "A credit note must be for more than zero" };
  if (bill && sums.total > num(bill.totalAmount) + 0.01) {
    return { error: `The credit cannot be more than the bill total (${num(bill.totalAmount)})` };
  }

  const creditId = String(formData.get("creditId") ?? "");
  const issue = formData.get("intent") === "issue";
  const creditAt = new Date(`${data.creditDate}T00:00:00Z`);
  const locked = creditId ? await documentLockMessage(business, "supplierCredit", creditId, creditAt) : lockMessage(business, creditAt);
  if (locked) return { error: locked };

  const duplicate = await prisma.supplierCredit.findFirst({
    where: { businessId: business.id, number, ...(creditId ? { id: { not: creditId } } : {}) },
  });
  if (duplicate) return { error: `Credit note ${number} has already been recorded` };

  const header = {
    supplierId: supplier.id,
    billId: bill?.id ?? null,
    number,
    creditDate: creditAt,
    reason: data.reason ?? null,
    returnStock: formData.get("returnStock") === "on",
    ...sums,
  };

  let id: string;
  if (creditId) {
    const existing = await prisma.supplierCredit.findFirst({ where: { id: creditId, businessId: business.id } });
    if (!existing) return { error: "Credit note not found" };
    if (existing.status !== "DRAFT") return { error: "Only a draft credit note can be edited. Void it and record a new one." };
    await prisma.$transaction([
      prisma.supplierCreditLine.deleteMany({ where: { creditId } }),
      prisma.supplierCredit.update({
        where: { id: creditId },
        data: { ...header, status: issue ? "ISSUED" : "DRAFT", lines: { create: priced.lines!.map((l) => ({ ...l })) } },
      }),
    ]);
    id = creditId;
  } else {
    const created = await prisma.supplierCredit.create({
      data: {
        businessId: business.id,
        status: issue ? "ISSUED" : "DRAFT",
        ...header,
        lines: { create: priced.lines!.map((l) => ({ ...l })) },
      },
    });
    id = created.id;
  }

  await postSupplierCredit(id);
  if (issue && bill) await applyCredit(id, bill.id);
  await audit(
    business.id,
    creditId ? "UPDATE" : "CREATE",
    "SUPPLIER_CREDIT",
    id,
    `${issue ? "Recorded" : "Saved draft"} supplier credit ${number} from ${supplier.name} (${sums.total.toFixed(2)})`
  );
  revalidateAll();
  redirect(`/app/supplier-credits/${id}`);
}

async function ownedCredit(businessId: string, formData: FormData) {
  return prisma.supplierCredit.findFirst({
    where: { id: String(formData.get("creditId")), businessId },
    include: { allocations: true, supplier: { select: { name: true } } },
  });
}

export async function issueSupplierCredit(formData: FormData) {
  const { business } = await requireBusiness();
  const credit = await ownedCredit(business.id, formData);
  if (!credit || credit.status !== "DRAFT") return;
  if (await blockedByLock(business, "supplierCredit", credit.id)) return;
  await prisma.supplierCredit.update({ where: { id: credit.id }, data: { status: "ISSUED" } });
  await postSupplierCredit(credit.id);
  if (credit.billId) await applyCredit(credit.id, credit.billId);
  await audit(business.id, "SEND", "SUPPLIER_CREDIT", credit.id, `Recorded supplier credit ${credit.number} from ${credit.supplier.name}`);
  revalidateAll();
}

export async function voidSupplierCredit(formData: FormData) {
  const { business } = await requireBusiness();
  const credit = await ownedCredit(business.id, formData);
  if (!credit || credit.status !== "ISSUED") return;
  if (await blockedByLock(business, "supplierCredit", credit.id)) return;
  // The bills it was reducing are owed in full again.
  await prisma.supplierCreditAllocation.deleteMany({ where: { creditId: credit.id } });
  await prisma.supplierCredit.update({ where: { id: credit.id }, data: { status: "VOID" } });
  await postSupplierCredit(credit.id);
  await audit(business.id, "VOID", "SUPPLIER_CREDIT", credit.id, `Voided supplier credit ${credit.number} from ${credit.supplier.name}`);
  revalidateAll();
}

export async function deleteDraftSupplierCredit(formData: FormData) {
  const { business } = await requireBusiness();
  const credit = await ownedCredit(business.id, formData);
  if (!credit || credit.status !== "DRAFT") return;
  await prisma.supplierCredit.delete({ where: { id: credit.id } });
  await audit(business.id, "DELETE", "SUPPLIER_CREDIT", credit.id, `Deleted draft supplier credit ${credit.number}`);
  revalidateAll();
  redirect("/app/supplier-credits");
}

export async function applySupplierCreditToBill(formData: FormData) {
  const { business } = await requireBusiness();
  const credit = await ownedCredit(business.id, formData);
  if (!credit) return;
  const bill = await prisma.invoice.findFirst({
    where: { id: String(formData.get("billId")), businessId: business.id, supplierId: credit.supplierId },
  });
  if (!bill) return;
  const applied = await applyCredit(credit.id, bill.id);
  if (applied > 0) {
    await audit(
      business.id,
      "LINK",
      "SUPPLIER_CREDIT",
      credit.id,
      `Applied ${applied.toFixed(2)} of supplier credit ${credit.number} to bill ${bill.invoiceNumber}`
    );
    await runAutoMatch(business.id);
  }
  revalidateAll();
}

export async function removeSupplierCreditAllocation(formData: FormData) {
  const { business } = await requireBusiness();
  const allocation = await prisma.supplierCreditAllocation.findFirst({
    where: { id: String(formData.get("allocationId")), credit: { businessId: business.id } },
    include: { credit: true, bill: true },
  });
  if (!allocation) return;
  await prisma.supplierCreditAllocation.delete({ where: { id: allocation.id } });
  await audit(
    business.id,
    "UNLINK",
    "SUPPLIER_CREDIT",
    allocation.creditId,
    `Removed supplier credit ${allocation.credit.number} from bill ${allocation.bill.invoiceNumber}`
  );
  revalidateAll();
}
