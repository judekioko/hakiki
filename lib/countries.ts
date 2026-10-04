// Country packs: currency, tax wording and defaults per country.
// Tax rates are starting points that the business can edit in Settings; they must be confirmed before filing.

export type CountryPack = {
  code: string;
  name: string;
  currency: string;
  locale: string;
  taxIdLabel: string;
  // National e-invoicing / fiscal device system suppliers issue tax invoices through, if any.
  taxInvoiceSystem: string | null;
  vatName: string;
  vatRates: { name: string; rate: number; isDefault?: boolean }[];
  mobileMoney: string[];
  // Countries with a built-in statutory payroll calculation. Others use rules the business configures.
  builtInPayroll: boolean;
  corporateTaxRate: number;
};

export const COUNTRIES: CountryPack[] = [
  {
    code: "KE", name: "Kenya", currency: "KES", locale: "en-KE", taxIdLabel: "KRA PIN", taxInvoiceSystem: "eTIMS",
    vatName: "VAT", vatRates: [{ name: "VAT 16%", rate: 16, isDefault: true }, { name: "VAT 8% (fuel)", rate: 8 }, { name: "Zero-rated", rate: 0 }, { name: "Exempt", rate: 0 }],
    mobileMoney: ["M-Pesa", "Airtel Money"], builtInPayroll: true, corporateTaxRate: 30,
  },
  {
    code: "UG", name: "Uganda", currency: "UGX", locale: "en-UG", taxIdLabel: "TIN", taxInvoiceSystem: "EFRIS",
    vatName: "VAT", vatRates: [{ name: "VAT 18%", rate: 18, isDefault: true }, { name: "Zero-rated", rate: 0 }, { name: "Exempt", rate: 0 }],
    mobileMoney: ["MTN MoMo", "Airtel Money"], builtInPayroll: false, corporateTaxRate: 30,
  },
  {
    code: "TZ", name: "Tanzania", currency: "TZS", locale: "en-TZ", taxIdLabel: "TIN", taxInvoiceSystem: "EFD / VFD",
    vatName: "VAT", vatRates: [{ name: "VAT 18%", rate: 18, isDefault: true }, { name: "Zero-rated", rate: 0 }, { name: "Exempt", rate: 0 }],
    mobileMoney: ["M-Pesa", "Mixx by Yas", "Airtel Money", "HaloPesa"], builtInPayroll: false, corporateTaxRate: 30,
  },
  {
    code: "RW", name: "Rwanda", currency: "RWF", locale: "en-RW", taxIdLabel: "TIN", taxInvoiceSystem: "EBM",
    vatName: "VAT", vatRates: [{ name: "VAT 18%", rate: 18, isDefault: true }, { name: "Zero-rated", rate: 0 }, { name: "Exempt", rate: 0 }],
    mobileMoney: ["MTN MoMo", "Airtel Money"], builtInPayroll: false, corporateTaxRate: 28,
  },
  {
    code: "ET", name: "Ethiopia", currency: "ETB", locale: "en-ET", taxIdLabel: "TIN", taxInvoiceSystem: null,
    vatName: "VAT", vatRates: [{ name: "VAT 15%", rate: 15, isDefault: true }, { name: "Zero-rated", rate: 0 }, { name: "Exempt", rate: 0 }],
    mobileMoney: ["telebirr", "M-Pesa"], builtInPayroll: false, corporateTaxRate: 30,
  },
  {
    code: "NG", name: "Nigeria", currency: "NGN", locale: "en-NG", taxIdLabel: "TIN", taxInvoiceSystem: "FIRS e-invoicing",
    vatName: "VAT", vatRates: [{ name: "VAT 7.5%", rate: 7.5, isDefault: true }, { name: "Zero-rated", rate: 0 }, { name: "Exempt", rate: 0 }],
    mobileMoney: ["OPay", "PalmPay", "Moniepoint"], builtInPayroll: false, corporateTaxRate: 30,
  },
  {
    code: "GH", name: "Ghana", currency: "GHS", locale: "en-GH", taxIdLabel: "TIN", taxInvoiceSystem: "GRA E-VAT",
    vatName: "VAT", vatRates: [{ name: "VAT 15%", rate: 15, isDefault: true }, { name: "Zero-rated", rate: 0 }, { name: "Exempt", rate: 0 }],
    mobileMoney: ["MTN MoMo", "Telecel Cash", "AT Money"], builtInPayroll: false, corporateTaxRate: 25,
  },
  {
    code: "ZA", name: "South Africa", currency: "ZAR", locale: "en-ZA", taxIdLabel: "Tax number", taxInvoiceSystem: null,
    vatName: "VAT", vatRates: [{ name: "VAT 15%", rate: 15, isDefault: true }, { name: "Zero-rated", rate: 0 }, { name: "Exempt", rate: 0 }],
    mobileMoney: [], builtInPayroll: false, corporateTaxRate: 27,
  },
  {
    code: "ZM", name: "Zambia", currency: "ZMW", locale: "en-ZM", taxIdLabel: "TPIN", taxInvoiceSystem: "Smart Invoice",
    vatName: "VAT", vatRates: [{ name: "VAT 16%", rate: 16, isDefault: true }, { name: "Zero-rated", rate: 0 }, { name: "Exempt", rate: 0 }],
    mobileMoney: ["MTN MoMo", "Airtel Money"], builtInPayroll: false, corporateTaxRate: 30,
  },
  {
    code: "MW", name: "Malawi", currency: "MWK", locale: "en-MW", taxIdLabel: "TPIN", taxInvoiceSystem: null,
    vatName: "VAT", vatRates: [{ name: "VAT 16.5%", rate: 16.5, isDefault: true }, { name: "Zero-rated", rate: 0 }, { name: "Exempt", rate: 0 }],
    mobileMoney: ["Airtel Money", "TNM Mpamba"], builtInPayroll: false, corporateTaxRate: 30,
  },
  {
    code: "EG", name: "Egypt", currency: "EGP", locale: "en-EG", taxIdLabel: "Tax registration number", taxInvoiceSystem: "ETA e-invoice",
    vatName: "VAT", vatRates: [{ name: "VAT 14%", rate: 14, isDefault: true }, { name: "Zero-rated", rate: 0 }, { name: "Exempt", rate: 0 }],
    mobileMoney: ["Vodafone Cash", "InstaPay"], builtInPayroll: false, corporateTaxRate: 22.5,
  },
  {
    code: "CI", name: "Côte d'Ivoire", currency: "XOF", locale: "fr-CI", taxIdLabel: "NCC", taxInvoiceSystem: "FNE",
    vatName: "TVA", vatRates: [{ name: "TVA 18%", rate: 18, isDefault: true }, { name: "TVA 9%", rate: 9 }, { name: "Exonéré", rate: 0 }],
    mobileMoney: ["Orange Money", "MTN MoMo", "Wave", "Moov Money"], builtInPayroll: false, corporateTaxRate: 25,
  },
  {
    code: "SN", name: "Senegal", currency: "XOF", locale: "fr-SN", taxIdLabel: "NINEA", taxInvoiceSystem: null,
    vatName: "TVA", vatRates: [{ name: "TVA 18%", rate: 18, isDefault: true }, { name: "TVA 10%", rate: 10 }, { name: "Exonéré", rate: 0 }],
    mobileMoney: ["Wave", "Orange Money", "Free Money"], builtInPayroll: false, corporateTaxRate: 30,
  },
  {
    code: "CM", name: "Cameroon", currency: "XAF", locale: "fr-CM", taxIdLabel: "NIU", taxInvoiceSystem: null,
    vatName: "TVA", vatRates: [{ name: "TVA 19.25%", rate: 19.25, isDefault: true }, { name: "Exonéré", rate: 0 }],
    mobileMoney: ["MTN MoMo", "Orange Money"], builtInPayroll: false, corporateTaxRate: 30,
  },
  {
    code: "CD", name: "DR Congo", currency: "CDF", locale: "fr-CD", taxIdLabel: "NIF", taxInvoiceSystem: null,
    vatName: "TVA", vatRates: [{ name: "TVA 16%", rate: 16, isDefault: true }, { name: "Exonéré", rate: 0 }],
    mobileMoney: ["M-Pesa", "Orange Money", "Airtel Money"], builtInPayroll: false, corporateTaxRate: 30,
  },
];

export const DEFAULT_COUNTRY = "KE";

export function countryPack(code: string | null | undefined): CountryPack {
  return COUNTRIES.find((c) => c.code === code) ?? COUNTRIES.find((c) => c.code === DEFAULT_COUNTRY)!;
}

// Wording for supplier tax invoices: "eTIMS invoice" in Kenya, "EFRIS invoice" in Uganda, "tax invoice" elsewhere.
export function taxInvoiceLabel(code: string | null | undefined): string {
  const system = countryPack(code).taxInvoiceSystem;
  return system ? `${system} invoice` : "tax invoice";
}

export const RATES_DISCLAIMER =
  "Tax rates are defaults for this country. Check them with your tax authority or adviser before filing.";
