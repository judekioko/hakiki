import { z } from "zod";
import { KRA_PIN_PATTERN } from "@/lib/kra";

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const kraPin = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s+/g, "").toUpperCase())
  .refine((v) => v === "" || KRA_PIN_PATTERN.test(v), "KRA PIN should look like P051234567X")
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const money = z.coerce
  .number({ message: "Enter an amount" })
  .positive("Amount must be more than zero")
  .max(10_000_000_000, "Amount is too large");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date");

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export const signupSchema = z.object({
  name: z.string().trim().min(2, "Enter your name"),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(8, "Use at least 8 characters"),
  businessName: z.string().trim().min(2, "Enter your business name"),
  kraPin,
});

export const businessSchema = z.object({
  name: z.string().trim().min(2, "Enter the business name"),
  kraPin,
  incomeTaxRate: z.coerce.number().min(0).max(100),
  yearEndMonth: z.coerce.number().int().min(1).max(12),
});

export const supplierSchema = z.object({
  name: z.string().trim().min(2, "Enter the supplier name"),
  kraPin,
  phone: optionalText,
});

export const invoiceSchema = z.object({
  invoiceNumber: z.string().trim().min(3, "Enter the eTIMS invoice number"),
  supplierId: optionalText,
  supplierName: optionalText,
  supplierPin: kraPin,
  invoiceDate: isoDate,
  totalAmount: money,
  vatAmount: z.coerce.number().min(0).default(0),
  description: optionalText,
});

export const paymentSchema = z.object({
  source: z.enum(["MPESA", "BANK", "CASH", "OTHER"]),
  reference: optionalText,
  paidAt: isoDate,
  amount: money,
  counterparty: z.string().trim().min(2, "Who was paid?"),
  details: optionalText,
});

export const exemptSchema = z.object({
  paymentId: z.string().min(1),
  exemptReason: z.enum([
    "SALARIES",
    "IMPORTS",
    "INTEREST_BANK_CHARGES",
    "AIRLINE_TICKETS",
    "NON_RESIDENT",
    "TAX_STATUTORY",
    "OWN_TRANSFER",
    "LOAN_REPAYMENT",
    "NOT_AN_EXPENSE",
    "OTHER",
  ]),
  exemptNote: optionalText,
});

export function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input";
}
