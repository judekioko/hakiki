"use server";

import { revalidatePath } from "next/cache";
import { requireBusiness } from "@/lib/business";
import { audit } from "@/lib/audit";
import { IMPORTS, IMPORT_KINDS, analyseImport, commitImport, type ImportKind, type PreviewRow } from "@/lib/csv-import";

export type ImportState = {
  error?: string;
  // What the file would do, row by row. Nothing has been saved yet.
  preview?: {
    kind: ImportKind;
    csv: string;
    stockDate: string;
    asAt: string;
    notes: string[];
    rows: PreviewRow[];
    total: number;
    summary: { new: number; duplicate: number; error: number };
  };
  done?: { kind: ImportKind; created: number; skipped: number; failed: { line: number; message: string }[] };
};

const SHOWN_ROWS = 300;

// Two steps on one action: "preview" reads the file and reports on every row, "import" reads the same file again on
// the server and saves only the rows that were ready. The browser never decides what gets saved.
export async function runCsvImport(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const { business } = await requireBusiness();
  if (business.role === "STAFF") return { error: "Only an owner or accountant can import data" };

  const kind = String(formData.get("kind")) as ImportKind;
  if (!IMPORT_KINDS.includes(kind)) return { error: "Choose what you are importing" };
  const csv = String(formData.get("csv") ?? "");
  if (!csv.trim()) return { error: "Choose a CSV file first" };
  const stockDate = String(formData.get("stockDate") ?? "");
  const asAt = String(formData.get("asAt") ?? "");

  const analysis = await analyseImport(business, kind, csv, { stockDate, asAt });
  if (analysis.fatal) return { error: analysis.fatal };

  if (formData.get("intent") !== "import") {
    return {
      preview: { kind, csv, stockDate, asAt, notes: analysis.notes, rows: analysis.rows.slice(0, SHOWN_ROWS), total: analysis.rows.length, summary: analysis.summary },
    };
  }

  if (analysis.summary.new === 0) return { error: "There is nothing new to import in this file." };
  const outcome = await commitImport(business, kind, analysis, { stockDate, asAt });
  await audit(
    business.id,
    "IMPORT",
    "IMPORT",
    null,
    `Imported ${outcome.created} ${IMPORTS[kind].label.toLowerCase()} from a CSV file (${analysis.summary.duplicate} skipped as already present, ${analysis.summary.error + outcome.failed.length} not imported)`
  );
  revalidatePath("/app", "layout");
  if (outcome.created === 0 && outcome.failed.length > 0) return { error: outcome.failed[0].message };
  return { done: { kind, created: outcome.created, skipped: analysis.summary.duplicate + analysis.summary.error, failed: outcome.failed } };
}
