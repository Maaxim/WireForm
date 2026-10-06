export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export const WORKSPACE_MARGIN = 400;
export const MIN_WORKSPACE_WIDTH = 1480;
export const MIN_WORKSPACE_HEIGHT = 820;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 1.25;
export const FIT_PADDING = 48;

export function boundsWidth(bounds: Bounds) {
  return bounds.maxX - bounds.minX;
}

export function boundsHeight(bounds: Bounds) {
  return bounds.maxY - bounds.minY;
}

export function getContentBounds(rects: LayoutRect[]): Bounds | undefined {
  const valid = rects.filter(
    (rect) =>
      Number.isFinite(rect.x) &&
      Number.isFinite(rect.y) &&
      Number.isFinite(rect.width) &&
      Number.isFinite(rect.height) &&
      rect.width >= 0 &&
      rect.height >= 0,
  );
  if (!valid.length) return undefined;

  return valid.reduce<Bounds>(
    (bounds, rect) => ({
      minX: Math.min(bounds.minX, rect.x),
      minY: Math.min(bounds.minY, rect.y),
      maxX: Math.max(bounds.maxX, rect.x + rect.width),
      maxY: Math.max(bounds.maxY, rect.y + rect.height),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
}

export function expandBounds(bounds: Bounds, margin: number): Bounds {
  return {
    minX: bounds.minX - margin,
    minY: bounds.minY - margin,
    maxX: bounds.maxX + margin,
    maxY: bounds.maxY + margin,
  };
}

function enforceMinimumSize(
  bounds: Bounds,
  minimumWidth: number,
  minimumHeight: number,
): Bounds {
  const missingWidth = Math.max(0, minimumWidth - boundsWidth(bounds));
  const missingHeight = Math.max(0, minimumHeight - boundsHeight(bounds));
  return {
    minX: bounds.minX - missingWidth / 2,
    minY: bounds.minY - missingHeight / 2,
    maxX: bounds.maxX + missingWidth / 2,
    maxY: bounds.maxY + missingHeight / 2,
  };
}

export function getWorkspaceBounds(
  rects: LayoutRect[],
  options: {
    margin?: number;
    minimumWidth?: number;
    minimumHeight?: number;
  } = {},
): Bounds {
  const margin = options.margin ?? WORKSPACE_MARGIN;
  const minimumWidth = options.minimumWidth ?? MIN_WORKSPACE_WIDTH;
  const minimumHeight = options.minimumHeight ?? MIN_WORKSPACE_HEIGHT;
  const content = getContentBounds(rects);
  if (!content) {
    return { minX: 0, minY: 0, maxX: minimumWidth, maxY: minimumHeight };
  }
  return enforceMinimumSize(
    expandBounds(content, margin),
    minimumWidth,
    minimumHeight,
  );
}

export function unionBounds(left: Bounds, right: Bounds): Bounds {
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
  };
}

export function worldToWorkspace(point: Point, workspace: Bounds): Point {
  return {
    x: point.x - workspace.minX,
    y: point.y - workspace.minY,
  };
}

export function workspaceToWorld(point: Point, workspace: Bounds): Point {
  return {
    x: point.x + workspace.minX,
    y: point.y + workspace.minY,
  };
}

export function screenDeltaToWorld(delta: number, zoom: number) {
  return Number.isFinite(zoom) && zoom > 0 ? delta / zoom : 0;
}

export function fitBoundsToViewport(
  bounds: Bounds,
  viewportWidth: number,
  viewportHeight: number,
  options: { padding?: number; minimumZoom?: number; maximumZoom?: number } = {},
) {
  const padding = options.padding ?? FIT_PADDING;
  const minimumZoom = options.minimumZoom ?? MIN_ZOOM;
  const maximumZoom = options.maximumZoom ?? MAX_ZOOM;
  const availableWidth = Math.max(1, viewportWidth - padding * 2);
  const availableHeight = Math.max(1, viewportHeight - padding * 2);
  const width = Math.max(1, boundsWidth(bounds));
  const height = Math.max(1, boundsHeight(bounds));
  const zoom = Math.min(
    maximumZoom,
    Math.max(minimumZoom, Math.min(availableWidth / width, availableHeight / height)),
  );
  return {
    zoom,
    centerX: (bounds.minX + bounds.maxX) / 2,
    centerY: (bounds.minY + bounds.maxY) / 2,
  };
}
