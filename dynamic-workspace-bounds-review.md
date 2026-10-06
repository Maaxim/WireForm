# Dynamic Workspace Bounds Review

## Areas needing manual review

- Exercise long real-world projects at several browser sizes and DPI/scaling
  settings, especially after repeated left/top expansion.
- Confirm the new Fit icon is discoverable and its 25% minimum is appropriate
  for expected harness sizes.
- Verify scrollbar behavior with operating systems that use permanently visible
  scrollbars rather than overlay scrollbars.

## Remaining edge cases

- A project containing a single component may recompute to a smaller workspace
  after drag end. The shrink occurs after pointer release, but the resulting
  viewport adjustment deserves UX review.
- Component height changes in the inspector immediately recompute bounds. This
  is correct, but a very tall connector can introduce a vertical scrollbar.
- Empty projects use the fixed minimum world area; they do not persist a custom
  user's previous empty-canvas pan position.

## Negative-coordinate concerns

Signed coordinates are now preserved by project parsing up to ±1,000,000. No
WireViz, BOM, HTML, or PDF calculation uses editor coordinates as engineering
data, so negative layout positions do not affect exports. Third-party code that
previously assumed non-negative `.wireform.json` positions should be reviewed.

## Very large layouts

The DOM workspace is not virtualized. Extremely large component spreads create
a correspondingly large scrollable element and SVG coordinate space. Browsers
have maximum layout dimensions, so the model's ±1,000,000 safety range is not a
promise that every browser can display a two-million-unit spread at every zoom.

## Performance concerns

The implementation scans up to 500 component rectangles per drag update. This
is intentionally simpler than incremental indexing and was responsive in the
manual tests. If the component limit grows substantially, profiling should
precede introducing a spatial index or requestAnimationFrame throttling.

## Zoom/pan limitations

Pan remains native scrolling, not a transform-based infinite-canvas controller.
That keeps the current interaction model and accessibility behavior, but means:

- there is no middle-button or spacebar grab-to-pan;
- browser scroll-dimension limits still exist;
- Fit is limited by the configured minimum zoom;
- a tiny workspace at low zoom relies on the viewport background outside the
  scaled world surface.

## Auto-pan considerations

The editor did not previously provide drag-near-edge auto-pan, and this change
does not add it. Pointer capture permits dragging outside the node, while the
dynamic bounds ensure no world clamp is encountered. A future auto-pan feature
should update scroll position without changing stored component coordinates and
should reuse the same workspace bounds.

## Future true infinite-canvas approach

If scrollbar limits or very large projects become common, a future version could
move to transform-based pan with a floating origin or tiled rendering. That
would be a larger coordinate/interaction redesign and is intentionally outside
this focused correction.

## Production-use concerns

No known issue blocks normal harness layouts. The main production consideration
is browser behavior for pathological million-unit spreads. Normal projects,
large spread-out layouts, signed coordinates, multi-selection, undo/redo, and
content fitting are covered by automated and Chrome smoke verification.
