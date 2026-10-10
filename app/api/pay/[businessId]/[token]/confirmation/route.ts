import { NextResponse } from "next/server";
import { configForCallback, parseDarajaTime } from "@/lib/mpesa";
import { recordMpesaPayment } from "@/lib/mpesa-record";

type C2bPayload = {
  TransID?: string;
  TransTime?: string;
  TransAmount?: string | number;
  BillRefNumber?: string;
  MSISDN?: string;
  FirstName?: string;
  MiddleName?: string;
  LastName?: string;
};

// Safaricom calls this once a customer has paid the shortcode. Whatever happens, the answer is "accepted": the money has
// already moved, and a failure answer only makes Safaricom retry. Payments that cannot be booked are kept for review.
export async function POST(request: Request, { params }: { params: Promise<{ businessId: string; token: string }> }) {
  const { businessId, token } = await params;
  if (!(await configForCallback(businessId, token))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as C2bPayload | null;
  if (body?.TransID) {
    try {
      await recordMpesaPayment(businessId, {
        kind: "C2B",
        transId: body.TransID,
        amount: Number(body.TransAmount),
        receivedAt: parseDarajaTime(body.TransTime),
        payer: [body.FirstName, body.MiddleName, body.LastName].filter(Boolean).join(" "),
        billRef: body.BillRefNumber ?? null,
        // From version 2 of Daraja the phone number arrives masked, so it is kept only as a label.
        phone: body.MSISDN ?? null,
      });
    } catch (error) {
      console.error("Could not record an M-Pesa payment", error);
    }
  }
  return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
