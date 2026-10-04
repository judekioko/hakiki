"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { countryPack } from "@/lib/countries";
import { num, round2 } from "@/lib/money";
import { accountIdsByKey, postPayment, postPayRun } from "@/lib/ledger";
import { calculateConfiguredPayslip, calculateKenyaPayslip, type PayslipCalc } from "@/lib/payroll";
import { sourceForMoneyAccount } from "@/lib/money-accounts";
import { employeeSchema, firstError } from "@/lib/validators";
import type { ActionState } from "./types";

function revalidateAll() {
  revalidatePath("/app", "layout");
}

function readEmployee(formData: FormData) {
  return employeeSchema.safeParse({
    name: formData.get("name"),
    employeeNumber: formData.get("employeeNumber") ?? "",
    nationalId: formData.get("nationalId") ?? "",
    taxId: formData.get("taxId") ?? "",
    pensionNumber: formData.get("pensionNumber") ?? "",
    healthNumber: formData.get("healthNumber") ?? "",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    jobTitle: formData.get("jobTitle") ?? "",
    basicSalary: formData.get("basicSalary"),
    allowances: formData.get("allowances") || 0,
    startDate: formData.get("startDate") ?? "",
  });
}

function employeeData(d: ReturnType<typeof employeeSchema.parse>) {
  return {
    name: d.name,
    employeeNumber: d.employeeNumber ?? null,
    nationalId: d.nationalId ?? null,
    taxId: d.taxId ?? null,
    pensionNumber: d.pensionNumber ?? null,
    healthNumber: d.healthNumber ?? null,
    phone: d.phone ?? null,
    email: d.email ?? null,
    jobTitle: d.jobTitle ?? null,
    basicSalary: d.basicSalary,
    allowances: d.allowances,
    startDate: d.startDate ? new Date(`${d.startDate}T00:00:00Z`) : null,
  };
}

export async function createEmployee(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const parsed = readEmployee(formData);
  if (!parsed.success) return { error: firstError(parsed.error) };
  await prisma.employee.create({ data: { businessId: business.id, ...employeeData(parsed.data) } });
  revalidateAll();
  redirect("/app/payroll/employees");
}

export async function updateEmployee(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const parsed = readEmployee(formData);
  if (!parsed.success) return { error: firstError(parsed.error) };
  await prisma.employee.updateMany({
    where: { id: String(formData.get("employeeId")), businessId: business.id },
    data: { ...employeeData(parsed.data), isActive: formData.get("isActive") === "on" },
  });
  revalidateAll();
  return { success: "Employee saved" };
}

// ---------- Rules for countries without a built-in payroll ----------

export async function savePayrollRule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) return { error: "Name the deduction, e.g. Pension (employee)" };
  const party = formData.get("party") === "EMPLOYER" ? "EMPLOYER" : "EMPLOYEE";
  const numberOrNull = (key: string) => {
    const raw = String(formData.get(key) ?? "").trim();
    return raw === "" ? null : Number(raw);
  };
  const rate = numberOrNull("rate") ?? 0;
  const fixedAmount = numberOrNull("fixedAmount") ?? 0;
  const maxBase = numberOrNull("maxBase");
  const maxAmount = numberOrNull("maxAmount");
  if ([rate, fixedAmount, maxBase ?? 0, maxAmount ?? 0].some((v) => !Number.isFinite(v) || v < 0)) {
    return { error: "Amounts and rates must be positive numbers" };
  }
  if (rate === 0 && fixedAmount === 0) return { error: "Enter a percentage or a fixed amount" };

  await prisma.payrollRule.create({
    data: {
      businessId: business.id,
      name,
      party,
      rate,
      fixedAmount,
      maxBase,
      maxAmount,
      preTax: party === "EMPLOYEE" && formData.get("preTax") === "on",
      position: await prisma.payrollRule.count({ where: { businessId: business.id } }),
    },
  });
  revalidateAll();
  return { success: "Deduction added" };
}

export async function deletePayrollRule(formData: FormData) {
  const { business } = await requireBusiness();
  await prisma.payrollRule.deleteMany({ where: { id: String(formData.get("ruleId")), businessId: business.id } });
  revalidateAll();
}

// Bands are entered as text lines "up to, rate" with a final line for everything above, e.g. "*, 30".
export async function saveTaxBands(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const text = String(formData.get("bands") ?? "").trim();
  const relief = Number(formData.get("personalRelief") || 0);
  if (!Number.isFinite(relief) || relief < 0) return { error: "Personal relief must be a positive number" };

  const bands: { upTo: number | null; rate: number }[] = [];
  for (const [i, raw] of text.split(/\r?\n/).filter((l) => l.trim()).entries()) {
    const [limit, rate] = raw.split(",").map((p) => p.trim());
    const upTo = limit === "*" || limit === "" ? null : Number(limit.replace(/[\s_]/g, ""));
    const pct = Number(rate);
    if ((upTo !== null && !Number.isFinite(upTo)) || !Number.isFinite(pct)) {
      return { error: `Line ${i + 1}: write it as "upper limit, rate" e.g. 24000, 10` };
    }
    bands.push({ upTo, rate: pct });
  }
  if (bands.filter((b) => b.upTo === null).length > 1) return { error: "Only the last band can be open-ended (*)" };

  await prisma.$transaction([
    prisma.incomeTaxBand.deleteMany({ where: { businessId: business.id } }),
    prisma.incomeTaxBand.createMany({ data: bands.map((b) => ({ businessId: business.id, ...b })) }),
    prisma.business.update({ where: { id: business.id }, data: { payrollPersonalRelief: relief } }),
  ]);
  revalidateAll();
  return { success: "Income tax bands saved" };
}

// ---------- Pay runs ----------

async function calculatorFor(business: { id: string; country: string; payrollPersonalRelief: unknown }) {
  if (countryPack(business.country).builtInPayroll) {
    return (basic: number, allowances: number) => calculateKenyaPayslip(basic, allowances);
  }
  const [rules, bands] = await Promise.all([
    prisma.payrollRule.findMany({ where: { businessId: business.id }, orderBy: { position: "asc" } }),
    prisma.incomeTaxBand.findMany({ where: { businessId: business.id } }),
  ]);
  const ruleInputs = rules.map((r) => ({
    name: r.name,
    party: r.party,
    rate: num(r.rate),
    fixedAmount: num(r.fixedAmount),
    maxBase: r.maxBase === null ? null : num(r.maxBase),
    maxAmount: r.maxAmount === null ? null : num(r.maxAmount),
    preTax: r.preTax,
  }));
  const bandInputs = bands.map((b) => ({ upTo: b.upTo === null ? null : num(b.upTo), rate: num(b.rate) }));
  const relief = num(business.payrollPersonalRelief as never);
  return (basic: number, allowances: number) => calculateConfiguredPayslip(basic, allowances, ruleInputs, bandInputs, relief);
}

function payslipData(employee: { id: string; basicSalary: unknown; allowances: unknown }, calc: PayslipCalc) {
  return {
    employeeId: employee.id,
    basicSalary: num(employee.basicSalary as never),
    allowances: num(employee.allowances as never),
    gross: calc.gross,
    taxableIncome: calc.taxableIncome,
    incomeTax: calc.incomeTax,
    employeeDeductions: calc.employeeDeductions,
    employerContributions: calc.employerContributions,
    net: calc.net,
    breakdown: calc.lines,
  };
}

export async function createPayRun(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const period = String(formData.get("period") ?? "");
  const payDate = String(formData.get("payDate") ?? "");
  if (!/^\d{4}-\d{2}$/.test(period)) return { error: "Choose the month" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate)) return { error: "Choose the pay date" };
  if (await prisma.payRun.findUnique({ where: { businessId_period: { businessId: business.id, period } } })) {
    return { error: `There is already a pay run for ${period}` };
  }
  const employees = await prisma.employee.findMany({ where: { businessId: business.id, isActive: true } });
  if (employees.length === 0) return { error: "Add at least one active employee first" };

  const calculate = await calculatorFor(business);
  const run = await prisma.payRun.create({
    data: {
      businessId: business.id,
      period,
      payDate: new Date(`${payDate}T00:00:00Z`),
      payslips: {
        create: employees.map((e) => payslipData(e, calculate(num(e.basicSalary), num(e.allowances)))),
      },
    },
  });
  revalidateAll();
  redirect(`/app/payroll/${run.id}`);
}

// Rebuilds a draft pay run from current salaries and rules.
export async function recalculatePayRun(formData: FormData) {
  const { business } = await requireBusiness();
  const run = await prisma.payRun.findFirst({ where: { id: String(formData.get("payRunId")), businessId: business.id } });
  if (!run || run.status !== "DRAFT") return;
  const employees = await prisma.employee.findMany({ where: { businessId: business.id, isActive: true } });
  const calculate = await calculatorFor(business);
  await prisma.$transaction([
    prisma.payslip.deleteMany({ where: { payRunId: run.id } }),
    prisma.payRun.update({
      where: { id: run.id },
      data: { payslips: { create: employees.map((e) => payslipData(e, calculate(num(e.basicSalary), num(e.allowances)))) } },
    }),
  ]);
  revalidateAll();
}

export async function approvePayRun(formData: FormData) {
  const { business } = await requireBusiness();
  const run = await prisma.payRun.findFirst({ where: { id: String(formData.get("payRunId")), businessId: business.id } });
  if (!run || run.status !== "DRAFT") return;
  await prisma.payRun.update({ where: { id: run.id }, data: { status: "APPROVED" } });
  await postPayRun(run.id);
  revalidateAll();
}

export async function reopenPayRun(formData: FormData) {
  const { business } = await requireBusiness();
  const run = await prisma.payRun.findFirst({ where: { id: String(formData.get("payRunId")), businessId: business.id } });
  if (!run || run.status !== "APPROVED") return;
  await prisma.payRun.update({ where: { id: run.id }, data: { status: "DRAFT" } });
  await postPayRun(run.id);
  revalidateAll();
}

export async function deletePayRun(formData: FormData) {
  const { business } = await requireBusiness();
  const run = await prisma.payRun.findFirst({ where: { id: String(formData.get("payRunId")), businessId: business.id } });
  if (!run || run.status !== "DRAFT") return;
  await prisma.payRun.delete({ where: { id: run.id } });
  revalidateAll();
  redirect("/app/payroll");
}

// Records the money actually paid out for an approved run: net pay to staff, or deductions to the authorities.
export async function recordPayrollPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireBusiness();
  const run = await prisma.payRun.findFirst({
    where: { id: String(formData.get("payRunId")), businessId: business.id, status: "APPROVED" },
    include: { payslips: true },
  });
  if (!run) return { error: "Approve the pay run first" };
  const account = await prisma.account.findFirst({
    where: { id: String(formData.get("moneyAccountId") ?? ""), businessId: business.id, moneyKind: { not: null } },
  });
  if (!account) return { error: "Choose the account the money was paid from" };
  const date = String(formData.get("paidAt") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Choose the payment date" };

  const kind = formData.get("kind");
  const keys = await accountIdsByKey(business.id);
  const sum = (f: "net" | "incomeTax" | "employeeDeductions" | "employerContributions") =>
    round2(run.payslips.reduce((s, p) => s + num(p[f]), 0));
  const target =
    kind === "NET"
      ? { amount: sum("net"), category: keys.SALARIES_PAYABLE, counterparty: `Salaries ${run.period}`, reason: "SALARIES" as const }
      : kind === "TAX"
        ? { amount: sum("incomeTax"), category: keys.PAYE_PAYABLE, counterparty: `Income tax (PAYE) ${run.period}`, reason: "TAX_STATUTORY" as const }
        : { amount: round2(sum("employeeDeductions") + sum("employerContributions")), category: keys.PAYROLL_LIABILITIES, counterparty: `Statutory deductions ${run.period}`, reason: "TAX_STATUTORY" as const };
  if (target.amount <= 0) return { error: "Nothing to pay for this item" };

  const reference = String(formData.get("reference") ?? "").trim().toUpperCase() || null;
  if (reference && (await prisma.payment.findFirst({ where: { businessId: business.id, reference } }))) {
    return { error: `A payment with reference ${reference} already exists` };
  }
  const payment = await prisma.payment.create({
    data: {
      businessId: business.id,
      moneyAccountId: account.id,
      source: sourceForMoneyAccount(account),
      reference,
      paidAt: new Date(`${date}T12:00:00+03:00`),
      amount: target.amount,
      counterparty: target.counterparty,
      categoryAccountId: target.category,
      exemptReason: target.reason,
      exemptNote: `Pay run ${run.period}`,
    },
  });
  await postPayment(payment.id);
  revalidateAll();
  return { success: `Recorded ${target.counterparty}` };
}
