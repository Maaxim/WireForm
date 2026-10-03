import { CABLE_KINDS, type HarnessProject } from "./model.ts";

export interface WireColorDefinition {
  code: string;
  name: string;
  hex: string;
}

export interface ParsedWireColor {
  code: string;
  primaryCode: string;
  secondaryCode?: string;
  primary?: WireColorDefinition;
  secondary?: WireColorDefinition;
  isBicolor: boolean;
  supported: boolean;
}

// WireViz 0.4.1 color codes. Existing WireForm colors retain their established
// screen palette; the remaining standard WireViz colors use its published hex.
export const WIRE_COLOR_OPTIONS: readonly WireColorDefinition[] = [
  { code: "BK", name: "Black", hex: "#25292d" },
  { code: "WH", name: "White", hex: "#f5f5f1" },
  { code: "GY", name: "Gray", hex: "#8c969d" },
  { code: "PK", name: "Pink", hex: "#ff66cc" },
  { code: "RD", name: "Red", hex: "#d44c43" },
  { code: "OG", name: "Orange", hex: "#e47d35" },
  { code: "YE", name: "Yellow", hex: "#e4b72d" },
  { code: "OL", name: "Olive green", hex: "#708000" },
  { code: "GN", name: "Green", hex: "#3c9669" },
  { code: "TQ", name: "Turquoise", hex: "#00bfc7" },
  { code: "LB", name: "Light blue", hex: "#a0dfff" },
  { code: "BU", name: "Blue", hex: "#3f74b8" },
  { code: "VT", name: "Violet", hex: "#855b9d" },
  { code: "BN", name: "Brown", hex: "#8a6047" },
  { code: "BG", name: "Beige", hex: "#ceb673" },
  { code: "IV", name: "Ivory", hex: "#f5f0d0" },
  { code: "SL", name: "Slate", hex: "#708090" },
  { code: "CU", name: "Copper", hex: "#d6775e" },
  { code: "SN", name: "Tin", hex: "#aaaaaa" },
  { code: "SR", name: "Silver", hex: "#84878c" },
  { code: "GD", name: "Gold", hex: "#ffcf80" },
] as const;

const COLOR_BY_CODE = new Map(
  WIRE_COLOR_OPTIONS.map((color) => [color.code, color]),
);
const FALLBACK_COLOR = "#70808c";

export function parseWireColor(value: string | undefined): ParsedWireColor {
  const code = value?.trim().toUpperCase() ?? "";
  const primaryCode = code.slice(0, 2);
  const secondaryCode = code.length > 2 ? code.slice(2, 4) : undefined;
  const primary = COLOR_BY_CODE.get(primaryCode);
  const secondary = secondaryCode
    ? COLOR_BY_CODE.get(secondaryCode)
    : undefined;
  const expectedLength = secondaryCode ? 4 : 2;
  return {
    code,
    primaryCode,
    ...(secondaryCode ? { secondaryCode } : {}),
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
    isBicolor: Boolean(secondaryCode),
    supported: Boolean(
      code.length === expectedLength &&
        primary &&
        (!secondaryCode || secondary),
    ),
  };
}

export function formatWireColor(primaryCode: string, secondaryCode?: string) {
  const primary = primaryCode.trim().toUpperCase();
  const secondary = secondaryCode?.trim().toUpperCase() ?? "";
  if (!primary) return "";
  return secondary && secondary !== primary ? `${primary}${secondary}` : primary;
}

export function getWireColorDisplay(value: string | undefined) {
  const parsed = parseWireColor(value);
  if (!parsed.code) return "No color";
  if (!parsed.supported) return `Unknown color (${parsed.code})`;
  const names = parsed.secondary
    ? `${parsed.primary?.name} / ${parsed.secondary.name}`
    : parsed.primary?.name;
  return `${names} (${parsed.code})`;
}

export function getWireColorHex(value: string | undefined) {
  return parseWireColor(value).primary?.hex ?? FALLBACK_COLOR;
}

export function getWireColorStripeHex(value: string | undefined) {
  return parseWireColor(value).secondary?.hex;
}

export function getWireColorCssBackground(value: string | undefined) {
  const parsed = parseWireColor(value);
  const primary = parsed.primary?.hex ?? FALLBACK_COLOR;
  const secondary = parsed.secondary?.hex;
  return secondary
    ? `linear-gradient(to bottom, ${primary} 0 34%, ${secondary} 34% 66%, ${primary} 66% 100%)`
    : primary;
}

export function validateWireColors(project: HarnessProject) {
  const warnings: string[] = [];
  for (const component of project.components) {
    if (!CABLE_KINDS.includes(component.kind)) continue;
    for (let index = 0; index < component.wireCount; index += 1) {
      const raw = component.colors[index]?.trim() ?? "";
      const label = `${component.designator} conductor ${index + 1}`;
      if (!raw) {
        warnings.push(`${label} has no wire color; BK will be used for WireViz export.`);
        continue;
      }
      const parsed = parseWireColor(raw);
      if (!parsed.supported) {
        warnings.push(
          `${label} uses unsupported or malformed wire color code "${raw}"; the value is preserved.`,
        );
      } else if (
        parsed.secondaryCode &&
        parsed.primaryCode === parsed.secondaryCode
      ) {
        warnings.push(
          `${label} repeats ${parsed.primaryCode} as both primary and secondary color; use the solid code instead.`,
        );
      }
    }
  }
  return warnings;
}
