# Connection Mapping Report — Implementation

## Implementation summary

WireForm now derives a concise end-to-end Connection Mapping from the authoritative project topology and places it immediately after the Harness Diagram in both the self-contained HTML report and native PDF report. The mapping is report-only: no mapping data is persisted in `.wireform.json`, added to WireViz YAML, or maintained by the user.

Each modeled physical conductor produces exactly one row. Rows retain physical connector pins, append editable pin labels in parentheses, identify the wire or cable/bundle conductor, include the exact solid or bi-color code, and show existing twisted-pair membership. One-ended, unused, malformed, and multidrop conductors have explicit safe representations.

## Files changed

- `app/connection-mapping.ts` — shared topology-derived row model and builder.
- `app/pin-labels.ts` — shared physical-pin-first report label helper.
- `app/html-report.ts` — report-model integration and HTML section/table.
- `app/pdf-report.ts` — PDF section using the shared rows.
- `tests/connection-mapping-report.test.mjs` — focused model, HTML, PDF, pagination, and regression coverage.
- `package.json` — includes the focused suite in the repository test command.
- `README.md` — user-facing report documentation.

## Topology source used

`buildConnectionMappingRows(project)` reads `project.components`, `project.links`, and `project.twistedPairs`. It never reads SVG geometry, rendered labels, WireViz text, or another report table. The resulting rows are added once to `HarnessReportModel.connectionMapping`; both report renderers consume that normalized array.

The builder is read-only and does not mutate the project, BOM data, validation state, or export state.

## Conductor enumeration strategy

The builder enumerates every component in the existing cable-kind family (`wire`, `cable`, and `bundle`) and creates one row for each `wire:1..wireCount` port. This provides:

- one row for each standalone single wire;
- one row for each physical cable conductor;
- one row for each physical bundle conductor;
- no connector-pin-centric reverse duplicates.

Zero-endpoint conductors are intentionally included as `OPEN -> conductor -> OPEN`. This makes unused or not-yet-connected conductors visible during design review.

## Endpoint resolution

For each conductor port, all matching topology links are collected. The opposite port is resolved only when it refers to an existing connector-family component and a valid physical `pin:n` within that component's pin count.

- No endpoints: `OPEN` to `OPEN`.
- One endpoint: resolved endpoint to `OPEN`.
- Two endpoints: deterministic normalized endpoint order.
- More than two endpoints: the first normalized endpoint is shown as From and the remainder are shown in a single `MULTI-DROP` destination description.
- Missing component, non-connector endpoint, malformed pin, or out-of-range pin: `UNRESOLVED`.

The existing validation system remains responsible for describing the underlying malformed topology.

## From/To normalization and natural sorting

The current topology is non-directional. From/To therefore represents deterministic report ordering, not electrical direction; that statement is printed above both tables.

Connected endpoints sort before multidrop, unresolved, and open states. Connected endpoints use the existing natural comparator by connector designator, physical pin, then pin label. Rows then sort by From endpoint, conductor designator and conductor number, followed by To endpoint. This keeps values such as `J2` before `J10` and pin `2` before pin `10`.

## Pin label handling

`getPinReportLabel(connector, pin)` was added beside the existing connector-pin helpers. It always preserves the authoritative physical pin:

- unlabeled: `1`
- labeled: `1 (A1)`

The mapping builder uses this shared helper, so connector designator and pin-label edits are reflected whenever the report model is rebuilt. No stale designator or label is stored in project data.

## Wire and conductor formatting

The normalized conductor model carries structured identity plus a compact display string:

- standalone: `W1 · CAN_H · BU`
- cable/bundle: `B1 / cond. 1 · CAN_H · BUWH`

Empty label or color segments are omitted without shifting the remaining identity. The exact persisted WireViz-compatible color code is retained. HTML and PDF both use the existing shared wire-color interpretation to render compact solid/striped swatches while keeping the color code as text for searchability and monochrome readability. The PDF mapping cell reuses the same vector swatch canvas already used by other PDF wire-color tables.

## Twisted-pair lookup

The builder reuses the established twisted-pair membership helpers:

- `findTwistedPairForWire` for standalone single wires;
- `findTwistedPairForBundleConductor` for bundle conductors by stable conductor ID.

Only the pair designator is included in this overview. Pitch, direction, members, and notes remain in the existing detailed Twisted Pairs section. Cable conductors do not acquire inferred pair membership.

## Shared report model

`HarnessReportModel` now contains `connectionMapping: ReportConnectionMappingRow[]`. `buildHarnessReportModel()` builds the rows once beside the connector, cable, termination, BOM, notes, and image report data. HTML and PDF do not independently traverse topology.

## HTML implementation

The self-contained HTML report adds:

- a Connection Mapping contents link after Diagram;
- a full-width six-column section immediately after Harness Diagram;
- From Connector, From Pin, Wire / Conductor, Twisted Pair, To Connector, and To Pin columns;
- compact existing-style rows, safe escaped text, exact color codes, and shared color swatches;
- a clear non-directional From/To note.

The existing CSP, escaping, static/offline behavior, detailed sections, and print styles remain in place.

## PDF implementation

The native PDF adds the same section immediately after the diagram. It uses the same normalized row objects and a compact portrait table with the conductor column assigned the flexible width. The existing shared PDF table helper supplies `headerRows: 1` and `keepWithHeaderRows: 1`, allowing long mappings to span pages with repeated headers. No alternate topology or BOM calculation was introduced.

## Tests

Focused tests cover:

- one naturally ordered row per physical conductor and no reverse duplicates;
- standalone wires, bundle conductors, labels/signals, solid and bi-color codes;
- physical pins and optional connector pin labels;
- deterministic non-directional ordering and natural designator/pin sorting;
- OPEN, UNRESOLVED, and safe multidrop behavior;
- standalone and bundle-conductor twisted-pair membership and pair removal;
- connector rename and pin-label edits without persisted mapping state;
- one shared report-model array feeding HTML and PDF;
- section order, six columns, color swatch, self-contained HTML, and escaped table output;
- portrait PDF widths, identical rows/order, repeating headers, and compact vector solid/bi-color swatches with outlined light colors;
- valid pdfmake binary generation with a 48-conductor mapping;
- project immutability, unchanged native BOM rows, and absence of mapping fields from the WireViz source path.

The full repository suite passed with 175 tests and zero failures.

## Commands run and results

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm test` — passed; 175 tests, 0 failed. This command also runs the production build before the Node test suites.
- `npm run build` — passed (`tsc --noEmit` and Vite production build).
- Formatter — the repository has no formatter script; formatting was checked through the configured lint/type/build pipeline and `git diff --check` at final verification.

The production build retained the repository's existing Vite large-chunk advisory; no new build error or report failure was introduced.

## Manual verification

A representative report was generated with:

- connectors `J1`, `J2`, and `J3`, each with physical pins and labels;
- standalone `W1`/`W2`, exact `BUWH`/`WHBU` color codes, and `TP1` membership;
- six-conductor bundle `B1`, conductor labels, solid and bi-color codes, and bundle-conductor `TP2` membership;
- two fully connected, one-ended, and zero-ended conductors;
- project metadata, diagram SVG, notes, and the existing detailed report sections.

The generated HTML was opened in headless Chrome and visually inspected. The section appeared directly below the diagram, showed eight rows with no reverse duplicates, preserved pin labels and color codes, displayed TP membership, and clearly rendered one-ended and zero-ended OPEN states. Connector details followed normally.

The generated native PDF was validated as a real PDF and rendered to page images with Ghostscript. The Connection Mapping occupied page 3 immediately after the cover and diagram, used a readable portrait six-column table, preserved the same eight row values/order, included page headers/footers, and showed no clipping. The automated 48-conductor PDF case verified multipage-capable table generation and repeated-header configuration.

Edits to connector designators and pin labels, and removal of pair membership, were also rebuilt in focused tests and reflected immediately without project mapping state. BOM rows and project state remained byte-for-byte equivalent at the model level before and after report-model construction.

## Known limitations

- From/To is presentation ordering because project links are not electrically directional.
- Multidrop is summarized in one safe row rather than expanded into implied point-to-point runs.
- A malformed link can be displayed as UNRESOLVED while present in live model state; normal project parsing may reject or normalize some malformed records before they reach reporting.
- Only modeled `wire:n` physical conductors are enumerated; separately modeled shields are not invented as signal conductors.
- Very long connector labels or multidrop endpoint lists wrap in the flexible table cells and may increase pagination.
- Connection Mapping CSV export and interactive filtering are intentionally outside this change.
