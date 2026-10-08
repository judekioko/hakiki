import "server-only";
import { prisma } from "./prisma";
import { num, round2 } from "./money";
import { parseAmount, parseCsv, parseStatementDate } from "./statement-import";
import { normaliseAlias } from "./matching";
import { taxIdFor } from "./validators";
import { accountIdsByKey, replaceEntry } from "./ledger";
import { lockMessage } from "./period-lock";
import { createOpeningBill, createOpeningInvoice } from "./opening-items";
import { runReceiptAutoMatch } from "./receipt-match";
import { runAutoMatch } from "./auto-match";
import { formatDate } from "./format";
import { debitNatured } from "./opening-balances";
import { openingEntryBlocked, savedOpeningAmounts, saveOpeningAccounts } from "./opening-entry";

// Bringing a business onto Hakiki from a spreadsheet: customers, suppliers, products and opening stock, and the
// unpaid invoices and bills that were open on the day the old books end. Each type has a template, a preview that
// shows what will happen to every row, and an import that only does what the preview showed.

export type ImportKind = "account-balances" | "customers" | "suppliers" | "items" | "customer-balances" | "supplier-balances";
export const IMPORT_KINDS: ImportKind[] = ["customers", "suppliers", "items", "account-balances", "customer-balances", "supplier-balances"];

export const MAX_ROWS = 5000;
export const MAX_CHARS = 1_500_000;

type Column = { key: string; label: string; aliases: string[]; required?: boolean; hint: string };

export const IMPORTS: Record<ImportKind, { label: string; description: string; columns: Column[]; example: string[][] }> = {
  "account-balances": {
    label: "Account balances (bank, loans, capital...)",
    description:
      "Your old trial balance or balance sheet: one row per account, as at the day your old books end. Either fill Balance, or Debit and Credit as in a trial balance. Accounts you leave out keep whatever is already saved. Customers, suppliers and stock are imported separately.",
    columns: [
      { key: "account", label: "Account", aliases: ["accountname", "accountcode", "code", "name", "ledger", "ledgeraccount", "accountno"], required: true, hint: "The account's code (like 1010) or name, exactly as in your chart of accounts" },
      { key: "balance", label: "Balance", aliases: ["amount", "closingbalance", "openingbalance"], hint: "On the account's normal side: assets and expenses as a debit, everything else as a credit. A minus sign is the other side (owner's drawings, for example, are a debit, so enter them with a minus)" },
      { key: "debit", label: "Debit", aliases: ["dr", "debits", "debitbalance"], hint: "Instead of Balance, as in a trial balance" },
      { key: "credit", label: "Credit", aliases: ["cr", "credits", "creditbalance"], hint: "Instead of Balance, as in a trial balance" },
    ],
    example: [
      ["1010", "250000", "", ""],
      ["M-Pesa", "48200.50", "", ""],
      ["2300", "", "", "120000"],
      ["Owner's capital", "100000", "", ""],
    ],
  },
  customers: {
    label: "Customers",
    description: "Everyone you invoice. Customers already in Hakiki (same name) are skipped.",
    columns: [
      { key: "name", label: "Name", aliases: ["customer", "customername", "client"], required: true, hint: "Full name of the customer" },
      { key: "taxId", label: "Tax ID", aliases: ["pin", "krapin", "tin", "vatno", "taxpin", "vatnumber"], hint: "KRA PIN, TIN or VAT number" },
      { key: "phone", label: "Phone", aliases: ["mobile", "tel", "telephone", "phonenumber"], hint: "Used for WhatsApp messages" },
      { key: "email", label: "Email", aliases: ["emailaddress"], hint: "" },
      { key: "address", label: "Address", aliases: ["location", "postaladdress"], hint: "" },
    ],
    example: [
      ["Baraka Builders Ltd", "P051777666B", "0722000111", "accounts@baraka.example.com", "Nakuru"],
      ["Njeri Retail Stores", "", "0733222444", "", "Kitengela"],
    ],
  },
  suppliers: {
    label: "Suppliers",
    description: "Everyone you buy from. Suppliers already in Hakiki (same name) are skipped.",
    columns: [
      { key: "name", label: "Name", aliases: ["supplier", "suppliername", "vendor"], required: true, hint: "Full name of the supplier" },
      { key: "taxId", label: "Tax ID", aliases: ["pin", "krapin", "tin", "vatno", "taxpin", "vatnumber"], hint: "KRA PIN, TIN or VAT number" },
      { key: "phone", label: "Phone", aliases: ["mobile", "tel", "telephone", "phonenumber"], hint: "Used for WhatsApp invoice requests" },
      { key: "email", label: "Email", aliases: ["emailaddress"], hint: "" },
    ],
    example: [
      ["Mabati Centre Ltd", "P051234567A", "0712345678", "sales@mabati.example.com"],
      ["Jua Kali Welders", "", "0733345678", ""],
    ],
  },
  items: {
    label: "Products & services (with opening stock)",
    description:
      "Your price list. For stocked products, fill Quantity (and cost) to bring in opening stock on the date you choose. Items with the same SKU or name are skipped.",
    columns: [
      { key: "name", label: "Name", aliases: ["item", "itemname", "product", "productname", "description"], required: true, hint: "What you sell or buy" },
      { key: "sku", label: "SKU", aliases: ["code", "itemcode", "barcode", "productcode"], hint: "Your own code, if you use one" },
      { key: "type", label: "Type", aliases: ["kind", "itemtype", "category"], hint: "service, stock or non-stock. Blank = stock if a quantity is given, otherwise service" },
      { key: "unit", label: "Unit", aliases: ["uom", "unitofmeasure"], hint: "bag, kg, piece..." },
      { key: "salePrice", label: "Sale price", aliases: ["price", "sellingprice", "saleprice", "unitprice", "retailprice"], hint: "Excluding tax" },
      { key: "purchasePrice", label: "Cost price", aliases: ["cost", "costprice", "buyingprice", "purchaseprice"], hint: "Excluding tax" },
      { key: "tax", label: "Tax", aliases: ["taxrate", "vat", "vatrate"], hint: "A tax rate name from Settings, or a percentage. Blank = none" },
      { key: "reorderLevel", label: "Reorder level", aliases: ["reorder", "minstock", "minimumstock", "reorderpoint"], hint: "Warn when stock falls to this" },
      { key: "quantity", label: "Quantity", aliases: ["openingstock", "openingquantity", "qty", "stock", "onhand", "stockonhand"], hint: "Stock on hand: becomes opening stock" },
      { key: "openingCost", label: "Opening cost", aliases: ["unitcost", "openingunitcost", "stockcost"], hint: "Cost per unit of the opening stock. Blank = the cost price" },
    ],
    example: [
      ["Cement 50kg", "CEM-50", "stock", "bag", "950", "720", "VAT 16%", "20", "125", "720"],
      ["Delivery within Nakuru", "", "service", "trip", "2500", "", "VAT 16%", "", "", ""],
    ],
  },
  "customer-balances": {
    label: "Customers who owe you (opening balances)",
    description:
      "Each invoice that was still unpaid when your old books ended, for the amount still owing. Needs the opening balance date to be set first (Accounting → Opening balances). Customers not yet in Hakiki are created.",
    columns: [
      { key: "party", label: "Customer", aliases: ["name", "customername", "client"], required: true, hint: "Customer name" },
      { key: "reference", label: "Invoice number", aliases: ["invoice", "invoiceno", "invoicenumber", "ref", "reference"], required: true, hint: "Your original invoice number" },
      { key: "issueDate", label: "Invoice date", aliases: ["date", "invoicedate", "issuedate"], required: true, hint: "On or before the opening balance date" },
      { key: "dueDate", label: "Due date", aliases: ["due", "duedate"], hint: "Blank = 30 days after the invoice date" },
      { key: "amount", label: "Amount owing", aliases: ["balance", "outstanding", "amountdue", "total"], required: true, hint: "What is still unpaid" },
    ],
    example: [
      ["Baraka Builders Ltd", "INV-0412", "2026-05-10", "2026-06-10", "25000"],
      ["Njeri Retail Stores", "INV-0431", "2026-06-02", "", "12500.50"],
    ],
  },
  "supplier-balances": {
    label: "Suppliers you owe (opening balances)",
    description:
      "Each supplier bill that was still unpaid when your old books ended. Needs the opening balance date to be set first. Suppliers not yet in Hakiki are created.",
    columns: [
      { key: "party", label: "Supplier", aliases: ["name", "suppliername", "vendor"], required: true, hint: "Supplier name" },
      { key: "reference", label: "Bill number", aliases: ["bill", "billno", "invoice", "invoiceno", "invoicenumber", "ref", "reference"], required: true, hint: "The supplier's invoice number" },
      { key: "issueDate", label: "Bill date", aliases: ["date", "invoicedate", "billdate", "issuedate"], required: true, hint: "On or before the opening balance date" },
      { key: "dueDate", label: "Due date", aliases: ["due", "duedate"], hint: "Blank = 30 days after the bill date" },
      { key: "amount", label: "Amount owing", aliases: ["balance", "outstanding", "amountdue", "total"], required: true, hint: "What is still unpaid" },
    ],
    example: [
      ["Mabati Centre Ltd", "MAB-7781", "2026-06-12", "2026-07-12", "184000"],
      ["Kenya Power", "KPLC-0629", "2026-06-20", "", "9200"],
    ],
  },
};

const csvField = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function templateCsv(kind: ImportKind): string {
  const spec = IMPORTS[kind];
  return [spec.columns.map((c) => c.label), ...spec.example].map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
}

const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const nameKey = (s: string) => normaliseAlias(s).toLowerCase();

// A date as written in the spreadsheet (day first, or ISO), as a calendar day comparable with DATE columns.
function parseDay(raw: string): Date | null {
  const d = parseStatementDate(raw);
  if (!d) return null;
  const local = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

export type PreviewRow = {
  line: number;
  label: string;
  detail: string;
  status: "new" | "duplicate" | "error";
  message?: string;
};

type Balance = { party: string; reference: string; issue: Date; due: Date; amount: number };

type Payload =
  | { kind: "customers"; name: string; taxId: string | null; phone: string | null; email: string | null; address: string | null }
  | { kind: "suppliers"; name: string; kraPin: string | null; phone: string | null; email: string | null }
  | {
      kind: "items";
      name: string;
      sku: string | null;
      itemKind: "SERVICE" | "INVENTORY" | "NON_STOCK";
      unit: string | null;
      salePrice: number;
      purchasePrice: number;
      taxRateId: string | null;
      reorderLevel: number | null;
      quantity: number;
      unitCost: number;
    }
  | { kind: "account-balances"; accountId: string; amount: number }
  | ({ kind: "customer-balances" } & Balance)
  | ({ kind: "supplier-balances" } & Balance);

export type Analysis = {
  // Things worth knowing before importing, such as how an opening entry will balance.
  notes: string[];
  rows: PreviewRow[];
  payloads: (Payload | null)[];
  summary: { new: number; duplicate: number; error: number };
  // Problems with the file as a whole (missing column, too big...). Nothing can be imported.
  fatal: string | null;
};

type Business = { id: string; country: string; currency: string; openingDate: Date | null; lockedThrough: Date | null };

export async function analyseImport(business: Business, kind: ImportKind, text: string, options: { stockDate?: string; asAt?: string } = {}): Promise<Analysis> {
  const empty = (fatal: string): Analysis => ({ notes: [], rows: [], payloads: [], summary: { new: 0, duplicate: 0, error: 0 }, fatal });
  if (text.length > MAX_CHARS) return empty("The file is too large. Split it into smaller files of a few thousand rows each.");
  const table = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (table.length < 2) return empty("The file has no data rows. It needs a header row followed by at least one row.");
  if (table.length - 1 > MAX_ROWS) return empty(`The file has more than ${MAX_ROWS} rows. Split it into smaller files.`);

  const spec = IMPORTS[kind];
  const headers = table[0].map(normal);
  const index: Record<string, number> = {};
  for (const col of spec.columns) {
    const names = new Set([normal(col.label), normal(col.key), ...col.aliases]);
    const found = headers.findIndex((h) => names.has(h));
    if (found >= 0) index[col.key] = found;
  }
  const missing = spec.columns.filter((c) => c.required && index[c.key] === undefined).map((c) => c.label);
  if (missing.length > 0) {
    return empty(`The first row must be a header row. Missing column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Download the template to see the layout.`);
  }
  const cell = (row: string[], key: string) => (index[key] === undefined ? "" : (row[index[key]] ?? "").trim());
  if (kind === "account-balances" && index.balance === undefined && index.debit === undefined && index.credit === undefined) {
    return empty("Add a Balance column, or Debit and Credit columns like a trial balance. Download the template to see the layout.");
  }

  const rows: PreviewRow[] = [];
  const payloads: (Payload | null)[] = [];
  const push = (line: number, label: string, detail: string, status: PreviewRow["status"], payload: Payload | null, message?: string) => {
    rows.push({ line, label, detail, status, message });
    payloads.push(status === "new" ? payload : null);
  };

  const dataRows = table.slice(1).map((row, i) => ({ row, line: i + 2 }));

  if (kind === "customers" || kind === "suppliers") {
    const existing = new Set(
      (kind === "customers"
        ? await prisma.customer.findMany({ where: { businessId: business.id }, select: { name: true } })
        : await prisma.supplier.findMany({ where: { businessId: business.id }, select: { name: true } })
      ).map((r) => nameKey(r.name))
    );
    const pin = taxIdFor(business.country);
    for (const { row, line } of dataRows) {
      const name = cell(row, "name");
      if (name.length < 2) {
        push(line, name || "(blank)", "", "error", null, "The name is missing");
        continue;
      }
      const email = cell(row, "email");
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        push(line, name, email, "error", null, "That email address does not look right");
        continue;
      }
      const key = nameKey(name);
      if (existing.has(key)) {
        push(line, name, "", "duplicate", null, "Already in Hakiki, or repeated in this file");
        continue;
      }
      if (kind === "suppliers") {
        const checked = pin.safeParse(cell(row, "taxId"));
        if (!checked.success) {
          push(line, name, cell(row, "taxId"), "error", null, checked.error.issues[0]?.message ?? "The tax ID does not look right");
          continue;
        }
        existing.add(key);
        push(line, name, [checked.data, cell(row, "phone")].filter(Boolean).join(" · "), "new", {
          kind: "suppliers",
          name,
          kraPin: checked.data || null,
          phone: cell(row, "phone") || null,
          email: email || null,
        });
      } else {
        existing.add(key);
        push(line, name, [cell(row, "taxId"), cell(row, "phone")].filter(Boolean).join(" · "), "new", {
          kind: "customers",
          name,
          taxId: cell(row, "taxId").toUpperCase() || null,
          phone: cell(row, "phone") || null,
          email: email || null,
          address: cell(row, "address") || null,
        });
      }
    }
  }

  if (kind === "items") {
    const [items, rates] = await Promise.all([
      prisma.item.findMany({ where: { businessId: business.id }, select: { name: true, sku: true } }),
      prisma.taxRate.findMany({ where: { businessId: business.id, isArchived: false } }),
    ]);
    const names = new Set(items.map((i) => nameKey(i.name)));
    const skus = new Set(items.map((i) => (i.sku ?? "").toLowerCase()).filter(Boolean));
    const stockDate = options.stockDate && /^\d{4}-\d{2}-\d{2}$/.test(options.stockDate) ? new Date(`${options.stockDate}T12:00:00+03:00`) : null;
    let stockProblem: string | null = null;
    if (rows.length === 0) {
      const wantsStock = dataRows.some(({ row }) => (parseAmount(cell(row, "quantity")) ?? 0) > 0);
      if (wantsStock) {
        if (!stockDate) stockProblem = "Choose the date the opening stock is as at";
        else stockProblem = lockMessage(business, stockDate);
      }
    }
    for (const { row, line } of dataRows) {
      const name = cell(row, "name");
      if (name.length < 1) {
        push(line, "(blank)", "", "error", null, "The name is missing");
        continue;
      }
      const sku = cell(row, "sku");
      if (names.has(nameKey(name)) || (sku && skus.has(sku.toLowerCase()))) {
        push(line, name, sku, "duplicate", null, "An item with this name or SKU already exists, or is repeated in this file");
        continue;
      }
      const money = (key: string): { value: number; error: string | null } => {
        const raw = cell(row, key);
        if (!raw) return { value: 0, error: null };
        const v = parseAmount(raw);
        return v === null || v < 0
          ? { value: 0, error: `${IMPORTS.items.columns.find((c) => c.key === key)!.label} is not a valid amount` }
          : { value: v, error: null };
      };
      const sale = money("salePrice");
      const cost = money("purchasePrice");
      const reorder = cell(row, "reorderLevel") ? parseAmount(cell(row, "reorderLevel")) : null;
      const qty = cell(row, "quantity") ? parseAmount(cell(row, "quantity")) : 0;
      const openingCost = money("openingCost");
      const err = sale.error ?? cost.error ?? openingCost.error ?? (qty === null || qty < 0 ? "Quantity is not a valid number" : reorder !== null && reorder < 0 ? "Reorder level is not valid" : null);
      if (err) {
        push(line, name, "", "error", null, err);
        continue;
      }

      const typeText = normal(cell(row, "type"));
      let itemKind: "SERVICE" | "INVENTORY" | "NON_STOCK";
      if (!typeText) itemKind = (qty ?? 0) > 0 ? "INVENTORY" : "SERVICE";
      else if (["service", "services"].includes(typeText)) itemKind = "SERVICE";
      else if (["stock", "stocked", "inventory", "product", "goods"].includes(typeText)) itemKind = "INVENTORY";
      else if (["nonstock", "nonstockitem", "nonstocked", "nonstockproduct", "expense"].includes(typeText)) itemKind = "NON_STOCK";
      else {
        push(line, name, cell(row, "type"), "error", null, 'Type must be "service", "stock" or "non-stock"');
        continue;
      }

      let taxRateId: string | null = null;
      const taxText = cell(row, "tax");
      if (taxText) {
        const percent = parseAmount(taxText.replace("%", ""));
        const match =
          rates.find((r) => r.name.toLowerCase() === taxText.toLowerCase()) ??
          (percent !== null ? rates.find((r) => Math.abs(num(r.rate) - percent) < 0.0005) : undefined);
        if (!match) {
          push(line, name, taxText, "error", null, `No tax rate called "${taxText}". Add it under Settings, or use one of: ${rates.map((r) => r.name).join(", ")}`);
          continue;
        }
        taxRateId = match.id;
      }

      const quantity = itemKind === "INVENTORY" ? (qty ?? 0) : 0;
      if (itemKind !== "INVENTORY" && (qty ?? 0) > 0) {
        push(line, name, String(qty), "error", null, "Only stocked products can have an opening quantity");
        continue;
      }
      const unitCost = openingCost.value || cost.value;
      if (quantity > 0 && unitCost <= 0) {
        push(line, name, `${quantity} on hand`, "error", null, "Opening stock needs a cost: fill Opening cost or Cost price");
        continue;
      }
      if (quantity > 0 && stockProblem) {
        push(line, name, `${quantity} on hand`, "error", null, stockProblem);
        continue;
      }

      names.add(nameKey(name));
      if (sku) skus.add(sku.toLowerCase());
      const kindLabel = itemKind === "INVENTORY" ? "stock" : itemKind === "SERVICE" ? "service" : "non-stock";
      push(line, name, `${kindLabel}${quantity > 0 ? ` · ${quantity} on hand at ${round2(unitCost)}` : ""}`, "new", {
        kind: "items",
        name,
        sku: sku || null,
        itemKind,
        unit: cell(row, "unit") || null,
        salePrice: sale.value,
        purchasePrice: cost.value,
        taxRateId,
        reorderLevel: reorder,
        quantity,
        unitCost,
      });
    }
  }

  const notes: string[] = [];
  if (kind === "account-balances") {
    const asAt = options.asAt && /^\d{4}-\d{2}-\d{2}$/.test(options.asAt) ? new Date(`${options.asAt}T00:00:00Z`) : null;
    if (!asAt) return empty("Choose the date the balances are as at.");
    const blocked = await openingEntryBlocked(business, asAt);
    if (blocked) return empty(blocked);

    const [accounts, keys, saved] = await Promise.all([
      prisma.account.findMany({ where: { businessId: business.id, isArchived: false } }),
      accountIdsByKey(business.id),
      savedOpeningAmounts(business.id),
    ]);
    const where: Record<string, string> = {
      [keys.AR]: "Money owed by customers goes in through Customers who owe you, one invoice at a time",
      [keys.AP]: "Money owed to suppliers goes in through Suppliers you owe, one bill at a time",
      [keys.INVENTORY]: "Stock goes in through Products & services with a Quantity and cost",
      [keys.OPENING_BALANCE]: "Opening balance equity is worked out for you as the balancing figure",
    };
    const byCode = new Map(accounts.map((a) => [a.code.toLowerCase(), a]));
    const byName = new Map<string, typeof accounts>();
    for (const a of accounts) byName.set(nameKey(a.name), [...(byName.get(nameKey(a.name)) ?? []), a]);
    const seen = new Set<string>();
    const merged = new Map(saved);
    const typeOf = new Map(accounts.map((a) => [a.id, a.type]));

    for (const { row, line } of dataRows) {
      const text = cell(row, "account");
      if (!text) {
        push(line, "(blank)", "", "error", null, "The account is missing");
        continue;
      }
      // "1010", "Bank account", or "1010 Bank account" / "1010 - Bank account".
      const lead = text.match(/^(\d{3,6})\b/)?.[1];
      const matches = byCode.has(text.toLowerCase())
        ? [byCode.get(text.toLowerCase())!]
        : (byName.get(nameKey(text)) ?? (lead && byCode.has(lead) ? [byCode.get(lead)!] : []));
      if (matches.length !== 1) {
        push(line, text, "", "error", null, matches.length === 0 ? "No account with that code or name. Add it under Chart of accounts first" : "More than one account has that name. Use the account code instead");
        continue;
      }
      const account = matches[0];
      if (where[account.id]) {
        push(line, `${account.code} · ${account.name}`, "", "error", null, where[account.id]);
        continue;
      }
      if (seen.has(account.id)) {
        push(line, `${account.code} · ${account.name}`, "", "error", null, "This account is listed more than once");
        continue;
      }
      seen.add(account.id);

      let amount: number;
      if (cell(row, "balance")) {
        const v = parseAmount(cell(row, "balance"));
        if (v === null) {
          push(line, `${account.code} · ${account.name}`, cell(row, "balance"), "error", null, "The balance is not a valid amount");
          continue;
        }
        amount = v;
      } else {
        const d = cell(row, "debit") ? parseAmount(cell(row, "debit")) : 0;
        const c = cell(row, "credit") ? parseAmount(cell(row, "credit")) : 0;
        if (d === null || c === null) {
          push(line, `${account.code} · ${account.name}`, "", "error", null, "The debit or credit is not a valid amount");
          continue;
        }
        amount = debitNatured(account.type) ? d - c : c - d;
      }
      amount = round2(amount);
      if (Math.abs(amount) < 0.005) {
        push(line, `${account.code} · ${account.name}`, "", "duplicate", null, "Zero balance, nothing to enter");
        continue;
      }
      merged.set(account.id, amount);
      const sideDebit = debitNatured(account.type) ? amount > 0 : amount < 0;
      push(line, `${account.code} · ${account.name}`, `${Math.abs(amount).toFixed(2)} ${sideDebit ? "debit" : "credit"}`, "new", { kind: "account-balances", accountId: account.id, amount });
    }

    // How the whole opening entry will balance once these figures are in.
    let debits = 0;
    let credits = 0;
    for (const [accountId, amount] of merged) {
      const debit = debitNatured(typeOf.get(accountId) ?? "ASSET") ? amount > 0 : amount < 0;
      if (debit) debits += Math.abs(amount);
      else credits += Math.abs(amount);
    }
    const plug = round2(debits - credits);
    notes.push(
      plug === 0
        ? "Debits and credits agree, so nothing is needed to balance the entry."
        : `${Math.abs(plug).toFixed(2)} will be booked to Opening balance equity as the balancing ${plug > 0 ? "credit" : "debit"}. That is your starting equity once customers, suppliers and stock are in.`
    );
    if (saved.size > 0) notes.push(`Balances already saved for ${saved.size} account${saved.size === 1 ? "" : "s"} are kept unless this file lists the same account, which replaces it.`);
  }

  if (kind === "customer-balances" || kind === "supplier-balances") {
    if (!business.openingDate) {
      return empty("Set the opening balance date first (Accounting → Opening balances, step 1), then come back to import the unpaid invoices.");
    }
    const taken = new Set<string>(
      kind === "customer-balances"
        ? (await prisma.salesInvoice.findMany({ where: { businessId: business.id, number: { startsWith: "OB-" } }, select: { number: true } })).map((r) => r.number)
        : (await prisma.invoice.findMany({ where: { businessId: business.id, invoiceNumber: { startsWith: "OB-" } }, select: { invoiceNumber: true } })).map((r) => r.invoiceNumber)
    );
    for (const { row, line } of dataRows) {
      const party = cell(row, "party");
      const reference = cell(row, "reference");
      if (party.length < 2 || !reference) {
        push(line, party || "(blank)", reference, "error", null, party.length < 2 ? "The name is missing" : "The invoice number is missing");
        continue;
      }
      const amount = parseAmount(cell(row, "amount"));
      if (amount === null || amount <= 0) {
        push(line, party, reference, "error", null, "The amount owing must be more than zero");
        continue;
      }
      const issue = parseDay(cell(row, "issueDate"));
      if (!issue) {
        push(line, party, reference, "error", null, "The invoice date is missing or not a date (use yyyy-mm-dd or dd/mm/yyyy)");
        continue;
      }
      if (issue.getTime() > business.openingDate.getTime()) {
        push(line, party, reference, "error", null, `The date must be on or before the opening balance date (${formatDate(business.openingDate)})`);
        continue;
      }
      const dueText = cell(row, "dueDate");
      const due = dueText ? parseDay(dueText) : new Date(issue.getTime() + 30 * 24 * 60 * 60 * 1000);
      if (!due || due.getTime() < issue.getTime()) {
        push(line, party, reference, "error", null, "The due date is not a date, or is before the invoice date");
        continue;
      }
      const locked = lockMessage(business, issue);
      if (locked) {
        push(line, party, reference, "error", null, locked);
        continue;
      }
      const number = `OB-${reference.toUpperCase()}`;
      if (taken.has(number)) {
        push(line, party, reference, "duplicate", null, `${number} has already been entered, or is repeated in this file`);
        continue;
      }
      taken.add(number);
      push(line, party, `${reference} · ${formatDate(issue)} · ${round2(amount).toFixed(2)}`, "new", { kind, party, reference, issue, due, amount: round2(amount) } as Payload);
    }
  }

  const summary = { new: 0, duplicate: 0, error: 0 };
  for (const r of rows) summary[r.status]++;
  return { notes, rows, payloads, summary, fatal: null };
}

export type ImportOutcome = { created: number; failed: { line: number; message: string }[] };

export async function commitImport(business: Business, kind: ImportKind, analysis: Analysis, options: { stockDate?: string; asAt?: string } = {}): Promise<ImportOutcome> {
  const failed: ImportOutcome["failed"] = [];
  let created = 0;
  const lineOf = (i: number) => analysis.rows[i].line;
  const todo = analysis.payloads.map((p, i) => ({ p, i })).filter((x): x is { p: Payload; i: number } => x.p !== null);

  if (kind === "account-balances") {
    // Saving replaces the whole opening entry, so what was already saved is carried over and the file overlays it.
    const saved = await savedOpeningAmounts(business.id);
    for (const { p } of todo) {
      const row = p as Extract<Payload, { kind: "account-balances" }>;
      saved.set(row.accountId, row.amount);
    }
    const asAt = options.asAt ? new Date(`${options.asAt}T00:00:00Z`) : null;
    if (!asAt) return { created: 0, failed: [{ line: 0, message: "Choose the date the balances are as at" }] };
    const result = await saveOpeningAccounts(business, asAt, [...saved].map(([accountId, amount]) => ({ accountId, amount })));
    if ("error" in result) failed.push({ line: 0, message: result.error });
    else created = todo.length;
  } else if (kind === "customers") {
    const data = todo.map(({ p }) => p as Extract<Payload, { kind: "customers" }>).map((p) => ({
      businessId: business.id,
      name: p.name,
      taxId: p.taxId,
      phone: p.phone,
      email: p.email,
      address: p.address,
      aliases: [normaliseAlias(p.name)],
    }));
    created = (await prisma.customer.createMany({ data })).count;
  } else if (kind === "suppliers") {
    const data = todo.map(({ p }) => p as Extract<Payload, { kind: "suppliers" }>).map((p) => ({
      businessId: business.id,
      name: p.name,
      kraPin: p.kraPin,
      phone: p.phone,
      email: p.email,
      aliases: [normaliseAlias(p.name)],
    }));
    created = (await prisma.supplier.createMany({ data })).count;
  } else if (kind === "items") {
    const keys = await accountIdsByKey(business.id);
    const stockDate = options.stockDate ? new Date(`${options.stockDate}T12:00:00+03:00`) : null;
    for (const { p, i } of todo) {
      const item = p as Extract<Payload, { kind: "items" }>;
      try {
        const row = await prisma.item.create({
          data: {
            businessId: business.id,
            name: item.name,
            sku: item.sku,
            kind: item.itemKind,
            unit: item.unit,
            salePrice: item.salePrice,
            purchasePrice: item.purchasePrice,
            taxRateId: item.taxRateId,
            reorderLevel: item.reorderLevel,
          },
        });
        if (item.quantity > 0 && stockDate) {
          const movement = await prisma.stockMovement.create({
            data: {
              businessId: business.id,
              itemId: row.id,
              date: stockDate,
              quantity: item.quantity,
              unitCost: item.unitCost,
              sourceType: "STOCK_ADJUSTMENT",
              note: "Opening stock (CSV import)",
            },
          });
          const value = round2(item.quantity * item.unitCost);
          await replaceEntry(business.id, "STOCK_ADJUSTMENT", movement.id, {
            date: stockDate,
            memo: `Opening stock: ${item.quantity} × ${item.name}`,
            lines: [
              { accountId: keys.INVENTORY, debit: value },
              { accountId: keys.OPENING_BALANCE, credit: value },
            ],
          });
          await prisma.stockMovement.update({ where: { id: movement.id }, data: { sourceId: movement.id } });
        }
        created++;
      } catch (error) {
        failed.push({ line: lineOf(i), message: error instanceof Error ? error.message : "Could not be saved" });
      }
    }
  } else if (kind === "customer-balances") {
    const cache = new Map<string, { id: string }>();
    const existing = await prisma.customer.findMany({ where: { businessId: business.id }, select: { id: true, name: true } });
    for (const c of existing) cache.set(nameKey(c.name), c);
    for (const { p, i } of todo) {
      const row = p as Extract<Payload, { kind: "customer-balances" }>;
      try {
        let customer = cache.get(nameKey(row.party));
        if (!customer) {
          customer = await prisma.customer.create({ data: { businessId: business.id, name: row.party, aliases: [normaliseAlias(row.party)] } });
          cache.set(nameKey(row.party), customer);
        }
        const result = await createOpeningInvoice(business, customer, { reference: row.reference, amount: row.amount, issue: row.issue, due: row.due });
        if ("error" in result) failed.push({ line: lineOf(i), message: result.error });
        else created++;
      } catch (error) {
        failed.push({ line: lineOf(i), message: error instanceof Error ? error.message : "Could not be saved" });
      }
    }
    if (created > 0) await runReceiptAutoMatch(business.id);
  } else {
    const cache = new Map<string, { id: string; name: string; kraPin: string | null }>();
    const existing = await prisma.supplier.findMany({ where: { businessId: business.id }, select: { id: true, name: true, kraPin: true } });
    for (const s of existing) cache.set(nameKey(s.name), s);
    for (const { p, i } of todo) {
      const row = p as Extract<Payload, { kind: "supplier-balances" }>;
      try {
        let supplier = cache.get(nameKey(row.party));
        if (!supplier) {
          const made = await prisma.supplier.create({ data: { businessId: business.id, name: row.party, aliases: [normaliseAlias(row.party)] } });
          supplier = { id: made.id, name: made.name, kraPin: made.kraPin };
          cache.set(nameKey(row.party), supplier);
        }
        const result = await createOpeningBill(business, supplier, { reference: row.reference, amount: row.amount, issue: row.issue, due: row.due });
        if ("error" in result) failed.push({ line: lineOf(i), message: result.error });
        else created++;
      } catch (error) {
        failed.push({ line: lineOf(i), message: error instanceof Error ? error.message : "Could not be saved" });
      }
    }
    if (created > 0) await runAutoMatch(business.id);
  }
  return { created, failed };
}
