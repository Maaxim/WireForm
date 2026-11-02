import { naturalCompare } from "./bom.ts";
import { getBundleConductorLengthOverride, getEffectiveBundleConductorLength, withBundleConductorLengthOverride } from "./bundle-conductors.ts";
import { parseLengthMeters } from "./length.ts";
import { CABLE_KINDS, CONNECTOR_KINDS, type HarnessComponent, type HarnessProject } from "./model.ts";
import { findTwistedPairForBundleConductor, findTwistedPairForWire } from "./twisted-pair.ts";
import { getWireColorDisplay, parseWireColor } from "./wire-colors.ts";
import { parseWireSize, validateWireSize } from "./wire-size.ts";

export const PROPERTY_CATEGORIES = ["connectors", "cables", "bundles", "conductors"] as const;
export type PropertyCategory = typeof PROPERTY_CATEGORIES[number];
export interface PropertyRowRef { category: PropertyCategory; componentId: string; conductorId?: string }
export interface PropertyRow {
  key: string; ref: PropertyRowRef; component: HarnessComponent; conductorIndex?: number; twistedPair: string;
}
export type PropertyEditorType = "text" | "multiline" | "length" | "gauge" | "color" | "readonly";
export interface PropertyColumn {
  id: string; title: string; editor: PropertyEditorType; sizing: "compact" | "content" | "flex";
  get: (row: PropertyRow) => string | number;
  format?: (value: string | number) => string;
  readOnly?: (row: PropertyRow) => boolean;
  help?: string;
  validate?: (value: string) => string | undefined;
  normalize?: (value: string) => string;
  set?: (component: HarnessComponent, value: string, row: PropertyRow) => void;
  compare?: (left: PropertyRow, right: PropertyRow) => number;
  filterValue?: (row: PropertyRow) => string;
}
export interface PropertyEdit { target: PropertyRowRef; propertyId: string; newValue: string }

export function propertyRowKey(ref: PropertyRowRef) {
  return JSON.stringify([ref.category, ref.componentId, ref.conductorId ?? null]);
}
function matchesCategory(component: HarnessComponent, category: PropertyCategory) {
  return category === "connectors" ? CONNECTOR_KINDS.includes(component.kind)
    : category === "cables" ? component.kind === "cable"
    : category === "bundles" ? component.kind === "bundle" : CABLE_KINDS.includes(component.kind);
}
function rowFor(project: HarnessProject, component: HarnessComponent, ref: PropertyRowRef): PropertyRow | undefined {
  if (!matchesCategory(component, ref.category)) return undefined;
  const index = ref.category === "conductors" && ref.conductorId ? component.conductorIds.indexOf(ref.conductorId) : undefined;
  if (ref.category === "conductors" && (index === undefined || index < 0 || index >= component.wireCount)) return undefined;
  const pair = ref.category !== "conductors" ? undefined : component.kind === "bundle"
    ? findTwistedPairForBundleConductor(project, component.id, ref.conductorId!)
    : component.kind === "wire" && component.wireCount === 1 ? findTwistedPairForWire(project, component.id) : undefined;
  return { key: propertyRowKey(ref), ref, component, conductorIndex: index, twistedPair: pair?.designator ?? "" };
}

/** Derived references only; never clones project data or processes attachments. */
export function buildPropertyRows(project: HarnessProject, category: PropertyCategory): PropertyRow[] {
  return project.components.filter((component) => matchesCategory(component, category)).flatMap((component) => {
    const refs = category === "conductors" ? component.conductorIds.slice(0, component.wireCount)
      .map((conductorId) => ({ category, componentId: component.id, conductorId })) : [{ category, componentId: component.id }];
    return refs.map((ref) => rowFor(project, component, ref)!).filter(Boolean);
  });
}
export function resolvePropertyRow(project: HarnessProject, ref: PropertyRowRef) {
  const component = project.components.find((component) => component.id === ref.componentId);
  return component ? rowFor(project, component, ref) : undefined;
}

const maxText = (limit: number) => (value: string) => value.length > limit ? `Use at most ${limit} characters.` : undefined;
function textColumn(id: "manufacturer" | "mpn" | "name" | "notes", title: string, multiline = false): PropertyColumn {
  return { id, title, editor: multiline ? "multiline" : "text", sizing: "flex", get: (row) => row.component[id],
    validate: maxText(4000), set: (component, value) => { component[id] = value; } };
}
const designator: PropertyColumn = { id: "designator", title: "Designator", editor: "readonly", sizing: "content", get: (row) => row.component.designator,
  help: "Rename in the component inspector. Structural identities are protected here." };
const gauge: PropertyColumn = { id: "gauge", title: "Wire size", editor: "gauge", sizing: "compact", get: (row) => row.component.gauge,
  help: "Wire size is shared by the parent cable/bundle; edit it in that category.",
  readOnly: (row) => row.ref.category === "conductors" && (row.component.kind !== "wire" || row.component.wireCount !== 1),
  validate: (value) => maxText(160)(value) ?? validateWireSize(value), normalize: (value) => value.trim(),
  set: (component, value) => { component.gauge = value; },
  compare: (left, right) => {
    const a = parseWireSize(left.component.gauge), b = parseWireSize(right.component.gauge);
    return a && b && a.unit === b.unit ? a.number - b.number : naturalCompare(left.component.gauge, right.component.gauge);
  } };
const length: PropertyColumn = { id: "length", title: "Length", editor: "length", sizing: "compact",
  get: (row) => row.component.kind === "bundle" && row.ref.category === "conductors"
    ? getEffectiveBundleConductorLength(row.component, row.ref.conductorId!) : row.component.length,
  readOnly: (row) => row.ref.category === "conductors" && (row.component.kind === "cable" || (row.component.kind === "wire" && row.component.wireCount !== 1)),
  help: "Physical cable conductors use the cable length. Clear a bundle override to use its default.",
  validate: (value) => maxText(160)(value) ?? (value.trim() && parseLengthMeters(value) === undefined
    ? "Length must be positive and include a supported unit (for example 600 mm)." : undefined),
  normalize: (value) => value.trim(),
  set: (component, value, row) => {
    if (row.ref.category === "conductors" && component.kind === "bundle") {
      component.conductorLengthOverrides = withBundleConductorLengthOverride(component, row.ref.conductorId!, value);
      if (!component.conductorLengthOverrides) delete component.conductorLengthOverrides;
    } else component.length = value;
  },
  compare: (left, right) => (parseLengthMeters(String(length.get(left))) ?? -1) - (parseLengthMeters(String(length.get(right))) ?? -1) };
const metadata = () => [textColumn("manufacturer", "Manufacturer"), textColumn("mpn", "MPN"), textColumn("name", "Description"), textColumn("notes", "Notes", true)];
export function propertyColumns(category: PropertyCategory): readonly PropertyColumn[] {
  if (category === "connectors") return [designator, ...metadata(),
    { id: "pinCount", title: "Pin count", editor: "readonly", sizing: "compact", get: (row) => row.component.pinCount },
    { id: "kind", title: "Connector type", editor: "readonly", sizing: "content", get: (row) => row.component.kind }];
  if (category !== "conductors") return [designator, ...metadata(), { ...length, title: category === "bundles" ? "Default length" : "Length" }, gauge,
    { id: "wireCount", title: "Conductors", editor: "readonly", sizing: "compact", get: (row) => row.component.wireCount }];
  return [
    { ...designator, id: "parent", title: "Parent" },
    { id: "conductor", title: "Conductor", editor: "readonly", sizing: "compact", get: (row) => row.conductorIndex! + 1 },
    { id: "label", title: "Label / Signal", editor: "text", sizing: "flex", get: (row) => row.component.wireLabels[row.conductorIndex!] ?? "",
      validate: maxText(300), set: (component, value, row) => { component.wireLabels[row.conductorIndex!] = value; } },
    { id: "color", title: "Color", editor: "color", sizing: "content", get: (row) => row.component.colors[row.conductorIndex!] ?? "",
      format: (value) => getWireColorDisplay(String(value)), normalize: (value) => parseWireColor(value).code,
      validate: (value) => parseWireColor(value).supported ? undefined : "Choose a supported wire color (including an optional stripe).",
      set: (component, value, row) => { component.colors[row.conductorIndex!] = value; } },
    gauge, { ...length, title: "Effective length" },
    { id: "lengthSource", title: "Length source", editor: "readonly", sizing: "content", get: (row) => row.component.kind === "bundle"
      ? getBundleConductorLengthOverride(row.component, row.ref.conductorId!) !== undefined ? "Override" : "Default"
      : row.component.kind === "cable" ? "Cable" : "Wire" },
    { id: "twistedPair", title: "Twisted pair", editor: "readonly", sizing: "content", get: (row) => row.twistedPair },
  ];
}

export function propertyIsReadOnly(column: PropertyColumn, row: PropertyRow) {
  return column.editor === "readonly" || !column.set || Boolean(column.readOnly?.(row));
}
export function propertyDisplay(column: PropertyColumn, row: PropertyRow) {
  const value = column.get(row);
  return column.format?.(value) ?? String(value);
}
/** Re-resolve stable IDs at commit time, never a displayed index or designator. */
export function validatePropertyEdit(project: HarnessProject, edit: PropertyEdit) {
  if (!PROPERTY_CATEGORIES.includes(edit.target.category)) return { error: "Unsupported property category.", changed: false };
  const row = resolvePropertyRow(project, edit.target);
  const column = propertyColumns(edit.target.category).find((column) => column.id === edit.propertyId);
  if (!row || !column) return { error: "This component or conductor no longer exists.", changed: false };
  if (propertyIsReadOnly(column, row)) return { error: "This property is read-only.", changed: false };
  if (typeof edit.newValue !== "string") return { error: "Enter a textual property value.", changed: false };
  const value = column.normalize?.(edit.newValue) ?? edit.newValue;
  // Clearing an explicit bundle override is a change even when its default is empty.
  const previous = column.id === "length" && row.ref.category === "conductors" && row.component.kind === "bundle"
    ? getBundleConductorLengthOverride(row.component, row.ref.conductorId!) ?? String(column.get(row)) : String(column.get(row));
  const clearingInherited = column.id === "length" && row.ref.category === "conductors" && row.component.kind === "bundle"
    && value === "" && getBundleConductorLengthOverride(row.component, row.ref.conductorId!) === undefined;
  const changed = !clearingInherited && value !== previous;
  const error = changed ? column.validate?.(value) : undefined;
  return { ...(error ? { error } : {}), changed: !error && changed, value, row, column };
}
/** Mutates ONLY the draft supplied by the application's existing update action. */
export function applyPropertyEdit(draft: HarnessProject, edit: PropertyEdit) {
  const result = validatePropertyEdit(draft, edit);
  if (result.error) throw new Error(result.error);
  if (!result.changed || !("column" in result)) return false;
  result.column!.set!(result.row!.component, result.value!, result.row!);
  return true;
}

export interface PropertyTableQuery { search?: string; filterColumn?: string; filterValue?: string; sortColumn?: string; descending?: boolean }
export function queryPropertyRows(rows: readonly PropertyRow[], columns: readonly PropertyColumn[], query: PropertyTableQuery) {
  const search = query.search?.trim().toLowerCase();
  const filter = columns.find((column) => column.id === query.filterColumn);
  const sort = columns.find((column) => column.id === query.sortColumn);
  const result = rows.filter((row) => (!search || columns.some((column) =>
    `${column.get(row)} ${propertyDisplay(column, row)}`.toLowerCase().includes(search))) &&
    (!filter || query.filterValue === undefined || (filter.filterValue?.(row) ?? String(filter.get(row))).toLowerCase() === query.filterValue.toLowerCase()));
  if (sort) result.sort((a, b) => ((sort.compare?.(a, b) ?? (typeof sort.get(a) === "number" && typeof sort.get(b) === "number"
    ? Number(sort.get(a)) - Number(sort.get(b)) : naturalCompare(String(sort.get(a)), String(sort.get(b))))) * (query.descending ? -1 : 1)) || naturalCompare(a.key, b.key));
  return result;
}

export interface PropertyCell { row: number; column: number }
export const PROPERTY_ROW_HEIGHT = 42;
export const PROPERTY_HEADER_HEIGHT = 38;
export function propertyVisibleRange(count: number, scrollTop: number, height: number) {
  const start = Math.min(Math.max(0, count - 1), Math.max(0, Math.floor((scrollTop - PROPERTY_HEADER_HEIGHT) / PROPERTY_ROW_HEIGHT) - 5));
  return { start, end: Math.min(count, start + Math.ceil(Math.max(1, height) / PROPERTY_ROW_HEIGHT) + 12) };
}
export function nextEditablePropertyCell(rows: readonly PropertyRow[], columns: readonly PropertyColumn[], current: PropertyCell, direction: 1 | -1): PropertyCell {
  const count = rows.length * columns.length;
  for (let offset = 1; offset <= count; offset++) {
    const index = ((current.row * columns.length + current.column + direction * offset) % count + count) % count;
    const row = Math.floor(index / columns.length), column = index % columns.length;
    if (!propertyIsReadOnly(columns[column], rows[row])) return { row, column };
  }
  return current;
}
