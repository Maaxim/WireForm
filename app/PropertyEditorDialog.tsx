import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, Redo2, Undo2, X } from "lucide-react";
import type { HarnessProject } from "./model";
import { PropertyBulkDialog, type PropertyBulkSession } from "./PropertyBulkDialog";
import { applyPropertyTransaction, PropertyTransactionError, propertyRowLabel, reconcilePropertySelection, selectFilteredPropertyRows,
  selectPropertyRange, validatePropertyPreview, type PropertyTransactionPreview } from "./property-transactions";
import { naturalCompare } from "./bom";
import { WireColorEditor, WireColorSwatch } from "./WireColorEditor";
import { LengthValueEditor, NumberValueEditor, WireGaugeEditor } from "./PropertyValueEditors";
import { PROPERTY_CATEGORIES, PROPERTY_HEADER_HEIGHT, PROPERTY_ROW_HEIGHT, applyPropertyEdit, buildPropertyRows,
  nextEditablePropertyCell, propertyColumns, propertyDisplay, propertyIsReadOnly, propertyVisibleRange,
  queryPropertyRows, validatePropertyEdit, type PropertyCategory, type PropertyColumn, type PropertyEdit,
  type PropertyRow } from "./property-editor";

interface Props {
  project: HarnessProject; onClose: () => void;
  onUpdate: (mutate: (draft: HarnessProject) => void, message?: string) => void;
  onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean;
  validation: { errors: string[]; warnings: string[] };
}
interface EditingCell { row: PropertyRow; column: PropertyColumn; value: string; x: number; y: number }
const categoryTitle = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export function PropertyEditorDialog(props: Props) {
  const [category, setCategory] = useState<PropertyCategory>("connectors");
  const [search, setSearch] = useState("");
  const [filterColumn, setFilterColumn] = useState("");
  const [filterValue, setFilterValue] = useState<string | undefined>();
  const [sort, setSort] = useState({ column: "designator", descending: false });
  const [selection, setSelection] = useState<{ key: string; column: number } | null>(null);
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [bulkSession, setBulkSession] = useState<PropertyBulkSession | null>(null);
  const [resultMessage, setResultMessage] = useState("");
  const rangeAnchor = useRef<string | null>(null);
  const headerCheckbox = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [scroll, setScroll] = useState({ top: 0, height: 600 });
  const root = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());
  const pendingFocus = useRef<string | null>(null);
  const columns = useMemo(() => propertyColumns(category), [category]);
  const allRows = useMemo(() => buildPropertyRows(props.project, category), [props.project, category]);
  const rows = useMemo(() => queryPropertyRows(allRows, columns, { search, filterColumn, filterValue,
    sortColumn: sort.column, descending: sort.descending }), [allRows, columns, search, filterColumn, filterValue, sort]);
  const filter = columns.find((column) => column.id === filterColumn);
  const values = useMemo(() => filter ? [...new Set(allRows.map((row) => filter.filterValue?.(row) ?? String(filter.get(row))))].sort(naturalCompare) : [], [allRows, filter]);
  const activeRow = Math.max(0, rows.findIndex((row) => row.key === selection?.key));
  const activeColumn = Math.min(selection?.column ?? 0, columns.length - 1);
  const range = propertyVisibleRange(rows.length, scroll.top, scroll.height);
  const selected = useMemo(() => reconcilePropertySelection(selectedKeys, allRows), [selectedKeys, allRows]);
  const selectedRows = useMemo(() => allRows.filter((row) => selected.has(row.key)), [allRows, selected]);
  const selectedVisible = useMemo(() => rows.filter((row) => selected.has(row.key)).length, [rows, selected]);
  const blocked = Boolean(editing || bulkSession);
  const cellId = (key: string, column: number) => `${key}/${column}`;
  useEffect(() => {
    if (selected.size !== selectedKeys.size) setSelectedKeys(selected);
  }, [selected, selectedKeys]);
  useEffect(() => {
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = selectedVisible > 0 && selectedVisible < rows.length;
  }, [selectedVisible, rows.length]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root.current?.focus();
    const element = viewport.current;
    const observer = new ResizeObserver(() => setScroll({ top: element?.scrollTop ?? 0, height: element?.clientHeight ?? 600 }));
    if (element) observer.observe(element);
    return () => { observer.disconnect(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  useEffect(() => { if (viewport.current) viewport.current.scrollTop = 0; }, [category, search, filterColumn, filterValue, sort]);
  useEffect(() => {
    if (editing) root.current?.querySelector<HTMLElement>(".property-cell-editor input, .property-cell-editor textarea, .property-cell-editor select")?.focus();
  }, [editing?.row.key, editing?.column.id]);
  useLayoutEffect(() => {
    const target = pendingFocus.current && cellRefs.current.get(pendingFocus.current);
    if (target) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: "nearest", inline: "nearest" }); pendingFocus.current = null; }
  });
  const focusCell = (row: number, column: number) => {
    const target = rows[row];
    if (!target) return;
    setSelection({ key: target.key, column });
    pendingFocus.current = cellId(target.key, column);
    const element = viewport.current;
    if (element) {
      const top = row * PROPERTY_ROW_HEIGHT;
      if (top < element.scrollTop) element.scrollTop = top;
      if (top + PROPERTY_ROW_HEIGHT + PROPERTY_HEADER_HEIGHT > element.scrollTop + element.clientHeight) {
        element.scrollTop = top + PROPERTY_ROW_HEIGHT + PROPERTY_HEADER_HEIGHT - element.clientHeight;
      }
      setScroll({ top: element.scrollTop, height: element.clientHeight });
    }
  };
  const beginEdit = (row: PropertyRow, column: PropertyColumn, index: number) => {
    if (blocked || propertyIsReadOnly(column, row)) return;
    const rect = cellRefs.current.get(cellId(row.key, index))?.getBoundingClientRect();
    setSelection({ key: row.key, column: index }); setError("");
    setEditing({ row, column, value: String(column.get(row)),
      x: Math.max(12, Math.min(rect?.left ?? 40, window.innerWidth - 390)),
      y: Math.max(80, Math.min(rect?.top ?? 120, window.innerHeight - 340)) });
  };
  const cancel = () => { setEditing(null); setError(""); focusCell(activeRow, activeColumn); };
  const commit = (value = editing?.value) => {
    if (!editing || value === undefined) return true;
    const edit: PropertyEdit = { target: editing.row.ref, propertyId: editing.column.id, newValue: value };
    const result = validatePropertyEdit(props.project, edit);
    if (result.error) { setError(result.error); return false; }
    if (result.changed) props.onUpdate((draft) => { applyPropertyEdit(draft, edit); });
    setEditing(null); setError("");
    return true;
  };
  const requestClose = () => { if (commit()) props.onClose(); };
  const moveEditable = (direction: 1 | -1) => {
    const next = nextEditablePropertyCell(rows, columns, { row: activeRow, column: activeColumn }, direction);
    focusCell(next.row, next.column);
  };
  const startBulk = (mode: PropertyBulkSession["mode"]) => {
    setResultMessage("");
    setBulkSession({ mode, selected: selectedRows.map((row) => ({ ...row.ref })), filtered: rows.map((row) => ({ ...row.ref })) });
  };
  const applyBulk = (preview: PropertyTransactionPreview) => {
    const result = validatePropertyPreview(props.project, preview);
    if (result.issues.length) throw new PropertyTransactionError(result.issues);
    if (!result.latest.changes.length) return;
    const message = bulkSession?.mode === "replace" ? `Replaced ${result.latest.changes.length} values in ${result.latest.changedObjects} ${category}.`
      : `Updated ${result.latest.changedObjects} ${category} (${result.latest.changes.length} property changes).`;
    props.onUpdate((draft) => { applyPropertyTransaction(draft, preview); }, message);
    setResultMessage(message); setBulkSession(null);
  };

  return createPortal(<div className="property-editor-backdrop">
    <section className="property-editor-modal" ref={root} tabIndex={-1} role="dialog" aria-modal="true"
      aria-labelledby="property-editor-title" data-testid="property-editor" onKeyDown={(event) => {
        event.stopPropagation();
        if (bulkSession) return;
        if (event.key === "Escape") { event.preventDefault(); if (editing) cancel(); else props.onClose(); return; }
        if (editing && event.key !== "Tab") return;
        const typing = (event.target as HTMLElement).matches("input,textarea,select");
        if (!editing && !typing && (event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) {
          event.preventDefault(); if (event.shiftKey || event.key.toLowerCase() === "y") props.onRedo(); else props.onUndo(); return;
        }
        if (event.key === "Tab" && !(event.target as HTMLElement).matches("td")) {
          const scope = editing ? root.current?.querySelector(".property-cell-editor") : root.current;
          const items = [...(scope?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),td[tabindex="0"]') ?? [])];
          if (event.shiftKey && (document.activeElement === items[0] || document.activeElement === root.current)) { event.preventDefault(); items.at(-1)?.focus(); }
          else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
        }
      }}>
      <header className="property-editor-header"><h2 id="property-editor-title">Harness Property Editor</h2>
        <button onClick={props.onUndo} disabled={!props.canUndo || blocked} aria-label="Undo property change"><Undo2 size={16} /></button>
        <button onClick={props.onRedo} disabled={!props.canRedo || blocked} aria-label="Redo property change"><Redo2 size={16} /></button>
        <button onClick={requestClose} disabled={Boolean(bulkSession)} aria-label="Close Property Editor"><X size={19} /></button>
      </header>
      <div className="property-editor-tabs" role="tablist" aria-label="Component categories">
        {PROPERTY_CATEGORIES.map((value) => <button key={value} role="tab" aria-selected={category === value} disabled={blocked}
          onClick={() => { setCategory(value); setSearch(""); setFilterColumn(""); setFilterValue(undefined); setSelection(null); setSelectedKeys(new Set()); rangeAnchor.current = null; setResultMessage(""); setSort({ column: value === "conductors" ? "parent" : "designator", descending: false }); }}>
          {categoryTitle(value)}</button>)}
      </div>
      <div className="property-editor-query">
        <label>Search <input type="search" aria-label="Search properties" value={search} disabled={blocked} onChange={(event) => setSearch(event.target.value)} placeholder="Search visible properties" /></label>
        <label>Filter <select aria-label="Filter column" value={filterColumn} disabled={blocked} onChange={(event) => { setFilterColumn(event.target.value); setFilterValue(undefined); }}>
          <option value="">All properties</option>{columns.map((column) => <option key={column.id} value={column.id}>{column.title}</option>)}</select></label>
        {filter && <select aria-label="Filter value" disabled={blocked} value={filterValue === undefined ? "all" : `value:${filterValue}`}
          onChange={(event) => setFilterValue(event.target.value === "all" ? undefined : event.target.value.slice(6))}>
          <option value="all">All values</option>{values.map((value) => <option key={value} value={`value:${value}`}>{value || "(empty)"}</option>)}</select>}
        <span>{rows.length} / {allRows.length} {category}</span>
      </div>
      <div className="property-selection-toolbar" aria-label="Row selection actions">
        <span data-testid="property-selection-summary">{selected.size} selected · {selectedVisible} visible · {selected.size - selectedVisible} hidden by current filter</span>
        <button onClick={() => startBulk("bulk")} disabled={blocked || !selected.size}>Edit Selected</button>
        <button onClick={() => startBulk("replace")} disabled={blocked || !rows.length && !selected.size}>Find &amp; Replace</button>
        <button onClick={() => { setSelectedKeys(new Set()); rangeAnchor.current = null; }} disabled={blocked || !selected.size}>Clear Selection</button>
        {resultMessage && <span className="property-bulk-result" role="status">{resultMessage}</span>}
      </div>
      <div ref={viewport} className="property-editor-table-viewport" data-testid="property-table-viewport" onScroll={(event) => setScroll({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}>
        <table className="property-editor-table" role="grid" aria-label={`${categoryTitle(category)} properties`} aria-rowcount={rows.length + 1} aria-colcount={columns.length + 1} aria-multiselectable="true">
          <thead><tr><th className="property-selection-cell"><input ref={headerCheckbox} type="checkbox" aria-label={`Select all filtered ${category}`}
            disabled={blocked || !rows.length} checked={rows.length > 0 && selectedVisible === rows.length}
            onChange={(event) => setSelectedKeys((previous) => selectFilteredPropertyRows(previous, rows, event.target.checked))} /></th>
            {columns.map((column) => <th key={column.id} data-property={column.id} className={`property-col-${column.sizing}`} aria-sort={sort.column === column.id ? sort.descending ? "descending" : "ascending" : "none"}>
            <button disabled={blocked} onClick={() => setSort({ column: column.id, descending: sort.column === column.id ? !sort.descending : false })}>
              {column.title}{sort.column === column.id && (sort.descending ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}</button>
          </th>)}</tr></thead>
          <tbody>
            {range.start > 0 && <tr className="property-spacer" aria-hidden="true"><td colSpan={columns.length + 1} style={{ height: range.start * PROPERTY_ROW_HEIGHT }} /></tr>}
            {rows.slice(range.start, range.end).map((row, offset) => <tr key={row.key} aria-rowindex={range.start + offset + 2} aria-selected={selected.has(row.key)} data-property-row={row.key}>
              <td className="property-selection-cell" role="gridcell"><input type="checkbox" aria-label={`Select ${propertyRowLabel(row)}`} checked={selected.has(row.key)} disabled={blocked}
                data-select-component={row.component.id} data-select-conductor={row.ref.conductorId} onChange={() => undefined}
                onClick={(event) => {
                  const checked = event.currentTarget.checked;
                  setSelectedKeys((previous) => event.shiftKey && rangeAnchor.current
                    ? selectPropertyRange(previous, rows, rangeAnchor.current, row.key, checked) : selectFilteredPropertyRows(previous, [row], checked));
                  if (!event.shiftKey || !rangeAnchor.current) rangeAnchor.current = row.key;
                }} /></td>
              {columns.map((column, index) => {
                const readOnly = propertyIsReadOnly(column, row), display = propertyDisplay(column, row);
                const issue = column.validate?.(String(column.get(row)));
                return <td key={column.id} ref={(element) => { const key = cellId(row.key, index); if (element) cellRefs.current.set(key, element); else cellRefs.current.delete(key); }}
                  role="gridcell" tabIndex={activeRow === range.start + offset && activeColumn === index ? 0 : -1}
                  data-property={column.id} data-component-id={row.component.id} data-conductor-id={row.ref.conductorId}
                  aria-readonly={readOnly} aria-invalid={Boolean(issue)} title={[display, column.help, readOnly ? "Read-only" : "Double-click or press Enter to edit", issue].filter(Boolean).join("\n")}
                  className={`${readOnly ? "readonly" : "editable"}${issue ? " invalid" : ""}${selection?.key === row.key && activeColumn === index ? " selected" : ""}`}
                  onFocus={() => { if (!editing) setSelection({ key: row.key, column: index }); }}
                  onClick={() => { if (!editing) setSelection({ key: row.key, column: index }); }}
                  onDoubleClick={() => beginEdit(row, column, index)}
                  onKeyDown={(event) => {
                    if (blocked || event.altKey || event.metaKey) return;
                    const rowIndex = range.start + offset;
                    if (event.key === "Enter") { event.preventDefault(); beginEdit(row, column, index); }
                    else if (event.key === "Tab") { event.preventDefault(); moveEditable(event.shiftKey ? -1 : 1); }
                    else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
                      event.preventDefault();
                      const targetRow = event.key === "ArrowUp" ? rowIndex - 1 : event.key === "ArrowDown" ? rowIndex + 1 : event.ctrlKey && event.key === "Home" ? 0 : event.ctrlKey && event.key === "End" ? rows.length - 1 : rowIndex;
                      const targetColumn = event.key === "ArrowLeft" ? index - 1 : event.key === "ArrowRight" ? index + 1 : event.key === "Home" ? 0 : event.key === "End" ? columns.length - 1 : index;
                      focusCell(Math.max(0, Math.min(rows.length - 1, targetRow)), Math.max(0, Math.min(columns.length - 1, targetColumn)));
                    }
                  }}>
                  <span className="property-cell-value">{column.editor === "color" && <WireColorSwatch code={String(column.get(row))} />}{display || <span className="property-empty">—</span>}</span>
                </td>;
              })}
            </tr>)}
            {range.end < rows.length && <tr className="property-spacer" aria-hidden="true"><td colSpan={columns.length + 1} style={{ height: (rows.length - range.end) * PROPERTY_ROW_HEIGHT }} /></tr>}
          </tbody>
        </table>
        {!rows.length && <p className="property-editor-empty">{allRows.length ? "No components match the search or filter." : `No ${category} in this project.`}</p>}
      </div>
      <footer className="property-editor-footer"><span>Enter / double-click: edit · Tab: next editable cell · Esc: cancel / close</span>
        {(props.validation.errors.length > 0 || props.validation.warnings.length > 0) && <details><summary>{props.validation.errors.length} errors · {props.validation.warnings.length} warnings</summary>
          <ul>{[...props.validation.errors, ...props.validation.warnings].map((issue, index) => <li key={index}>{issue}</li>)}</ul></details>}
      </footer>
      {editing && <form className="property-cell-editor" aria-label={`Edit ${editing.column.title}`} style={{ left: editing.x, top: editing.y }}
        onSubmit={(event) => { event.preventDefault(); if (commit()) focusCell(activeRow, activeColumn); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); }
          else if (event.key === "Tab" && ["text", "gauge", "length", "number"].includes(editing.column.editor)) {
            event.preventDefault(); event.stopPropagation(); if (commit()) moveEditable(event.shiftKey ? -1 : 1);
          } else if (event.key === "Enter" && (editing.column.editor !== "multiline" || event.ctrlKey || event.metaKey) && !(event.target as HTMLElement).matches("select,button")) {
            event.preventDefault(); if (commit()) focusCell(activeRow, activeColumn);
          }
        }}>
        <strong>{editing.row.component.designator}{editing.row.conductorIndex !== undefined ? ` / cond. ${editing.row.conductorIndex + 1}` : ""} · {editing.column.title}</strong>
        {editing.column.editor === "color" ? <WireColorEditor code={editing.value} onChange={(value) => setEditing({ ...editing, value })} />
          : editing.column.editor === "multiline" ? <textarea autoFocus aria-label="Cell value" rows={6} value={editing.value} onChange={(event) => setEditing({ ...editing, value: event.target.value })} />
          : editing.column.editor === "length" ? <LengthValueEditor value={editing.value} onChange={(value) => setEditing({ ...editing, value })} />
          : editing.column.editor === "gauge" ? <WireGaugeEditor value={editing.value} autoFocus onChange={(value) => setEditing({ ...editing, value })} />
          : editing.column.editor === "number" ? <NumberValueEditor value={editing.value} autoFocus onChange={(value) => setEditing({ ...editing, value })} />
          : <input autoFocus aria-label="Cell value" value={editing.value} onChange={(event) => setEditing({ ...editing, value: event.target.value })} />}
        {error && <p className="property-edit-error" role="alert">{error}</p>}
        {editing.column.editor === "multiline" && <small>Enter: new line · Ctrl/⌘+Enter: save</small>}
        {editing.column.id === "length" && editing.row.component.kind === "bundle" && editing.row.ref.category === "conductors" && <button type="button" onClick={() => { if (commit("")) focusCell(activeRow, activeColumn); }}>Use bundle default</button>}
        <div className="property-cell-editor-actions"><button type="submit" className="primary-button">Save</button><button type="button" onClick={cancel}>Cancel</button></div>
      </form>}
      {bulkSession && <PropertyBulkDialog project={props.project} category={category} session={bulkSession}
        onClose={() => setBulkSession(null)} onApply={applyBulk} />}
    </section>
  </div>, document.body);
}
