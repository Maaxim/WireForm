# Bi-color wire review

## Areas needing manual review

- Confirm the primary/secondary selector placement and preview size on narrower inspector widths.
- Confirm selection and hover emphasis remains clear on all supported primary colors, especially black, white, silver, and yellow.
- Exercise real User Library workflows in browsers with existing large libraries; the isolated Chrome verification used a new one-template library.
- Review printed HTML and PDF output on the organization's normal printers, including monochrome output.

## Unsupported and unknown color codes

Unknown/custom values are deliberately preserved and produce a warning. The editor shows an unsupported option and disables secondary editing until the user chooses a known primary. This prevents destructive rewriting but means unknown multi-code strings cannot be decomposed in the structured editor.

The parser currently supports exactly one or two standard WireViz two-letter color tokens. Future WireViz support for more elaborate markings should extend the shared parser rather than adding report-specific parsing.

## SVG rendering concerns

The interactive canvas uses two SVG paths for bi-color connections. The exported harness diagram continues to come from WireViz/Graphviz and was verified with `BUWH`, `WHBU`, and `GNYE`. The two visual systems intentionally use their native geometry, so stripe width is representative rather than a manufacturing measurement.

Very large or unusually complex WireViz SVGs remain subject to the established HTML sanitizer and pdfmake SVG support limitations; this feature did not add scriptable SVG content.

## PDF color and swatch concerns

PDF swatches are vector rectangles with a visible border and searchable text beside them. Narrow cells can wrap long display text, as seen for `Green / Yellow (GNYE)`, but no data is clipped. Organizations with strict drafting standards may want to tune the swatch dimensions or palette during design review.

The default pdfmake font and PDF renderer were exercised with this fixture, but printer color profiles and grayscale conversions can vary. Textual names/codes remain the authoritative accessible fallback.

## Very light color readability

White and other light fills use an outline in UI, HTML, and PDF. White-primary/blue-secondary was visibly distinct from blue-primary/white-secondary in the Windows Chrome/PDF checks. Monochrome reproduction should still be reviewed because some printers may reduce contrast.

## BOM grouping considerations

For wires without an MPN, color is included in fallback identity to prevent distinct variants from merging. For wires with an MPN, existing behavior treats manufacturer/MPN as authoritative and may aggregate different displayed colors if users assign the same MPN to them. That policy was retained deliberately; teams that encode spool color outside the MPN may prefer a future configurable grouping policy.

Color changes never alter procurement length or quantity.

## User Library and persistence considerations

No migration was required because the established `colors` array already stores the combined code. Library templates and copy/history snapshots already deep-clone that array. Normal save/load keeps stable data and does not add parallel primary/secondary fields.

The test fixture and automated tests cover project/library/copy round trips. Existing production IndexedDB stores should be spot-checked with representative legacy projects, although their solid codes follow the unchanged path.

## WireViz compatibility

Only standard combined codes are emitted; no custom YAML keys are introduced. WireViz import preserves order and does not infer a new model. The vendored WireViz 0.4.1 runtime successfully rendered the directional stripes.

`npm run vendor:verify` currently reports a checksum mismatch for `public/vendor/pyodide/pyodide.asm.js`. This predates and is unrelated to the bi-color changes, but the vendored checksum state should be reconciled before a supply-chain-sensitive release even though the live runtime integration test passes.

## Possible future improvements

- Support named/custom WireViz color definitions in the shared palette.
- Add structured editing for multi-conductor cable/bundle color lists without changing their serialized format.
- Add optional print-specific hatch/pattern differentiation for monochrome manufacturing documents.
- Add a palette legend to very large reports when many wire colors are present.
- Add support for future WireViz multi-marking semantics only after confirming the targeted WireViz schema.

## Production-use concerns

No feature-specific blocker was found: automated checks, runtime WireViz rendering, Chrome UI/export checks, offline HTML, and native PDF inspection all passed. The only repository-wide concern observed is the pre-existing vendored Pyodide checksum mismatch described above.

