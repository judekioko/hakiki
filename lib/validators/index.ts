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

// Tax ID for any country. Kenyan PINs are checked against the KRA format.
export function taxIdFor(country: string) {
  return country === "KE"
    ? kraPin
    : z
        .string()
        .trim()
        .max(40, "Tax number is too long")
        .transform((v) => (v === "" ? undefined : v.toUpperCase()))
        .optional();
}

const countryCode = z.string().regex(/^[A-Z]{2}$/, "Choose a country");

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
  country: countryCode,
  taxId: z.string().trim().max(40).optional(),
});

export const businessSchema = z.object({
  name: z.string().trim().min(2, "Enter the business name"),
  taxId: z.string().trim().max(40).optional(),
  incomeTaxRate: z.coerce.number().min(0).max(100),
  yearEndMonth: z.coerce.number().int().min(1).max(12),
  vatRegistered: z.boolean(),
  address: optionalText,
  phone: optionalText,
  email: optionalText,
  invoiceFooter: optionalText,
});

export const newBusinessSchema = businessSchema.extend({ country: countryCode });

export const supplierSchema = z.object({
  name: z.string().trim().min(2, "Enter the supplier name"),
  kraPin: z
    .string()
    .trim()
    .max(40, "Tax number is too long")
    .transform((v) => (v === "" ? undefined : v.replace(/\s+/g, "").toUpperCase()))
    .optional(),
  phone: optionalText,
});

export const invoiceSchema = z.object({
  invoiceNumber: z.string().trim().min(3, "Enter the eTIMS invoice number"),
  supplierId: optionalText,
  supplierName: optionalText,
  supplierPin: z.string().trim().optional(),
  invoiceDate: isoDate,
  dueDate: isoDate.optional().or(z.literal("").transform(() => undefined)),
  totalAmount: z.coerce.number().min(0),
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

export const lineSchema = z.object({
  itemId: z.string().optional().nullable(),
  description: z.string().trim().min(1, "Every line needs a description"),
  quantity: z.coerce.number().positive("Quantity must be more than zero"),
  unitPrice: z.coerce.number().min(0, "Price cannot be negative"),
  taxRateId: z.string().optional().nullable(),
  accountId: z.string().optional().nullable(),
});
export type LineInput = z.infer<typeof lineSchema>;

export const linesSchema = z.array(lineSchema).min(1, "Add at least one line");

export const customerSchema = z.object({
  name: z.string().trim().min(2, "Enter the customer name"),
  taxId: optionalText,
  phone: optionalText,
  email: z.string().trim().toLowerCase().email("Enter a valid email").optional().or(z.literal("").transform(() => undefined)),
  address: optionalText,
});

export const salesInvoiceSchema = z.object({
  customerId: optionalText,
  newCustomerName: optionalText,
  issueDate: isoDate,
  dueDate: isoDate,
  reference: optionalText,
  notes: optionalText,
});

export const creditNoteSchema = z.object({
  customerId: z.string().min(1, "Choose a customer"),
  invoiceId: optionalText,
  issueDate: isoDate,
  reason: optionalText,
});

export const receiptSchema = z.object({
  receivedAt: isoDate,
  amount: money,
  payer: z.string().trim().min(2, "Who paid?"),
  reference: optionalText,
  details: optionalText,
});

export const itemSchema = z.object({
  name: z.string().trim().min(2, "Enter the item name"),
  sku: optionalText,
  kind: z.enum(["SERVICE", "INVENTORY", "NON_STOCK"]),
  unit: optionalText,
  salePrice: z.coerce.number().min(0),
  purchasePrice: z.coerce.number().min(0),
  taxRateId: optionalText,
  incomeAccountId: optionalText,
  expenseAccountId: optionalText,
  reorderLevel: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0), "Reorder level must be a number"),
});

export const employeeSchema = z.object({
  name: z.string().trim().min(2, "Enter the employee's name"),
  employeeNumber: optionalText,
  nationalId: optionalText,
  taxId: optionalText,
  pensionNumber: optionalText,
  healthNumber: optionalText,
  phone: optionalText,
  email: optionalText,
  jobTitle: optionalText,
  basicSalary: z.coerce.number().min(0, "Salary cannot be negative"),
  allowances: z.coerce.number().min(0).default(0),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
});

export const accountSchema = z.object({
  code: z.string().trim().min(1, "Enter an account code").max(10),
  name: z.string().trim().min(2, "Enter the account name"),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]),
  moneyKind: z.enum(["BANK", "MOBILE_MONEY", "CASH"]).optional().or(z.literal("").transform(() => undefined)),
  description: optionalText,
});

export const journalLineSchema = z.object({
  accountId: z.string().min(1, "Choose an account on every line"),
  debit: z.coerce.number().min(0).default(0),
  credit: z.coerce.number().min(0).default(0),
  description: z.string().trim().optional(),
});

export const taxRateSchema = z.object({
  name: z.string().trim().min(2, "Enter a name"),
  rate: z.coerce.number().min(0).max(100),
});

export function parseJsonField<T>(value: FormDataEntryValue | null, schema: z.ZodType<T>): { data?: T; error?: string } {
  if (typeof value !== "string") return { error: "Missing lines" };
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return { error: "Could not read the lines" };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? { data: parsed.data } : { error: firstError(parsed.error) };
}
