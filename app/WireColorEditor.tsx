import { ChevronDown } from "lucide-react";
import { Field } from "./EditorField";
import { WIRE_COLOR_OPTIONS, formatWireColor, getWireColorCssBackground, getWireColorDisplay, parseWireColor } from "./wire-colors";

export function WireColorSwatch({
  code,
  className = "",
}: {
  code: string;
  className?: string;
}) {
  const parsed = parseWireColor(code);
  return (
    <span
      className={`wire-color-swatch ${parsed.secondary ? "bicolor" : "solid"} ${className}`.trim()}
      style={{ background: getWireColorCssBackground(code) }}
      role="img"
      aria-label={getWireColorDisplay(code)}
      title={getWireColorDisplay(code)}
    />
  );
}

export function WireColorEditor({
  code,
  onChange,
  target = "wire",
}: {
  code: string;
  onChange: (code: string) => void;
  target?: "wire" | "shield";
}) {
  const parsed = parseWireColor(code);
  const primaryValue = parsed.primary?.code ?? "__unknown";
  const secondaryValue = parsed.secondary
    ? parsed.secondary.code
    : parsed.supported
      ? ""
      : "__unknown";
  const primaryAriaLabel =
    target === "shield" ? "Primary shield color" : "Primary wire color";
  const secondaryAriaLabel =
    target === "shield" ? "Secondary shield color" : "Secondary wire color";
  return (
    <div className="wire-color-editor" data-color-target={target}>
      <div className="field-row">
        <Field label="Primary color">
          <div className="select-wrap">
            <select
              aria-label={primaryAriaLabel}
              value={primaryValue}
              onChange={(event) =>
                onChange(
                  formatWireColor(
                    event.target.value,
                    parsed.secondary?.code,
                  ),
                )
              }
            >
              {!parsed.primary && (
                <option value="__unknown" disabled>
                  Unsupported ({parsed.code || "empty"})
                </option>
              )}
              {WIRE_COLOR_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name} ({option.code})
                </option>
              ))}
            </select>
            <ChevronDown size={13} />
          </div>
        </Field>
        <Field label="Secondary color" hint="optional stripe">
          <div className="select-wrap">
            <select
              aria-label={secondaryAriaLabel}
              value={secondaryValue}
              disabled={!parsed.primary}
              onChange={(event) =>
                onChange(
                  formatWireColor(
                    parsed.primary?.code ?? "BK",
                    event.target.value || undefined,
                  ),
                )
              }
            >
              <option value="">None</option>
              {!parsed.supported && parsed.secondaryCode && (
                <option value="__unknown" disabled>
                  Unsupported ({parsed.secondaryCode})
                </option>
              )}
              {WIRE_COLOR_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name} ({option.code})
                </option>
              ))}
            </select>
            <ChevronDown size={13} />
          </div>
        </Field>
      </div>
      <div className="wire-color-preview">
        <WireColorSwatch code={code} className="large" />
        <span>{getWireColorDisplay(code)}</span>
        <small>WireViz color code</small>
        <code>{code}</code>
      </div>
    </div>
  );
}
