# Twisted-pair implementation

## Summary

WireForm now models a twisted pair as a project-level relationship between two
existing, independent single-wire components. The relationship adds an editable
designator, optional pitch in millimetres, S/Z/unspecified direction, and notes.
It does not merge member wires or change their connections, terminations,
accessories, sourcing data, BOM quantities, or WireViz representation.

## Files changed

- `app/model.ts`: project-level `TwistedPair` data and legacy normalization.
- `app/twisted-pair.ts`: eligibility, creation, designator allocation,
  validation, copy remapping, lookup, and member-deletion helpers.
- `app/HarnessStudio.tsx`: inspector workflow, history-integrated edits,
  copy/paste and deletion integration, validation, and canvas badges.
- `app/globals.css`: compact pair editor and canvas-badge styling.
- `app/html-report.ts`: report model, wire-summary membership, and the
  Twisted Pairs section.
- `README.md`: user workflow and compatibility behavior.
- `tests/twisted-pair.test.mjs`: focused model, validation, persistence,
  copy/delete, BOM, HTML, and WireViz compatibility coverage.
- `tests/html-report.test.mjs`: updated cable report-model expectation.
- `tests/static-build.test.mjs`: production bundle UI assertions.
- `package.json`: includes the twisted-pair suite in `npm test`.

## Data model and eligibility

`HarnessProject.twistedPairs` stores `TwistedPair` objects with a stable ID,
editable designator, member component IDs, optional `twistPitchMm`, direction,
and optional note. Members refer to stable component IDs rather than editable
designators.

A new pair can be created only from exactly two distinct components whose kind
is `wire` and whose conductor count is one. Neither wire may already belong to
another pair. Designators are allocated using the first available natural
`TP<number>` value.

## UI workflow and canvas indication

Shift-selection or marquee selection of two eligible wires exposes **Create
twisted pair** in the inspector. Invalid two-component selections show the
specific eligibility reason and keep the action disabled. A member-wire
inspector shows its counterpart and provides fields for pair designator, both
members, pitch, direction, and notes, plus **Remove twisted pair**.

Each member has a small canvas badge containing the pair designator and pitch
when present. Both wires remain separately selectable and no graphical or
electrical connection is drawn between them.

## Persistence and compatibility

New and starter projects initialize `twistedPairs` to an empty array. Project
normalization gives legacy files without the field an empty array, so existing
schema-1, schema-2, and schema-3 files continue to load. Normal project JSON,
autosave/IndexedDB, and history snapshots already serialize or clone the whole
project, so the relationship participates in all of them.

The schema version remains 3 because the new top-level field is additive and
the existing normalizer supplies its default for older files.

## Delete, undo, redo, copy, and duplication

Deleting either member removes the relationship in the same project mutation
that removes the component and links. Undo restores the complete prior project
snapshot, including the member and pair; redo reapplies the deletion. Removing
only the relationship never removes either member.

The component clipboard includes a pair only when both members are in the
selection. Paste allocates a fresh pair ID and unique designator and remaps both
member references to the copied wires. Copying one member creates an unpaired
wire and cannot create a half-pair.

## Validation

The existing always-visible issue UI now includes twisted-pair results.
Validation reports errors for the wrong member count, duplicate member, missing
member, non-single-wire member, membership in multiple pairs, non-positive or
non-finite pitch, and duplicate pair designators. It warns about unequal parsed
lengths, unequal gauges, and a fully routed member paired with a member that has
an open end. Validation never silently changes wire length or gauge.

## WireViz and BOM behavior

The WireViz document builder is intentionally unchanged. It exports both
members as ordinary single wires with their existing connections and emits no
`twisted_pair`, `wire_groups`, or other custom key. WireViz import initializes
an empty project relationship list and does not infer pairs.

The native BOM builder is also unchanged. Member wires and their additional
components contribute exactly as before, and no pair-level purchasing row is
created.

## HTML report

The existing intermediate report model now contains naturally sorted pair rows.
The standalone report adds a **Twisted Pairs** table with pair, members, pitch,
direction, and notes. The cable/wire summary adds `Pair / counterpart`
membership. Existing HTML escaping handles pair designators, member
designators, and notes. The diagram remains the standard WireViz-generated SVG.

## Tests and commands

Commands run from the repository root:

- Type check: `node node_modules/typescript/bin/tsc --noEmit` — passed.
- Lint: `node node_modules/eslint/bin/eslint.js .` — passed.
- Focused tests: Node test runner for `tests/twisted-pair.test.mjs` — 11/11
  passed.
- Full validation: `npm test` — production build passed and 65/65 tests
  passed, including WireViz/GraphViz rendering.
- Production build: executed by `npm test`; Vite built the static application
  successfully.
- Formatter: the repository has no formatter script or configured formatter;
  `git diff --check` passed.
- Vendor integrity: `npm run vendor:verify` still reports the pre-existing
  checksum mismatch for `public/vendor/pyodide/pyodide.asm.js` (actual
  `f4f3c6...`, manifest `1263f0...`). `git diff --exit-code HEAD --` for that
  file passed, confirming this feature did not modify it.

## Manual Chrome verification

An isolated Chrome desktop session exercised the production build at
`http://127.0.0.1:4173/` with two 24 AWG, 220 mm WH/BU single wires. It verified:

- pair creation, pitch/direction/notes editing, member rename, autosave reload;
- copying both members creates a second pair, while copying one does not;
- deleting a member removes its pair and Undo restores both;
- BOM CSV and HTML report downloads;
- generated YAML contains both ordinary wires and no pair extension keys;
- downloaded HTML opens from `file://`, contains the pair and inline SVG,
  supports browser PDF rendering, makes no external requests, and logs no
  report errors.

Unequal-length/gauge warnings, malformed relationships, natural report sorting,
and malicious-note escaping are additionally covered by automated tests.

## Deliberate limitations

- Pair members are chosen at creation; changing members requires removing and
  recreating the relationship.
- The canvas uses compact badges on both members rather than a bracket spanning
  components that may be positioned far apart.
- User Libraries store individual component templates, so they intentionally
  do not contain project-level pair relationships.
- WireViz YAML cannot preserve the metadata and import cannot reconstruct it.
- Breakout lengths, impedance, automatic detection, triplets, star quad,
  shielded-pair modeling, and pair-level accessories remain out of scope.

