import "dotenv/config";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { accountIdsByKey, postSalesInvoice } from "../lib/ledger";
import { recordMpesaPayment } from "../lib/mpesa-record";
import { encryptSecret, decryptSecret } from "../lib/secrets";
import { darajaTimestamp, parseDarajaTime, stkPush, registerC2bUrls } from "../lib/mpesa";
import { balanceOf, bookTotals, day, dropBusiness, scratchBusiness, unbalancedEntries } from "./helpers";

process.env.SESSION_SECRET ??= "test-secret-for-the-test-suite";

describe("stored secrets", () => {
  it("round-trips and never stores the plain text", () => {
    const stored = encryptSecret("consumer-key-123");
    assert.ok(!stored.includes("consumer-key-123"));
    assert.equal(decryptSecret(stored), "consumer-key-123");
  });

  it("uses a fresh nonce each time", () => {
    assert.notEqual(encryptSecret("same"), encryptSecret("same"));
  });

  it("detects tampering and rejects junk", () => {
    const parts = encryptSecret("value").split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    assert.throws(() => decryptSecret(parts.join(":")));
    assert.throws(() => decryptSecret("not-a-secret"));
  });
});

describe("Daraja requests", () => {
  it("formats timestamps in Nairobi time and reads them back", () => {
    assert.equal(darajaTimestamp(new Date("2026-07-05T09:03:07Z")), "20260705120307");
    assert.equal(parseDarajaTime("20260705120307").toISOString(), "2026-07-05T09:03:07.000Z");
  });

  it("builds the STK password and avoids forbidden words in the callback", async () => {
    const calls: { url: string; body?: string }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body as string | undefined });
      const body = String(url).includes("oauth") ? { access_token: "T", expires_in: "3599" } : { ResponseCode: "0", CheckoutRequestID: "ws_CO_1" };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    try {
      const credentials = { environment: "SANDBOX" as const, shortcode: "174379", shortcodeType: "PAYBILL", consumerKey: "K", consumerSecret: "S", passkey: "PASS" };
      await stkPush(credentials, { phone: "254722000111", amount: 1500.4, reference: "INV-0031-LONG-REFERENCE", description: "Invoice payment", callback: "https://example.com/api/pay/b/t/stk" });
      const stk = JSON.parse(calls.find((c) => c.url.includes("stkpush"))!.body!);
      assert.equal(stk.Password, Buffer.from(`174379PASS${stk.Timestamp}`).toString("base64"));
      assert.equal(stk.Amount, 1501);
      assert.ok(stk.AccountReference.length <= 12);
      await registerC2bUrls(credentials, { confirmation: "https://example.com/api/pay/b/t/confirmation", validation: "https://example.com/api/pay/b/t/validation" });
      const register = JSON.parse(calls.find((c) => c.url.includes("registerurl"))!.body!);
      assert.ok(!/mpesa|safaricom/i.test(register.ConfirmationURL));
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("recording M-Pesa payments", () => {
  let businessId: string;
  let keys: Record<string, string>;
  let customerId: string;

  const invoice = async (number: string, total: number) => {
    const created = await prisma.salesInvoice.create({
      data: {
        businessId,
        customerId,
        number,
        issueDate: day("2026-02-01"),
        dueDate: day("2026-03-01"),
        status: "SENT",
        subtotal: total,
        total,
        lines: { create: [{ description: "Goods", quantity: 1, unitPrice: total, accountId: keys.SALES, lineTotal: total, taxAmount: 0 }] },
      },
    });
    await postSalesInvoice(created.id);
    return created;
  };
  const pay = (transId: string, amount: number, billRef: string | null, receivedAt = new Date("2026-06-10T09:00:00Z")) =>
    recordMpesaPayment(businessId, { kind: "C2B", transId, amount, receivedAt, payer: "JOHN DOE", billRef, phone: "254722000111" });

  before(async () => {
    businessId = (await scratchBusiness({ vatRegistered: false })).id;
    keys = await accountIdsByKey(businessId);
    customerId = (await prisma.customer.create({ data: { businessId, name: "Baraka Builders" } })).id;
  });
  after(() => dropBusiness(businessId));

  it("settles the invoice named in the account number", async () => {
    const inv = await invoice("INV-0100", 5000);
    const result = await pay("QAA1", 5000, "inv-0100");
    assert.equal(result.status, "RECORDED");
    const receipt = await prisma.receipt.findFirstOrThrow({ where: { businessId, reference: "QAA1" }, include: { allocations: true } });
    assert.equal(receipt.source, "MPESA");
    assert.equal(receipt.customerId, customerId);
    assert.equal(receipt.allocations[0].invoiceId, inv.id);
    assert.equal(Number(receipt.allocations[0].amount), 5000);
    assert.equal(await balanceOf(keys.AR), 0);
    assert.equal(await balanceOf(keys.MOBILE_MONEY), 5000);
  });

  it("ignores the same notification when Safaricom retries it", async () => {
    const again = await pay("QAA1", 5000, "INV-0100");
    assert.equal(again.status, "DUPLICATE");
    assert.equal(await prisma.receipt.count({ where: { businessId, reference: "QAA1" } }), 1);
    assert.equal(await balanceOf(keys.MOBILE_MONEY), 5000);
  });

  it("applies only what the invoice owes and keeps the rest as money received", async () => {
    await invoice("INV-0101", 1000);
    await pay("QAA2", 1400, "INV-0101");
    const receipt = await prisma.receipt.findFirstOrThrow({ where: { businessId, reference: "QAA2" }, include: { allocations: true } });
    assert.equal(Number(receipt.allocations[0].amount), 1000);
    assert.equal(Number(receipt.amount), 1400);
    assert.equal((await bookTotals(businessId)).balanced, true);
  });

  it("keeps a payment with an unknown account number as unmatched money in", async () => {
    const result = await pay("QAA3", 250, "SOMETHING ELSE");
    assert.equal(result.status, "RECORDED");
    const receipt = await prisma.receipt.findFirstOrThrow({ where: { businessId, reference: "QAA3" }, include: { allocations: true } });
    assert.equal(receipt.allocations.length, 0);
  });

  it("flags a payment dated in closed books instead of dropping it", async () => {
    await prisma.business.update({ where: { id: businessId }, data: { lockedThrough: day("2026-12-31") } });
    const result = await pay("QAA4", 100, null);
    assert.equal(result.status, "NEEDS_ATTENTION");
    assert.equal(await prisma.receipt.count({ where: { businessId, reference: "QAA4" } }), 0);
    const stored = await prisma.mpesaTransaction.findUniqueOrThrow({ where: { businessId_transId: { businessId, transId: "QAA4" } } });
    assert.equal(stored.status, "NEEDS_ATTENTION");
    await prisma.business.update({ where: { id: businessId }, data: { lockedThrough: null } });
  });

  it("can try a flagged payment again once the books are reopened", async () => {
    const flagged = await prisma.mpesaTransaction.findUniqueOrThrow({ where: { businessId_transId: { businessId, transId: "QAA4" } } });
    assert.ok(flagged.receivedAt, "the payment date is kept for a second try");
    const retry = await recordMpesaPayment(businessId, {
      kind: "C2B",
      transId: "QAA4",
      amount: Number(flagged.amount),
      receivedAt: flagged.receivedAt!,
      payer: flagged.payer ?? "",
      billRef: flagged.billRef,
      phone: flagged.phone,
    });
    assert.equal(retry.status, "RECORDED");
    assert.equal(await prisma.receipt.count({ where: { businessId, reference: "QAA4" } }), 1);
    assert.equal((await prisma.mpesaTransaction.findUniqueOrThrow({ where: { businessId_transId: { businessId, transId: "QAA4" } } })).status, "RECORDED");
  });

  it("flags a notification without a valid amount", async () => {
    assert.equal((await pay("QAA5", 0, null)).status, "NEEDS_ATTENTION");
  });

  it("flags a payment when there is no mobile money account", async () => {
    await prisma.account.update({ where: { id: keys.MOBILE_MONEY }, data: { isArchived: true } });
    assert.equal((await pay("QAA6", 100, null)).status, "NEEDS_ATTENTION");
    await prisma.account.update({ where: { id: keys.MOBILE_MONEY }, data: { isArchived: false } });
  });

  it("leaves every entry balanced", async () => {
    assert.equal((await unbalancedEntries(businessId)).length, 0);
    assert.equal((await bookTotals(businessId)).balanced, true);
  });
});
