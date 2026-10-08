"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { audit } from "@/lib/audit";
import { formatDate } from "@/lib/format";
import { round2 } from "@/lib/money";
import { setFlash } from "@/lib/flash";
import { blockedWithMessage } from "@/lib/lock-guard";
import { accountIdsByKey, postTransfer, removeEntry, replaceEntry } from "@/lib/ledger";
import { lockMessage, reconciledMessage } from "@/lib/period-lock";
import { postRevaluation } from "@/lib/revaluation";
import type { ActionState } from "./types";

function revalidateAll() {
  revalidatePath("/app", "layout");
}

const isoDay = /^\d{4}-\d{2}-\d{2}$/;
const day = (value: FormDataEntryValue | null) => {
  const text = String(value ?? "");
  return isoDay.test(text) ? new Date(`${text}T00:00:00Z`) : null;
};
const positive = (value: FormDataEntryValue | null) => {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// ---------- Transfers and currency exchanges ----------

export async function saveTransfer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return { error: "Only an owner or accountant can move money between accounts" };

  const date = day(formData.get("date"));
  if (!date) return { error: "Choose the date of the transfer" };
  if (date.getTime() > Date.now()) return { error: "The date cannot be in the future" };
  const locked = lockMessage(business, date);
  if (locked) return { error: locked };

  const [from, to] = await Promise.all(
    ["fromAccountId", "toAccountId"].map((k) =>
      prisma.account.findFirst({ where: { id: String(formData.get(k) ?? ""), businessId: business.id, moneyKind: { not: null }, isArchived: false } })
    )
  );
  if (!from || !to) return { error: "Choose the account the money leaves and the account it goes into" };
  if (from.id === to.id) return { error: "Choose two different accounts" };

  const fromAmount = positive(formData.get("fromAmount"));
  if (!fromAmount) return { error: `Enter how much leaves ${from.name}` };
  // Between accounts in the same currency exactly what leaves arrives; across currencies the arriving amount is
  // what the bank actually credited.
  const sameCurrency = (from.currency ?? null) === (to.currency ?? null);
  const toAmount = sameCurrency ? fromAmount : positive(formData.get("toAmount"));
  if (!toAmount) return { error: `Enter how much arrived in ${to.name}` };

  const rateFor = (account: { currency: string | null; name: string }, raw: FormDataEntryValue | null) => {
    if (!account.currency) return { rate: null as number | null };
    const rate = Number(raw);
    return Number.isFinite(rate) && rate > 0
      ? { rate }
      : { error: `${account.name} is in ${account.currency}. Enter how many ${business.currency} one ${account.currency} is worth` };
  };
  const fromRate = rateFor(from, formData.get("fromRate"));
  if ("error" in fromRate) return { error: fromRate.error };
  const toRate = sameCurrency && from.currency ? { rate: fromRate.rate } : rateFor(to, formData.get("toRate"));
  if ("error" in toRate) return { error: toRate.error };

  const transfer = await prisma.moneyTransfer.create({
    data: {
      businessId: business.id,
      fromAccountId: from.id,
      toAccountId: to.id,
      date,
      fromAmount,
      toAmount,
      fromRate: fromRate.rate,
      toRate: toRate.rate,
      note: String(formData.get("note") ?? "").trim() || null,
    },
  });
  await postTransfer(transfer.id);
  const label = (amount: number, a: { currency: string | null }) => `${a.currency ?? business.currency} ${amount.toFixed(2)}`;
  await audit(business.id, "CREATE", "MONEY_TRANSFER", transfer.id, `Moved ${label(fromAmount, from)} from ${from.name} to ${to.name} (${label(toAmount, to)} arrived)`);
  revalidateAll();
  return { success: `Recorded: ${label(fromAmount, from)} out of ${from.name}, ${label(toAmount, to)} into ${to.name}` };
}

export async function deleteTransfer(formData: FormData) {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return;
  const transfer = await prisma.moneyTransfer.findFirst({ where: { id: String(formData.get("transferId")), businessId: business.id } });
  if (!transfer) return;
  if (await blockedWithMessage(lockMessage(business, transfer.date) ?? (await reconciledMessage("TRANSFER", transfer.id)))) return;
  await prisma.moneyTransfer.delete({ where: { id: transfer.id } });
  await postTransfer(transfer.id);
  await audit(business.id, "DELETE", "MONEY_TRANSFER", transfer.id, `Deleted a transfer dated ${formatDate(transfer.date)}`);
  revalidateAll();
}

// ---------- Revaluation ----------

// Posts or removes the revaluation of one foreign-currency account at a rate on a day. Results are shown in the banner.
export async function revalueAccount(formData: FormData) {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return;
  const date = day(formData.get("date"));
  const rate = positive(formData.get("rate"));
  const accountId = String(formData.get("accountId") ?? "");
  if (!date || !rate) {
    await setFlash("Enter the date and the closing exchange rate to revalue an account.");
    revalidateAll();
    return;
  }
  const result = await postRevaluation(business, accountId, date, rate);
  if ("error" in result) {
    await setFlash(result.error);
  } else {
    const account = await prisma.account.findUnique({ where: { id: accountId }, select: { name: true } });
    await setFlash(
      result.difference === 0
        ? `${account?.name} already agrees with that rate: no entry needed.`
        : `Revalued ${account?.name} at ${rate}: ${result.difference > 0 ? "gain" : "loss"} of ${Math.abs(result.difference).toFixed(2)} ${business.currency}.`
    );
    await audit(business.id, "CREATE", "REVALUATION", accountId, `Revalued ${account?.name} at ${rate} as at ${formatDate(date)} (${result.difference.toFixed(2)})`);
  }
  revalidateAll();
}

export async function removeRevaluation(formData: FormData) {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return;
  const date = day(formData.get("date"));
  const accountId = String(formData.get("accountId") ?? "");
  if (!date) return;
  const sourceId = `${accountId}:${date.toISOString().slice(0, 10)}`;
  const entry = await prisma.journalEntry.findFirst({ where: { businessId: business.id, sourceType: "FX_REVALUATION", sourceId } });
  if (!entry) return;
  if (await blockedWithMessage(lockMessage(business, entry.date))) return;
  await removeEntry("FX_REVALUATION", sourceId);
  await audit(business.id, "DELETE", "REVALUATION", accountId, `Removed the revaluation dated ${formatDate(date)}`);
  revalidateAll();
}

// ---------- Opening balance of a foreign-currency account ----------

// Entered in the account's own currency at the rate on the opening date. Each foreign account has its own opening
// entry, balanced against opening balance equity, so the main opening balances entry is left alone.
export async function saveForeignOpening(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return { error: "Only an owner or accountant can enter opening balances" };
  if (!business.openingDate) return { error: "Set the opening balance date first (step 1 on this page)" };

  const account = await prisma.account.findFirst({
    where: { id: String(formData.get("accountId") ?? ""), businessId: business.id, currency: { not: null }, moneyKind: { not: null } },
  });
  if (!account) return { error: "Foreign-currency account not found" };
  const amount = Number(String(formData.get("amount") ?? "").replace(/,/g, "") || 0);
  if (!Number.isFinite(amount) || amount < 0) return { error: "Enter the balance as a positive amount (or 0 to clear it)" };
  const rate = amount > 0 ? positive(formData.get("rate")) : 1;
  if (!rate) return { error: `Enter how many ${business.currency} one ${account.currency} was worth on the opening date` };

  const sourceId = `fx:${account.id}`;
  const blocked = lockMessage(business, business.openingDate) ?? (await reconciledMessage("OPENING_BALANCE", sourceId));
  if (blocked) return { error: blocked };

  if (amount === 0) {
    await removeEntry("OPENING_BALANCE", sourceId);
  } else {
    const keys = await accountIdsByKey(business.id);
    const base = round2(amount * rate);
    await replaceEntry(business.id, "OPENING_BALANCE", sourceId, {
      date: business.openingDate,
      memo: `Opening balance: ${account.name} (${account.currency} ${amount.toFixed(2)} at ${rate})`,
      lines: [
        { accountId: account.id, debit: base, foreignAmount: amount },
        { accountId: keys.OPENING_BALANCE, credit: base, description: "Opening balance equity (balancing figure)" },
      ],
    });
  }
  await audit(business.id, "UPDATE", "OPENING_BALANCES", account.id, `Saved the opening balance of ${account.name}: ${account.currency} ${amount.toFixed(2)}`);
  revalidateAll();
  return { success: `Saved ${account.currency} ${amount.toFixed(2)} for ${account.name}` };
}
