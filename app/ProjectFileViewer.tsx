import { lazy, Suspense, useEffect, useRef, useState, type RefObject } from "react";
import { Download, Minus, Plus, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { ProjectAttachment } from "./model";
import { createProjectFilePreview, type ProjectFilePreview } from "./project-files";
import { ProjectFileImageViewer } from "./ProjectFileImageViewer";
import type { ViewerSize } from "./project-file-viewport";

const ProjectFilePdfViewer = lazy(() => import("./ProjectFilePdfViewer"));
export interface ViewerHandle {
  zoomIn: () => void; zoomOut: () => void; reset: () => void;
  move: (x: number, y: number) => void; page?: (delta: number) => void;
}
export interface ViewerChildProps { controls: RefObject<ViewerHandle | null> }

export function useViewerSize(ref: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState<ViewerSize>({ width: 1, height: 1 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export function ViewerZoomToolbar({ zoom, onZoom, onFit, onNative, onReset, children }: {
  zoom: number; onZoom: (factor: number) => void; onFit: () => void; onNative: () => void;
  onReset: () => void; children?: React.ReactNode;
}) {
  return <footer className="project-viewer-toolbar" aria-label="Preview controls">
    {children}
    <button onClick={() => onZoom(1 / 1.25)} aria-label="Zoom out"><Minus size={16} /></button>
    <output aria-label="Zoom percentage">{Math.round(zoom * 100)}%</output>
    <button onClick={() => onZoom(1.25)} aria-label="Zoom in"><Plus size={16} /></button>
    <button onClick={onFit}>Fit{children ? " Page" : ""}</button>
    <button onClick={onNative}>100%</button><button onClick={onReset}>Reset</button>
  </footer>;
}

export function ProjectFileViewer({ attachment, onClose, onDownload }: {
  attachment: ProjectAttachment; onClose: () => void; onDownload: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const controls = useRef<ViewerHandle | null>(null);
  const [preview, setPreview] = useState<ProjectFilePreview | null>(null);
  const [error, setError] = useState("");
  const [wrap, setWrap] = useState(false);
  useEffect(() => {
    try {
      const result = createProjectFilePreview(attachment);
      setPreview(result);
      return () => result.dispose();
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Unable to preview this file."); }
  }, [attachment]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);

  return createPortal(<div className="project-viewer-backdrop" onMouseDown={(event) => event.stopPropagation()}>
    <section ref={dialog} className="project-file-viewer" role="dialog" aria-modal="true" tabIndex={-1}
      aria-label={`Preview: ${attachment.filename}`} data-testid="project-file-viewer"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
        if (event.key === "Tab") {
          const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]') ?? []);
          const first = items[0], last = items.at(-1);
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
            event.preventDefault(); last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          return;
        }
        if ((event.target as HTMLElement).matches("input,textarea,select") || event.ctrlKey || event.metaKey || event.altKey) return;
        const handle = controls.current;
        if (!handle) return;
        const actions: Record<string, () => void> = { "+": handle.zoomIn, "=": handle.zoomIn, "-": handle.zoomOut,
          "0": handle.reset, ArrowLeft: () => handle.move(80, 0), ArrowRight: () => handle.move(-80, 0),
          ArrowUp: () => handle.move(0, 80), ArrowDown: () => handle.move(0, -80),
          PageUp: () => handle.page?.(-1), PageDown: () => handle.page?.(1) };
        if (actions[event.key]) { event.preventDefault(); actions[event.key](); }
      }}>
      <header className="project-viewer-header"><strong title={attachment.filename}>{attachment.filename}</strong>
        <button onClick={onDownload}><Download size={16} /> Download Original File</button>
        <button onClick={onClose} aria-label="Close file preview"><X size={20} /></button>
      </header>
      {error ? <div className="project-viewer-message" role="alert">Unable to preview this file. {error} Use Download Original File.</div>
        : !preview ? <div className="project-viewer-message" role="status">Loading preview…</div>
        : preview.kind === "image" ? <ProjectFileImageViewer url={preview.url!} filename={attachment.filename} controls={controls} />
        : preview.kind === "pdf" ? <Suspense fallback={<div className="project-viewer-message" role="status">Loading PDF viewer…</div>}>
          <ProjectFilePdfViewer bytes={preview.bytes!} controls={controls} />
        </Suspense>
        : preview.kind === "text" ? <>
          <div className="project-viewer-text" tabIndex={0}><pre style={{ whiteSpace: wrap ? "pre-wrap" : "pre" }}>{preview.text}</pre></div>
          <footer className="project-viewer-toolbar"><label><input type="checkbox" checked={wrap} onChange={(event) => setWrap(event.target.checked)} /> Wrap lines</label></footer>
        </> : <div className="project-viewer-message">Preview is unavailable for this file. Use Download Original File to open it in an appropriate application.</div>}
    </section>
  </div>, document.body);
}
