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

export interface WorldViewTransform {
  zoom: number;
  worldOrigin: Point;
  screenOrigin: Point;
}

export const WORKSPACE_MARGIN = 400;
export const MIN_WORKSPACE_WIDTH = 1480;
export const MIN_WORKSPACE_HEIGHT = 820;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 1.25;
export const FIT_PADDING = 48;
export const GRID_SCREEN_TARGET = 30;
export const GRID_MAJOR_DIVISIONS = 5;

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

export function worldToScreen(
  point: Point,
  transform: WorldViewTransform,
): Point {
  const zoom = Number.isFinite(transform.zoom) && transform.zoom > 0
    ? transform.zoom
    : 1;
  return {
    x:
      transform.screenOrigin.x +
      (point.x - transform.worldOrigin.x) * zoom,
    y:
      transform.screenOrigin.y +
      (point.y - transform.worldOrigin.y) * zoom,
  };
}

export function screenToWorld(
  point: Point,
  transform: WorldViewTransform,
): Point {
  const zoom = Number.isFinite(transform.zoom) && transform.zoom > 0
    ? transform.zoom
    : 1;
  return {
    x:
      transform.worldOrigin.x +
      (point.x - transform.screenOrigin.x) / zoom,
    y:
      transform.worldOrigin.y +
      (point.y - transform.screenOrigin.y) / zoom,
  };
}

function stableNumber(value: number) {
  return Object.is(value, -0) ? 0 : Number(value.toFixed(10));
}

export function getAdaptiveGridStep(
  zoom: number,
  targetScreenSpacing = GRID_SCREEN_TARGET,
) {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const safeTarget =
    Number.isFinite(targetScreenSpacing) && targetScreenSpacing > 0
      ? targetScreenSpacing
      : GRID_SCREEN_TARGET;
  const idealWorldStep = safeTarget / safeZoom;
  const exponent = Math.floor(Math.log10(idealWorldStep));
  const candidates: number[] = [];
  for (let candidateExponent = exponent - 1; candidateExponent <= exponent + 1; candidateExponent += 1) {
    const magnitude = 10 ** candidateExponent;
    for (const multiplier of [1, 2, 5]) {
      candidates.push(multiplier * magnitude);
    }
  }
  return stableNumber(
    candidates.reduce((best, candidate) => {
      const difference = Math.abs(candidate * safeZoom - safeTarget);
      const bestDifference = Math.abs(best * safeZoom - safeTarget);
      return difference < bestDifference ||
        (difference === bestDifference && candidate < best)
        ? candidate
        : best;
    }),
  );
}

export function gridLineOffset(worldMinimum: number, step: number) {
  if (!Number.isFinite(worldMinimum) || !Number.isFinite(step) || step <= 0) {
    return 0;
  }
  const remainder = (-worldMinimum) % step;
  return stableNumber(remainder < 0 ? remainder + step : remainder);
}

export function snapToGrid(value: number, step: number) {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    return value;
  }
  return stableNumber(Math.round(value / step) * step);
}

export function snapWorldPoint(point: Point, step: number): Point {
  return {
    x: snapToGrid(point.x, step),
    y: snapToGrid(point.y, step),
  };
}

export function getDragWorldDelta(
  anchor: Point,
  screenDelta: Point,
  zoom: number,
  gridStep: number,
  snapping: boolean,
): Point {
  const rawDelta = {
    x: screenDeltaToWorld(screenDelta.x, zoom),
    y: screenDeltaToWorld(screenDelta.y, zoom),
  };
  if (!snapping) return rawDelta;
  const snapped = snapWorldPoint(
    { x: anchor.x + rawDelta.x, y: anchor.y + rawDelta.y },
    gridStep,
  );
  return {
    x: stableNumber(snapped.x - anchor.x),
    y: stableNumber(snapped.y - anchor.y),
  };
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
