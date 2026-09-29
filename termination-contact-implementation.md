# Termination/contact implementation

## Repository baseline

- Baseline HEAD: `56589872253f5da99119d843735977a89374efde`
- Final HEAD: unchanged; the implementation is present as working-tree changes
- The pre-existing untracked handoff file was preserved
- Project schema version: `2` to `3`

## Implemented behavior

WireForm now stores the selected termination hardware on the exact
`TopologyLink` between a connector-like pin and a cable/wire conductor end.
Each link may contain:

- contact type, subtype, internal PN, manufacturer, MPN, supplier, and SPN;
- an optional seal with the same part fields;
- optional strip length, tooling/applicator, and termination notes.

The connector inspector includes a compact **Pin terminations** list. Connected
pins show their conductor and contact, expand into the termination editor, and
support clearing the termination or copying the contact to every connected pin
on that connector. Unconnected pins remain visible but cannot be assigned link
metadata. Connector rows on the topology canvas show a small `T` badge when the
associated link has termination data.

Connection deletion removes its termination naturally. Reducing pin/wire counts,
disabling a shield, or changing a component between connector and cable groups
also removes links that would become invalid. A newly reconnected link starts
without termination data.

## Data model and persistence

`TopologyLink` gained optional `WireTermination` data. Project parsing now
normalizes nested termination values, drops unsupported/empty nested values,
and migrates schema-1/schema-2 projects to schema 3 without inventing contact
assignments.

Normal project download/open and IndexedDB/local-storage autosave already use
the common project serializer, so termination metadata follows those paths.
Undo/redo snapshots use a structured clone of the complete project. Copy/paste
uses an explicit link remapping helper that deep-copies nested termination data.

Connector-level WireViz `additional_components` imported from YAML are retained
as component compatibility data. They are kept distinct from exact per-link
assignments and are also normalized through component-library round trips.

## WireViz export and import

For each connector, export inspects valid pin-to-conductor links and groups
identical contacts and seals deterministically. The generated connector
`additional_components` entries use explicit `qty`; per-pin contacts never use
`qty_multiplier: populated`. Contact type defaults to `Crimp contact`, and seal
type defaults to `Wire seal` when those fields are omitted.

Supported part fields map directly to WireViz: `type`, `subtype`, `pn`,
`manufacturer`, `mpn`, `supplier`, and `spn`. Strip length, tooling, and notes
remain WireForm-native.

Existing connector-level additional components are emitted first. An exactly
matching manual component with a normal numeric quantity is combined with the
aggregated termination quantity to avoid duplicate BOM rows; components with a
quantity multiplier or other distinct fields remain separate.

WireViz import preserves supported connector-level additional components and
adds a compatibility warning that no per-pin assignments were inferred.

## Validation

- Termination data on a non-physical connector-pin/conductor-end link produces
  a warning.
- A strip length must be a positive numeric value with a common unit such as
  `5 mm`.
- Dangling or invalid link endpoints are project validation errors.
- Contacts remain optional; existing contact-free projects and workflows are
  unchanged.

## Files changed

- `app/model.ts`
- `app/termination.ts`
- `app/HarnessStudio.tsx`
- `app/globals.css`
- `app/wireviz-import.ts`
- `app/library.ts`
- `tests/project-data.test.mjs`
- `tests/static-build.test.mjs`
- `tests/wireviz-runtime.test.mjs`
- `README.md`
- `ARCHITECTURE.md`
- `termination-contact-implementation.md`
- `termination-contact-review.md`

`app/storage.ts` and `app/preview.worker.ts` required no changes because they
already persist/pass the complete serialized project and generated WireViz
document respectively.

## Tests added or updated

Automated coverage includes:

1. schema-1 and schema-2 legacy migration without termination data;
2. contact, seal, strip length, tooling, and notes save/load round-trip;
3. invalid nested termination input normalization;
4. different contacts at the two ends of conductors;
5. multiple pins sharing one contact;
6. mixed contacts on one connector and explicit aggregation quantities;
7. connector with no contact metadata;
8. manual additional-component preservation and practical de-duplication;
9. undo/redo snapshot isolation and copy/paste deep-copy behavior;
10. deletion/reconnection behavior;
11. malformed strip length and invalid-link validation;
12. WireViz import compatibility reporting;
13. production-build UI presence;
14. vendored WireViz and GraphViz runtime acceptance of contact components.

## Commands run

- `npm ci`: passed; 133 locked packages installed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: passed, including production build and all 14 tests.
- `npm run build`: passed as part of `npm test`.
- `npm run vendor:verify`: failed on a pre-existing checked-in Pyodide checksum
  mismatch. Expected `1263f02b...5ce91`; actual `f4f3c6f7...70285`. Git reports
  no working-tree modification to that asset.
- `npm audit --audit-level=high`: reported two high-severity advisories
  (`brace-expansion`, `nanoid`) and one moderate advisory (`postcss`) in the
  existing locked dependency tree.
- Formatter: no formatter command is configured in `package.json`.

## Deliberate limitations

- WireViz connector-level additional components are preserved but are not
  assigned to pins during import because explicit quantities are ambiguous.
- Imported/manual connector additional components are not given a new editor in
  this feature; the per-pin termination editor is the supported contact workflow.
- Applying a contact to all connected pins copies the contact part only. It does
  not overwrite pin-specific seals, strip lengths, tooling, or notes.
- No contact catalog, automatic gauge-based selection, or tooling database was
  introduced.
- A browser automation environment was not available for pointer-level manual UI
  testing; the production build and static/runtime tests cover the shipped code.
