import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument, PasswordResponses, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useViewerSize, ViewerZoomToolbar, type ViewerChildProps } from "./ProjectFileViewer";
import { clampZoom, fitViewerScale, pdfRenderResolution, type ViewerSize } from "./project-file-viewport";

GlobalWorkerOptions.workerSrc = workerUrl;
const assetBase = new URL(`${import.meta.env.BASE_URL}vendor/pdfjs/`, document.baseURI).href;
type FitMode = "page" | "width" | null;

function PdfPage({ pdf, number, zoom, size, root, enabled, onSize }: {
  pdf: PDFDocumentProxy; number: number; zoom: number; size: ViewerSize;
  root: React.RefObject<HTMLDivElement | null>; enabled: boolean;
  onSize: (number: number, size: ViewerSize) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!element.current) return;
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { root: root.current, rootMargin: "50% 0px" });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [root]);
  useEffect(() => {
    const host = canvasHost.current;
    if (!near || !enabled || !host) return;
    let stopped = false;
    let task: RenderTask | undefined;
    let page: PDFPageProxy | undefined;
    // Each render owns a fresh canvas. Cancelled work can never paint a newer one.
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", `PDF page ${number}`);
    host.replaceChildren(canvas);
    setError("");
    void pdf.getPage(number).then(async (loaded) => {
      page = loaded;
      if (stopped) { page.cleanup(); return; }
      const natural = page.getViewport({ scale: 1 });
      onSize(number, { width: natural.width, height: natural.height });
      const viewport = page.getViewport({ scale: zoom });
      const resolution = pdfRenderResolution(viewport, window.devicePixelRatio || 1);
      canvas.width = resolution.width; canvas.height = resolution.height;
      task = page.render({ canvas, viewport,
        transform: [resolution.ratio, 0, 0, resolution.ratio, 0, 0], background: "white" });
      await task.promise;
      if (!stopped) canvas.dataset.rendered = "true";
    }).catch((problem: unknown) => {
      if (!stopped && !(problem instanceof Error && problem.name === "RenderingCancelledException")) {
        setError("Unable to render this page. Download the original file to inspect it.");
      }
    });
    return () => {
      stopped = true; task?.cancel(); canvas.remove();
      // Do not release a backing store until its render has actually stopped.
      void (task?.promise.catch(() => undefined) ?? Promise.resolve()).then(() => {
        canvas.width = 0; canvas.height = 0; page?.cleanup();
      });
    };
  }, [pdf, number, zoom, near, enabled, onSize]);
  return <div ref={element} className="project-viewer-pdf-page" data-page={number}
    style={{ width: size.width * zoom, height: size.height * zoom }}>
    <div ref={canvasHost} />
    {error && <p role="alert">{error}</p>}
  </div>;
}

export default function ProjectFilePdfViewer({ bytes, controls }: ViewerChildProps & { bytes: Uint8Array<ArrayBuffer> }) {
  const viewport = useRef<HTMLDivElement>(null);
  const size = useViewerSize(viewport);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [passwordRequest, setPasswordRequest] = useState<{ submit: (password: string) => void; incorrect: boolean } | null>(null);
  const [dimensions, setDimensions] = useState<Record<number, ViewerSize>>({});
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState<FitMode>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const pendingAnchor = useRef<{ page: number; x: number; y: number; screenX: number; screenY: number } | null>(null);
  const first = dimensions[1];
  const loaded = Boolean(pdf && first);

  useEffect(() => {
    let stopped = false;
    // PDF.js transfers this copy to its worker; the preview/original bytes remain intact.
    const task = getDocument({ data: bytes.slice(), cMapUrl: `${assetBase}cmaps/`, cMapPacked: true,
      standardFontDataUrl: `${assetBase}standard_fonts/`, wasmUrl: `${assetBase}wasm/`,
      enableXfa: false, disableFontFace: true, useSystemFonts: false,
      maxImageSize: 32_000_000, canvasMaxAreaInBytes: 48_000_000 });
    task.onPassword = (submit: (value: string) => void, reason: number) => {
      if (!stopped) setPasswordRequest({ submit, incorrect: reason === PasswordResponses.INCORRECT_PASSWORD });
    };
    void task.promise.then(async (document) => {
      const page = await document.getPage(1);
      const natural = page.getViewport({ scale: 1 });
      if (stopped) return;
      setDimensions({ 1: { width: natural.width, height: natural.height } });
      setFitMode(document.numPages === 1 ? "page" : "width");
      setPdf(document); setPasswordRequest(null);
    }).catch((problem: unknown) => {
      if (!stopped) setError(`Unable to preview this PDF. ${problem instanceof Error ? problem.message : "The document could not be loaded."} Use Download Original File.`);
    });
    return () => { stopped = true; void task.destroy().catch(() => undefined); };
  }, [bytes]);

  useEffect(() => {
    if (first && fitMode && size.width > 1) setZoom(fitViewerScale(dimensions[currentPage] ?? first, size, fitMode === "width"));
  }, [first, fitMode, size, dimensions, currentPage]);
  useEffect(() => setPageInput(String(currentPage)), [currentPage]);

  const rememberPoint = (screenX = size.width / 2, screenY = size.height / 2) => {
    const root = viewport.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const pages = Array.from(root.querySelectorAll<HTMLElement>("[data-page]"));
    const page = pages.find((element) => element.getBoundingClientRect().bottom > rect.top + screenY) ?? pages.at(-1);
    if (!page) return;
    const bounds = page.getBoundingClientRect();
    pendingAnchor.current = { page: Number(page.dataset.page), x: (rect.left + screenX - bounds.left) / zoom,
      y: (rect.top + screenY - bounds.top) / zoom, screenX, screenY };
  };
  useLayoutEffect(() => {
    const anchor = pendingAnchor.current, root = viewport.current;
    if (!anchor || !root) return;
    const page = root.querySelector<HTMLElement>(`[data-page="${anchor.page}"]`);
    if (page) {
      root.scrollLeft = page.offsetLeft + anchor.x * zoom - anchor.screenX;
      root.scrollTop = page.offsetTop + anchor.y * zoom - anchor.screenY;
    }
    pendingAnchor.current = null;
  }, [zoom, dimensions]);

  const changeZoom = (next: number, x?: number, y?: number) => {
    rememberPoint(x, y); setFitMode(null); setZoom(clampZoom(next));
  };
  const fit = (mode: FitMode) => { rememberPoint(); setFitMode(mode); };
  const navigate = (page: number) => {
    const next = Math.max(1, Math.min(pdf?.numPages ?? 1, page));
    const element = viewport.current?.querySelector<HTMLElement>(`[data-page="${next}"]`);
    if (element && viewport.current) viewport.current.scrollTop = element.offsetTop - 16;
    setCurrentPage(next); setPageInput(String(next));
  };
  useImperativeHandle(controls, () => ({ zoomIn: () => changeZoom(zoom * 1.25), zoomOut: () => changeZoom(zoom / 1.25),
    reset: () => fit(pdf?.numPages === 1 ? "page" : "width"), page: (delta) => navigate(currentPage + delta),
    move: (x, y) => viewport.current?.scrollBy(-x, -y) }));

  // Keep the native wheel scroll. Only Ctrl+wheel zooms a PDF.
  useEffect(() => {
    const root = viewport.current;
    if (!root) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault(); event.stopPropagation();
      const rect = root.getBoundingClientRect();
      rememberPoint(event.clientX - rect.left, event.clientY - rect.top);
      setFitMode(null); setZoom((previous) => clampZoom(previous * Math.exp(-event.deltaY * 0.002)));
    };
    root.addEventListener("wheel", wheel, { passive: false });
    return () => root.removeEventListener("wheel", wheel);
  });
  // A stable callback prevents every page restarting when another page's size is resolved.
  const updateSize = useRef((number: number, next: ViewerSize) => {
    setDimensions((previous) => previous[number]?.width === next.width && previous[number]?.height === next.height
      ? previous : { ...previous, [number]: next });
  }).current;

  return <>
    <div ref={viewport} className={`project-viewer-pdf-viewport${dragging ? " dragging" : ""}`} data-testid="pdf-viewport"
      onScroll={() => {
        const root = viewport.current;
        if (!root) return;
        const top = root.getBoundingClientRect().top + Math.min(120, root.clientHeight / 3);
        const pages = Array.from(root.querySelectorAll<HTMLElement>("[data-page]"));
        const page = pages.find((element) => element.getBoundingClientRect().bottom > top);
        if (page) setCurrentPage(Number(page.dataset.page));
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest("input,button")) return;
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY,
          left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop }; setDragging(true);
      }} onPointerMove={(event) => {
        if (!drag.current || drag.current.id !== event.pointerId) return;
        event.currentTarget.scrollLeft = drag.current.left - event.clientX + drag.current.x;
        event.currentTarget.scrollTop = drag.current.top - event.clientY + drag.current.y;
      }} onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
      onPointerUp={(event) => { drag.current = null; setDragging(false); event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { drag.current = null; setDragging(false); }}>
      {error ? <p className="project-viewer-message" role="alert">{error}</p>
        : passwordRequest ? <form className="project-viewer-password" onSubmit={(event) => {
          event.preventDefault(); passwordRequest.submit(password); setPassword(""); setPasswordRequest(null);
        }}><p>{passwordRequest.incorrect ? "Incorrect password. Try again." : "This PDF requires a password."}</p>
          <input type="password" value={password} autoComplete="off" aria-label="PDF password" onChange={(event) => setPassword(event.target.value)} autoFocus />
          <button type="submit">Open PDF</button></form>
        : !loaded ? <p className="project-viewer-message" role="status">Loading PDF…</p>
        : <div className="project-viewer-pdf-document" style={{ width: Math.max(size.width, ...Object.values(dimensions).map((value) => value.width * zoom + 32)) }}>
          {Array.from({ length: pdf!.numPages }, (_, index) => <PdfPage key={index} pdf={pdf!} number={index + 1} zoom={zoom}
            size={dimensions[index + 1] ?? first!} root={viewport} enabled={Math.abs(index + 1 - currentPage) <= 2} onSize={updateSize} />)}
        </div>}
    </div>
    {loaded && <ViewerZoomToolbar zoom={zoom} onZoom={(factor) => changeZoom(zoom * factor)} onFit={() => fit("page")}
      onNative={() => changeZoom(1)} onReset={() => fit(pdf!.numPages === 1 ? "page" : "width")}>
      <div className="project-viewer-page-controls">
        <button onClick={() => navigate(currentPage - 1)} disabled={currentPage <= 1} aria-label="Previous PDF page">Previous</button>
        <form onSubmit={(event) => { event.preventDefault(); const value = Number(pageInput); navigate(Number.isFinite(value) ? Math.round(value) : currentPage); }}>
          <label>Page <input type="number" min={1} max={pdf!.numPages} value={pageInput} aria-label="PDF page number" onChange={(event) => setPageInput(event.target.value)} /></label>
          <span> / {pdf!.numPages}</span><button type="submit">Go</button>
        </form>
        <button onClick={() => navigate(currentPage + 1)} disabled={currentPage >= pdf!.numPages} aria-label="Next PDF page">Next</button>
      </div>
      <button onClick={() => fit("width")}>Fit Width</button>
    </ViewerZoomToolbar>}
  </>;
}
