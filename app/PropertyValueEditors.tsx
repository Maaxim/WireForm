import { EDITOR_LENGTH_UNITS, getLengthInputParts } from "./length";
import { useId, useState } from "react";

export function WireGaugeEditor({ value, onChange, autoFocus, label = "Wire size" }: {
  value: string; onChange: (value: string) => void; autoFocus?: boolean; label?: string;
}) {
  const id = useId();
  return <><input aria-label={label} value={value} autoFocus={autoFocus} list={id}
    onChange={(event) => onChange(event.target.value)} placeholder="22 AWG" />
    <datalist id={id}>{["12 AWG", "14 AWG", "16 AWG", "18 AWG", "20 AWG", "22 AWG", "24 AWG", "26 AWG", "0.5 mm²", "0.75 mm²", "1 mm²", "1.5 mm²", "2.5 mm²"].map((value) => <option key={value} value={value} />)}</datalist></>;
}

export function LengthValueEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [parts, setParts] = useState(() => getLengthInputParts(value));
  // Keep invalid drafts editable rather than silently replacing imported text.
  if (!parts) return <input aria-label="Length value" value={value} autoFocus
    onChange={(event) => onChange(event.target.value)} placeholder="600 mm" />;
  return <div className="property-length-input"><input type="number" step="any" aria-label="Length value" value={parts.quantity} autoFocus
    onChange={(event) => { setParts({ ...parts, quantity: event.target.value }); onChange(event.target.value ? `${event.target.value} ${parts.unit}` : ""); }} />
    <select aria-label="Length unit" value={parts.unit} onChange={(event) => { setParts({ ...parts, unit: event.target.value }); onChange(parts.quantity ? `${parts.quantity} ${event.target.value}` : ""); }}>
      {EDITOR_LENGTH_UNITS.map((unit) => <option key={unit}>{unit}</option>)}
    </select></div>;
}
