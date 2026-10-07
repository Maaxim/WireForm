# Twisted-pair diagram markers implementation

## Summary

WireForm adds one compact `TPx` badge to each member conductor of a twisted pair. Each badge is centered directly on its member path about 20 SVG user units outside the corresponding cable, bundle, or standalone-wire box. A two-member pair therefore produces exactly two labels with the same designator. There is no shared marker, bracket, leader, stem, or joining line.

The original WireViz paths remain unchanged. The annotated SVG is shared by the interactive preview, HTML report, and PDF report, so placement cannot drift between outputs. No project-schema, twisted-pair, BOM, or WireViz YAML changes were required.

## Files changed

- `app/diagram-annotations.ts` — semantic DOT identity preservation, SVG member-path resolution, path-aware entry placement, and badge rendering.
- `app/preview.worker.ts` — preserves semantic conductor IDs through Graphviz SVG generation.
- `app/html-report.ts` — provides the shared sanitized SVG annotation path.
- `app/HarnessStudio.tsx` — displays the same prepared SVG used by reports.
- `tests/diagram-annotations.test.mjs` — focused member placement, curved-path, fallback, determinism, HTML/PDF, and regression coverage.
- `tests/wireviz-runtime.test.mjs` — verifies IDs and two member badges through the vendored WireViz/Graphviz runtime, including bi-color conductors.
- `package.json` — includes the annotation suite in the repository test command.
- `README.md` — documents member-level diagram markers.

## SVG mapping strategy

WireViz 0.4.1 DOT identifies conductor ports as `DESIGNATOR:wN`, but Graphviz otherwise reduces SVG edge titles to endpoint node names. `addWireFormDiagramIdsToDot()` adds an `id` attribute to each existing conductor edge before rendering. It does not change visible geometry or exported WireViz YAML.

The rendered SVG groups use deterministic IDs of the form:

```text
wireform-member-<encoded-designator>-<conductor-number>-<occurrence>
```

Graphviz node `<title>` values identify the relevant component box. Visible text and SVG child order are not used for member identity.

## Member-path and entry resolution

Each member is resolved independently. For a standalone wire the renderer uses semantic conductor 1 edges; for a bundle member it uses the member's stable conductor identity to find its physical conductor number and matching edge groups.

The component node supplies the cable/bundle/wire-box bounds. The endpoint of a matching SVG path closest to those bounds is treated as the box entry. The path is sampled in drawing order, and the badge anchor is moved 20 user units along the actual path away from that endpoint. This follows an immediate curve instead of applying a blind x/y offset.

WireViz bi-color conductors may contain several parallel paths. The middle path is used as the stable conductor centerline, while all original paths remain untouched and visible on both sides of the small badge.

## Aggregate fallback

If semantic conductor edge geometry is unavailable, the component node remains a deterministic fallback. Bundle members use their conductor row to choose separate anchors, preventing several pairs from collapsing onto one point. This fallback does not invent conductor paths and is used only when the generated SVG exposes no member path.

## Marker geometry and style

Every normal pair produces exactly two marker groups, one per member. A marker contains only:

- a `<g>` with stable pair/member identity and `data-pair-id`
- a compact white rounded `<rect>` knockout with a neutral border
- a small bold `<text>` designator
- a plain-text `<title>` with pair details for compatible SVG viewers

No path, line, polyline, bracket, brace, leader, or stem is generated. The badge center coincides with the sampled member centerline, intentionally covering only a short piece of wire. Basic SVG primitives keep the annotation vector, grayscale-readable, and compatible with pdfmake.

## Collision behavior

There is deliberately no free-space collision solver. Such a solver caused labels to drift away from their conductors and made membership ambiguous. Natural pair ordering is deterministic, but final position is always member-specific and stays on the resolved path. Closely spaced pairs therefore appear as repeated labels on their actual conductor rows.

## UI, HTML, and PDF integration

The preview worker tags DOT edges before Graphviz renders them. `prepareHarnessDiagramSvg()` then sanitizes the SVG, applies the member badges, and sanitizes it again. The live preview and `buildHarnessReportModel()` both call that function. HTML embeds the final self-contained SVG, while pdfmake receives the identical `model.diagramSvg`; there is no HTML- or PDF-specific marker implementation.

The detailed Twisted Pairs report tables remain unchanged and authoritative for member names, pitch, direction, and notes. The image-based live preview does not currently expose marker click selection.

## Safety and failure handling

The annotation uses no scripts, event handlers, filters, masks, external resources, or raster assets. `data-pair-id` is included in the existing strict sanitizer allowlist. A malformed or unmappable pair skips only its own badges and cannot suppress the underlying diagram or other pairs.

## Tests

Coverage includes:

- unchanged SVG when no pairs exist
- exactly two badges with the same designator per pair
- member A and member B resolving to separate physical paths
- badge placement near the component-box endpoint
- curved-path sampling rather than blind axis offsets
- three adjacent pairs producing six conductor-row labels
- standalone wires and bundle conductors
- deterministic aggregate fallback
- absence of bracket/line/stem primitives
- natural ordering and no collision wandering
- graceful unresolved-pair handling
- unchanged original and bi-color paths
- shared preview/HTML/PDF SVG flow
- pdfmake rendering of the annotated vector SVG
- real WireViz 0.4.1 and Graphviz identity preservation

## Commands run

```text
npm run typecheck
npm run lint
node --experimental-strip-types --test tests/diagram-annotations.test.mjs
node --experimental-strip-types --test tests/wireviz-runtime.test.mjs
npm test
```

`npm test` includes the production build. The repository has no separate formatter script.

## Build/test results

- TypeScript: passed
- ESLint: passed
- Focused annotation tests: 14 passed, including a real pdfmake binary
- Real WireViz runtime test: passed
- Full repository tests: 165 passed, 0 failed
- Production Vite build: passed

## Manual verification

A real WireViz 0.4.1 six-conductor bundle was rendered with three pairs:

- `TP1`: conductors 1 and 2 (`BUWH`, `WHBU`)
- `TP2`: conductors 3 and 4 (`RDWH`, `WHRD`)
- `TP3`: conductors 5 and 6 (`GNYE`, `YEGN`)

The sanitized SVG was opened locally in Chrome. Six badges appeared: one on each conductor, centered on its actual bi-color path about 20 SVG units outside the left edge of the `B1` box. No labels floated between conductors, no connector geometry was present, and every stripe remained visible immediately before and after its badge. The same SVG identity is asserted in the HTML and PDF document-definition paths.

The annotated SVG also passes through the bundled pdfmake renderer and produces a valid PDF binary.

## Known limitations

- SVG path sampling targets the absolute `M`/`C` path form produced by the vendored Graphviz version; a future renderer emitting substantially different commands will require an updated parser.
- When member edge geometry is absent, fallback anchors use component bounds and conductor rows rather than claiming an exact invisible path.
- The current image-based preview cannot make SVG badges clickable.
- Very short conductor segments use at most half their available sampled length, so their badges may sit closer to the box than the normal 20-unit offset.
