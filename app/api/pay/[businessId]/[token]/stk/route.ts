import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { configForCallback, parseDarajaTime } from "@/lib/mpesa";
import { recordMpesaPayment } from "@/lib/mpesa-record";

type StkCallback = {
  Body?: {
    stkCallback?: {
      CheckoutRequestID?: string;
      ResultCode?: number;
      ResultDesc?: string;
      CallbackMetadata?: { Item?: { Name: string; Value?: string | number }[] };
    };
  };
};

// The result of a payment request sent to a customer's phone: paid, cancelled, wrong PIN, timed out...
export async function POST(request: Request, { params }: { params: Promise<{ businessId: string; token: string }> }) {
  const { businessId, token } = await params;
  if (!(await configForCallback(businessId, token))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = ((await request.json().catch(() => null)) as StkCallback | null)?.Body?.stkCallback;
  const checkoutId = result?.CheckoutRequestID;
  if (result && checkoutId) {
    try {
      const pending = await prisma.mpesaTransaction.findUnique({ where: { checkoutRequestId: checkoutId } });
      if (pending && pending.businessId === businessId) {
        if (result.ResultCode === 0) {
          const item = (name: string) => result.CallbackMetadata?.Item?.find((i) => i.Name === name)?.Value;
          await recordMpesaPayment(businessId, {
            kind: "STK",
            transId: String(item("MpesaReceiptNumber") ?? ""),
            amount: Number(item("Amount")),
            receivedAt: parseDarajaTime(item("TransactionDate")),
            payer: "",
            phone: item("PhoneNumber") ? String(item("PhoneNumber")) : pending.phone,
            billRef: pending.billRef,
            invoiceId: pending.invoiceId,
            checkoutRequestId: checkoutId,
          });
        } else {
          await prisma.mpesaTransaction.update({
            where: { id: pending.id },
            data: { status: "FAILED", note: result.ResultDesc ?? `Safaricom result ${result.ResultCode}` },
          });
        }
      }
    } catch (error) {
      console.error("Could not record an M-Pesa payment request result", error);
    }
  }
  return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
