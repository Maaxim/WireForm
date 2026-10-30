/** Transient preview geometry, independent of editor coordinates/project state. */
export interface ViewerSize { width: number; height: number }
export interface ViewerPoint { x: number; y: number }
export interface ImageViewport extends ViewerPoint { scale: number }
export const MIN_VIEWER_ZOOM = 0.1;
export const MAX_VIEWER_ZOOM = 10;
export const clampZoom = (scale: number) => Math.max(MIN_VIEWER_ZOOM, Math.min(MAX_VIEWER_ZOOM, scale));

export function fitViewerScale(content: ViewerSize, viewport: ViewerSize, widthOnly = false) {
  const width = Math.max(1, viewport.width - 32) / Math.max(1, content.width);
  return Math.max(0.001, Math.min(width, widthOnly ? Infinity : Math.max(1, viewport.height - 32) / Math.max(1, content.height)));
}

export function fitImageViewport(content: ViewerSize, viewport: ViewerSize): ImageViewport {
  const scale = fitViewerScale(content, viewport);
  return { scale, x: (viewport.width - content.width * scale) / 2, y: (viewport.height - content.height * scale) / 2 };
}

export function zoomImageAt(current: ImageViewport, point: ViewerPoint, scale: number): ImageViewport {
  const next = clampZoom(scale);
  const ratio = next / current.scale;
  return { scale: next, x: point.x - (point.x - current.x) * ratio, y: point.y - (point.y - current.y) * ratio };
}

/** Keep at least a small inspectable part on screen; smaller images stay centered. */
export function boundImagePan(current: ImageViewport, content: ViewerSize, viewport: ViewerSize): ImageViewport {
  const bound = (position: number, length: number, available: number) => length <= available
    ? (available - length) / 2
    : Math.max(48 - length, Math.min(available - 48, position));
  return { ...current, x: bound(current.x, content.width * current.scale, viewport.width),
    y: bound(current.y, content.height * current.scale, viewport.height) };
}

/** High-DPI PDF canvases are capped at 12 MP / 8192px to bound memory per page. */
export function pdfRenderResolution(size: ViewerSize, devicePixelRatio: number) {
  const ratio = Math.min(Math.max(1, devicePixelRatio), 8192 / size.width, 8192 / size.height,
    Math.sqrt(12_000_000 / (size.width * size.height)));
  return { ratio, width: Math.max(1, Math.floor(size.width * ratio)), height: Math.max(1, Math.floor(size.height * ratio)) };
}
