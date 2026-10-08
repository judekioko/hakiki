"use client";

import { useEffect, useState } from "react";

// Shows the one-shot message set by lib/flash.ts, then clears the cookie so it does not appear again.
export function FlashBanner({ message }: { message: string | null }) {
  const [shown, setShown] = useState<string | null>(message);
  // The layout keys this component by the message, so a new message mounts a fresh banner.
  useEffect(() => {
    if (message) document.cookie = "hakiki_flash=; Max-Age=0; path=/";
  }, [message]);
  if (!shown) return null;
  return (
    <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 print:hidden">
      <p>{shown}</p>
      <button type="button" onClick={() => setShown(null)} className="shrink-0 text-amber-800 hover:underline">
        Dismiss
      </button>
    </div>
  );
}
