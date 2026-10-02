# Approved alternatives review

## Areas needing manual review

- Review the compact editor with unusually long manufacturer/MPN values and
  many alternatives on the smallest supported desktop width.
- Review printed reports with numerous cable/bundle alternative tables.
- Confirm organizational policy agrees that differing free-form approval notes
  must split BOM rows.
- Exercise production User Libraries created by older WireForm versions and all
  duplicate policies (`keep`, `replace`, and `skip`).

## BOM grouping risks

The grouping logic intentionally favors correctness over maximum consolidation.
Two otherwise identical primary items do not aggregate when their canonical
alternative sets differ. This prevents a combined row from claiming an
alternative is approved for designators where it is not.

Free-form note text participates in the canonical set. Therefore `Drop-in` and
`Drop in` produce separate rows even if a person considers the notes
equivalent. That is deliberate: WireForm does not perform fuzzy matching or
interpret approval language.

Alternatives are metadata on the primary row and never independent
contributions. A downstream consumer that ignores the new CSV column still
sees the correct primary part and quantity.

## Alternative canonicalization behavior

Canonical comparison trims leading/trailing whitespace and compares
manufacturer, MPN, and note case-insensitively. Entries are deduplicated and
sorted only inside the grouping key, so user-visible order and formatting are
preserved. Duplicate validation compares manufacturer/MPN without the note,
because two notes do not make the same substitute part physically distinct.

Manufacturer naming is not normalized beyond case and outer whitespace.
`TE Connectivity` and `TE` remain different. MPN punctuation is not removed.
These constraints avoid unsafe manufacturer equivalence and fuzzy MPN logic.

## User Library cloning concerns

Templates preserve alternative records. Insertion and canvas paste use
structured cloning and fresh IDs. Tests cover all eligible kinds, and browser
verification confirmed independent edits. Any future nested fields added to an
alternative should continue through `cloneApprovedAlternativesWithNewIds()`;
shallow copying would reintroduce shared mutable state.

Library template duplicate identity still uses the primary manufacturer/MPN,
matching existing behavior. Alternative-set differences do not make two
templates distinct under `replace` or `skip`; reviewers should confirm this is
the desired library-management policy before changing it.

## WireViz round-trip limitation

WireViz has no targeted standard structure for approved substitute lists.
WireForm exports only the primary manufacturer/MPN and does not place
alternatives in notes or custom YAML. WireViz import never infers alternatives.
The `.wireform.json` file must therefore remain the editable source of truth.

## Future approval-status possibilities

Potential future fields include approval state, applicable revision range,
approver, approval date, qualification document, and deprecation status. Those
would require explicit semantics and migration planning; free-form notes are
the intentionally small version-one representation.

## Possible future supplier/SPN alternatives

Supplier and supplier part number are not modeled per alternative. They could
be added later without replacing the primary-part model, but BOM grouping rules
would need a clear decision about whether sourcing-only differences split rows.
Distributor lookup, price, stock, lifecycle, and ERP/PLM integration remain out
of scope.

## Production-use concerns

- Build, lint, type checking, all 93 tests, live WireViz rendering, and Chrome
  offline-report verification pass.
- `npm run vendor:verify` still fails because the tracked Pyodide JavaScript
  checksum differs from the tracked manifest. This is unrelated to approved
  alternatives, but release engineering should reconcile it before requiring
  all repository integrity checks to be green.
- Empty alternatives are persisted so users can fix them and are reported as
  warnings. They format as blank metadata and do not affect quantity.
- Large alternative lists increase project, library, CSV, and HTML size, though
  normalization caps each component list at the repository's existing row
  limit.
