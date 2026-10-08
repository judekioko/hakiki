import "server-only";
import { cookies } from "next/headers";

// A one-shot message shown at the top of the app after an action that cannot show its own error (for example the
// Void and Delete buttons, which are plain forms). It lives in a short-lived cookie and the banner clears it.
export const FLASH_COOKIE = "hakiki_flash";

export async function setFlash(message: string) {
  const store = await cookies();
  store.set(FLASH_COOKIE, message, { path: "/", maxAge: 60, sameSite: "lax" });
}

export async function readFlash(): Promise<string | null> {
  const store = await cookies();
  return store.get(FLASH_COOKIE)?.value ?? null;
}
