# Approved alternatives implementation

## Implementation summary

WireForm now supports explicit approved substitute manufacturer/MPN records for
connectors, single wires, cables, and bundles. The existing component
`manufacturer` and `mpn` fields remain the preferred/default part. Alternatives
are optional metadata for the same physical item and never create additional
procurement quantities.

The feature uses one shared model and one shared inspector implementation. It
is integrated with project normalization, autosave, project JSON, history,
copy/paste, User Libraries, validation, native BOM rows, BOM CSV, and the
self-contained HTML report. Standard WireViz YAML remains unchanged and emits
only the primary part.

## Files changed

- `app/model.ts` — shared `ApprovedPartAlternative`, optional component list,
  stable ID creation, normalization, and project-file persistence.
- `app/approved-alternatives.ts` — eligible-kind checks, creation and cloning,
  validation, display formatting, and canonical BOM comparison.
- `app/HarnessStudio.tsx` — shared inspector UI, history-backed actions,
  copy/paste cloning, validation integration, and exported WireViz builder for
  direct regression inspection.
- `app/globals.css` — compact inspector styling.
- `app/library.ts` — template normalization and fresh IDs on insertion.
- `app/bom.ts` — alternative metadata on primary component rows, conservative
  grouping, deterministic sorting, and CSV output.
- `app/html-report.ts` — component detail tables and shared-BOM column.
- `tests/approved-alternatives.test.mjs` — focused feature coverage.
- `tests/bom-export.test.mjs`, `tests/html-report.test.mjs`, and
  `tests/static-build.test.mjs` — updated regression expectations.
- `package.json` — adds the focused test file to the full suite.
- `README.md` — user-facing semantics and round-trip documentation.
- `approved-alternatives-implementation.md` and
  `approved-alternatives-review.md` — implementation handoff.

## Shared data model

The model adds:

```ts
interface ApprovedPartAlternative {
  id: string;
  manufacturer?: string;
  mpn?: string;
  note?: string;
}
```

and the optional `HarnessComponent.approvedAlternatives` list. The primary
component `manufacturer` and `mpn` fields were not generalized or replaced.
The alternative ID is WireForm-only and is preserved by normal save/load.
Normalization bounds text/list sizes, ignores non-object entries, replaces
missing or duplicate internal IDs, and safely accepts incomplete records so the
validator and editor can report them.

## Eligible component types

The shared UI, validation, BOM metadata, and report detail behavior applies to:

- connector
- wire
- cable
- bundle

Splices and junctions do not expose approved alternatives. No separate model
exists for any eligible component kind.

## UI behavior

The open **BOM & sourcing** inspector section now places **Approved
alternatives** immediately below the primary and supplier fields for every
eligible component. The explanatory text states that entries are substitutes
and do not add BOM quantity.

Users can add a blank alternative, edit manufacturer/MPN/note, duplicate an
entry, or delete it. Entries retain user order. Rows use the existing compact,
collapsible inspector pattern and summarize manufacturer, MPN, and optional
note.

All mutations use the normal `updateProject` path, so add, edit, duplicate, and
delete participate in undo/redo and autosave.

## Persistence

`approvedAlternatives` is optional. Existing schema-1/2/3 projects without the
field continue to normalize normally. Project JSON and IndexedDB autosave store
the list directly on the owning component. Normal save/load preserves IDs and
visible order. Empty/incomplete entries remain representable and produce a
warning rather than crashing downstream transformations.

## Cloning and copy behavior

`cloneApprovedAlternativesWithNewIds()` uses structured cloning and replaces
every internal alternative ID. Canvas paste applies it to each pasted
component. History snapshots continue to use the existing deep project clone.
Therefore a pasted connector, wire, cable, or bundle retains the same approval
data but editing it cannot modify its source.

## User Library behavior

Library templates normalize and retain approved alternatives for all four
eligible kinds. A template keeps its stored alternative data, while insertion
deep-clones the list and generates fresh alternative IDs. Automated and browser
checks confirmed an inserted component can be edited independently of both its
source component and template.

## Validation

The existing issues UI now receives alternative warnings for:

- both manufacturer and MPN empty;
- an alternative identical to the primary manufacturer/MPN;
- the same alternative entered more than once.

Comparison trims whitespace and folds case without rewriting the user's stored
formatting. Duplicate detection uses manufacturer plus MPN; notes do not make a
duplicate physical part distinct. Messages identify the designator and entry
ordinal. Malformed runtime values are safely formatted/ignored rather than
crashing BOM or report export.

## WireViz behavior

The WireViz document builder continues to copy only the primary component
manufacturer and MPN to standard connector/cable fields. It never reads
`approvedAlternatives`, and emits no custom keys or note stuffing. Existing
additional-component, termination, cable, and twisted-pair behavior is
unchanged.

WireViz import populates only primary manufacturer/MPN and never invents an
alternative list. Consequently, WireForm -> WireViz -> WireForm is
intentionally lossy for approved alternatives. The editable `.wireform.json`
file remains authoritative.

## BOM model changes

`BomRow` now has optional `approvedAlternatives` metadata containing only
manufacturer, MPN, and note; WireForm IDs are excluded. Only the owning
component's primary contribution receives this metadata. Alternatives never
become independent contributions and cannot increase quantity. Additional
components and termination parts retain their existing independent purchasing
semantics.

## BOM grouping logic

The existing component identity is extended with a canonical alternative set.
Each entry is trimmed, case-folded, represented by manufacturer/MPN/note, then
deduplicated and sorted for comparison. This means:

- list order does not prevent otherwise identical rows from aggregating;
- case/outer-whitespace differences do not split rows;
- a different approved part or different approval note keeps rows separate;
- visible alternative order is not mutated; an aggregated row retains the
  first stable component's user order.

This conservative rule avoids implying that an alternative approved for one
designator is approved for another.

## CSV changes

Native BOM CSV adds one stable `Approved Alternatives` column between
`Designators` and `Notes`. Entries render in user order as semicolon-separated
text, for example:

```text
TE Connectivity ABC123 (Drop-in); Amphenol XYZ987
```

The existing CSV serializer handles commas, quotes, newlines, and Unicode. The
output remains deterministic for unchanged project data.

## HTML changes

Connector cards conditionally render an **Approved Alternatives** table after
primary metadata. Cable, single-wire, and bundle records receive their own
designator-specific detail table below the cable/wire summary. Components with
no alternatives render no empty alternatives heading or table.

The HTML BOM adds an optional compact alternatives column derived from the same
`BomRow[]` used by CSV. User notes are passed through the existing HTML escaping
path. No external report resources or runtime dependencies were introduced.

## Tests

Focused tests cover:

- all eligible component types and excluded splice/junction kinds;
- one/multiple/no alternatives, stable IDs, legacy projects, malformed input,
  save/load, user order, cloning, and history isolation;
- User Library connector/wire/cable/bundle preservation and fresh insertion
  IDs;
- empty, primary-identical, and case-insensitive duplicate warnings;
- zero quantity impact, metadata retention, identical-set aggregation,
  different-set separation, order-independent grouping, and deterministic
  notes;
- CSV header, escaping, Unicode, newlines, and repeated-output stability;
- connector/wire/cable/bundle HTML details, shared BOM reuse, safe escaping,
  omitted empty sections, and offline output;
- primary-only WireViz export and import with no inferred alternatives.

The full regression suite continues to cover terminations, connector and cable
additional components, twisted pairs, harness notes, validation UI, BOM,
HTML security, and the live WireViz/Graphviz runtime.

## Commands run and results

- Formatter — no formatter script or formatter configuration exists; used
  `git diff --check` for whitespace validation.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; 1,652 modules transformed.
- `npm test` — passed, 93/93 tests.
- `git diff --check` — passed with only Git line-ending notices.
- `npm run vendor:verify` — failed on the unchanged tracked
  `public/vendor/pyodide/pyodide.asm.js`: actual SHA-256
  `f4f3c6f756c779f073af1a6324b83d10fd11a10fbae70c942c32a05383670285`,
  manifest expected
  `1263f02b5b26099b96112378156f242dd98b39a8201ba7765e5fe3d455c5ce91`.
  The live WireViz/Graphviz runtime test passed, and this feature changes no
  vendor files.

## Manual verification

Chrome 154.0.8037.59 was used against the production build.

1. Set J1 primary part to Molex `123456` and added TE Connectivity `ABC123`
   (Drop-in) plus Amphenol `XYZ987` (Prototype only).
2. Added Alpha Wire primary/alternative data to the existing cable and to a new
   single-wire component.
3. Verified add/edit/duplicate/delete and alternative-note undo/redo.
4. Reloaded the application and confirmed IndexedDB autosave restored J1 and
   cable alternatives.
5. Copied the cable, changed the clone's alternative to `CLONE-ONLY`, and
   confirmed the original remained `ALT-001`.
6. Saved the cable to the User Library and inserted it with its alternative.
7. Exported project JSON and confirmed copied J1 alternatives had independent,
   unique internal IDs.
8. Exported WireViz YAML and confirmed Molex `123456` appeared while `ABC123`,
   `XYZ987`, and all alternative keys were absent.
9. Exported BOM CSV. J1 and J1_COPY, which had identical alternative sets,
   aggregated to quantity 2. The copied cable with a different alternative set
   remained separate from the otherwise identical primary cable row.
10. Exported HTML and confirmed connector/cable/wire detail data and the shared
    BOM alternatives column.
11. Confirmed J2, which had no alternatives, had no empty alternatives table.
12. Entered `<script>alert(1)</script> & approved` as an alternative note and
    confirmed the HTML contained escaped text and no executable script.
13. Opened the report directly from `file://`; inline SVG and print CSS loaded,
    no external resources were requested, and the console contained no errors.

Temporary browser profiles and downloaded verification files were removed.

## Known limitations

- Approved alternatives are WireForm-native and are intentionally lost through
  WireViz round-trip.
- Alternatives carry manufacturer, MPN, and note only; supplier/SPN and formal
  approval status/history are outside this version.
- A note difference is treated conservatively as a different approval set for
  BOM grouping.
- The pre-existing vendor checksum mismatch prevents `npm run vendor:verify`
  from passing even though build, tests, and the live runtime are green.
