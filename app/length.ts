const LENGTH_FACTORS_TO_METERS: Record<string, number> = {
  m: 1,
  meter: 1,
  meters: 1,
  metre: 1,
  metres: 1,
  cm: 0.01,
  mm: 0.001,
  km: 1_000,
  in: 0.0254,
  inch: 0.0254,
  inches: 0.0254,
  '"': 0.0254,
  ft: 0.3048,
  foot: 0.3048,
  feet: 0.3048,
  yd: 0.9144,
  yard: 0.9144,
  yards: 0.9144,
};

function parseLength(value: string) {
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*([A-Za-z"]+)\s*$/.exec(value);
  if (!match) return undefined;
  const quantity = Number(match[1].replace(",", "."));
  const factor = LENGTH_FACTORS_TO_METERS[match[2].toLowerCase()];
  if (!Number.isFinite(quantity) || quantity <= 0 || factor === undefined) {
    return undefined;
  }
  return { quantity, factor, decimal: match[1].replace(",", ".") };
}

export function parseLengthMeters(value: string) {
  const parsed = parseLength(value);
  return parsed
    ? Number((parsed.quantity * parsed.factor).toFixed(9))
    : undefined;
}

/** Exact decimal millimeters for CSV cells, without binary drift or rounding. */
export function parseLengthMillimeters(value: string): string | undefined {
  const parsed = parseLength(value);
  if (!parsed) return undefined;
  const [whole, fraction = ""] = parsed.decimal.split(".");
  const [factorWhole, factorFraction = ""] = String(parsed.factor).split(".");
  const places = fraction.length + factorFraction.length;
  const product = (
    BigInt(whole + fraction) * BigInt(factorWhole + factorFraction) * BigInt(1000)
  )
    .toString()
    .padStart(places + 1, "0");
  if (!places) return product;
  const integer = product.slice(0, -places);
  const decimal = product.slice(-places).replace(/0+$/, "");
  return decimal ? `${integer}.${decimal}` : integer;
}
