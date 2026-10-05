# Connector Pin Labels Implementation

## Implementation summary

WireForm now treats connector `pinLabels` as optional display/connector-marking
metadata for stable physical pins. The connector inspector has a compact
per-pin editor, the canvas prefers a label while retaining the numeric pin,
connection controls and termination summaries preserve physical-pin
traceability, duplicate labels produce warnings, and HTML/PDF reports contain
separate **Pin**, **Label**, and **Signal** data.

No topology or termination keys were changed. A connection to `pin:3` remains
connected to `pin:3` when its label changes from `B1` to `B01`.

## Files changed

- `app/pin-labels.ts` — shared normalization, positional list, display,
  conductor-signal, and duplicate-label validation helpers.
- `app/HarnessStudio.tsx` — per-pin inspector, canvas labels/tooltips,
  connection labels, termination trace labels, validation integration, and
  positional WireViz export.
- `app/globals.css` — compact pin editor table styling.
- `app/wireviz-import.ts` — normalized positional `pinlabels` import.
- `app/html-report.ts` — shared report pin/termination label fields and separate
  conductor signal mapping.
- `app/pdf-report.ts` — physical Pin plus Label columns sourced from the shared
  report model.
- `tests/connector-pin-labels.test.mjs` — focused model, topology, library,
  WireViz, report, validation, and BOM coverage.
- `tests/html-report.test.mjs`, `tests/static-build.test.mjs` — updated report
  expectations and production-bundle UI assertions.
- `tests/fixtures/pin-labels-manual.wireform.json` and
  `scripts/browser-pin-labels-smoke.mjs` — realistic browser verification.
- `package.json` — includes the new suite in `npm test`.
- `README.md` — user-facing semantics and workflow.

## Chosen data representation

The checkout already had the correct WireViz-compatible representation:

```ts
pinLabels: string[]
```

It remains positional: array index zero is physical pin 1. No mapping table,
new pin identity, schema field, or schema-version change was introduced. Empty
strings preserve gaps in partially labeled connectors.

## Why physical identity remains unchanged

All topology links still reference `pin:<number>`. Editing a label updates only
the connector's `pinLabels` array through the existing project commit/history
path. It does not rewrite links, conductor associations, termination contact,
seal, strip length, tooling, signals, BOM data, or component relationships.

## UI changes

The connector inspector replaces the comma-separated label field with a row for
each physical pin. Rows show physical pin, editable label, separate conductor
signal, connected endpoint, and contact summary. Labels accept free text,
trim whitespace, may be cleared, and use the physical number as the blank
fallback.

Canvas connector rows display the label when present while the numeric badge
remains visible. Tooltips show connector, physical pin, optional label, and
signal. Connection-button accessible names use `A1 (pin 1)` form.

## Display helper

`app/pin-labels.ts` centralizes:

- `getConnectorPinLabel()`
- `getPinDisplayName()`
- `getPinTraceLabel()`
- `getConnectedPinSignal()` / `getConductorSignal()`
- `pinLabelsForCount()` and `setConnectorPinLabel()`

UI and report consumers therefore share fallback and signal-separation rules.

## Persistence and history

Labels remain ordinary connector data in `.wireform.json`; existing project
serialization, IndexedDB autosave, snapshots, copy/paste, and undo/redo handle
them without a migration. Legacy connectors with no labels still load. Editing
uses the normal `updateSelected`/`commitProject` path, so undo and redo restore
the complete prior positional label array.

## WireViz import/export and partial labels

Export emits standard `pinlabels` only when at least one label is present. The
array is padded to `pincount`, so `[A1, "", B1, ""]` retains B1 at physical pin
3. Connections continue to emit numeric selectors obtained from `pin:N`.

Import reads standard `pinlabels` positionally, trims label text, preserves
empty placeholders, and never fabricates labels. Supported WireViz round trips
therefore preserve full or partial labels without shifting.

## User Library behavior

Connector templates already deep-cloned complete connector data. Pin-label
arrays are retained by template serialization and restored as independent data
when inserted. Connector copy/paste likewise clones the array.

## HTML and PDF changes

The shared `ReportPin` now contains `pin` and `label`; `ReportTermination`
contains `pin` and `pinLabel`. Signal is independently sourced from the
connected conductor's `wireLabels`.

HTML connector pinout and termination tables show physical pin plus label. PDF
uses the same report fields, with separate Pin and Label columns. BOM generation
does not read pin labels and remains unchanged.

## Validation

Duplicate non-empty labels on one connector produce an editor warning that
identifies the connector and physical pins. Comparison trims labels and is
case-insensitive. Blank labels, numeric labels, and symbols such as `+`, `-`,
and `PE` remain valid.

## Tests added or updated

The focused suite covers positional helpers, all/partial/no labels, trimming,
clearing, legacy projects, JSON round trip, stable topology and termination
data, undo/redo snapshots, copy and User Library independence, WireViz import,
standard export structure, numeric connections, shared HTML/PDF mapping,
duplicate warnings, blank/symbol labels, BOM invariance, canvas traceability,
and existing contact-application UI presence.

The complete suite also reruns termination/contact, strip-length propagation,
additional components, alternatives, twisted pairs, notes/images, bi-color
wires, BOM, HTML, PDF, static build, and live WireViz rendering regressions.

## Commands run and results

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- Focused connector-label/HTML/PDF tests — 32 passed.
- `npm test` — production build passed; all 132 tests passed.
- `git diff --check` — passed (Git reported only repository line-ending
  conversion notices).
- No formatter script exists in `package.json`.
- `npm run vendor:verify` — failed on the already-present
  `public/vendor/pyodide/pyodide.asm.js` manifest checksum mismatch. Neither
  that file nor the manifest was modified by this work.

## Manual verification

A real Chrome session loaded the four-pin manual fixture with X1 labels
`A1/A2/B1/B2`, four connected wires, and contacts, seals, strip lengths, and
tooling. Browser verification confirmed:

- canvas labels and tooltips include the stable physical pin and separate
  signal;
- `B1 -> B01`, undo, and redo work;
- all eight topology links and all termination records remain unchanged;
- duplicate `B01` produces a warning without blocking the project;
- connector copy/paste and User Library insertion preserve labels;
- clearing pin 2 yields `[A1, "", B01, B2]` and remains positional;
- autosave/reload and downloaded `.wireform.json` preserve that array;
- YAML contains four positional `pinlabels` entries and numeric `X1: 3`
  connection selectors;
- BOM CSV retains the expected housing and contains no display-label metadata;
- standalone offline HTML contains Pin/Label columns, B01, and termination
  strip length;
- native PDF download succeeded with eight pages; Ghostscript text extraction
  confirmed searchable Pin/Label columns, physical pin 3, B01, FAN_PWM,
  CONTACT-3, SEAL-3, 6 mm, and Tool 3;
- the browser console contained no errors.

## Known limitations

- Label edits follow the existing inspector convention and commit on input;
  there is no separate modal Save/Cancel interaction.
- Very long labels are accepted up to the existing 300-character label bound;
  the compact inspector table scrolls horizontally and canvas text may be
  visually truncated.
- Duplicate labels are allowed with a warning. A WireViz file that later uses a
  duplicate label as a connection selector is inherently ambiguous; numeric
  selectors remain unambiguous and are what WireForm exports.

