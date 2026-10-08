import { requireSession } from "@/lib/session";
import { IMPORT_KINDS, templateCsv, type ImportKind } from "@/lib/csv-import";

// A ready-made spreadsheet for each kind of import, with the right column headings and a couple of example rows.
export async function GET(_request: Request, { params }: { params: Promise<{ kind: string }> }) {
  await requireSession();
  const { kind } = await params;
  if (!IMPORT_KINDS.includes(kind as ImportKind)) return new Response("Not found", { status: 404 });
  return new Response("﻿" + templateCsv(kind as ImportKind), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hakiki-${kind}-template.csv"`,
    },
  });
}
