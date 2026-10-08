import "server-only";
import { revalidatePath } from "next/cache";
import { documentLockMessage, type LockableDocument } from "./period-lock";
import { setFlash } from "./flash";

type Lockable = { lockedThrough: Date | null };

// For actions that return nothing: when the document sits in closed books or a completed reconciliation, show the
// reason in the banner and tell the action to stop (it should `return`), instead of failing with an error page.
export async function blockedByLock(
  business: Lockable,
  kind: LockableDocument,
  id: string,
  ...newDates: (Date | null | undefined)[]
): Promise<boolean> {
  const message = await documentLockMessage(business, kind, id, ...newDates);
  if (!message) return false;
  await setFlash(message);
  revalidatePath("/app", "layout");
  return true;
}

export async function blockedWithMessage(message: string | null): Promise<boolean> {
  if (!message) return false;
  await setFlash(message);
  revalidatePath("/app", "layout");
  return true;
}
