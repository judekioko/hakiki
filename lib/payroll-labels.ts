import { countryPack } from "./countries";

export function employeeIdLabels(country: string) {
  if (country === "KE") return { taxId: "KRA PIN", pension: "NSSF number", health: "SHA number" };
  return {
    taxId: countryPack(country).taxIdLabel,
    pension: "Social security / pension number",
    health: "Health insurance number",
  };
}
