import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { useViewerSize, ViewerZoomToolbar, type ViewerChildProps } from "./ProjectFileViewer";
import { boundImagePan, fitImageViewport, zoomImageAt, type ImageViewport, type ViewerPoint, type ViewerSize } from "./project-file-viewport";

export function ProjectFileImageViewer({ url, filename, controls }: ViewerChildProps & { url: string; filename: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const size = useViewerSize(viewport);
  const [image, setImage] = useState<ViewerSize>({ width: 0, height: 0 });
  const [view, setView] = useState<ImageViewport>({ scale: 1, x: 0, y: 0 });
  const [fitting, setFitting] = useState(true);
  const [failed, setFailed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, ViewerPoint>());
  useEffect(() => {
    if (image.width) setView((previous) => fitting ? fitImageViewport(image, size) : boundImagePan(previous, image, size));
  }, [image, size, fitting]);
  const fit = () => { setFitting(true); setView(fitImageViewport(image, size)); };
  const zoom = (factor: number, point = { x: size.width / 2, y: size.height / 2 }, native = false) => {
    setFitting(false);
    setView((previous) => boundImagePan(zoomImageAt(previous, point, native ? 1 : previous.scale * factor), image, size));
  };
  useImperativeHandle(controls, () => ({ zoomIn: () => zoom(1.25), zoomOut: () => zoom(1 / 1.25), reset: fit,
    move: (x, y) => { setFitting(false); setView((previous) => boundImagePan({ ...previous, x: previous.x + x, y: previous.y + y }, image, size)); } }));
  // Native non-passive wheel listener permits cursor-centered zoom without page scroll.
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); event.stopPropagation();
      const rect = element.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      setFitting(false);
      setView((previous) => boundImagePan(zoomImageAt(previous, point, previous.scale * Math.exp(-event.deltaY * 0.002)), image, size));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [image, size]);
  return <>
    <div ref={viewport} className={`project-viewer-image-viewport${dragging ? " dragging" : ""}`} data-testid="image-viewport"
      onDoubleClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); zoom(2, { x: event.clientX - rect.left, y: event.clientY - rect.top }); }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); setDragging(true); setFitting(false);
      }} onPointerMove={(event) => {
        const old = pointers.current.get(event.pointerId);
        if (!old) return;
        const before = [...pointers.current.values()];
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const after = [...pointers.current.values()];
        const rect = event.currentTarget.getBoundingClientRect();
        setView((previous) => {
          if (before.length === 2) {
            const distance = (points: ViewerPoint[]) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            const center = (points: ViewerPoint[]) => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
            const a = center(before), b = center(after);
            const next = zoomImageAt(previous, { x: a.x - rect.left, y: a.y - rect.top }, previous.scale * distance(after) / Math.max(1, distance(before)));
            return boundImagePan({ ...next, x: next.x + b.x - a.x, y: next.y + b.y - a.y }, image, size);
          }
          return boundImagePan({ ...previous, x: previous.x + event.clientX - old.x, y: previous.y + event.clientY - old.y }, image, size);
        });
      }} onLostPointerCapture={(event) => { pointers.current.delete(event.pointerId); setDragging(pointers.current.size > 0); }}
      onPointerUp={(event) => { pointers.current.delete(event.pointerId); event.currentTarget.releasePointerCapture(event.pointerId); setDragging(pointers.current.size > 0); }}
      onPointerCancel={(event) => { pointers.current.delete(event.pointerId); setDragging(pointers.current.size > 0); }}>
      {failed ? <p role="alert">Unable to preview this image. Download the original file instead.</p>
        : <img src={url} alt={filename} draggable={false} onLoad={(event) => setImage({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          onError={() => setFailed(true)} style={{ width: image.width || undefined, height: image.height || undefined,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, visibility: image.width && size.width > 1 ? "visible" : "hidden" }} />}
    </div>
    <ViewerZoomToolbar zoom={view.scale} onZoom={zoom} onFit={fit} onNative={() => zoom(1, undefined, true)} onReset={fit} />
  </>;
}
