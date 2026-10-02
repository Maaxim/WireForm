# Connector additional components implementation

## Summary

WireForm now supports user-authored connector accessories through the same
`AdditionalComponent` model used by cable and wire accessories. A selected
connector exposes a compact **Additional components** inspector section with
Secondary Lock / TPA and Generic component presets. Accessories can be edited,
duplicated, or deleted and participate in the existing project history,
autosave, project-file, copy/paste, and User Library workflows.

Connector accessories remain distinct from per-termination contacts and seals.
WireViz combines both sources only while generating a connector's
`additional_components`; the editable connector accessory list never receives
the synthesized contact or seal aggregates.

## Files changed

- `app/model.ts` — retained the shared accessory model and added its optional
  WireForm-only `notes` field to normalization.
- `app/additional-components.ts` — connector presets, connector quantity-mode
  labels, shared effective-quantity behavior, and clearer validation labels.
- `app/HarnessStudio.tsx` — connector inspector UI and generalized the existing
  accessory add/edit/duplicate/delete handlers for cable and connector owners.
- `app/bom.ts` — carries user accessory notes into the existing native BOM row.
- `app/html-report.ts` — connector accessory report model and connector-section
  table using the shared effective-quantity calculator and native BOM builder.
- `tests/connector-additional-components.test.mjs` — focused model, persistence,
  export/import, BOM, report, cloning, history, and validation coverage.
- `tests/static-build.test.mjs` — production-bundle assertions for the new UI.
- `package.json` — includes the new focused test file in the full suite.
- `README.md` — user workflow and contact/accessory separation documentation.
- `connector-additional-components-implementation.md` and
  `connector-additional-components-review.md` — implementation handoff.

## Reused shared model

`HarnessComponent.additionalComponents?: AdditionalComponent[]` is the single
model for cable, wire, and connector accessories. Connector-specific state was
not introduced. Standard part fields include type, subtype, internal part
number, manufacturer, MPN, supplier, supplier part number, quantity, unit,
quantity multiplier, and WireViz background color. Internal IDs and accessory
notes remain WireForm-only.

Legacy projects need no schema migration: `additionalComponents` remains
optional and the normalizer accepts projects where it is absent.

## UI and presets

The selected connector inspector now contains **Additional components** after
**Pin terminations**. Each row is a collapsible editor with part, quantity,
sourcing, and notes fields plus Duplicate and Delete actions. The summary and
editor show the calculated procurement quantity.

Presets initialize the generic editor only:

- **Secondary Lock / TPA**: type `Secondary Lock / TPA`, quantity `1`, unit
  `pcs`, fixed quantity.
- **Generic component**: blank type, quantity `1`, unit `pcs`.

Available connector quantity modes use WireViz semantics:

- Fixed quantity: no `qty_multiplier`.
- Per populated position: `qty_multiplier: populated`.
- Per connector position: `qty_multiplier: pincount`.
- Per unpopulated position: `qty_multiplier: unpopulated`.

The latter two modes were already valid connector multipliers in the shared
model and remain available alongside the required fixed and populated modes.

## Persistence, history, copy, and User Libraries

Accessories live directly on the connector, so existing immutable project
snapshots and IndexedDB autosave persist them without a parallel storage path.
Project JSON normalization retains all supported fields and generates an ID for
legacy/imported entries that lack one.

The existing copy/paste and User Library insertion paths call
`cloneAdditionalComponentsWithNewIds()`. They deep-clone nested data and assign
fresh internal IDs, preventing edits to an inserted or pasted connector from
mutating the original connector or template. Add, edit, duplicate, and delete
use the normal `updateProject` history path, so undo/redo restores complete
accessory snapshots.

## WireViz export and import

The existing connector exporter now receives user accessories authored through
the new UI. `additionalComponentToWireViz()` emits only supported WireViz
fields. Internal IDs and WireForm-only notes are excluded.

`collectConnectorAdditionalComponents()` continues to build the exported list
as:

1. user-authored connector accessories, in user order; then
2. deterministically grouped contact and seal parts derived from physical
   connector-pin/conductor links.

Generated contact/seal aggregates are never written back to the project.
Existing behavior that adds a manual quantity to an exactly matching generated
termination part remains intact, preserving intentional spare quantities.

WireViz import already normalized standard connector `additional_components`
into the shared model. Generic and contact-looking entries are preserved as
user accessories because WireViz does not carry enough cavity-level data to
infer safe termination assignments; the importer reports that no per-pin
assignments were inferred.

## Contact and seal separation

Connector accessories are user-authored housing accessories. Crimp contacts and
wire seals remain properties of physical topology links. The native BOM reads
the connector list and termination model independently; it does not parse the
combined WireViz output. This avoids synthesized contacts being counted twice.

## BOM integration

The existing `buildBomRows()` path already processes `additionalComponents` on
all harness components. Connector accessories therefore use the same part
identity grouping as cable accessories. Identical manufacturer/MPN parts on
multiple connectors aggregate their quantities and naturally sorted
designators. Accessory notes are retained in the BOM row. Placement metadata is
not relevant to connector accessories.

## HTML report integration

Each connector report card now conditionally includes an **Additional
Components** table with type, manufacturer, MPN, description, base quantity,
quantity rule, calculated quantity, unit, and notes. Pin contact and seal data
remain in pinout and termination tables. The report BOM still receives the
unchanged `buildBomRows(project)` output rather than recalculating purchasing
data.

## Validation

The shared validator checks connector accessories for missing type, non-finite
or negative quantity, and unsupported connector multipliers. Messages identify
the connector, accessory index, and accessory type where available. Malformed
entries are safely omitted or marked unavailable by WireViz, BOM, and report
transformations rather than crashing export.

## Tests added and updated

Focused tests cover presets, blank/legacy connectors, project round-trip,
fixed/populated quantities, WireViz field filtering, WireViz import and
round-trip, export-time termination aggregation, native BOM grouping and
double-count protection, copy and User Library cloning, history snapshot
isolation, HTML rendering/BOM reuse, malformed values, and actionable
validation. The static production test checks that connector accessory controls
are present in the built bundle.

The full suite also exercises the existing termination, cable accessory,
twisted-pair, harness-notes, BOM CSV, HTML safety, and live WireViz/Graphviz
paths.

## Commands run and results

- Formatter — no formatter script or repository formatter configuration is
  present; `git diff --check` was used for whitespace validation.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; 1,651 modules transformed.
- `npm test` — passed, 82/82 tests.
- `git diff --check` — passed (Git emitted only existing line-ending notices).
- `npm run vendor:verify` — failed on the tracked
  `public/vendor/pyodide/pyodide.asm.js` checksum: actual
  `f4f3c6f756c779f073af1a6324b83d10fd11a10fbae70c942c32a05383670285`,
  manifest expected
  `1263f02b5b26099b96112378156f242dd98b39a8201ba7765e5fe3d455c5ce91`.
  The vendor file and manifest were not modified by this work; the live
  WireViz/Graphviz runtime test passed.

## Manual verification

Manual verification used Chrome 154.0.8037.59 against the production preview
and the starter three-conductor harness:

1. Added a Secondary Lock / TPA to J1 and entered Molex `5051520400` plus a
   WireForm-only assembly note.
2. Confirmed fixed quantity `1 pcs` and populated-position quantity `3 pcs`.
3. Confirmed undo/redo of edits and delete/undo of the complete accessory.
4. Reloaded the application and confirmed IndexedDB autosave restored every
   field.
5. Copied/pasted J1, changed the pasted MPN, and confirmed the original remained
   `5051520400`.
6. Saved J1 to the User Library, inserted it, and confirmed the accessory was
   restored on the new connector.
7. Confirmed generated YAML contained the standard connector
   `additional_components` entry and no internal ID or notes.
8. Downloaded project JSON, BOM CSV, and HTML. JSON contained one authored J1
   accessory; the BOM contained Molex `5051520400` exactly once at quantity 1.
9. Opened the HTML directly from `file://`; the connector table, BOM row, inline
   SVG, and print CSS were present. It made no external resource requests and
   logged no console errors.
10. Confirmed the HTML BOM and CSV BOM agreed for the accessory.

Temporary browser profiles and downloaded verification artifacts were removed.

## Known limitations

- WireViz connector `additional_components` cannot express which cavity an
  imported contact-like component belongs to, so imports preserve such entries
  as user accessories rather than guessing termination metadata.
- Accessory notes are intentionally WireForm-only because they are not emitted
  as a non-standard WireViz field.
- Effective populated quantity reflects distinct modeled connector pin ports;
  an unconnected connector therefore calculates zero for the populated mode.
- The repository's existing vendor checksum mismatch remains unresolved and is
  unrelated to this feature.
