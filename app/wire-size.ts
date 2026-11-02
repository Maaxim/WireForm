/** Shared AWG interpretation; preserves the existing Onshape 0–40 contract. */
export function parseAwgGauge(value: string) {
  const match = /^(?:AWG\s*)?(4\/0|3\/0|2\/0|1\/0|\d{1,2})(?:\s*AWG)?$/i.exec(value.trim());
  if (!match) return undefined;
  const designation = match[1];
  const number = /^\d+$/.test(designation) ? Number(designation) : undefined;
  return { designation: number === undefined ? designation : String(number),
    number: number ?? 1 - Number(designation[0]), supported: number === undefined || number <= 40 };
}

/** The project stores gauge text, shared by all conductors of a cable/bundle. */
export function parseWireSize(value: string) {
  const awg = parseAwgGauge(value);
  if (awg?.supported) return { unit: "AWG", number: awg.number };
  const metric = /^(\d+(?:[.,]\d+)?)\s*mm(?:2|²|\^2)$/i.exec(value.trim());
  const number = metric ? Number(metric[1].replace(",", ".")) : undefined;
  return number !== undefined && Number.isFinite(number) && number > 0 ? { unit: "mm²", number } : undefined;
}

export function validateWireSize(value: string) {
  return !value.trim() || parseWireSize(value) ? undefined : "Use a valid wire size, such as 24 AWG, 4/0 AWG or 0.5 mm².";
}
