import { MAX_ZOOM, MIN_ZOOM, screenToWorld, worldToScreen, type Point } from "./workspace-bounds.ts";

export interface ViewportZoomAnchor {
  worldPoint: Point;
  viewportPoint: Point;
}

export function viewportZoomAnchor(viewportPoint: Point, scroll: Point, zoom: number, worldOrigin: Point): ViewportZoomAnchor {
  return { viewportPoint, worldPoint: screenToWorld(viewportPoint, {
    zoom, worldOrigin, screenOrigin: { x: -scroll.x, y: -scroll.y },
  }) };
}

export function scrollForZoomAnchor(anchor: ViewportZoomAnchor, zoom: number, worldOrigin: Point): Point {
  const screen = worldToScreen(anchor.worldPoint, { zoom, worldOrigin, screenOrigin: { x: 0, y: 0 } });
  return { x: screen.x - anchor.viewportPoint.x, y: screen.y - anchor.viewportPoint.y };
}

export function topologyWheelZoom(zoom: number, deltaPixels: number) {
  // Bound a frame's change so large wheel/page deltas never make a huge jump.
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * Math.exp(-Math.max(-300, Math.min(300, deltaPixels)) * 0.001)));
}

/** Attach only to the topology viewport; coalesce trackpad/wheel events per frame. */
export function bindTopologyWheelZoom(viewport: HTMLElement, onZoom: (deltaPixels: number, pointer: Point) => void) {
  let frame: number | undefined;
  let delta = 0;
  let pointer = { x: 0, y: 0 };
  const wheel = (event: WheelEvent) => {
    if (!event.ctrlKey || event.defaultPrevented || !Number.isFinite(event.deltaY) || !event.deltaY) return;
    if (event.cancelable) event.preventDefault();
    delta += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
    pointer = { x: event.clientX, y: event.clientY };
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const amount = delta;
      delta = 0;
      onZoom(amount, pointer);
    });
  };
  viewport.addEventListener("wheel", wheel, { passive: false });
  return () => {
    viewport.removeEventListener("wheel", wheel);
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
}
