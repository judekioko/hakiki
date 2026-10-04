// KRA PINs are a letter (A individual, P non-individual), nine digits and a check letter.
export const KRA_PIN_PATTERN = /^[AP]\d{9}[A-Z]$/;

export function normalisePin(pin: string | null | undefined): string | null {
  const cleaned = pin?.replace(/\s+/g, "").toUpperCase();
  return cleaned ? cleaned : null;
}

// Kenyan numbers in any common format → 2547XXXXXXXX for wa.me links.
export function toWhatsAppNumber(phone: string | null | undefined): string | null {
  const digits = phone?.replace(/\D/g, "") ?? "";
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  return null;
}
