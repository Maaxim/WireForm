# Native PDF report review notes

## Areas needing manual review

- Review several real production harnesses with unusually wide pin tables, very
  long MPNs, and dense connector images at normal print scale.
- Verify company-specific expectations for the cover/title block, margins,
  section order, and header wording.
- Exercise very large WireViz diagrams beyond the tested fixture to decide
  whether future multi-page diagram tiling would be useful.
- Test printed output on the organization's usual A4 printers as well as common
  PDF viewers.

## PDF and SVG limitations

The report sends the existing sanitized WireViz SVG directly to pdfmake. This is
vector-based and worked for the inspected WireViz output, but pdfmake supports a
practical subset of SVG/CSS. A construct introduced by a future WireViz or
Graphviz version may render differently. The graphics-degraded fallback avoids a
failed export, retains engineering data, and tells the user that graphics were
omitted.

The diagram currently fits a single landscape A4 page. It is never silently
clipped, but a very large harness can become small. Deliberate tiling or a larger
page-size option would be a future enhancement.

## pdfmake limitations encountered

- pdfmake's bundled browser font data is large, so it is lazy-loaded.
- Reliable embedded raster handling is restricted to PNG/JPEG data URLs in this
  implementation. WebP images are omitted.
- Page-break behavior is declarative. Very tall individual content rows may
  still produce less-than-ideal whitespace, so large real-world reports deserve
  continued visual regression review.
- The library controls final PDF serialization; byte-for-byte equality across
  library/browser versions is not guaranteed.

## Large-report performance

The 18-page manual fixture generated successfully in Chrome with no console
errors. The report model is built once and table cells do not recompute BOM or
termination maps. Initial PDF use downloads/parses the lazy pdfmake and font
chunks, so the first export is heavier than later exports. Very large embedded
images or hundreds of pages may increase memory pressure.

## Image-size concerns

Connector photos are stored as data URLs and embedded in the PDF. Large source
photos can materially increase project memory, PDF generation time, and file
size even though their display dimensions are constrained. Future work could add
an explicit image-size warning or an opt-in preprocessing step at image import.

## Pagination edge cases

Major sections deliberately start on new pages, table headers repeat, and large
tables may split naturally. Connector heading plus overview is kept together,
but the following pin table may start on the next page when space is limited.
Unusually long unbroken strings can still wrap poorly because automatic soft
hyphenation is not currently applied.

## Font and Unicode concerns

Bundled Roboto successfully rendered and exposed common engineering characters
and German text in the tested PDF. Scripts outside Roboto's glyph coverage may
show missing glyphs. Adding broader font coverage would increase the lazy font
payload and should be based on a concrete localization requirement.

## BOM and report-model maintenance

The key invariant is that `HarnessReportModel.bomRows` remains the only PDF BOM
input. Future PDF changes must not call `buildBomRows()` or derive quantities
from WireViz/HTML. Likewise, new engineering fields should first be mapped into
the shared report model so HTML and PDF remain aligned.

## Maintainability compared with HTML

The native PDF renderer intentionally has its own page layout and style objects;
it does not translate CSS. This is more code than browser printing but makes
pagination, repeated headers, orientation, and page numbering predictable. Data
mapping remains shared, while presentation-specific code stays isolated in
`pdf-report.ts` and `pdf-styles.ts`.

## Future enhancements

- Optional A3 or tiled-diagram output for very large harnesses.
- Per-section orientation/page-size controls based on measured table width.
- A progress indication for very large reports.
- Opt-in connector-image downsampling at import time.
- Additional bundled font coverage driven by localization needs.
- Structural PDF accessibility tagging if pdfmake gains suitable support.

## Production-use concerns

No PDF-specific blocker was found in automated or manual testing. Before a formal
document-release workflow, production owners should review organization-specific
title-block requirements and a representative set of the largest harnesses.

The repository's vendor verification currently reports a pre-existing Pyodide
checksum mismatch, and `npm audit` reports existing transitive development-tool
findings. Neither was introduced by pdfmake, but both should be resolved by the
project maintainers as separate dependency/vendor-maintenance work.
