import { useEffect, useRef, useState } from "react";
import { Download, File, Paperclip, Plus, Trash2, Upload, X } from "lucide-react";
import type { ProjectAttachment } from "./model";
import {
  MAX_ATTACHMENT_SIZE, MAX_TOTAL_ATTACHMENTS_SIZE,
  addProjectAttachments, assertProjectFilesFit, createProjectFilePreview,
  prepareProjectAttachment, projectAttachmentDownloadBlob,
  projectAttachmentLimitWarnings, projectFileSizeLabel,
  replaceProjectAttachment, totalAttachmentSize, updateProjectAttachment,
  type ProjectFilePreview,
} from "./project-files";

interface Props {
  attachments: readonly ProjectAttachment[];
  onChange: (mutate: (files: readonly ProjectAttachment[]) => ProjectAttachment[]) => void;
  onClose: () => void;
  autosaveFailed: boolean;
}

export function ProjectFilesDialog(props: Props) {
  const latest = useRef(props);
  useEffect(() => { latest.current = props; });
  const alive = useRef(true);
  const dialogRef = useRef<HTMLElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replacementId = useRef<string | null>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ProjectFilePreview | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const current = props.attachments.find((file) => file.id === previewId);
  const visibleFiles = props.attachments.filter((file) =>
    `${file.filename} ${file.description ?? ""}`.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") latest.current.onClose();
      if (event.key === "Tab") {
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not([hidden]):not(:disabled), textarea:not(:disabled)',
        ) ?? []).filter((element) => element.offsetParent !== null);
        const target = event.shiftKey ? controls.at(-1) : controls[0];
        if (target && document.activeElement === (event.shiftKey ? controls[0] : controls.at(-1))) {
          event.preventDefault(); target.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => { window.removeEventListener("keydown", handleKey); previousFocus?.focus(); };
  }, []);

  useEffect(() => {
    if (!current) { setPreview(null); return; }
    try {
      const result = createProjectFilePreview(current);
      setPreview(result);
      return () => result.dispose();
    } catch (problem) {
      setPreview(null);
      setError(problem instanceof Error ? problem.message : "The file could not be previewed.");
    }
    // Rename/description edits do not decode an unchanged binary again.
  }, [current?.id, current?.data, current?.mimeType, current?.filename]);

  useEffect(() => {
    if (preview) previewRef.current?.scrollIntoView({ block: "nearest" });
  }, [preview]);

  const receiveFiles = async (files: File[], replaceId?: string) => {
    if (busyRef.current || !files.length) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      assertProjectFilesFit(latest.current.attachments, files, replaceId);
      const additions: ProjectAttachment[] = [];
      // Read sequentially to bound peak memory for a large multi-file selection.
      for (const file of files) additions.push(await prepareProjectAttachment(file));
      if (!alive.current) return;
      latest.current.onChange((existing) => replaceId
        ? replaceProjectAttachment(existing, replaceId, additions[0])
        : addProjectAttachments(existing, additions));
    } catch (problem) {
      if (alive.current) setError(problem instanceof Error ? problem.message : "The files could not be read.");
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const download = async (file: ProjectAttachment) => {
    try {
      const blob = await projectAttachmentDownloadBlob(file);
      if (!alive.current) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (problem) {
      if (alive.current) setError(problem instanceof Error ? problem.message : "The file could not be downloaded.");
    }
  };

  const mutate = (change: Parameters<Props["onChange"]>[0]) => {
    try { props.onChange(change); setError(""); return true; }
    catch (problem) {
      setError(problem instanceof Error ? problem.message : "The file could not be updated.");
      return false;
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) props.onClose();
    }}>
      <section ref={dialogRef} tabIndex={-1} className="modal project-files-modal" role="dialog" aria-modal="true"
        aria-labelledby="project-files-title" data-testid="project-files-dialog">
        <div className="modal-header">
          <div>
            <h2 id="project-files-title"><Paperclip size={18} /> Project Files</h2>
            <p>Internal references embedded in this project. Excluded from reports and manufacturing exports.</p>
          </div>
          <button className="modal-close" onClick={props.onClose} aria-label="Close Project Files"><X size={17} /></button>
        </div>
        <div className="project-files-toolbar">
          <button className="primary-button" onClick={() => inputRef.current?.click()} disabled={busy}>
            <Plus size={15} /> {busy ? "Reading files…" : "Add Files"}
          </button>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
            aria-label="Search Project Files" placeholder="Search files or descriptions" />
          <span>{props.attachments.length} files · {projectFileSizeLabel(totalAttachmentSize(props.attachments))} / {projectFileSizeLabel(MAX_TOTAL_ATTACHMENTS_SIZE)}</span>
          <input ref={inputRef} type="file" multiple hidden data-testid="project-files-add"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              void receiveFiles(files);
            }} />
          <input ref={replaceInputRef} type="file" hidden data-testid="project-files-replace"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              const id = replacementId.current;
              replacementId.current = null;
              if (file && id) void receiveFiles([file], id);
            }} />
        </div>
        <div className="modal-body project-files-body" onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.preventDefault(); void receiveFiles(Array.from(event.dataTransfer.files)); }}>
          {props.autosaveFailed && <p className="project-files-error" role="alert">
            Latest changes have not been saved locally. Download the WireForm project to keep your files.
          </p>}
          {error && <p className="project-files-error" role="alert">{error}</p>}
          {projectAttachmentLimitWarnings(props.attachments).map((warning) => (
            <p key={warning} className="project-files-warning" role="status">{warning}</p>
          ))}
          <p className="project-files-drop-hint">Drop files here, or use Add Files. Up to {projectFileSizeLabel(MAX_ATTACHMENT_SIZE)} per file. Original bytes are preserved.</p>
          <div className="project-files-list">
            {visibleFiles.map((file) => (
              <article className="project-file-card" key={file.id} data-attachment-id={file.id}>
                <div className="project-file-heading"><File size={20} /><strong>{file.filename}</strong><span>{projectFileSizeLabel(file.sizeBytes)}</span></div>
                <small>{file.mimeType}{file.addedAt ? ` · ${new Date(file.addedAt).toLocaleString()}` : ""}</small>
                {renaming === file.id && <form className="project-file-rename" onSubmit={(event) => {
                  event.preventDefault();
                  if (mutate((files) => updateProjectAttachment(files, file.id, { filename }))) setRenaming(null);
                }}>
                  <input aria-label="New attachment filename" value={filename} onChange={(event) => setFilename(event.target.value)} autoFocus />
                  <button type="submit">Save name</button><button type="button" onClick={() => setRenaming(null)}>Cancel</button>
                </form>}
                <label>Description
                  <textarea value={file.description ?? ""} rows={2} maxLength={4000} disabled={busy}
                    aria-label={`Description for ${file.filename}`}
                    onChange={(event) => mutate((files) => updateProjectAttachment(files, file.id, { description: event.target.value }))} />
                </label>
                <div className="project-file-actions">
                  <button disabled={busy} onClick={() => { setPreviewId(file.id); setError(""); }}>View</button>
                  <button disabled={busy} onClick={() => void download(file)}><Download size={13} /> Download</button>
                  <button disabled={busy} onClick={() => { setRenaming(file.id); setFilename(file.filename); }}>Rename</button>
                  <button disabled={busy} onClick={() => { replacementId.current = file.id; replaceInputRef.current?.click(); }}><Upload size={13} /> Replace</button>
                  <button className="danger" disabled={busy} onClick={() => {
                    if (window.confirm(`Delete "${file.filename}"? This file will be removed from the project.`)) {
                      mutate((files) => files.filter((candidate) => candidate.id !== file.id));
                    }
                  }}><Trash2 size={13} /> Delete</button>
                </div>
              </article>
            ))}
          </div>
          {!props.attachments.length && <p className="empty-selection">No project files have been added.</p>}
          {props.attachments.length > 0 && !visibleFiles.length && <p className="empty-selection">No project files match your search.</p>}
          {current && preview && <section ref={previewRef} className="project-file-preview" aria-label="Project file preview">
            <div><strong>{current.filename}</strong><button onClick={() => setPreviewId(null)} aria-label="Close file preview"><X size={16} /></button></div>
            {preview.kind === "image" && <img src={preview.url} alt={current.filename} onError={() => setError("Image preview unavailable. Download the original file instead.")} />}
            {preview.kind === "pdf" && <>
              <iframe src={preview.url} title={`PDF preview: ${current.filename}`} sandbox="" referrerPolicy="no-referrer" />
              <p>If your browser cannot display this restricted PDF preview, download the original file.</p>
            </>}
            {preview.kind === "text" && <pre>{preview.text}</pre>}
            {preview.kind === "download" && <p>Preview is unavailable for this file. Use Download to open it in an appropriate application.</p>}
          </section>}
        </div>
        <div className="modal-footer"><button className="secondary-button" onClick={props.onClose}>Close</button></div>
      </section>
    </div>
  );
}
