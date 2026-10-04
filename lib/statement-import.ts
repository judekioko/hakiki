// Parses M-Pesa (business portal) and bank statement CSV exports into outgoing payments.
// Column layouts differ between banks, so columns are found by header name rather than position.

export type ParsedPayment = {
  reference: string | null;
  paidAt: Date;
  amount: number;
  counterparty: string;
  details: string;
};

export type ParseResult = {
  payments: ParsedPayment[];
  skippedRows: number;
  incomingRows: number;
  columns: Record<ColumnKey, string | null>;
};

type ColumnKey = "reference" | "date" | "details" | "counterparty" | "debit" | "credit" | "amount" | "status";

const COLUMN_ALIASES: Record<ColumnKey, string[]> = {
  reference: ["receipt no.", "receipt no", "receipt", "transaction id", "transaction ref", "reference", "ref", "ref no", "ref no.", "reference no", "cheque/ref no", "mpesa code"],
  date: ["completion time", "transaction date", "trans date", "date", "value date", "posting date", "booking date", "initiation time"],
  details: ["details", "description", "narration", "narrative", "particulars", "transaction details", "remarks"],
  counterparty: ["other party info", "counterparty", "payee", "beneficiary", "paid to"],
  debit: ["withdrawn", "withdrawals", "withdrawal", "debit", "debits", "money out", "paid out", "debit amount", "dr"],
  credit: ["paid in", "deposits", "deposit", "credit", "credits", "money in", "credit amount", "cr"],
  amount: ["amount", "transaction amount"],
  status: ["transaction status", "status"],
};

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const input = text.replace(/^﻿/, "");

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function findColumns(header: string[]): Record<ColumnKey, number> {
  const normalised = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, " "));
  const result = {} as Record<ColumnKey, number>;
  for (const key of Object.keys(COLUMN_ALIASES) as ColumnKey[]) {
    result[key] = -1;
    for (const alias of COLUMN_ALIASES[key]) {
      const index = normalised.indexOf(alias);
      if (index !== -1) {
        result[key] = index;
        break;
      }
    }
  }
  return result;
}

function isUsableHeader(columns: Record<ColumnKey, number>): boolean {
  return columns.date !== -1 && (columns.debit !== -1 || columns.amount !== -1);
}

export function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  let text = raw.trim();
  if (!text || text === "-") return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (/\bdr\b/i.test(text)) negative = true;
  text = text.replace(/kes|ksh|dr|cr/gi, "").replace(/[,\s]/g, "");
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  }
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

// Kenyan statements use day-first dates. Times are kept when present.
export function parseStatementDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const text = raw.trim();
  let m = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return build(+m[1], +m[2] - 1, +m[3], m[4], m[5], m[6]);
  m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return build(fullYear(+m[3]), +m[2] - 1, +m[1], m[4], m[5], m[6]);
  m = text.match(/^(\d{1,2})[-\s]([A-Za-z]{3,4})[A-Za-z]*[-\s,]+(\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) {
    return build(fullYear(+m[3]), MONTHS[m[2].toLowerCase()], +m[1], m[4], m[5], m[6]);
  }
  return null;
}

function fullYear(year: number): number {
  return year < 100 ? 2000 + year : year;
}

function build(year: number, month: number, day: number, h?: string, min?: string, s?: string): Date | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  // Statement times are East Africa Time (UTC+3).
  const date = new Date(Date.UTC(year, month, day, Number(h ?? 12) - 3, Number(min ?? 0), Number(s ?? 0)));
  return Number.isNaN(date.getTime()) ? null : date;
}

// "Merchant Payment to 512345 - JOHN SUPPLIES LTD" → "JOHN SUPPLIES LTD"
// "Pay Bill to 888880 - KPLC PREPAID Acc. 1234" → "KPLC PREPAID"
// "254722000000 - JANE WANJIKU" → "JANE WANJIKU"
export function extractCounterparty(details: string, otherParty?: string): string {
  const source = (otherParty?.trim() || details).trim();
  const dashIndex = source.lastIndexOf(" - ");
  let name = dashIndex !== -1 ? source.slice(dashIndex + 3) : source;
  name = name
    .replace(/\s+acc(?:ount)?\.?\s*(?:no\.?)?\s*[:#]?\s*\S*$/i, "")
    .replace(/^(?:merchant payment|pay bill(?: online)?|customer transfer|business payment|buy goods) to\s+/i, "")
    .replace(/^(?:eft|rtgs|pesalink|swift|ift|funds transfer|transfer|trf|chq|cheque)(?:\s+(?:to|payment to|no\.?\s*\d+))?[\s:/-]+/i, "")
    .trim();
  return name || source || "Unknown";
}

export function parseStatement(text: string): ParseResult {
  const rows = parseCsv(text);
  let headerIndex = -1;
  let columns: Record<ColumnKey, number> | null = null;

  // Statements often start with account details; the header is the first row that names a date and an amount.
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const candidate = findColumns(rows[i]);
    if (isUsableHeader(candidate)) {
      headerIndex = i;
      columns = candidate;
      break;
    }
  }
  if (!columns) {
    throw new Error(
      "Could not find the header row. The file needs a date column and a withdrawn/debit or amount column."
    );
  }

  const header = rows[headerIndex];
  const payments: ParsedPayment[] = [];
  let skippedRows = 0;
  let incomingRows = 0;
  const cell = (row: string[], index: number) => (index === -1 ? undefined : row[index]);

  for (const row of rows.slice(headerIndex + 1)) {
    const status = cell(row, columns.status)?.trim().toLowerCase();
    if (status && status !== "completed" && status !== "success" && status !== "successful") {
      skippedRows++;
      continue;
    }

    const paidAt = parseStatementDate(cell(row, columns.date));
    let outgoing: number | null = null;
    if (columns.debit !== -1) {
      const debit = parseAmount(cell(row, columns.debit));
      if (debit) outgoing = Math.abs(debit);
    } else {
      const amount = parseAmount(cell(row, columns.amount));
      if (amount !== null && amount < 0) outgoing = Math.abs(amount);
      else if (amount !== null && amount > 0) {
        incomingRows++;
        continue;
      }
    }

    if (!paidAt) {
      skippedRows++;
      continue;
    }
    if (!outgoing) {
      const credit = parseAmount(cell(row, columns.credit));
      if (credit) incomingRows++;
      else skippedRows++;
      continue;
    }

    const details = cell(row, columns.details)?.trim() ?? "";
    payments.push({
      reference: cell(row, columns.reference)?.trim().toUpperCase() || null,
      paidAt,
      amount: Math.round(outgoing * 100) / 100,
      counterparty: extractCounterparty(details, cell(row, columns.counterparty)),
      details,
    });
  }

  const columnNames = {} as Record<ColumnKey, string | null>;
  for (const key of Object.keys(columns) as ColumnKey[]) {
    columnNames[key] = columns[key] === -1 ? null : header[columns[key]].trim();
  }
  return { payments, skippedRows, incomingRows, columns: columnNames };
}
