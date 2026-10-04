import { round2 } from "./money";

export type PayslipLine = { label: string; amount: number; party: "EMPLOYEE" | "EMPLOYER" | "TAX" | "RELIEF" };

export type PayslipCalc = {
  gross: number;
  taxableIncome: number;
  incomeTax: number;
  employeeDeductions: number;
  employerContributions: number;
  net: number;
  lines: PayslipLine[];
};

type Band = { upTo: number | null; rate: number };

export function bandTax(income: number, bands: Band[]): number {
  let tax = 0;
  let lower = 0;
  const sorted = [...bands].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
  for (const band of sorted) {
    const upper = band.upTo ?? Infinity;
    if (income <= lower) break;
    tax += (Math.min(income, upper) - lower) * (band.rate / 100);
    lower = upper;
  }
  return round2(tax);
}

// ---------- Kenya (monthly), rules in force from 2025 ----------
// PAYE bands and relief: Finance Act 2023. SHIF 2.75% (min KES 300) and Affordable Housing Levy 1.5% are deductible
// before PAYE from 27 Dec 2024 (Tax Laws (Amendment) Act 2024). NSSF year 3 rates from Feb 2025: 6% each of pay
// between the lower earnings limit (8,000) and upper earnings limit (72,000).
export const KENYA_PAYROLL = {
  payeBands: [
    { upTo: 24_000, rate: 10 },
    { upTo: 32_333, rate: 25 },
    { upTo: 500_000, rate: 30 },
    { upTo: 800_000, rate: 32.5 },
    { upTo: null, rate: 35 },
  ] as Band[],
  personalRelief: 2_400,
  shifRate: 2.75,
  shifMinimum: 300,
  housingLevyRate: 1.5,
  nssfRate: 6,
  nssfLowerLimit: 8_000,
  nssfUpperLimit: 72_000,
};

export function calculateKenyaPayslip(basic: number, allowances: number): PayslipCalc {
  const k = KENYA_PAYROLL;
  const gross = round2(basic + allowances);
  const nssfTier1 = round2(Math.min(gross, k.nssfLowerLimit) * (k.nssfRate / 100));
  const nssfTier2 = round2(Math.max(0, Math.min(gross, k.nssfUpperLimit) - k.nssfLowerLimit) * (k.nssfRate / 100));
  const nssf = round2(nssfTier1 + nssfTier2);
  const shif = gross > 0 ? round2(Math.max(k.shifMinimum, gross * (k.shifRate / 100))) : 0;
  const housing = round2(gross * (k.housingLevyRate / 100));

  const taxableIncome = round2(Math.max(0, gross - nssf - shif - housing));
  const taxBeforeRelief = bandTax(taxableIncome, k.payeBands);
  const relief = Math.min(k.personalRelief, taxBeforeRelief);
  const paye = round2(taxBeforeRelief - relief);

  const employeeDeductions = round2(nssf + shif + housing);
  const employerContributions = round2(nssf + housing);
  return {
    gross,
    taxableIncome,
    incomeTax: paye,
    employeeDeductions,
    employerContributions,
    net: round2(gross - paye - employeeDeductions),
    lines: [
      { label: "NSSF (employee)", amount: nssf, party: "EMPLOYEE" },
      { label: "SHIF", amount: shif, party: "EMPLOYEE" },
      { label: "Housing Levy (employee)", amount: housing, party: "EMPLOYEE" },
      { label: "PAYE before relief", amount: taxBeforeRelief, party: "TAX" },
      { label: "Personal relief", amount: relief, party: "RELIEF" },
      { label: "PAYE", amount: paye, party: "TAX" },
      { label: "NSSF (employer)", amount: nssf, party: "EMPLOYER" },
      { label: "Housing Levy (employer)", amount: housing, party: "EMPLOYER" },
    ],
  };
}

// ---------- Configurable engine for other countries ----------

export type PayrollRuleInput = {
  name: string;
  party: "EMPLOYEE" | "EMPLOYER";
  rate: number;
  fixedAmount: number;
  maxBase: number | null;
  maxAmount: number | null;
  preTax: boolean;
};

export function calculateConfiguredPayslip(
  basic: number,
  allowances: number,
  rules: PayrollRuleInput[],
  bands: Band[],
  personalRelief: number
): PayslipCalc {
  const gross = round2(basic + allowances);
  const lines: PayslipLine[] = [];
  let preTaxDeductions = 0;
  let employeeDeductions = 0;
  let employerContributions = 0;

  for (const rule of rules) {
    const base = rule.maxBase === null ? gross : Math.min(gross, rule.maxBase);
    let amount = round2(base * (rule.rate / 100) + rule.fixedAmount);
    if (rule.maxAmount !== null) amount = Math.min(amount, rule.maxAmount);
    if (amount <= 0) continue;
    lines.push({ label: rule.name, amount, party: rule.party });
    if (rule.party === "EMPLOYEE") {
      employeeDeductions += amount;
      if (rule.preTax) preTaxDeductions += amount;
    } else {
      employerContributions += amount;
    }
  }

  const taxableIncome = round2(Math.max(0, gross - preTaxDeductions));
  const taxBeforeRelief = bands.length ? bandTax(taxableIncome, bands) : 0;
  const relief = Math.min(personalRelief, taxBeforeRelief);
  const incomeTax = round2(taxBeforeRelief - relief);
  if (bands.length) {
    lines.push({ label: "Income tax before relief", amount: taxBeforeRelief, party: "TAX" });
    if (relief > 0) lines.push({ label: "Personal relief", amount: relief, party: "RELIEF" });
    lines.push({ label: "Income tax", amount: incomeTax, party: "TAX" });
  }

  return {
    gross,
    taxableIncome,
    incomeTax,
    employeeDeductions: round2(employeeDeductions),
    employerContributions: round2(employerContributions),
    net: round2(gross - incomeTax - employeeDeductions),
    lines,
  };
}
