import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/jwt";
import { ACTIVE_BUSINESS_COOKIE } from "@/lib/business";

// Clears a session whose user no longer exists (e.g. after the demo data is rebuilt).
export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.delete(ACTIVE_BUSINESS_COOKIE);
  return response;
}
