import { NextResponse } from "next/server";
import { runDueRecurring } from "@/lib/recurring";

// For an external scheduler (cPanel cron, GitHub Actions...): issues every recurring invoice that is due.
// Call with  Authorization: Bearer $CRON_SECRET.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const issued = await runDueRecurring();
  return NextResponse.json({ issued });
}
