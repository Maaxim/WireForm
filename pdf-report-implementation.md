# Native PDF report implementation

## Implementation summary

WireForm now exports a native, page-oriented PDF wiring-harness report directly
in the browser. The export uses pdfmake rather than browser printing, HTML
conversion, screenshots, or a backend service. Report text remains selectable
and searchable, and the sanitized WireViz diagram is supplied to pdfmake as SVG
vector content.

The existing `HarnessReportModel` remains the normalized engineering-data
source for both HTML and PDF. The PDF renderer consumes that model and its
existing native `BomRow[]`; it does not parse HTML or WireViz YAML and does not
implement a second BOM or termination calculation path.

## Files changed

- `app/pdf-report.ts` — PDF document-definition builder, lazy pdfmake loading,
  graphics fallback, filename helper, and browser download.
- `app/pdf-styles.ts` — dedicated engineering-document styles and table layout.
- `app/HarnessStudio.tsx` — Export PDF action, progress state, error handling,
  shared report-model construction, and download notices.
- `tests/pdf-report.test.mjs` — focused PDF document-definition and integration
  tests.
- `tests/static-build.test.mjs` — production-bundle assertion for the PDF action.
- `scripts/browser-pdf-smoke.mjs` — reproducible Chrome DevTools Protocol smoke
  check for the real UI download and a realistic large report.
- `package.json`, `package-lock.json` — pinned pdfmake and TypeScript definitions.
- `README.md` — user-facing PDF export and architecture documentation.
- `THIRD_PARTY_NOTICES.md`, `public/third-party-notices.txt`, and
  `public/vendor/licenses/*` — pdfmake MIT and bundled Roboto Apache 2.0 notices.

## Dependency changes

- `pdfmake` 0.3.11
- `@types/pdfmake` 0.3.3

pdfmake and its bundled Roboto virtual file system are loaded with dynamic
imports only after the user requests PDF export.

## Shared report-model architecture

The export flow is:

```text
project + sanitized WireViz SVG
        -> buildHarnessReportModel()
        -> HarnessReportModel
             -> existing HTML renderer
             -> buildHarnessPdfDocument()
```

`buildHarnessReportModel()` continues to perform the shared mappings for
metadata, connectors, embedded images, pins, terminations, wires/cables/bundles,
additional components, approved alternatives, twisted pairs, harness notes, and
the native BOM. The PDF renderer accepts this model as its only engineering-data
input.

The document-definition builder is pure and separately testable. PDF generation
and downloading are isolated in `downloadHarnessPdf()`.

## PDF renderer and layout

The report includes:

- a portrait cover/title block with available project metadata and revision;
- a dedicated landscape harness-diagram page;
- landscape connector sections with metadata, image, approved alternatives,
  additional components, and pin/termination tables;
- wire/cable/bundle summary and detailed alternatives/accessories;
- twisted-pair and termination sections when data exists;
- a BOM built from the report model's native BOM rows;
- portrait harness notes when nonblank.

Empty twisted-pair, termination, alternatives, additional-component, and notes
sections are omitted where appropriate. Validation issues are intentionally not
included.

Tables use repeating header rows, flexible widths, wrapping text, restrained
font sizes, and natural multi-page flow. Headings begin major sections on new
pages. Connector identity and its overview block are kept together, while large
tables remain free to paginate.

## SVG handling

The UI obtains the diagram through the existing in-browser WireViz render
request and passes it to `buildHarnessReportModel()`. That existing model builder
sanitizes the SVG. The PDF definition embeds the sanitized string through
pdfmake's `svg` node with a bounded `fit`, preserving vector output and aspect
ratio without taking a screenshot.

If pdfmake rejects the SVG or an embedded connector image, generation is retried
without graphics. The resulting PDF retains all engineering text and tables, and
the UI reports a clear warning. If the fallback also fails, the export error is
shown in the existing notice UI.

## Connector image handling

Persisted, self-contained PNG and JPEG data URLs are embedded directly. External
URLs, blob URLs, invalid data, and formats not reliably supported by pdfmake are
omitted. Images are proportionally constrained to the connector overview. No
network fetch is performed during PDF generation.

## Header, footer, and metadata

Every page has a consistent report header containing the harness title and
revision when present. The footer contains `WireForm` and `Page X / Y`.

PDF document metadata is populated from project data. Creation and modification
dates use a fixed value rather than the wall clock so the implementation does not
introduce time-dependent report content.

## BOM reuse

The PDF renderer reads `model.bomRows` and applies the existing `sortBomRows()`
and `formatBomQuantity()` helpers for presentation. It never calls
`buildBomRows()` and contains no alternative aggregation implementation.

Consequently connector housings/accessories, cable accessories, termination
contacts/seals, modeled lengths, approved-alternative grouping, quantities, and
designators use the same underlying rows as HTML and CSV.

## Unicode and fonts

pdfmake's redistributable bundled Roboto font is registered from its virtual
file system. Browser generation and extracted PDF text were checked with `µ`,
`Ω`, `°`, `±`, `×`, en/em dashes, and German umlauts. Project-controlled values
are supplied as plain pdfmake text values and are never interpreted as HTML.

## Lazy loading and bundle impact

The production build keeps the initial application bundle at approximately
443.73 kB minified / 133.68 kB gzip. PDF code is split into lazy chunks:

- PDF report adapter: 10.39 kB / 3.46 kB gzip
- pdfmake: 972.78 kB / 346.51 kB gzip
- bundled Roboto VFS: 854.65 kB / 468.59 kB gzip

Vite reports its normal large-chunk warning for the two lazy PDF dependencies;
they are not loaded during ordinary editing.

## Tests added

The PDF tests cover:

- use of the shared report model and native BOM rows;
- project-state immutability;
- metadata, revision, and Unicode text;
- sanitized SVG as a vector node;
- valid and invalid connector images;
- approved alternatives for connectors, wires, cables, and bundles;
- connector and cable additional components;
- contacts, seals, strip lengths, tooling, and twisted pairs;
- harness notes and absence of Validation;
- BOM row parity and quantities;
- repeating table headers and page-number footer;
- filename sanitization;
- graphics-degraded fallback;
- lazy pdfmake loading and absence of a second BOM builder;
- presence of the PDF action in the production bundle.

The full existing suite also covers HTML, CSV, WireViz, persistence, legacy
projects, accessories, alternatives, twisted pairs, notes, and terminations.

## Commands run and results

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm test` — passed: 101 tests, 0 failures. This command also ran a successful
  production TypeScript/Vite build.
- `git diff --check` — passed.
- Formatter — no formatter script is configured; lint and diff whitespace
  checks passed.
- `npm run vendor:verify` — fails on the existing
  `public/vendor/pyodide/pyodide.asm.js` checksum mismatch. The expected and
  actual Pyodide checksums already differed before this PDF work; no vendored
  Pyodide files were changed.
- `npm audit --audit-level=high` — reports three pre-existing transitive
  development-tool findings (brace-expansion through ESLint, nanoid and postcss
  through Tailwind/Vite). The affected versions were unchanged by this feature.

## Manual verification

Manual testing used Chrome 154 on Windows against the local Vite server.

- The real toolbar action downloaded `can-sensor-harness.pdf` directly without
  opening a print dialog.
- The final UI smoke run downloaded a valid 32,935-byte PDF with no browser
  console errors and no non-local resource requests.
- A realistic generated fixture containing six connectors, connector images,
  twelve wires, a 12-core cable, accessories, approved alternatives, 24
  terminations, six twisted pairs, a multi-page BOM, notes, and Unicode produced
  a valid 109,424-byte, 18-page PDF.
- Ghostscript rendered all 18 pages successfully. Pages throughout the report
  were visually inspected, including the cover, vector diagram, connector and
  termination tables, cable details, two-page BOM, and notes.
- The diagram remained sharp and unclipped; connector images rendered; long
  tables wrapped and paginated; the BOM header repeated on its second page; and
  headers/footers showed correct `Page X / Y` values.
- Ghostscript text extraction found project metadata, MPN `5051520400`, contact
  and seal data, tooling, notes, Unicode, and `Page 18 / 18`, confirming that
  report text is searchable/selectable.
- The PDF BOM is sourced from the same model rows asserted against the CSV/HTML
  BOM in automated tests.

## Known limitations

- pdfmake's browser image path is limited here to embedded PNG and JPEG data
  URLs. Persisted WebP connector images are omitted rather than converted or
  fetched.
- If any graphic makes pdfmake fail, the safety retry omits the diagram and all
  connector images together. The user receives a warning and still gets the
  engineering tables.
- Extremely large or unusually complex SVGs remain subject to pdfmake/SVG parser
  limits. The renderer prioritizes an unclipped fit on one landscape page rather
  than tiling a diagram across pages.
- PDF binary bytes are controlled by pdfmake and are not promised to be identical
  across different pdfmake/browser versions, although report data and explicit
  document metadata are deterministic.
- The existing vendored Pyodide checksum verification failure remains outside
  this feature.
