# Native BOM CSV export implementation

## Summary

WireForm now provides a native, fully client-side BOM CSV export from the main editor toolbar. The export is built directly from the WireForm project model and does not invoke WireViz, Python, Graphviz, a backend, or any external service.

The BOM includes connector-like components, cables and wires, per-termination contacts, per-termination seals, and user-authored connector additional components. Identical parts are aggregated deterministically, designators use natural ordering, and CSV output is byte-stable for unchanged projects.

## Files changed

- `app/bom.ts` — BOM transformation, grouping, length normalization, deterministic sorting, CSV serialization, and filename generation.
- `app/HarnessStudio.tsx` — native BOM download action in the existing export toolbar.
- `tests/bom-export.test.mjs` — focused BOM and CSV tests.
- `tests/static-build.test.mjs` — verifies that the production bundle includes the BOM export action.
- `package.json` — includes the BOM tests in the normal test command.
- `README.md` — documents native BOM export and quantity behavior.
- `bom-export-implementation.md` — this implementation report.
- `bom-export-review.md` — review notes and follow-up considerations.

No project schema changes were required.

## BOM grouping rules

- Parts with an MPN are grouped by normalized category, manufacturer, MPN, description, and unit.
- When an MPN is absent, manufacturer and description provide the fallback identity so unrelated incomplete entries are not merged solely because their MPN is blank.
- Quantities are summed with decimal normalization to avoid visible floating-point artifacts.
- Designators are de-duplicated and naturally sorted, so values such as `X2` precede `X10`.
- Final rows use a stable category/manufacturer/MPN/description/unit/designator ordering.
- Repeated exports of an unchanged project produce identical CSV bytes.

## Contact handling

- The authoritative source is `TopologyLink.termination.contact` on valid physical connector-pin-to-conductor links.
- Each valid physical termination contributes one contact.
- Contacts are aggregated by actual part identity across all connectors and conductor ends.
- The designator identifies the physical termination, for example `X1:1`.
- Different contacts at opposite ends of one conductor remain distinct.
- Generated WireViz `additional_components` are not read, so WireViz contact synthesis cannot cause double-counting.
- A manually authored additional component that represents the same contact remains intentional BOM quantity and is added rather than silently deleted.

## Seal handling

- The authoritative source is `TopologyLink.termination.seal`.
- Each valid physical termination containing a seal contributes one seal.
- Seals aggregate independently from contacts and use the same physical termination designator.
- A seal can be exported even when that termination has no contact metadata.

## Wire and cable handling

- Cable and wire lengths are normalized to meters when a recognized length unit is supplied.
- Supported units include meters, centimeters, millimeters, kilometers, inches, feet, and yards, including common abbreviations.
- Identical cable/wire parts aggregate their modeled purchase lengths.
- A multiconductor cable contributes its cable length once; its length is not multiplied by conductor count.
- A bundle models grouped loose conductors, so its length is multiplied by `wireCount` when available.
- Missing or malformed length is not fabricated. The item is emitted as a piece quantity with an explanatory note.

## Additional-component handling

- User-authored connector `additionalComponents` are included directly from the project model.
- Explicit quantities and units are retained.
- Existing `pincount`, `populated`, and `unpopulated` quantity multipliers are resolved against the owning connector.
- Manual quantities are not discarded when they overlap a termination-derived part; this supports spares and intentional extras.
- The current implemented project schema has no project-level additional-BOM-item collection or BOM-exclusion flag, so no new schema was introduced for those concepts.

## CSV format

The exported columns are:

```text
Item,Category,Manufacturer,MPN,Description,Qty,Unit,Designators,Notes
```

- Fields containing commas, quotes, carriage returns, or line breaks are quoted.
- Embedded quotes are doubled according to CSV rules.
- Unicode is preserved, and a UTF-8 byte-order mark is included for spreadsheet compatibility.
- Rows use CRLF line endings.
- Internal part numbers fall back into the `MPN` column when no manufacturer MPN exists because the requested format has one part-number column.
- The filename is `<project-name>.bom.csv`, sanitized for common filesystems, with `wireform-harness.bom.csv` as the fallback.

## Tests added

The BOM test suite covers:

- one connector
- duplicate and different connector MPNs
- missing MPN behavior
- the same contact on several terminations
- mixed contact part numbers
- different contacts at both ends of one conductor
- seals with and without contacts
- projects with no termination metadata
- user-authored additional components and quantity multipliers
- prevention of WireViz-generated contact double-counting
- cable length aggregation and unit conversion
- multiconductor cable length behavior
- grouped loose-conductor bundle quantities
- missing and malformed lengths
- stable decimal formatting
- CSV comma, quote, newline, and Unicode handling
- deterministic row and designator order
- repeated byte-identical output
- legacy schema-version-2 projects
- filename sanitization and fallback
- empty BOM output

## Commands run

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm test` — passed; 31 tests passed, including the production Vite build and WireViz/Graphviz runtime coverage.
- `git diff --check` — passed.
- Live development server HTTP check at `http://127.0.0.1:4173/` — returned HTTP 200.
- `npm run vendor:verify` — failed on an existing Pyodide asset checksum mismatch: expected `1263f02b5b26099b96112378156f242dd98b39a8201ba7765e5fe3d455c5ce91`, actual `f4f3c6f756c779f073af1a6324b83d10fd11a10fbae70c942c32a05383670285`. The BOM implementation did not modify vendor assets.
- `npm audit --audit-level=high` — reported existing advisories in `brace-expansion` and `nanoid` (high) and `postcss` (moderate).

There is no formatter command configured in `package.json`.

## Build and test status

Type checking, linting, all 31 tests, and the production build pass. The native export is present in the live development build. The separate vendor checksum verification and dependency audit findings described above remain for repository maintenance.

## Known limitations

- Length parsing intentionally supports common explicit units, not arbitrary free-form dimensional expressions.
- Missing or malformed length is exported as pieces with a note rather than guessed.
- The existing model stores user-authored additional components on connector-like components; it does not currently expose a project-level miscellaneous BOM-item collection.
- Manual and termination-derived quantities with the same identity aggregate into one row, preserving total quantity but not their separate source labels.
- The UI action is intentionally a compact toolbar icon and does not provide a BOM preview or configuration dialog.
