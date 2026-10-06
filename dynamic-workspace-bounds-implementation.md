# Dynamic Workspace Bounds Implementation

## Implementation summary

WireForm's topology editor now derives its logical workspace from the current
component rectangles instead of a fixed 1480 × 820 canvas. Components can move
beyond the previous right/bottom boundary and into signed negative coordinates.
The DOM canvas, SVG link layer, scroll/pan extent, marquee, node positions, and
Zoom to Fit action all use the same world bounds.

## Root cause

`HarnessStudio.tsx` used fixed `CANVAS_WIDTH` and `CANVAS_HEIGHT` constants for
three independent purposes:

- drag and paste deltas were clamped to the fixed rectangle;
- the scaled canvas wrapper was always 1480 × 820 world units;
- the SVG link layer was always 1480 × 820 world units.

Zoom changed only the CSS scale. It did not change those world limits, so
zooming out exposed viewport space that the logical canvas and drag clamp could
not use. Project loading also clamped component coordinates to 0..20000, which
prevented persistent layouts to the left or above the original origin.

## Files changed

- `app/workspace-bounds.ts`
- `app/HarnessStudio.tsx`
- `app/model.ts`
- `tests/workspace-bounds.test.mjs`
- `scripts/browser-workspace-smoke.mjs`
- `package.json`
- `README.md`
- `dynamic-workspace-bounds-implementation.md`
- `dynamic-workspace-bounds-review.md`

## Coordinate system and conversion

Component `x`/`y` values remain stable world coordinates. Pointer drag deltas
are converted from screen pixels by dividing once by the current zoom. The
derived workspace may have a negative minimum; rendering subtracts that minimum
to produce non-negative local DOM/SVG coordinates. Marquee pointer coordinates
perform the inverse conversion by adding the workspace minimum.

No workspace dimensions or origin offsets are persisted.

## Content and workspace bounds

`getContentBounds()` unions every component's full rectangle, using the current
224-unit node width and the actual calculated node height, including rows and
connector photos. `getWorkspaceBounds()` then adds 400 world units on every
side and enforces a minimum 1480 × 820 world area. Empty projects retain that
minimum area.

The 400-unit margin also comfortably contains the current endpoint-derived
Bézier wire curves. Transient selection, tooltip, menu, and inspector geometry
is not included.

## Drag-time expansion and shrink behavior

The old coordinate clamp was removed. During a drag, the workspace immediately
unions new required bounds with the bounds present at drag start. It can grow
but cannot shrink beneath that starting extent, avoiding pointer jitter. After
drag end the normal content-derived calculation resumes, so unused remote space
can shrink safely.

Multi-selection uses the same original-position plus world-delta update for
every selected component. Workspace expansion is derived from the complete
moved component collection. Paste keeps its normal deterministic offset but is
no longer forced back inside the former fixed canvas.

## Left/top behavior

Signed positions are supported. Project normalization now accepts finite layout
coordinates from -1,000,000 through 1,000,000 rather than clamping to zero.
This keeps positions stable across save/load without rewriting every component
when one object crosses the old origin.

## Pan and viewport behavior

The editor continues using its existing scrollable viewport as the pan model.
The scaled wrapper and SVG dimensions now match the derived workspace. A layout
effect preserves the same world-space viewport center when zoom or workspace
bounds change, including when left/top expansion changes the local origin.

The grid remains viewport-based, as it was before, so it continues covering the
visible editor without creating a second page-level scrollbar.

## Zoom to Fit

The canvas toolbar now includes **Zoom to fit harness**. It uses the shared
content bounds, full component dimensions, a 48-pixel fit margin, and the same
workspace origin. Normal zoom controls now support 25% so deliberately spread
layouts can be inspected and manipulated at the requested scale.

## Initial load and layout changes

Bounds are derived during render from project component state, so imported,
autosaved, duplicated, pasted, resized, and undo/redo layouts update immediately.
No initial movement or reload is required.

## Performance

Bounds calculation is an O(n) scan over at most the existing model limit of 500
components and uses model geometry rather than DOM measurement. It is memoized
against the component collection. Drag updates perform the same inexpensive
scan while preserving a monotonic drag-time extent.

## Tests added

`tests/workspace-bounds.test.mjs` covers:

- empty and minimum workspaces;
- component width/height and multi-component unions;
- expansion left, right, top, and bottom;
- negative-coordinate conversion and project round trips;
- monotonic drag-time union without component mutation;
- zoom-independent screen/world deltas;
- content-based fit calculations;
- absence of persisted workspace dimensions;
- editor integration for canvas, SVG, marquee, paste, and Fit.

The browser smoke test exercises real pointer movement at 25% zoom, right and
left/top expansion, scroll reach, shared SVG dimensions, Zoom to Fit, undo/redo,
and a two-component group move beyond the old bottom edge.

## Commands run and results

- `tsc --noEmit` — passed.
- ESLint on all changed TypeScript/JavaScript files — passed.
- `node --experimental-strip-types --test tests/workspace-bounds.test.mjs` —
  8/8 passed.
- Chrome browser smoke verification — passed with no console errors.
- Full `npm test` — production build passed and all 142 unit/integration tests
  passed.
- `git diff --check` — passed.

The repository has no formatter script.

## Manual verification

An isolated Chrome session at a 1600 × 1000 viewport was used with the starter
harness at 25% zoom:

- J2 moved to world x=3650, growing maxX from 1474 to 4274;
- J1 moved to x=-630/y=-95, growing minX/minY to -1030/-495;
- the SVG link layer matched the dynamic 5304 × 1530 world workspace;
- the horizontal scroll extent reached the expanded content;
- Zoom to Fit framed the spread-out harness;
- undo and redo restored the exact signed coordinates;
- J1 and W1 moved together by 1400 world units downward, growing maxY to 2147;
- no browser console errors occurred.

## Known limitations

- Pan remains scrollbar-based; this change does not add grab-to-pan or
  drag-near-edge auto-pan.
- Wire bounds are not scanned independently. Current connection curves are
  endpoint-derived and remain inside the generous workspace margin.
- Coordinates retain a ±1,000,000 safety limit during project normalization to
  reject pathological persisted data.

