/** Optional scalar measurements: blank is unspecified, explicit zero is real. */
export function isOptionalNonNegativeNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

export function readOptionalNonNegativeNumber(value: unknown, label: string): number | undefined {
  if (!isOptionalNonNegativeNumber(value)) throw new Error(`${label} must be a finite number greater than or equal to zero, or unspecified.`);
  return value === 0 ? 0 : value;
}

export function validateOptionalNonNegativeNumberInput(value: string) {
  const text = value.trim();
  if (!text) return undefined;
  const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) ? Number(text) : NaN;
  const underflow = numeric === 0 && /[1-9]/.test(text.split(/[eE]/)[0]);
  return Number.isFinite(numeric) && numeric >= 0 && !underflow ? undefined : "Enter a finite number greater than or equal to zero, or clear the value to leave it unspecified.";
}

export function parseOptionalNonNegativeNumberInput(value: string): number | undefined {
  const error = validateOptionalNonNegativeNumberInput(value);
  if (error) throw new Error(error);
  return value.trim() ? Number(value) || 0 : undefined;
}

/** Plain, locale-independent decimal notation without rounding IEEE-754 values. */
export function formatNumericProperty(value: number | undefined): string {
  if (value === undefined) return "";
  readOptionalNonNegativeNumber(value, "Measurement");
  const text = String(value);
  if (!/[eE]/.test(text)) return text;
  const [coefficient, exponentText] = text.toLowerCase().split("e");
  const [whole, fraction = ""] = coefficient.split(".");
  const digits = whole + fraction;
  const point = whole.length + Number(exponentText);
  return point <= 0 ? `0.${"0".repeat(-point)}${digits}`
    : point >= digits.length ? digits + "0".repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
}
