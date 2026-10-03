# Bi-color wire implementation

## Implementation summary

WireForm single wires now support a required primary color and an optional secondary/stripe color while retaining the existing WireViz-compatible combined color code as the only authoritative value. Solid `BU`, striped `BUWH`, reversed `WHBU`, and `GNYE` values are edited, persisted, copied, stored in User Libraries, imported, exported, and reported without introducing a new wire type or duplicate color fields.

The design canvas, component rows, inspector, User Library thumbnails, native HTML report, and native PDF report now show an accessible visual swatch plus human-readable text. Canvas connections use a primary vector path with a narrower secondary vector path. The existing WireViz SVG remains vector-based and renders WireViz stripes directly.

## Files changed

- `app/wire-colors.ts`: shared WireViz color definitions, parser, formatter, display/CSS helpers, and validation.
- `app/HarnessStudio.tsx`: single-wire editor, reusable UI swatch, canvas stripe paths, library/twisted-pair presentation, and validation integration.
- `app/globals.css`: inspector, swatch, canvas path, hover, and light-color readability styles.
- `app/html-report.ts`: shared-model wire colors and self-contained HTML color swatches.
- `app/pdf-report.ts`: vector pdfmake color swatches and text in pin, wire, and twisted-pair tables.
- `app/bom.ts`: readable wire-color metadata and color-sensitive fallback grouping when no MPN identifies the wire.
- `tests/wire-colors.test.mjs`: focused parser/model/UI/canvas/library/WireViz/HTML/PDF/BOM tests.
- `tests/wireviz-runtime.test.mjs`: live WireViz/Graphviz assertions for `BUWH` and `WHBU` stripe order.
- `tests/html-report.test.mjs`, `tests/static-build.test.mjs`: report-model and production-source expectations.
- `tests/fixtures/bicolor-manual.wireform.json`: representative `BU`, `BUWH`, `WHBU`, and `GNYE` harness with `TP1`.
- `scripts/browser-bicolor-smoke.mjs`: repeatable Chrome UI/export/offline-report smoke check.
- `package.json`: includes the focused suite in `npm test`.
- `README.md`: usage and compatibility documentation.

## Authoritative color representation

`HarnessComponent.colors` remains authoritative. A single wire stores one combined code, for example `colors: ["BUWH"]`. No `primaryColor` or `secondaryColor` fields were added, and no schema-version change was needed. The editor parses the combined code for presentation and formats selections back into the same field.

Existing solid codes remain byte-for-byte unchanged unless the user edits them. Import/export order is preserved, so `BUWH` and `WHBU` remain distinct.

## Parser and formatter design

`parseWireColor`, `formatWireColor`, `getWireColorDisplay`, `getWireColorHex`, `getWireColorStripeHex`, and `getWireColorCssBackground` live in one shared module. The module uses the WireViz 0.4.1 two-letter palette and retains the prior WireForm screen colors for codes that already existed.

The parser supports one standard code for a solid color and two concatenated standard codes for a bi-color wire. Selecting the same primary and secondary normalizes to the solid code. Unknown/custom input is preserved and displayed as an unknown value rather than replaced or discarded.

## UI editor changes

The single-wire inspector now provides:

- Primary color selector
- Optional Secondary color selector
- Striped or solid visual preview
- Human-readable color name
- Explicit authoritative WireViz code

Changes use the existing immutable project update/history mechanism, so each selector edit participates in undo/redo. Cable and bundle multi-conductor code editing remains unchanged and code-based.

## Canvas rendering

Each connected conductor is drawn as an outline plus a primary-color SVG path. Bi-color wires add a narrower secondary-color SVG path. `BUWH` therefore has a blue body and white stripe, while `WHBU` has a white body and blue stripe. Hover adds outline emphasis without replacing the engineering colors. Endpoint hit areas, selection, labels, termination markers, and twisted-pair badges retain their existing behavior.

White and other light swatches retain a visible border/outline. Text labels and codes remain available so color is never the sole identifier.

## Persistence, copy, and User Libraries

Normal project JSON, IndexedDB autosave, history snapshots, copy/paste, component duplication, and User Library templates already clone the `colors` array. Because the feature keeps the established combined code representation, those systems preserve `BUWH` without migration or parallel state. A library wire thumbnail now displays the same shared striped swatch.

## WireViz behavior

WireViz export continues to emit standard `colors` values only. It does not emit custom primary/secondary keys. WireViz import uppercases and preserves combined codes and their order. The live vendored WireViz 0.4.1 runtime test confirmed that Graphviz output uses:

- `BUWH` as blue / white / blue
- `WHBU` as white / blue / white

The manual harness exported `BU`, `BUWH`, `WHBU`, and `GNYE` unchanged.

## HTML report behavior

The shared report model now carries the authoritative wire color for wire summaries and twisted-pair members. Connector pin tables, wire summaries, and twisted-pair tables render a self-contained CSS swatch plus text such as `Blue / White (BUWH)`. The existing sanitized inline WireViz SVG is unchanged and shows the native WireViz stripe rendering.

The downloaded HTML was opened directly from `file://`; it contained inline SVG, all four textual colors, directional gradients, no external resource requests, and no console errors.

## PDF report behavior

The PDF renderer consumes the same report model and shared parser. Color cells use pdfmake vector canvas rectangles: a primary rectangle, a narrower secondary stripe, and a border. Text remains searchable/selectable. No HTML screenshot or raster swatch is used.

The manually generated seven-page PDF showed directional swatches in connector, wire, and twisted-pair tables. Its WireViz harness diagram remained vector/sharp and displayed blue/white, white/blue, and green/yellow striped conductors correctly.

## BOM considerations

Changing a color does not change quantity or quantity semantics. Wire BOM descriptions now include the shared human-readable color. When a wire has no MPN, color participates in its fallback grouping identity so physically different color variants do not merge. When an MPN is present, the established MPN-authoritative grouping behavior remains unchanged.

## Validation

The existing issue system now warns for:

- a missing required single-wire color;
- unsupported or malformed combined codes;
- identical primary and secondary codes found in imported/stored data.

Valid solid and bi-color WireViz codes do not produce warnings. Unknown values are non-destructive and do not crash UI or exports.

## Tests added and updated

Focused coverage includes solid/bi-color/reversed parsing, formatting, order preservation, unknown input, validation, legacy/project/library/copy round trips, WireViz import/export, standard-key-only YAML, UI source integration, vector canvas stripes, HTML gradients and text, PDF vector swatches and text, BOM quantities/grouping, and a real WireViz/Graphviz render.

The full suite contains 110 passing tests.

## Commands run and results

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm test` — passed, 110/110; includes the production build and live vendored WireViz runtime test.
- `npm run build` — passed as part of `npm test`.
- `git diff --check` — passed; Git reported only existing line-ending conversion warnings.
- Formatter — no formatter command is defined in `package.json`.
- `npm run vendor:verify` — still fails on the pre-existing `public/vendor/pyodide/pyodide.asm.js` checksum mismatch. The runtime itself successfully passed the WireViz/Graphviz integration test, and this feature did not modify the vendored file or checksum manifest.

## Manual verification

Google Chrome 154 on Windows loaded `tests/fixtures/bicolor-manual.wireform.json` and verified:

- `W1 = BU`, `W2 = BUWH`, `W3 = WHBU`, and `W4 = GNYE` editor values and previews;
- distinct `BUWH`/`WHBU` base-and-stripe order on the canvas;
- six striped connection paths for the three bi-color wires;
- `TP1` retained independent `W2`/`W3` colors;
- solid-to-bi-color editing plus undo and redo;
- copy/paste and undo;
- User Library preservation and striped thumbnail;
- project JSON and WireViz YAML downloads with authoritative combined codes and no custom color keys;
- self-contained HTML opened directly from disk with inline SVG and no external requests;
- native PDF generation with vector diagram/swatches and searchable color text;
- no validation issue, browser-console error, or external runtime resource request.

Ghostscript rendered the generated PDF for visual inspection and extracted its searchable text. The canvas, WireViz diagram, pin tables, wire table, and twisted-pair table were visually inspected.

## Known limitations

- Version 1 edits one primary plus one secondary color. Longer multi-marking codes are preserved but shown as unsupported rather than decomposed.
- Custom/non-palette WireViz color strings are preserved but do not receive a named/editable swatch until the user selects a supported standard code.
- Multi-conductor cables and bundles retain their existing comma-separated code editor; the structured selector is intentionally limited to single wires.
- Screen/report swatches are a simplified longitudinal stripe. The WireViz diagram uses WireViz's own three-band rendering and palette.
- MPN remains the authoritative BOM grouping identity when present, matching existing behavior.

