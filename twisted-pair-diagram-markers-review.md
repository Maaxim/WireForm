# Twisted-pair diagram markers review

## Areas needing manual review

- Inspect dense production harnesses with many adjacent twisted pairs at minimum and maximum zoom.
- Check both portrait and landscape PDF pages containing unusually large diagrams.
- Verify badge visibility in organization-specific monochrome print workflows.
- Exercise future WireViz/Graphviz upgrades before changing vendored renderer versions.

## Geometry edge cases

The renderer selects the member-path endpoint closest to the member's cable, bundle, or wire box and samples approximately 20 SVG units away along the path. This is deterministic and handles the cubic paths Graphviz currently emits. Self-edges, unusually short edges, or future complex path commands may need a more general SVG path parser.

When both endpoints are equally close to a node, stable edge ordering chooses the first endpoint. This is appropriate for current WireViz cable geometry but should be reviewed if future diagrams place the same component at both ends of an edge.

## SVG identifier reliability

Conductor identity is preserved from WireViz DOT ports before Graphviz rendering. This avoids matching visible labels or depending on SVG child order. A WireViz upgrade that changes its `wN` port convention should be caught by the real runtime test.

Component-box lookup uses the structural Graphviz node `<title>`, not the displayed text label.

## Bundle-rendering limitations

Current WireViz output exposes each conductor edge, allowing an exact badge per bundle member. If a future diagram contains only an aggregate bundle node, the fallback uses the member's conductor row within the node bounds. It keeps labels distinct but cannot claim exact invisible conductor geometry.

## Marker overlap risks

There is intentionally no free-space collision placement. Association with the physical member path is more important than whitespace optimization. A badge can overlap an unusually close wire label, although its white knockout keeps the pair designator readable. Any future collision refinement must move only a small distance along the same member path and must never float into unrelated space.

## PDF SVG limitations

Markers use only groups, rectangles, text, and basic attributes supported by pdfmake. Browser and pdfmake font metrics may differ slightly because the knockout width is estimated from character count. Unicode pair details remain in plain SVG title text, while the visible designator uses the same report font path as other SVG text.

## Large-harness clutter concerns

Every pair deliberately repeats its designator once per member. Dense bundles therefore show many badges, but membership remains explicit and no connection-like geometry is introduced. The Twisted Pairs table remains authoritative for full metadata.

## Potential future improvements

- Add marker click selection if the live preview changes from an `<img>` to an interactive inline SVG surface.
- Replace sampled cubic-length approximation with a general SVG path-length utility if renderer output becomes more complex.
- Permit a tiny deterministic along-path adjustment when a badge directly overlaps an existing wire label, without ever leaving the conductor.

## Production-use concerns

No project data, pair membership, BOM calculation, WireViz YAML, or original wire geometry is modified. An unresolved member suppresses only that pair's diagram badges; the underlying SVG and detailed Twisted Pairs table remain available. The primary production risk is compatibility with future changes to WireViz DOT port names or Graphviz path syntax, both of which are covered by focused runtime checks in the current version.
