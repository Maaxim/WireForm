# Native BOM CSV export review

## Areas needing manual review

- Use the spreadsheet icon in the editor toolbar with a representative project and confirm that the browser downloads `<project-name>.bom.csv` without opening a modal.
- Open the file in the target spreadsheet application and confirm UTF-8 text, quoted multiline notes, and meter quantities display as expected.
- Confirm the procurement policy for bundle components. The implementation treats a bundle as grouped loose conductors and multiplies its modeled length by `wireCount`, while a multiconductor cable is counted only once.
- Confirm that exporting incomplete cable/wire rows as pieces with an explanatory note is preferable to omitting them.
- Review whether the compact icon is sufficiently discoverable; it has both an accessible label and a hover title.

## Possible double-counting edge cases

- WireViz-generated contact additions are not part of the project model and are not read by the BOM builder, so they are not double-counted.
- A user-authored additional component matching a per-termination contact or seal is deliberately retained and added. This may represent spares or an intentional extra quantity, but a user who manually entered termination counts before this feature may see a higher total until that manual data is reviewed.
- Additional components can use connector-derived quantity multipliers. If a user also models the same physical part explicitly elsewhere, both intentional sources contribute to the total.
- Grouping uses part identity plus category, description, and unit. Entries with the same MPN but conflicting descriptions or units remain separate so inconsistent source data is visible rather than silently merged.

## Legacy-project considerations

- No schema migration is required. Projects without termination metadata continue to load and export normally.
- Missing optional arrays and fields are handled defensively.
- Legacy cable/wire components without length export as one piece with a note; the exporter does not invent purchase length.
- Existing save/load, autosave, undo/redo, WireViz export, and termination behavior are unchanged because BOM export is a read-only transformation.

## Incomplete-data behavior

- Missing connector/component MPNs are still included and grouped using manufacturer and description fallback identity.
- A termination contact or seal with an internal part number but no MPN uses that part number in the CSV `MPN` column.
- A malformed or missing wire/cable length produces a piece quantity and an explanatory note.
- Termination metadata on dangling or otherwise invalid physical links is excluded by the existing physical-termination-link validation predicate.
- Rows with different incomplete identities are kept separate to avoid silently combining unrelated parts.

## Recommended future improvements

- Add an optional BOM preview and validation summary for incomplete parts or lengths without making export dependent on a modal.
- Add a distinct internal-part-number CSV column if downstream consumers need to distinguish PN from manufacturer MPN.
- Add project-level miscellaneous BOM items and explicit BOM-exclusion controls if those become first-class model features.
- Add configurable procurement rounding, stock-length allowances, and unit selection for manufacturing workflows.
- Add browser-level download automation once the project adopts an end-to-end test framework.
- Resolve the vendor checksum baseline and dependency audit findings described below.

## Production-use concerns

- `npm run vendor:verify` currently fails because the checked-in Pyodide asset hash differs from the manifest. This appears unrelated to the BOM change, but should be resolved before relying on the repository's full integrity gate.
- `npm audit --audit-level=high` reports two high-severity advisories (`brace-expansion` and `nanoid`) and one moderate advisory (`postcss`). These should be evaluated and upgraded where compatible.
- Procurement teams should confirm how they want missing lengths, bundle conductor quantities, and manually entered contact spares represented before using the CSV for purchasing without review.
- The browser download interaction has been validated through build/static coverage and a live HTTP response, but a final manual download/open-in-spreadsheet check is still recommended for the production browser matrix.
