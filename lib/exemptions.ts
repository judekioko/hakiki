import type { ExemptReason } from "./generated/prisma/client";

export const EXEMPT_REASONS: { value: ExemptReason; label: string; hint: string }[] = [
  { value: "SALARIES", label: "Salaries & wages", hint: "Employment income is supported by payroll records, not supplier tax invoices." },
  { value: "IMPORTS", label: "Imports", hint: "Supported by customs entries." },
  { value: "INTEREST_BANK_CHARGES", label: "Interest & bank charges", hint: "Supported by bank or lender statements." },
  { value: "AIRLINE_TICKETS", label: "Airline tickets", hint: "Supported by the ticket." },
  { value: "NON_RESIDENT", label: "Payment to a non-resident", hint: "Foreign suppliers cannot issue local tax invoices." },
  { value: "TAX_STATUTORY", label: "Tax & statutory payments", hint: "KRA, SHA, NSSF, Housing Levy, county fees." },
  { value: "OWN_TRANSFER", label: "Transfer to own account / drawings", hint: "Not a business expense." },
  { value: "LOAN_REPAYMENT", label: "Loan repayment", hint: "Principal is not an expense." },
  { value: "NOT_AN_EXPENSE", label: "Not an expense (asset, refund, etc.)", hint: "Exclude from the expense claim." },
  { value: "OTHER", label: "Other (explain in note)", hint: "Add a note your accountant can rely on." },
];

export const EXEMPT_LABEL = Object.fromEntries(
  EXEMPT_REASONS.map((r) => [r.value, r.label])
) as Record<ExemptReason, string>;

export const EXEMPTION_DISCLAIMER =
  "These categories are a guide. Confirm the current list of expenses that do not need a supplier tax invoice with your tax authority or adviser.";
