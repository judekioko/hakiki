"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createCustomer, recordReceipt, saveSalesInvoice, updateCustomer } from "@/lib/actions/sales";
import { saveCreditNote } from "@/lib/actions/credit-notes";
import { saveQuotation } from "@/lib/actions/quotations";
import { saveRecurring } from "@/lib/actions/recurring";
import { savePurchaseOrder } from "@/lib/actions/purchase-orders";
import { saveSupplierCredit } from "@/lib/actions/supplier-credits";
import { adjustStock, createItem, updateItem } from "@/lib/actions/items";
import {
  createEmployee,
  createPayRun,
  recordPayrollPayment,
  savePayrollRule,
  saveTaxBands,
  updateEmployee,
} from "@/lib/actions/payroll";
import { createAccount, createManualJournal, createTaxRate } from "@/lib/actions/accounting";
import { AccountSelect, Feedback, Field, SubmitButton, useFormAction, type AccountOption, type Option } from "./form-kit";
import { LineItemsEditor, type EditorItem, type EditorLine, type EditorTaxRate } from "./line-items-editor";
import type { MoneyAccountOption } from "./forms";

function MoneyAccountSelect({ accounts, defaultValue }: { accounts: MoneyAccountOption[]; defaultValue?: string }) {
  return (
    <Select id="moneyAccountId" name="moneyAccountId" defaultValue={defaultValue ?? accounts[0]?.id}>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </Select>
  );
}

// ---------- Sales ----------

export function CustomerForm({
  mode,
  customerId,
  defaults,
  taxIdLabel,
}: {
  mode: "create" | "edit";
  customerId?: string;
  defaults?: { name: string; taxId: string | null; phone: string | null; email: string | null; address: string | null };
  taxIdLabel: string;
}) {
  const { state, onSubmit, pending } = useFormAction(mode === "create" ? createCustomer : updateCustomer);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <input type="hidden" name="customerId" value={customerId ?? ""} />
      <Field label="Customer name" htmlFor="name">
        <Input id="name" name="name" defaultValue={defaults?.name} required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={taxIdLabel} htmlFor="taxId">
          <Input id="taxId" name="taxId" defaultValue={defaults?.taxId ?? ""} className="uppercase" />
        </Field>
        <Field label="Phone" htmlFor="phone">
          <Input id="phone" name="phone" type="tel" defaultValue={defaults?.phone ?? ""} />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" defaultValue={defaults?.email ?? ""} />
        </Field>
        <Field label="Address" htmlFor="address">
          <Input id="address" name="address" defaultValue={defaults?.address ?? ""} />
        </Field>
      </div>
      <SubmitButton pending={pending}>{mode === "create" ? "Add customer" : "Save customer"}</SubmitButton>
    </form>
  );
}

export function SalesInvoiceForm({
  invoiceId,
  status,
  customers,
  items,
  taxRates,
  accounts,
  chargeTax,
  currency,
  defaults,
}: {
  invoiceId?: string;
  status?: string;
  customers: Option[];
  items: EditorItem[];
  taxRates: EditorTaxRate[];
  accounts: AccountOption[];
  chargeTax: boolean;
  currency: string;
  defaults: {
    customerId?: string;
    issueDate: string;
    dueDate: string;
    reference?: string | null;
    notes?: string | null;
    lines?: Omit<EditorLine, "key">[];
  };
}) {
  const { state, onSubmit, pending } = useFormAction(saveSalesInvoice);
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Feedback state={state} />
      <input type="hidden" name="invoiceId" value={invoiceId ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Customer" htmlFor="customerId">
          <Select id="customerId" name="customerId" defaultValue={defaults.customerId ?? ""}>
            <option value="">New customer (type below)</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="New customer name" htmlFor="newCustomerName">
          <Input id="newCustomerName" name="newCustomerName" />
        </Field>
        <Field label="Invoice date" htmlFor="issueDate">
          <Input id="issueDate" name="issueDate" type="date" defaultValue={defaults.issueDate} required />
        </Field>
        <Field label="Due date" htmlFor="dueDate">
          <Input id="dueDate" name="dueDate" type="date" defaultValue={defaults.dueDate} required />
        </Field>
      </div>
      <LineItemsEditor
        side="sale"
        items={items}
        taxRates={taxRates}
        accounts={accounts}
        chargeTax={chargeTax}
        initial={defaults.lines}
        currency={currency}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Reference / PO number (optional)" htmlFor="reference">
          <Input id="reference" name="reference" defaultValue={defaults.reference ?? ""} />
        </Field>
        <Field label="Notes to customer (optional)" htmlFor="notes">
          <Input id="notes" name="notes" defaultValue={defaults.notes ?? ""} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        {status !== "SENT" ? (
          <SubmitButton pending={pending} name="intent" value="draft" variant="secondary">
            Save as draft
          </SubmitButton>
        ) : null}
        <SubmitButton pending={pending} name="intent" value="send">
          {status === "SENT" ? "Save changes" : "Save & mark as sent"}
        </SubmitButton>
      </div>
    </form>
  );
}

export function CreditNoteForm({
  creditNoteId,
  customers,
  invoices,
  items,
  taxRates,
  accounts,
  chargeTax,
  currency,
  defaults,
}: {
  creditNoteId?: string;
  customers: Option[];
  invoices: { id: string; number: string; customerId: string }[];
  items: EditorItem[];
  taxRates: EditorTaxRate[];
  accounts: AccountOption[];
  chargeTax: boolean;
  currency: string;
  defaults: {
    customerId?: string;
    invoiceId?: string;
    issueDate: string;
    reason?: string | null;
    restock?: boolean;
    lines?: Omit<EditorLine, "key">[];
  };
}) {
  const { state, onSubmit, pending } = useFormAction(saveCreditNote);
  const [customerId, setCustomerId] = useState(defaults.customerId ?? "");
  const customerInvoices = invoices.filter((i) => i.customerId === customerId);
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Feedback state={state} />
      <input type="hidden" name="creditNoteId" value={creditNoteId ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Customer" htmlFor="customerId">
          <Select id="customerId" name="customerId" value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
            <option value="">Choose a customer</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Against invoice (optional)" htmlFor="invoiceId">
          <Select id="invoiceId" name="invoiceId" defaultValue={defaults.invoiceId ?? ""} key={customerId}>
            <option value="">Not linked to an invoice</option>
            {customerInvoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.number}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Credit note date" htmlFor="issueDate">
          <Input id="issueDate" name="issueDate" type="date" defaultValue={defaults.issueDate} required />
        </Field>
        <Field label="Reason" htmlFor="reason">
          <Input id="reason" name="reason" defaultValue={defaults.reason ?? ""} placeholder="Returned goods, price correction..." />
        </Field>
      </div>
      <LineItemsEditor
        side="sale"
        items={items}
        taxRates={taxRates}
        accounts={accounts}
        chargeTax={chargeTax}
        initial={defaults.lines}
        currency={currency}
      />
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="restock" defaultChecked={defaults.restock} className="h-4 w-4 rounded border-slate-300" />
        Put returned stock items back into stock
      </label>
      <div className="flex flex-wrap gap-2">
        <SubmitButton pending={pending} name="intent" value="draft" variant="secondary">
          Save as draft
        </SubmitButton>
        <SubmitButton pending={pending} name="intent" value="issue">
          Save & issue
        </SubmitButton>
      </div>
    </form>
  );
}

export function QuotationForm({
  quotationId,
  status,
  customers,
  items,
  taxRates,
  accounts,
  chargeTax,
  currency,
  defaults,
}: {
  quotationId?: string;
  status?: string;
  customers: Option[];
  items: EditorItem[];
  taxRates: EditorTaxRate[];
  accounts: AccountOption[];
  chargeTax: boolean;
  currency: string;
  defaults: {
    customerId?: string;
    issueDate: string;
    expiryDate: string;
    reference?: string | null;
    notes?: string | null;
    lines?: Omit<EditorLine, "key">[];
  };
}) {
  const { state, onSubmit, pending } = useFormAction(saveQuotation);
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Feedback state={state} />
      <input type="hidden" name="quotationId" value={quotationId ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Customer" htmlFor="customerId">
          <Select id="customerId" name="customerId" defaultValue={defaults.customerId ?? ""} required>
            <option value="">Choose a customer</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quotation date" htmlFor="issueDate">
          <Input id="issueDate" name="issueDate" type="date" defaultValue={defaults.issueDate} required />
        </Field>
        <Field label="Valid until" htmlFor="expiryDate">
          <Input id="expiryDate" name="expiryDate" type="date" defaultValue={defaults.expiryDate} required />
        </Field>
      </div>
      <LineItemsEditor
        side="sale"
        items={items}
        taxRates={taxRates}
        accounts={accounts}
        chargeTax={chargeTax}
        initial={defaults.lines}
        currency={currency}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Reference (optional)" htmlFor="reference">
          <Input id="reference" name="reference" defaultValue={defaults.reference ?? ""} />
        </Field>
        <Field label="Notes to customer (optional)" htmlFor="notes">
          <Input id="notes" name="notes" defaultValue={defaults.notes ?? ""} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        {!status || status === "DRAFT" ? (
          <SubmitButton pending={pending} name="intent" value="draft" variant="secondary">
            Save as draft
          </SubmitButton>
        ) : null}
        <SubmitButton pending={pending} name="intent" value="send">
          {!status || status === "DRAFT" ? "Save & mark as sent" : "Save changes"}
        </SubmitButton>
      </div>
    </form>
  );
}

export function RecurringForm({
  recurringId,
  customers,
  items,
  taxRates,
  accounts,
  chargeTax,
  currency,
  defaults,
}: {
  recurringId?: string;
  customers: Option[];
  items: EditorItem[];
  taxRates: EditorTaxRate[];
  accounts: AccountOption[];
  chargeTax: boolean;
  currency: string;
  defaults: {
    customerId?: string;
    frequency: string;
    interval: number;
    startDate: string;
    endDate?: string;
    dueDays: number;
    autoSend: boolean;
    reference?: string | null;
    notes?: string | null;
    lines?: Omit<EditorLine, "key">[];
  };
}) {
  const { state, onSubmit, pending } = useFormAction(saveRecurring);
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Feedback state={state} />
      <input type="hidden" name="recurringId" value={recurringId ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Customer" htmlFor="customerId">
          <Select id="customerId" name="customerId" defaultValue={defaults.customerId ?? ""} required>
            <option value="">Choose a customer</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Repeat" htmlFor="frequency">
          <Select id="frequency" name="frequency" defaultValue={defaults.frequency}>
            <option value="WEEKLY">Weekly</option>
            <option value="MONTHLY">Monthly</option>
            <option value="QUARTERLY">Quarterly</option>
            <option value="YEARLY">Yearly</option>
          </Select>
        </Field>
        <Field label="Every (number of periods)" htmlFor="interval">
          <Input id="interval" name="interval" type="number" min={1} max={52} defaultValue={defaults.interval} required />
        </Field>
        <Field label="Payment terms (days)" htmlFor="dueDays">
          <Input id="dueDays" name="dueDays" type="number" min={0} max={365} defaultValue={defaults.dueDays} required />
        </Field>
        <Field label="First invoice date" htmlFor="startDate">
          <Input id="startDate" name="startDate" type="date" defaultValue={defaults.startDate} required />
        </Field>
        <Field label="Stop after (optional)" htmlFor="endDate">
          <Input id="endDate" name="endDate" type="date" defaultValue={defaults.endDate ?? ""} />
        </Field>
      </div>
      <LineItemsEditor
        side="sale"
        items={items}
        taxRates={taxRates}
        accounts={accounts}
        chargeTax={chargeTax}
        initial={defaults.lines}
        currency={currency}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Reference / PO number (optional)" htmlFor="reference">
          <Input id="reference" name="reference" defaultValue={defaults.reference ?? ""} />
        </Field>
        <Field label="Notes to customer (optional)" htmlFor="notes">
          <Input id="notes" name="notes" defaultValue={defaults.notes ?? ""} />
        </Field>
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" name="autoSend" defaultChecked={defaults.autoSend} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
        <span>
          Issue each invoice as sent (it posts to your books straight away). Leave unticked to get a draft to review first.
        </span>
      </label>
      <SubmitButton pending={pending}>{recurringId ? "Save changes" : "Start recurring invoice"}</SubmitButton>
    </form>
  );
}

export function PurchaseOrderForm({
  orderId,
  status,
  suppliers,
  items,
  taxRates,
  accounts,
  currency,
  defaults,
}: {
  orderId?: string;
  status?: string;
  suppliers: Option[];
  items: EditorItem[];
  taxRates: EditorTaxRate[];
  accounts: AccountOption[];
  currency: string;
  defaults: {
    supplierId?: string;
    orderDate: string;
    expectedDate?: string;
    reference?: string | null;
    notes?: string | null;
    lines?: Omit<EditorLine, "key">[];
  };
}) {
  const { state, onSubmit, pending } = useFormAction(savePurchaseOrder);
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Feedback state={state} />
      <input type="hidden" name="orderId" value={orderId ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Supplier" htmlFor="supplierId">
          <Select id="supplierId" name="supplierId" defaultValue={defaults.supplierId ?? ""} required>
            <option value="">Choose a supplier</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Order date" htmlFor="orderDate">
          <Input id="orderDate" name="orderDate" type="date" defaultValue={defaults.orderDate} required />
        </Field>
        <Field label="Expected delivery (optional)" htmlFor="expectedDate">
          <Input id="expectedDate" name="expectedDate" type="date" defaultValue={defaults.expectedDate ?? ""} />
        </Field>
      </div>
      <LineItemsEditor
        side="purchase"
        items={items}
        taxRates={taxRates}
        accounts={accounts}
        chargeTax
        initial={defaults.lines}
        currency={currency}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Reference (optional)" htmlFor="reference">
          <Input id="reference" name="reference" defaultValue={defaults.reference ?? ""} />
        </Field>
        <Field label="Notes to supplier (optional)" htmlFor="notes">
          <Input id="notes" name="notes" defaultValue={defaults.notes ?? ""} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        {!status || status === "DRAFT" ? (
          <SubmitButton pending={pending} name="intent" value="draft" variant="secondary">
            Save as draft
          </SubmitButton>
        ) : null}
        <SubmitButton pending={pending} name="intent" value="order">
          {!status || status === "DRAFT" ? "Save & place order" : "Save changes"}
        </SubmitButton>
      </div>
    </form>
  );
}

export function SupplierCreditForm({
  creditId,
  suppliers,
  bills,
  items,
  taxRates,
  accounts,
  currency,
  defaults,
}: {
  creditId?: string;
  suppliers: Option[];
  bills: { id: string; number: string; supplierId: string }[];
  items: EditorItem[];
  taxRates: EditorTaxRate[];
  accounts: AccountOption[];
  currency: string;
  defaults: {
    supplierId?: string;
    billId?: string;
    number?: string;
    creditDate: string;
    reason?: string | null;
    returnStock?: boolean;
    lines?: Omit<EditorLine, "key">[];
  };
}) {
  const { state, onSubmit, pending } = useFormAction(saveSupplierCredit);
  const [supplierId, setSupplierId] = useState(defaults.supplierId ?? "");
  const supplierBills = bills.filter((b) => b.supplierId === supplierId);
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Feedback state={state} />
      <input type="hidden" name="creditId" value={creditId ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Supplier" htmlFor="supplierId">
          <Select id="supplierId" name="supplierId" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
            <option value="">Choose a supplier</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Against bill (optional)" htmlFor="billId">
          <Select id="billId" name="billId" defaultValue={defaults.billId ?? ""} key={supplierId}>
            <option value="">Not linked to a bill</option>
            {supplierBills.map((b) => (
              <option key={b.id} value={b.id}>
                {b.number}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Supplier's credit note no." htmlFor="number">
          <Input id="number" name="number" defaultValue={defaults.number ?? ""} className="uppercase" required />
        </Field>
        <Field label="Credit note date" htmlFor="creditDate">
          <Input id="creditDate" name="creditDate" type="date" defaultValue={defaults.creditDate} required />
        </Field>
      </div>
      <Field label="Reason (optional)" htmlFor="reason">
        <Input id="reason" name="reason" defaultValue={defaults.reason ?? ""} placeholder="Goods returned, overcharge, discount..." />
      </Field>
      <LineItemsEditor
        side="purchase"
        items={items}
        taxRates={taxRates}
        accounts={accounts}
        chargeTax
        initial={defaults.lines}
        currency={currency}
      />
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="returnStock" defaultChecked={defaults.returnStock} className="h-4 w-4 rounded border-slate-300" />
        Take returned stock items out of stock (leave unticked for a price adjustment)
      </label>
      <div className="flex flex-wrap gap-2">
        <SubmitButton pending={pending} name="intent" value="draft" variant="secondary">
          Save as draft
        </SubmitButton>
        <SubmitButton pending={pending} name="intent" value="issue">
          Save & record
        </SubmitButton>
      </div>
    </form>
  );
}

export function ReceiptForm({
  moneyAccounts,
  today,
  invoiceId,
  customerId,
  defaultAmount,
  defaultPayer,
}: {
  moneyAccounts: MoneyAccountOption[];
  today: string;
  invoiceId?: string;
  customerId?: string;
  defaultAmount?: number;
  defaultPayer?: string;
}) {
  const { state, onSubmit, pending } = useFormAction(recordReceipt);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <input type="hidden" name="invoiceId" value={invoiceId ?? ""} />
      <input type="hidden" name="customerId" value={customerId ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Received into" htmlFor="moneyAccountId">
          <MoneyAccountSelect accounts={moneyAccounts} defaultValue={moneyAccounts.find((a) => a.kind === "MOBILE_MONEY")?.id} />
        </Field>
        <Field label="Date received" htmlFor="receivedAt">
          <Input id="receivedAt" name="receivedAt" type="date" defaultValue={today} required />
        </Field>
        <Field label="Amount" htmlFor="amount">
          <Input id="amount" name="amount" type="number" step="0.01" min="0.01" defaultValue={defaultAmount} required />
        </Field>
        <Field label="Reference (optional)" htmlFor="reference">
          <Input id="reference" name="reference" className="uppercase" />
        </Field>
      </div>
      <Field label="Received from" htmlFor="payer">
        <Input id="payer" name="payer" defaultValue={defaultPayer} required />
      </Field>
      <SubmitButton pending={pending}>Record money received</SubmitButton>
    </form>
  );
}

// ---------- Products & stock ----------

export function ItemForm({
  mode,
  itemId,
  defaults,
  taxRates,
  accounts,
}: {
  mode: "create" | "edit";
  itemId?: string;
  defaults?: {
    name: string;
    sku: string | null;
    kind: string;
    unit: string | null;
    salePrice: number;
    purchasePrice: number;
    taxRateId: string | null;
    incomeAccountId: string | null;
    expenseAccountId: string | null;
    reorderLevel: number | null;
  };
  taxRates: EditorTaxRate[];
  accounts: AccountOption[];
}) {
  const { state, onSubmit, pending } = useFormAction(mode === "create" ? createItem : updateItem);
  const [kind, setKind] = useState(defaults?.kind ?? "INVENTORY");
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <input type="hidden" name="itemId" value={itemId ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="name">
          <Input id="name" name="name" defaultValue={defaults?.name} required />
        </Field>
        <Field label="Type" htmlFor="kind">
          <Select id="kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="INVENTORY">Stocked product (track quantity)</option>
            <option value="NON_STOCK">Product (don&apos;t track quantity)</option>
            <option value="SERVICE">Service</option>
          </Select>
        </Field>
        <Field label="SKU / code (optional)" htmlFor="sku">
          <Input id="sku" name="sku" defaultValue={defaults?.sku ?? ""} />
        </Field>
        <Field label="Unit (optional)" htmlFor="unit" hint="e.g. pcs, kg, bag, litre">
          <Input id="unit" name="unit" defaultValue={defaults?.unit ?? ""} />
        </Field>
        <Field label="Selling price (excl. tax)" htmlFor="salePrice">
          <Input id="salePrice" name="salePrice" type="number" step="0.01" min="0" defaultValue={defaults?.salePrice ?? 0} />
        </Field>
        <Field label="Buying price (excl. tax)" htmlFor="purchasePrice">
          <Input id="purchasePrice" name="purchasePrice" type="number" step="0.01" min="0" defaultValue={defaults?.purchasePrice ?? 0} />
        </Field>
        <Field label="Tax rate" htmlFor="taxRateId">
          <Select id="taxRateId" name="taxRateId" defaultValue={defaults?.taxRateId ?? taxRates.find((r) => r.isDefault)?.id ?? ""}>
            <option value="">No tax</option>
            {taxRates.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        {kind === "INVENTORY" ? (
          <Field label="Reorder when stock falls to (optional)" htmlFor="reorderLevel">
            <Input id="reorderLevel" name="reorderLevel" type="number" step="any" min="0" defaultValue={defaults?.reorderLevel ?? ""} />
          </Field>
        ) : (
          <input type="hidden" name="reorderLevel" value="" />
        )}
        <Field label="Income account" htmlFor="incomeAccountId">
          <AccountSelect
            id="incomeAccountId"
            name="incomeAccountId"
            accounts={accounts.filter((a) => a.type === "INCOME")}
            defaultValue={defaults?.incomeAccountId ?? ""}
            placeholder="Sales (default)"
          />
        </Field>
        {kind !== "INVENTORY" ? (
          <Field label="Expense account when bought" htmlFor="expenseAccountId">
            <AccountSelect
              id="expenseAccountId"
              name="expenseAccountId"
              accounts={accounts.filter((a) => a.type === "EXPENSE")}
              defaultValue={defaults?.expenseAccountId ?? ""}
              placeholder="Uncategorised expense (default)"
            />
          </Field>
        ) : null}
      </div>
      <SubmitButton pending={pending}>{mode === "create" ? "Add item" : "Save item"}</SubmitButton>
    </form>
  );
}

export function StockAdjustForm({ itemId, today, hasStock }: { itemId: string; today: string; hasStock: boolean }) {
  const { state, onSubmit, pending } = useFormAction(adjustStock);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <input type="hidden" name="itemId" value={itemId} />
      <Field label="Reason" htmlFor="reason">
        <Select id="reason" name="reason" defaultValue={hasStock ? "COUNT" : "OPENING"}>
          <option value="OPENING">Opening stock</option>
          <option value="COUNT">Stock count correction</option>
          <option value="DAMAGE">Damaged / expired / lost</option>
          <option value="OTHER">Other</option>
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Quantity" htmlFor="quantity" hint="Negative to remove">
          <Input id="quantity" name="quantity" type="number" step="any" required />
        </Field>
        <Field label="Cost per unit" htmlFor="unitCost" hint="For stock coming in">
          <Input id="unitCost" name="unitCost" type="number" step="0.01" min="0" />
        </Field>
        <Field label="Date" htmlFor="date">
          <Input id="date" name="date" type="date" defaultValue={today} required />
        </Field>
      </div>
      <Field label="Note (optional)" htmlFor="note">
        <Input id="note" name="note" />
      </Field>
      <SubmitButton pending={pending}>Save adjustment</SubmitButton>
    </form>
  );
}

// ---------- Payroll ----------

export function EmployeeForm({
  mode,
  employeeId,
  defaults,
  labels,
}: {
  mode: "create" | "edit";
  employeeId?: string;
  defaults?: Record<string, string | number | boolean | null>;
  labels: { taxId: string; pension: string; health: string };
}) {
  const { state, onSubmit, pending } = useFormAction(mode === "create" ? createEmployee : updateEmployee);
  const v = (k: string) => (defaults?.[k] ?? "") as string;
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <input type="hidden" name="employeeId" value={employeeId ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="name">
          <Input id="name" name="name" defaultValue={v("name")} required />
        </Field>
        <Field label="Job title" htmlFor="jobTitle">
          <Input id="jobTitle" name="jobTitle" defaultValue={v("jobTitle")} />
        </Field>
        <Field label="Basic monthly salary" htmlFor="basicSalary">
          <Input id="basicSalary" name="basicSalary" type="number" step="0.01" min="0" defaultValue={v("basicSalary")} required />
        </Field>
        <Field label="Taxable allowances per month" htmlFor="allowances" hint="House, transport, etc.">
          <Input id="allowances" name="allowances" type="number" step="0.01" min="0" defaultValue={v("allowances") || "0"} />
        </Field>
        <Field label="Employee number" htmlFor="employeeNumber">
          <Input id="employeeNumber" name="employeeNumber" defaultValue={v("employeeNumber")} />
        </Field>
        <Field label="National ID" htmlFor="nationalId">
          <Input id="nationalId" name="nationalId" defaultValue={v("nationalId")} />
        </Field>
        <Field label={labels.taxId} htmlFor="taxId">
          <Input id="taxId" name="taxId" defaultValue={v("taxId")} className="uppercase" />
        </Field>
        <Field label={labels.pension} htmlFor="pensionNumber">
          <Input id="pensionNumber" name="pensionNumber" defaultValue={v("pensionNumber")} />
        </Field>
        <Field label={labels.health} htmlFor="healthNumber">
          <Input id="healthNumber" name="healthNumber" defaultValue={v("healthNumber")} />
        </Field>
        <Field label="Phone" htmlFor="phone">
          <Input id="phone" name="phone" type="tel" defaultValue={v("phone")} />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" defaultValue={v("email")} />
        </Field>
        <Field label="Start date" htmlFor="startDate">
          <Input id="startDate" name="startDate" type="date" defaultValue={v("startDate")} />
        </Field>
      </div>
      {mode === "edit" ? (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="isActive" defaultChecked={defaults?.isActive !== false} />
          Active (included in new pay runs)
        </label>
      ) : null}
      <SubmitButton pending={pending}>{mode === "create" ? "Add employee" : "Save employee"}</SubmitButton>
    </form>
  );
}

export function PayrollRuleForm() {
  const { state, onSubmit, pending } = useFormAction(savePayrollRule);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="ruleName">
          <Input id="ruleName" name="name" placeholder="e.g. Social security (employee)" required />
        </Field>
        <Field label="Paid by" htmlFor="party">
          <Select id="party" name="party" defaultValue="EMPLOYEE">
            <option value="EMPLOYEE">Employee (deducted from pay)</option>
            <option value="EMPLOYER">Employer (extra cost)</option>
          </Select>
        </Field>
        <Field label="Percentage of gross (%)" htmlFor="rate">
          <Input id="rate" name="rate" type="number" step="0.001" min="0" />
        </Field>
        <Field label="Fixed amount per month" htmlFor="fixedAmount">
          <Input id="fixedAmount" name="fixedAmount" type="number" step="0.01" min="0" />
        </Field>
        <Field label="Apply % only up to gross of (optional)" htmlFor="maxBase">
          <Input id="maxBase" name="maxBase" type="number" step="0.01" min="0" />
        </Field>
        <Field label="Maximum deduction (optional)" htmlFor="maxAmount">
          <Input id="maxAmount" name="maxAmount" type="number" step="0.01" min="0" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="preTax" />
        Reduces taxable income (e.g. pension contributions)
      </label>
      <SubmitButton pending={pending}>Add deduction</SubmitButton>
    </form>
  );
}

export function TaxBandsForm({ bandsText, personalRelief }: { bandsText: string; personalRelief: number }) {
  const { state, onSubmit, pending } = useFormAction(saveTaxBands);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <Field
        label="Monthly income tax bands"
        htmlFor="bands"
        hint='One band per line as "upper limit, rate %". Use * for the top band. Example: 24000, 10 / 40000, 25 / *, 30'
      >
        <textarea
          id="bands"
          name="bands"
          rows={6}
          defaultValue={bandsText}
          className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm"
        />
      </Field>
      <Field label="Monthly personal relief" htmlFor="personalRelief">
        <Input id="personalRelief" name="personalRelief" type="number" step="0.01" min="0" defaultValue={personalRelief} />
      </Field>
      <SubmitButton pending={pending}>Save tax bands</SubmitButton>
    </form>
  );
}

export function PayRunForm({ defaultPeriod, defaultPayDate }: { defaultPeriod: string; defaultPayDate: string }) {
  const { state, onSubmit, pending } = useFormAction(createPayRun);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Month" htmlFor="period">
          <Input id="period" name="period" type="month" defaultValue={defaultPeriod} required />
        </Field>
        <Field label="Pay date" htmlFor="payDate">
          <Input id="payDate" name="payDate" type="date" defaultValue={defaultPayDate} required />
        </Field>
      </div>
      <SubmitButton pending={pending} pendingText="Calculating...">
        Calculate pay run
      </SubmitButton>
    </form>
  );
}

export function PayrollPaymentForm({
  payRunId,
  moneyAccounts,
  today,
  options,
}: {
  payRunId: string;
  moneyAccounts: MoneyAccountOption[];
  today: string;
  options: { value: string; label: string }[];
}) {
  const { state, onSubmit, pending } = useFormAction(recordPayrollPayment);
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Feedback state={state} />
      <input type="hidden" name="payRunId" value={payRunId} />
      <Field label="What was paid" htmlFor="kind">
        <Select id="kind" name="kind">
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Paid from" htmlFor="moneyAccountId">
          <MoneyAccountSelect accounts={moneyAccounts} defaultValue={moneyAccounts.find((a) => a.kind === "BANK")?.id} />
        </Field>
        <Field label="Date" htmlFor="paidAt">
          <Input id="paidAt" name="paidAt" type="date" defaultValue={today} required />
        </Field>
      </div>
      <Field label="Reference (optional)" htmlFor="reference">
        <Input id="reference" name="reference" className="uppercase" />
      </Field>
      <SubmitButton pending={pending} variant="secondary">
        Record payment
      </SubmitButton>
    </form>
  );
}

// ---------- Accounting ----------

export function AccountForm() {
  const { state, onSubmit, pending } = useFormAction(createAccount);
  const [type, setType] = useState("EXPENSE");
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Code" htmlFor="code">
          <Input id="code" name="code" required placeholder="6150" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Name" htmlFor="accountName">
            <Input id="accountName" name="name" required />
          </Field>
        </div>
        <Field label="Type" htmlFor="type">
          <Select id="type" name="type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="ASSET">Asset</option>
            <option value="LIABILITY">Liability</option>
            <option value="EQUITY">Equity</option>
            <option value="INCOME">Income</option>
            <option value="EXPENSE">Expense</option>
          </Select>
        </Field>
        {type === "ASSET" ? (
          <div className="sm:col-span-2">
            <Field label="Holds money?" htmlFor="moneyKind" hint="Bank, mobile money and cash accounts can receive imports and payments">
              <Select id="moneyKind" name="moneyKind" defaultValue="">
                <option value="">No</option>
                <option value="BANK">Bank account</option>
                <option value="MOBILE_MONEY">Mobile money wallet / till</option>
                <option value="CASH">Cash</option>
              </Select>
            </Field>
          </div>
        ) : null}
      </div>
      <SubmitButton pending={pending}>Add account</SubmitButton>
    </form>
  );
}

export function TaxRateForm() {
  const { state, onSubmit, pending } = useFormAction(createTaxRate);
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <div className="w-full">
        <Feedback state={state} />
      </div>
      <Field label="Name" htmlFor="taxName">
        <Input id="taxName" name="name" placeholder="e.g. VAT 16%" required />
      </Field>
      <Field label="Rate %" htmlFor="taxRate">
        <Input id="taxRate" name="rate" type="number" step="0.001" min="0" max="100" required className="w-28" />
      </Field>
      <SubmitButton pending={pending} variant="secondary">
        Add rate
      </SubmitButton>
    </form>
  );
}

type JournalRow = { key: number; accountId: string; debit: string; credit: string; description: string };

export function JournalForm({ accounts, today }: { accounts: AccountOption[]; today: string }) {
  const { state, onSubmit, pending } = useFormAction(createManualJournal);
  const blank = (key: number): JournalRow => ({ key, accountId: "", debit: "", credit: "", description: "" });
  const [rows, setRows] = useState<JournalRow[]>(() => [blank(1), blank(2)]);
  const update = (key: number, patch: Partial<JournalRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const debit = rows.reduce((s, r) => s + (Number(r.debit) || 0), 0);
  const credit = rows.reduce((s, r) => s + (Number(r.credit) || 0), 0);
  const balanced = Math.abs(debit - credit) < 0.005 && debit > 0;
  const cell = "block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Feedback state={state} />
      <input
        type="hidden"
        name="lines"
        value={JSON.stringify(rows.filter((r) => r.accountId).map((r) => ({ accountId: r.accountId, debit: r.debit || 0, credit: r.credit || 0, description: r.description })))}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Date" htmlFor="journalDate">
          <Input id="journalDate" name="date" type="date" defaultValue={today} required />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description" htmlFor="memo">
            <Input id="memo" name="memo" placeholder="e.g. Opening balances, depreciation for the year" required />
          </Field>
        </div>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.key} className="grid gap-2 sm:grid-cols-12">
            <div className="sm:col-span-5">
              <AccountSelect
                name={`acct-${r.key}`}
                accounts={accounts}
                defaultValue={r.accountId}
                placeholder="Choose account"
                className={cell}
                onChange={(accountId) => update(r.key, { accountId })}
              />
            </div>
            <input
              className={`${cell} sm:col-span-2`}
              type="number"
              step="0.01"
              min="0"
              placeholder="Debit"
              aria-label={`Debit line ${i + 1}`}
              value={r.debit}
              onChange={(e) => update(r.key, { debit: e.target.value, credit: e.target.value ? "" : r.credit })}
            />
            <input
              className={`${cell} sm:col-span-2`}
              type="number"
              step="0.01"
              min="0"
              placeholder="Credit"
              aria-label={`Credit line ${i + 1}`}
              value={r.credit}
              onChange={(e) => update(r.key, { credit: e.target.value, debit: e.target.value ? "" : r.debit })}
            />
            <input
              className={`${cell} sm:col-span-3`}
              placeholder="Line note (optional)"
              aria-label={`Note line ${i + 1}`}
              value={r.description}
              onChange={(e) => update(r.key, { description: e.target.value })}
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="text-sm font-medium text-teal-700 hover:underline" onClick={() => setRows((rs) => [...rs, blank(Math.max(0, ...rs.map((r) => r.key)) + 1)])}>
          + Add line
        </button>
        <p className={`text-sm ${balanced ? "text-teal-700" : "text-rose-700"}`}>
          Debits {debit.toLocaleString("en-GB", { minimumFractionDigits: 2 })} · Credits{" "}
          {credit.toLocaleString("en-GB", { minimumFractionDigits: 2 })} {balanced ? "· balanced" : "· must be equal"}
        </p>
      </div>
      <SubmitButton pending={pending}>Post journal</SubmitButton>
    </form>
  );
}
