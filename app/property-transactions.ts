import type { HarnessComponent, HarnessProject } from "./model.ts";
import { getBundleConductorLengthOverride } from "./bundle-conductors.ts";
import { PROPERTY_CATEGORIES, propertyColumns, propertyDisplay, propertyIsReadOnly, propertyRowKey, resolvePropertyRow,
  validatePropertyEdit, type PropertyCategory, type PropertyColumn, type PropertyEdit, type PropertyRow, type PropertyRowRef } from "./property-editor.ts";

export type BulkFieldAction = { action: "keep" } | { action: "set"; value: string } | { action: "clear" };
export interface TransactionEdit extends PropertyEdit { action?: "set" | "clear" }
export interface PropertyEditTransaction {
  category: PropertyCategory;
  targets: readonly PropertyRowRef[];
  edits: readonly TransactionEdit[];
}
export interface PropertyTransactionIssue { target?: PropertyRowRef; row: string; property: string; message: string }
export interface PropertyChange {
  edit: TransactionEdit; row: string; property: string; previous: string; next: string; snapshot: string; changed: boolean;
}
export interface PropertyTransactionPreview {
  projectId: string; transaction: PropertyEditTransaction; entries: PropertyChange[]; changes: PropertyChange[];
  issues: PropertyTransactionIssue[]; selectedObjects: number; matchedObjects: number; changedObjects: number; unchangedObjects: number;
}

export function propertyRowLabel(row: PropertyRow) {
  return row.component.designator + (row.conductorIndex === undefined ? "" : ` / cond. ${row.conductorIndex + 1}`);
}
export function textualProperty(column: PropertyColumn) {
  return Boolean(column.set && ["text", "multiline"].includes(column.editor));
}
export function bulkPropertyColumns(category: PropertyCategory, rows: readonly PropertyRow[]) {
  // A mixed conductor selection cannot silently skip read-only cable members.
  return propertyColumns(category).filter((column) => rows.length > 0 && rows.every((row) => !propertyIsReadOnly(column, row)));
}
function snapshot(row: PropertyRow, column: PropertyColumn) {
  const bundleLength = column.id === "length" && row.ref.category === "conductors" && row.component.kind === "bundle";
  return JSON.stringify([row.component.kind, row.component.designator, row.conductorIndex ?? null, column.get(row),
    bundleLength ? [getBundleConductorLengthOverride(row.component, row.ref.conductorId!) ?? null, row.component.length] : null]);
}
function uniqueTargets(targets: readonly PropertyRowRef[]) {
  return [...new Map(targets.map((target) => [propertyRowKey(target), { ...target }])).values()];
}

export function createBulkPropertyTransaction(category: PropertyCategory, targets: readonly PropertyRowRef[], actions: Readonly<Record<string, BulkFieldAction>>): PropertyEditTransaction {
  const scope = uniqueTargets(targets);
  return { category, targets: scope, edits: scope.flatMap((target) => Object.entries(actions).flatMap(([propertyId, action]) =>
    action.action === "keep" ? [] : [{ target: { ...target }, propertyId, action: action.action, newValue: action.action === "clear" ? "" : action.value }])) };
}

/** Preview reads scalar property data only. It never clones a project or decodes attachments. */
export function previewPropertyTransaction(project: HarnessProject, transaction: PropertyEditTransaction): PropertyTransactionPreview {
  const issues: PropertyTransactionIssue[] = [], entries: PropertyChange[] = [];
  const scope = uniqueTargets(transaction.targets), keys = new Set(scope.map(propertyRowKey));
  const rows = new Map<string, PropertyRow | undefined>();
  const resolve = (target: PropertyRowRef) => {
    const key = propertyRowKey(target);
    if (!rows.has(key)) rows.set(key, resolvePropertyRow(project, target));
    return rows.get(key);
  };
  if (!PROPERTY_CATEGORIES.includes(transaction.category)) issues.push({ row: "Selection", property: "Category", message: "Unsupported property category." });
  for (const target of scope) {
    if (target.category !== transaction.category) issues.push({ target, row: target.componentId, property: "Category", message: "All targets must belong to the current category." });
    else if (!resolve(target)) issues.push({ target, row: target.componentId, property: "Target", message: "This component or conductor no longer exists." });
  }
  const seen = new Set<string>();
  for (const edit of transaction.edits) {
    const row = resolve(edit.target), column = propertyColumns(transaction.category).find((column) => column.id === edit.propertyId);
    const rowName = row ? propertyRowLabel(row) : edit.target.componentId;
    const issue = (message: string) => issues.push({ target: { ...edit.target }, row: rowName, property: column?.title ?? edit.propertyId, message });
    const key = JSON.stringify([propertyRowKey(edit.target), edit.propertyId]);
    if (edit.target.category !== transaction.category || !keys.has(propertyRowKey(edit.target))) { issue("The edit is outside the reviewed category/selection."); continue; }
    if (seen.has(key)) { issue("Duplicate updates for the same property are not allowed in one transaction."); continue; }
    seen.add(key);
    if (edit.action !== undefined && edit.action !== "set" && edit.action !== "clear") { issue("Unsupported field action."); continue; }
    if (edit.action === "set" && typeof edit.newValue === "string" && !edit.newValue.trim()) { issue("Choose Clear value explicitly to remove a value."); continue; }
    if (edit.action === "clear" && edit.newValue !== "") { issue("A Clear operation must have an empty value."); continue; }
    const result = validatePropertyEdit(project, edit);
    if (result.error) { issue(result.error); continue; }
    if (!row || !column || !("value" in result)) { issue("This target or property no longer exists."); continue; }
    // Validate even matching requests: invalid input must never bypass a transaction.
    const invalid = column.validate?.(result.value!);
    if (invalid) { issue(invalid); continue; }
    const inherit = edit.action === "clear" && edit.propertyId === "length" && row.ref.category === "conductors" && row.component.kind === "bundle";
    const inheritedBefore = row.ref.category === "conductors" && row.component.kind === "bundle" && edit.propertyId === "length"
      ? getBundleConductorLengthOverride(row.component, row.ref.conductorId!) === undefined : false;
    const explicitOverride = edit.action === "set" && edit.propertyId === "length" && row.ref.category === "conductors" && row.component.kind === "bundle";
    entries.push({ edit: { ...edit, target: { ...edit.target }, newValue: result.value! }, row: rowName, property: column.title,
      previous: (propertyDisplay(column, row) || "(empty)") + (inheritedBefore ? " (bundle default)" : ""),
      next: inherit ? `${row.component.length || "(empty)"} (bundle default)` : (column.format?.(result.value!) ?? (result.value || "(empty)")) + (explicitOverride ? " (override)" : ""),
      snapshot: snapshot(row, column), changed: result.changed || (explicitOverride && inheritedBefore) });
  }
  const changes = entries.filter((entry) => entry.changed);
  const changedObjects = new Set(changes.map((entry) => propertyRowKey(entry.edit.target))).size;
  const matching = new Set(entries.map((entry) => propertyRowKey(entry.edit.target))).size;
  return { projectId: project.projectId,
    transaction: { category: transaction.category, targets: scope, edits: transaction.edits.map((edit) => ({ ...edit, target: { ...edit.target } })) },
    entries, changes, issues, selectedObjects: scope.length, matchedObjects: matching, changedObjects, unchangedObjects: Math.max(0, scope.length - changedObjects) };
}

export function validatePropertyPreview(project: HarnessProject, preview: PropertyTransactionPreview) {
  const latest = previewPropertyTransaction(project, preview.transaction);
  const issues = [...latest.issues];
  if (project.projectId !== preview.projectId) issues.push({ row: "Project", property: "Preview", message: "The project changed. Refresh and review this preview." });
  const current = new Map(latest.entries.map((entry) => [JSON.stringify([propertyRowKey(entry.edit.target), entry.edit.propertyId]), entry]));
  for (const previous of preview.entries) {
    const next = current.get(JSON.stringify([propertyRowKey(previous.edit.target), previous.edit.propertyId]));
    if (!next || next.snapshot !== previous.snapshot) issues.push({ target: previous.edit.target, row: previous.row, property: previous.property,
      message: "This value or its source changed since preview. Refresh and review the changes." });
  }
  if (preview.issues.length) issues.push(...preview.issues);
  return { latest, issues: [...new Map(issues.map((issue) => [JSON.stringify([issue.target, issue.row, issue.property, issue.message]), issue])).values()] };
}

export class PropertyTransactionError extends Error {
  issues: readonly PropertyTransactionIssue[];
  constructor(issues: readonly PropertyTransactionIssue[]) {
    super(`${issues.map((issue) => `${issue.row} · ${issue.property}: ${issue.message}`).join("\n")}\nNo changes were made.`);
    this.issues = issues;
    this.name = "PropertyTransactionError";
  }
}

/** Validates twice (review + commit), stages affected components, then publishes once. */
export function applyPropertyTransaction(draft: HarnessProject, preview: PropertyTransactionPreview) {
  const { latest, issues } = validatePropertyPreview(draft, preview);
  if (issues.length) throw new PropertyTransactionError(issues);
  if (!latest.changes.length) return 0;
  const staged = new Map<string, HarnessComponent>();
  for (const change of latest.changes) {
    const result = validatePropertyEdit(draft, change.edit);
    if (result.error || !("row" in result)) throw new PropertyTransactionError([{ row: change.row, property: change.property, message: result.error ?? "Unable to resolve this property." }]);
    const original = result.row.component;
    if (!staged.has(original.id)) staged.set(original.id, { ...original, colors: [...original.colors], wireLabels: [...original.wireLabels],
      ...(original.conductorLengthOverrides ? { conductorLengthOverrides: { ...original.conductorLengthOverrides } } : {}) });
    const component = staged.get(original.id)!;
    result.column.set!(component, result.value!, { ...result.row, component });
  }
  draft.components = draft.components.map((component) => staged.get(component.id) ?? component);
  return latest.changes.length;
}

export interface FindReplaceOptions { propertyId: string; find: string; replacement: string; caseSensitive: boolean; wholeCell: boolean }
/** Literal replacement; replacement strings like $& have no special meaning. */
export function replacePropertyText(value: string, options: FindReplaceOptions): string | undefined {
  if (!options.find) return undefined;
  const haystack = options.caseSensitive ? value : value.toLowerCase();
  const needle = options.caseSensitive ? options.find : options.find.toLowerCase();
  if (options.wholeCell) return haystack === needle ? options.replacement : undefined;
  let cursor = 0, index = 0, output = "", matched = false;
  while (index <= value.length - options.find.length) {
    const portion = value.slice(index, index + options.find.length);
    if ((options.caseSensitive ? portion : portion.toLowerCase()) !== needle) { index++; continue; }
    output += value.slice(cursor, index) + options.replacement;
    index += options.find.length; cursor = index; matched = true;
  }
  return matched ? output + value.slice(cursor) : undefined;
}
export function createFindReplaceTransaction(project: HarnessProject, category: PropertyCategory, targets: readonly PropertyRowRef[], options: FindReplaceOptions): PropertyEditTransaction {
  const column = propertyColumns(category).find((column) => column.id === options.propertyId);
  if (!column || !textualProperty(column)) throw new Error("Find & Replace is available only for editable text properties.");
  if (!options.find) throw new Error("Enter literal text to find.");
  const scope = uniqueTargets(targets);
  return { category, targets: scope, edits: scope.flatMap((target) => {
    const row = resolvePropertyRow(project, target);
    // Keep missing targets as explicit errors in preview, never silently skip them.
    if (!row) return [];
    const next = replacePropertyText(String(column.get(row)), options);
    return next === undefined ? [] : [{ target: { ...target }, propertyId: column.id, newValue: next }];
  }) };
}

/** Selection helpers operate on stable row keys, including virtualized/hidden rows. */
export function reconcilePropertySelection(selected: ReadonlySet<string>, allRows: readonly PropertyRow[]) {
  const valid = new Set(allRows.map((row) => row.key));
  return new Set([...selected].filter((key) => valid.has(key)));
}
export function selectFilteredPropertyRows(selected: ReadonlySet<string>, filtered: readonly PropertyRow[], checked: boolean) {
  const next = new Set(selected);
  for (const row of filtered) { if (checked) next.add(row.key); else next.delete(row.key); }
  return next;
}
export function selectPropertyRange(selected: ReadonlySet<string>, filtered: readonly PropertyRow[], anchor: string, target: string, checked: boolean) {
  const from = filtered.findIndex((row) => row.key === anchor), to = filtered.findIndex((row) => row.key === target);
  const range = from < 0 || to < 0 ? filtered.filter((row) => row.key === target) : filtered.slice(Math.min(from, to), Math.max(from, to) + 1);
  return selectFilteredPropertyRows(selected, range, checked);
}
