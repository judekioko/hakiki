import { NextResponse } from "next/server";
import { configForCallback } from "@/lib/mpesa";

// Safaricom asks here whether to accept a payment before it completes. Every payment to the shortcode is accepted:
// rejecting would turn a customer away over a typo in the account number, and the payment is matched afterwards.
export async function POST(_request: Request, { params }: { params: Promise<{ businessId: string; token: string }> }) {
  const { businessId, token } = await params;
  if (!(await configForCallback(businessId, token))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ResultCode: "0", ResultDesc: "Accepted" });
}
