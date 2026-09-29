# Native self-contained HTML harness report implementation

## Implementation summary

WireForm now exports a single, self-contained HTML engineering report from the document icon in the main toolbar. The report is generated entirely in the browser and downloads as `<project-name>.html`, with `wireform-harness.html` as the empty-title fallback.

The static report contains project metadata, the WireViz-derived vector diagram, naturally ordered connector sections and pinout tables, embedded connector images, cable/wire summaries, per-end termination manufacturing data, the native BOM, validation warnings, and print-specific styling. It requires no WireForm instance, localhost server, network access, JavaScript, external stylesheet, external image, Python, Graphviz executable, or WireViz runtime after download.

## Files changed

- `app/html-report.ts` — report model, project-data extraction, SVG sanitization, HTML escaping/rendering, print styling, and filename generation.
- `app/HarnessStudio.tsx` — asynchronous HTML report action and fresh WireViz worker render request.
- `app/bom.ts` — exports the existing stable BOM quantity formatter for shared CSV/HTML presentation.
- `tests/html-report.test.mjs` — report-model, security, rendering, compatibility, and determinism tests.
- `tests/static-build.test.mjs` — checks that the production application contains the HTML export action.
- `package.json` — adds the report tests to the normal suite.
- `README.md` — documents report export, offline use, printing, and authoritative project files.
- `html-report-implementation.md` — this implementation record.
- `html-report-review.md` — security and production review notes.

No project schema or persistence format changed.

## Report architecture

The implementation is split into testable layers:

1. `buildHarnessReportModel(project, diagramSvg, warnings)` reads the current project model.
2. The model contains project metadata, connectors/pins, cables, terminations, shared `BomRow[]`, warnings, and a sanitized inline SVG.
3. `renderHarnessReportHtml(model)` produces deterministic semantic HTML with inline CSS and no script.
4. `htmlReportFilenameForTitle(title)` produces the stable download name.
5. The UI downloads the result through WireForm's existing Blob/object-URL helper using `text/html;charset=utf-8`.

Project-data extraction and HTML generation are independent. The renderer does not inspect the live editor DOM or parse YAML/CSV output.

## Diagram-generation path

The action sends the current `buildWireVizDocument()` result and connector-image payload to the existing `preview.worker.ts` rendering path. It uses a dedicated request ID and awaits a fresh response rather than reusing a possibly stale preview state.

The existing worker continues to perform:

```text
WireForm project model
  -> buildWireVizDocument()
  -> vendored WireViz in Pyodide
  -> Graphviz through @viz-js/viz
  -> SVG string
```

Report generation fails clearly if rendering fails, the worker is unavailable, or the request exceeds three minutes. Structurally invalid projects are rejected before report rendering, matching the existing YAML export behavior.

## Connector-image handling

Connector photos already persist as normalized JPEG/PNG/WebP base64 data URLs. The report model retains only data URLs matching those supported MIME types and base64 form. Persisted `blob:`, `http:`, `https:`, SVG, or otherwise invalid image sources are omitted.

The resulting connector `<img>` has embedded data, stored dimensions, and escaped meaningful alt text. Connector images embedded by the worker inside the diagram are also data URLs and are checked by the SVG sanitizer.

## Termination/contact handling

The report directly reads `TopologyLink.termination` after confirming the link through the existing `isPhysicalTerminationLink()` predicate. It does not derive assignments from WireViz `additional_components`.

Pinout rows and the dedicated termination table include the current connector/cavity, cable or wire, conductor label, signal, color, gauge, contact manufacturer, contact MPN/internal PN fallback, seal MPN/internal PN fallback, strip length, tooling, and termination notes where available. Opposite ends of one conductor remain distinct rows. Links without explicit termination metadata still appear in connector pinouts but not in the manufacturing termination table.

## Native BOM reuse

`buildHarnessReportModel()` calls the existing `buildBomRows(project)` function directly. The HTML renderer receives those `BomRow[]` and does not independently calculate connector, cable, contact, seal, or additional-component quantities.

The BOM table also uses the BOM module's exported stable quantity formatter and natural sorter. Automated and manual checks compare the HTML-visible parts and quantities with the native BOM CSV output.

## HTML escaping strategy

All project-controlled text passes through `escapeHtml()` before entering markup. The function escapes `&`, `<`, `>`, double quotes, and apostrophes. This applies to project metadata, component fields, signals, designators, notes, termination values, image alt text, warnings, and BOM values.

The report contains no JavaScript. A restrictive CSP is embedded:

```text
default-src 'none'
img-src data:
style-src 'unsafe-inline'
script-src 'none'
connect-src 'none'
object-src 'none'
base-uri 'none'
form-action 'none'
```

Only inline CSS and embedded raster image data are enabled.

## SVG sanitization strategy

The WireViz/Graphviz SVG is rebuilt through a small XML/SVG allowlist before inline embedding.

- XML declarations, Graphviz's SVG doctype, and comments are removed.
- Allowed elements are limited to the shapes, grouping, text, and raster-image elements used by the current Graphviz output.
- Allowed attributes are limited to geometry, paint, font, transform, namespace, identity, and image-reference attributes required by the current renderer.
- `script`, `foreignObject`, style elements/attributes, event handlers, unknown declarations, invalid nesting, unsupported entities, and unknown elements/attributes are rejected.
- Image references may only be supported base64 raster data URLs or internal fragment references.
- `javascript:`, external URLs, `url(...)`, and HTML data values are rejected in SVG attributes.
- `xlink:href` from Graphviz is normalized to modern `href`; the obsolete xlink namespace is removed.
- Graphviz's harmless `xml:space` output is allowed and covered by tests.

The export stops with a visible error instead of emitting a diagram when the SVG falls outside this safety profile.

## Deterministic-output considerations

- No generated-at timestamp is included.
- Connector, cable, termination, warning, BOM, and designator order uses the existing deterministic natural comparison.
- Stable connector anchors are based on ordered position, not random values.
- Project-local blob URLs are never included.
- The report uses fixed HTML/CSS formatting and shared stable BOM quantity formatting.
- Repeated model/render calls with identical project data and SVG produce byte-identical HTML in tests.

The current Graphviz-generated SVG is deterministic in the tested runtime. Renderer upgrades may change SVG markup even when the higher-level project is unchanged.

## Print behavior

The report uses a light, professional document theme independent of WireForm's application theme. Desktop tables scroll horizontally when necessary; the inline SVG scales to report width while retaining vector quality.

Print CSS:

- removes the table of contents and screen-only footer
- removes shadows and rounded-card styling
- repeats table headers where the browser supports it
- avoids splitting table rows and compact metadata blocks
- starts subsequent connector cards on new pages
- scales the SVG to page width and a bounded page height
- reduces table padding and type size for dense engineering data

## Tests added

Thirteen focused report tests cover:

- project metadata mapping
- natural connector/cable/warning ordering
- connector pin/cavity and conductor mapping
- signals, colors, wire size, contacts, seals, strip length, tooling, and notes
- opposite conductor ends and mixed contact MPNs
- multiconductor cable represented once at modeled length
- direct reuse and exact equality of native `buildBomRows()` output
- legacy schema-2 projects without termination data
- malicious project title, symbols, quotes, and multiline-note escaping
- retained embedded raster images and omitted blob/external images
- inline SVG and embedded image normalization
- rejection of scripts, handlers, `foreignObject`, styles, JavaScript/external URLs, and URL-bearing paint attributes
- semantic report sections, CSP, no script/CDN, print CSS, shared BOM quantities, filename behavior, and repeated-output stability

The existing BOM CSV, termination, migration, WireViz import/export aggregation, static build, and vendored WireViz runtime tests remain in the full suite.

## Commands run and results

- TypeScript: `tsc --noEmit` — passed.
- ESLint: `eslint .` — passed.
- Production Vite build — passed; 1,649 modules transformed.
- Full Node test suite — passed; 44 tests passed.
- Focused report suite — passed; 13 tests passed.
- `npm audit --audit-level=high` — passed with 0 vulnerabilities.
- Live development server check at `http://127.0.0.1:4173/` — HTTP 200.
- `npm run vendor:verify` equivalent — failed on the pre-existing `public/vendor/pyodide/pyodide.asm.js` hash mismatch. Expected `1263f02b5b26099b96112378156f242dd98b39a8201ba7765e5fe3d455c5ce91`; actual `f4f3c6f756c779f073af1a6324b83d10fd11a10fbae70c942c32a05383670285`. This feature did not modify vendor assets or the manifest.
- `git diff --check` — run after final documentation and recorded below if successful.

No formatter command is configured in `package.json`.

## Manual verification performed

A realistic harness was loaded into Microsoft Edge on Windows through WireForm's normal autosave/project path. It contained two connectors, a three-conductor cable, an embedded connector image, two distinct contact MPNs, a seal, strip length, tooling, manufacturer/MPN data, and notes.

The native toolbar action generated `manual-edge-report.html` through a fresh real WireViz/Pyodide/Graphviz worker render. The native BOM action also generated `manual-edge-report.bom.csv`.

Verification results:

1. The HTML was reopened directly through `file://`.
2. Edge networking was forced offline before opening it.
3. The inline SVG rendered at a measured width of 1,308 CSS pixels.
4. The embedded connector image completed decoding with a nonzero natural width.
5. Connector pinout, cable, and termination tables were checked programmatically and visually.
6. `CONTACT-A`, `CONTACT-B`, `SEAL-A`, `5 mm`, and `Applicator A` appeared in the expected report sections.
7. HTML BOM and CSV both contained contact quantities 2 and 1 and seal quantity 1.
8. `CONTACT-B` was found as searchable document text.
9. Screen and print-media captures were visually inspected; the diagram and tables were readable and fitted the engineering layout.
10. Edge `Page.printToPDF` produced a valid 182,357-byte PDF. Its PDF signature/size and the equivalent browser print-media rendering were inspected. The headless built-in PDF viewer itself produced a blank screenshot, so visual layout assessment used the pre-PDF print-media capture.
11. No HTTP or HTTPS request occurred while the offline `file://` report was open.
12. The browser console reported no errors.

The generated manual-verification artifacts were kept outside the repository in the operating-system temporary directory.

## Known limitations

- The safe SVG allowlist intentionally rejects renderer output it does not recognize. A future Graphviz version that introduces a new safe element or attribute may require a reviewed allowlist update.
- Large embedded connector photos increase the single HTML file size; WireForm's existing image normalization and project limits remain the governing bounds.
- Export requires the in-browser rendering worker to initialize successfully at generation time. The resulting HTML has no runtime dependency.
- The report does not contain a generated timestamp by design.
- Browser pagination of exceptionally wide or long tables varies slightly by browser; rows and headers use best-effort print-break rules.
- The HTML report is read-only generated documentation and cannot be imported back into WireForm.
