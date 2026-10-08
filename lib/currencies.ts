// Currencies offered for foreign-currency invoices and bills. African currencies come first.
export const CURRENCIES: { code: string; name: string }[] = [
  { code: "KES", name: "Kenyan shilling" },
  { code: "UGX", name: "Ugandan shilling" },
  { code: "TZS", name: "Tanzanian shilling" },
  { code: "RWF", name: "Rwandan franc" },
  { code: "ETB", name: "Ethiopian birr" },
  { code: "NGN", name: "Nigerian naira" },
  { code: "GHS", name: "Ghanaian cedi" },
  { code: "ZAR", name: "South African rand" },
  { code: "ZMW", name: "Zambian kwacha" },
  { code: "MWK", name: "Malawian kwacha" },
  { code: "EGP", name: "Egyptian pound" },
  { code: "XOF", name: "West African CFA franc" },
  { code: "XAF", name: "Central African CFA franc" },
  { code: "CDF", name: "Congolese franc" },
  { code: "USD", name: "US dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British pound" },
  { code: "CNY", name: "Chinese yuan" },
  { code: "AED", name: "UAE dirham" },
  { code: "INR", name: "Indian rupee" },
  { code: "JPY", name: "Japanese yen" },
  { code: "SAR", name: "Saudi riyal" },
  { code: "CAD", name: "Canadian dollar" },
  { code: "AUD", name: "Australian dollar" },
];

export function currencyName(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.name ?? code;
}

export function foreignCurrencies(base: string) {
  return CURRENCIES.filter((c) => c.code !== base);
}
