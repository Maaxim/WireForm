# Cable/Wire Additional Components Implementation

## Summary

WireForm now supports generic additional components on cables, wires, and
bundles. The cable/wire inspector provides Heat shrink, Wire label, Ferrite,
and Generic presets, followed by one shared editor with add, edit, duplicate,
and delete behavior. Each row shows the base quantity, WireViz quantity mode,
and the effective quantity calculated by the same code used by the native BOM.

The feature is fully client-side and participates in project persistence,
autosave, history snapshots, component copy/paste, user libraries, WireViz
import/export, native BOM CSV, HTML reports, and validation.

## Files changed

- `app/additional-components.ts` — shared presets, quantity calculation,
  WireViz serialization, cloning, placement helpers, and validation.
- `app/model.ts` — shared `AdditionalComponent` and placement model plus
  normalization for connector and cable owners.
- `app/HarnessStudio.tsx` — cable WireViz export, inspector CRUD UI,
  calculated quantities, validation integration, undo/redo-compatible edits,
  and fresh IDs during paste.
- `app/globals.css` — compact accessory editor styling.
- `app/bom.ts` — delegates all additional-component quantity calculation to
  the shared implementation.
- `app/wireviz-import.ts` — imports standard cable `additional_components`.
- `app/termination.ts` — connector additional components now use the shared
  WireViz serializer while contact/seal synthesis remains unchanged.
- `app/library.ts` — cable templates preserve components and regenerate their
  internal IDs when instantiated.
- `app/html-report.ts` — cable accessory tables with quantity rules,
  calculated quantities, and resolved placement.
- `README.md` — user documentation and WireViz/placement distinction.
- `package.json` — includes the focused test file in the normal suite.
- `tests/cable-additional-components.test.mjs` — feature coverage.
- `tests/project-data.test.mjs`, `tests/html-report.test.mjs`,
  `tests/static-build.test.mjs`, `tests/wireviz-runtime.test.mjs` — migration,
  report, UI-presence, and real WireViz runtime regression coverage.

## Model changes

`HarnessComponent.additionalComponents` now uses a shared
`AdditionalComponent` representation for connector and cable owners. It
contains the existing WireViz part fields plus:

- a stable WireForm-only `id`;
- `qty`, `unit`, `qtyMultiplier`, and `bgcolor`;
- optional placement scope, end, selected conductors, offset, piece length,
  and note.

This is an additive optional field, so the project schema remains version 3.
Legacy projects load without fabricated accessory data. Existing connector
additional components receive an internal ID when normalized but export exactly
as standard WireViz data.

## Presets

- Heat shrink: quantity 1, fixed, `pcs`.
- Wire label: quantity 1, `terminations`, `pcs`, termination scope.
- Ferrite: quantity 1, fixed, `pcs`, cable scope.
- Generic: quantity 1 with the type left for the user to enter.

Presets only initialize the generic component editor. Wire label products do
not replace or modify conductor `wirelabels` identification text.

## Quantity modes and calculated quantities

The UI mappings are:

| UI mode | WireViz field |
|---|---|
| Fixed quantity | no `qty_multiplier` |
| Per conductor | `wirecount` |
| Per termination | `terminations` |
| Per cable length | `length` |
| Per total conductor length | `total_length` |

`additionalComponentQuantity()` is authoritative for the inspector, BOM, and
HTML report. It matches WireViz 0.4.1: `terminations` is the count of modeled
WireViz cable connection records, `length` is normalized to meters, and
`total_length` is meters multiplied by wire count. Quantities are rounded to
nine decimal places to avoid floating-point artifacts.

## Persistence and cloning

Additional components are part of the normal project object, so project JSON,
autosave/IndexedDB, and undo/redo snapshots preserve them automatically.
Component paste, accessory duplication, and user-library instantiation deep
clone the nested data and generate fresh internal accessory IDs. Ordinary
save/load preserves stable IDs.

## WireViz export and import

Cable export emits only standard WireViz 0.4.1 fields:

`type`, `subtype`, `pn`, `manufacturer`, `mpn`, `supplier`, `spn`, `qty`,
`unit`, `qty_multiplier`, and `bgcolor`.

Internal IDs and all placement fields are omitted. Invalid/unknown multipliers
are reported and omitted from YAML so the export remains valid. Components
without a type are reported and skipped by WireViz export.

WireViz import accepts cable `additional_components`, preserves all supported
standard fields, assigns internal IDs, and leaves placement undefined. A
standard WireViz import/export round trip therefore retains standard data but
does not invent manufacturing placement.

## BOM integration

The existing `buildBomRows()` path now calls the shared quantity calculator.
Cable accessory rows aggregate using the existing purchasing identity rules;
placement does not split otherwise identical parts. Connector components,
per-termination contacts, and seals retain their existing independent paths,
so synthesized connector contact data is not double-counted.

## HTML report integration

Each cable with accessories receives an Additional Components table showing
type, part identity, base quantity, rule, calculated quantity, unit, and
WireForm-only placement. From/to placement is resolved to cable endpoint
designators. The report BOM continues to consume `buildBomRows()` directly.

## Validation

The current always-visible topology issue panel now receives accessory errors
and warnings for:

- negative/non-finite quantities;
- negative/non-finite offsets and piece lengths;
- selected conductors that do not exist;
- unknown owner-specific quantity multipliers;
- missing component type;
- from/to placement on an unresolved cable endpoint.

Malformed components are skipped safely where their export quantity or type
cannot be resolved.

## Tests added or updated

Focused coverage includes presets, legacy and current persistence, all five
quantity modes, standard-field WireViz export/import and round trip, placement
exclusion from YAML, BOM quantities/grouping/no double counting, HTML detail
and shared BOM reuse, user-library cloning, copy IDs, history isolation,
validation, UI bundle presence, existing connector/contact regressions, and a
real vendored WireViz/Graphviz runtime render.

The final suite contains 54 passing tests.

## Commands run and results

- TypeScript type check (`tsc --noEmit`) — passed.
- ESLint (`eslint .`) — passed.
- `npm test` — passed: production build plus all 54 tests.
- Production Vite build — passed as part of `npm test` (1,650 modules).
- `git diff --check` — passed before documentation and repeated at handoff.
- `npm run vendor:verify` equivalent — failed on the pre-existing checked-in
  Pyodide checksum mismatch: expected `1263f02b...5ce91`, actual
  `f4f3c6f7...70285`. Git confirms the vendor file is unchanged from `HEAD`.
- Formatter — no formatter command is configured in `package.json`.

## Manual verification

A fresh Microsoft Edge profile exercised a 12-conductor cable connected at
both ends with:

- heat shrink: fixed quantity 2, both ends, 30 mm pieces;
- Brady B-342 wire labels: quantity 1 with `terminations`;
- TDK ZCAT2035-0930 ferrite: fixed quantity 1, 30 mm from X1.

Verified in the browser:

- preset creation and compact editing;
- effective quantity display (12 labels under exact WireViz 0.4.1 semantics);
- undo and redo of placement changes;
- project download and reload preserving placement;
- user-library save and insertion preserving data with cloned IDs;
- YAML containing the standard components and no placement/internal fields;
- YAML re-import restoring standard fields without fabricated placement;
- BOM CSV quantities of 2 heat-shrink, 12 labels, and 1 ferrite;
- HTML detail tables and HTML BOM content;
- HTML opening directly from `file://` with inline SVG, no external resources,
  searchable MPNs, print CSS, and no report console errors;
- malformed generic quantity/type issues rendered in the topology issue panel.

Temporary browser profiles and generated verification artifacts were removed.

## Known limitations

- WireViz 0.4.1 defines `terminations` as cable connection records, not twice
  the conductor count. A 12-conductor cable connected at both ends therefore
  calculates 12, not 24. Use base quantity 2 when one purchased item is needed
  at each physical end.
- Placement is intentionally not round-tripped through WireViz YAML.
- Placement is documentation/manufacturing metadata; it does not draw physical
  accessory symbols on the topology canvas.
- The pre-existing vendor checksum mismatch remains outside this feature.
