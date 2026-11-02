import { useEffect, useMemo, useRef, useState } from "react";
import type { HarnessProject } from "./model";
import { propertyColumns, resolvePropertyRow, type PropertyCategory, type PropertyRowRef } from "./property-editor";
import { bulkPropertyColumns, createBulkPropertyTransaction, createFindReplaceTransaction, previewPropertyTransaction,
  textualProperty, validatePropertyPreview, type BulkFieldAction, type PropertyTransactionPreview } from "./property-transactions";
import { WireColorEditor } from "./WireColorEditor";
import { LengthValueEditor, WireGaugeEditor } from "./PropertyValueEditors";

export interface PropertyBulkSession {
  mode: "bulk" | "replace"; selected: readonly PropertyRowRef[]; filtered: readonly PropertyRowRef[];
}
interface Props {
  project: HarnessProject; category: PropertyCategory; session: PropertyBulkSession;
  onClose: () => void; onApply: (preview: PropertyTransactionPreview) => void;
}
const PAGE_SIZE = 50;
export function PropertyBulkDialog({ project, category, session, onClose, onApply }: Props) {
  const [scope, setScope] = useState<"selected" | "filtered">(session.selected.length ? "selected" : "filtered");
  const [actions, setActions] = useState<Record<string, BulkFieldAction>>({});
  const [propertyId, setPropertyId] = useState(() => propertyColumns(category).find(textualProperty)?.id ?? "");
  const [find, setFind] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeCell, setWholeCell] = useState(true);
  const [preview, setPreview] = useState<PropertyTransactionPreview | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const dialog = useRef<HTMLElement>(null);
  const targets = session.mode === "bulk" || scope === "selected" ? session.selected : session.filtered;
  const resolved = useMemo(() => targets.flatMap((target) => { const row = resolvePropertyRow(project, target); return row ? [row] : []; }), [project, targets]);
  const columns = useMemo(() => bulkPropertyColumns(category, resolved), [category, resolved]);
  const textColumns = useMemo(() => propertyColumns(category).filter(textualProperty), [category]);
  const staleIssues = useMemo(() => preview ? validatePropertyPreview(project, preview).issues : [], [project, preview]);
  const [applying, setApplying] = useState(false);
  const applyingRef = useRef(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  const makePreview = () => {
    try {
      const transaction = session.mode === "bulk" ? createBulkPropertyTransaction(category, targets, actions)
        : createFindReplaceTransaction(project, category, targets, { propertyId, find, replacement, caseSensitive, wholeCell });
      setPreview(previewPropertyTransaction(project, transaction)); setPage(0); setError("");
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Unable to preview these changes."); }
  };
  const apply = () => {
    if (applyingRef.current || !preview || staleIssues.length || !preview.changes.length) return;
    applyingRef.current = true; setApplying(true);
    try { onApply(preview); }
    catch (problem) {
      const message = problem instanceof Error ? problem.message : "The update failed.";
      setError(message.includes("No changes were made.") ? message : `${message} No changes were made.`);
      applyingRef.current = false; setApplying(false);
    }
  };
  const title = session.mode === "bulk" ? "Bulk Edit" : "Find & Replace";
  return <div className="property-bulk-backdrop" onMouseDown={(event) => event.stopPropagation()}>
    <section className="property-bulk-modal" role="dialog" aria-modal="true" tabIndex={-1} ref={dialog}
      aria-label={preview ? `${title} Preview` : title} data-testid="property-bulk-dialog"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        if (event.key === "Tab") {
          const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)') ?? [])];
          if (event.shiftKey && (document.activeElement === controls[0] || document.activeElement === dialog.current)) { event.preventDefault(); controls.at(-1)?.focus(); }
          else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
        }
      }}>
      <header><h3>{title}{preview ? " Preview" : ""}</h3><span>{targets.length} {session.mode === "bulk" || scope === "selected" ? "selected" : "filtered"} {category}</span></header>
      <div className="property-bulk-body">
        {error && <p role="alert" className="property-edit-error">{error}</p>}
        {!preview ? session.mode === "bulk" ? <>
          <p>Choose Set value or Clear value for each property to change. Other properties remain unchanged.</p>
          {!columns.length && <p>No properties are editable for every selected row. Select rows of the same physical type.</p>}
          {columns.map((column) => {
            const action = actions[column.id] ?? { action: "keep" };
            const clearAllowed = !column.validate?.("");
            const value = action.action === "set" ? action.value : "";
            const updateValue = (value: string) => setActions((previous) => ({ ...previous, [column.id]: { action: "set", value } }));
            const isBundleLength = category === "conductors" && column.id === "length" && resolved.every((row) => row.component.kind === "bundle");
            return <div className="property-bulk-field" key={column.id} data-bulk-property={column.id}>
              <label>{column.title}<select aria-label={`Action for ${column.title}`} value={action.action} onChange={(event) => {
                const mode = event.target.value;
                const current = resolved.map((row) => String(column.get(row)));
                const common = current.length && current.every((value) => value === current[0]) ? current[0] : column.editor === "color" ? "BK" : "";
                setActions((previous) => ({ ...previous, [column.id]: mode === "set" ? { action: "set", value: common || "" } : { action: mode as "keep" | "clear" } }));
              }}><option value="keep">Leave unchanged</option><option value="set">{isBundleLength ? "Set individual override" : "Set value"}</option>
                <option value="clear" disabled={!clearAllowed}>{isBundleLength ? "Use bundle default" : "Clear value"}</option></select></label>
              {action.action === "set" && <div className="property-bulk-value">
                {column.editor === "color" ? <WireColorEditor code={value} onChange={updateValue} />
                  : column.editor === "gauge" ? <WireGaugeEditor value={value} onChange={updateValue} />
                  : column.editor === "length" ? <LengthValueEditor value={value} onChange={updateValue} />
                  : column.editor === "multiline" ? <textarea aria-label={`New ${column.title}`} rows={3} value={value} onChange={(event) => updateValue(event.target.value)} />
                  : <input aria-label={`New ${column.title}`} value={value} onChange={(event) => updateValue(event.target.value)} />}
              </div>}
              {action.action === "clear" && <small>{isBundleLength ? "Removes each individual override; it does not copy the current default." : "Removes the current value. The preview requires confirmation."}</small>}
            </div>;
          })}
        </> : <div className="property-replace-form">
          <label>Property<select aria-label="Replacement property" value={propertyId} onChange={(event) => setPropertyId(event.target.value)}>{textColumns.map((column) => <option key={column.id} value={column.id}>{column.title}</option>)}</select></label>
          <label>Find<input aria-label="Find text" value={find} onChange={(event) => setFind(event.target.value)} /></label>
          <label>Replace with<input aria-label="Replace with" value={replacement} onChange={(event) => setReplacement(event.target.value)} /></label>
          <label><input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} /> Case sensitive</label>
          <label><input type="checkbox" checked={wholeCell} onChange={(event) => setWholeCell(event.target.checked)} /> Match entire cell</label>
          <fieldset><legend>Scope</legend>
            <label><input type="radio" name="replace-scope" value="selected" checked={scope === "selected"} disabled={!session.selected.length} onChange={() => setScope("selected")} /> Selected rows ({session.selected.length})</label>
            <label><input type="radio" name="replace-scope" value="filtered" checked={scope === "filtered"} onChange={() => setScope("filtered")} /> All rows matching current filter ({session.filtered.length})</label>
          </fieldset><p>Literal text only. Empty replacement clears matching text. Targets are fixed when this dialog opens.</p>
        </div> : <>
          <div className="property-preview-counts" role="status">
            <span>Scope: {preview.selectedObjects} objects</span><span>Matched: {preview.matchedObjects}</span>
            <span>Affected objects: {preview.changedObjects}</span><strong>Actual changes: {preview.changes.length}</strong>
            <span>{session.mode === "bulk" ? "Already matching / kept" : "Unchanged / not matched"}: {preview.unchangedObjects}</span>
          </div>
          {staleIssues.length > 0 && <div className="property-edit-error" role="alert"><strong>Cannot apply. No changes were made.</strong>
            <ul>{staleIssues.slice(0, PAGE_SIZE).map((issue, index) => <li key={index}>{issue.row} · {issue.property}: {issue.message}</li>)}</ul>
            {staleIssues.length > PAGE_SIZE && <p>{staleIssues.length - PAGE_SIZE} more errors. Correct the operation and refresh the preview.</p>}</div>}
          {!preview.changes.length && !staleIssues.length && <p>No values need to change. No undo entry or autosave will be created.</p>}
          <table className="property-preview-table"><thead><tr><th>Ref</th><th>Property</th><th>Current value</th><th>New value</th></tr></thead>
            <tbody>{preview.changes.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((change, index) => <tr key={index}>
              <td>{change.row}</td><td>{change.property}</td><td>{change.previous}</td><td>{change.next}</td></tr>)}</tbody></table>
          {preview.changes.length > PAGE_SIZE && <nav aria-label="Preview pages"><button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {page + 1} / {Math.ceil(preview.changes.length / PAGE_SIZE)}</span>
            <button disabled={(page + 1) * PAGE_SIZE >= preview.changes.length} onClick={() => setPage(page + 1)}>Next</button></nav>}
        </>}
      </div>
      <footer><button onClick={onClose} disabled={applying}>Cancel</button>
        {preview ? <><button onClick={() => { setPreview(null); setError(""); }}>Back to Edit</button><button onClick={makePreview}>Refresh Preview</button>
          <button className="primary-button" onClick={apply} disabled={applying || staleIssues.length > 0 || !preview.changes.length}>
            {session.mode === "replace" ? `Replace ${preview.changes.length} Values` : `Apply ${preview.changes.length} Changes`}</button></>
          : <button className="primary-button" onClick={makePreview} disabled={!targets.length || (session.mode === "replace" && !find)}>{session.mode === "replace" ? "Preview Matches" : "Preview Changes"}</button>}
      </footer>
    </section>
  </div>;
}
