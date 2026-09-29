# Native HTML harness report review

## Areas requiring manual review

- Review `app/html-report.ts` as the security boundary for all exported markup, especially the SVG tokenizer/allowlist and connector-image predicate.
- Confirm that blocking report export for structural validation errors matches the desired release workflow. Procurement warnings remain informational and are included in the report.
- Confirm terminology for connector `MPN`, internal `PN` fallback, cable `From`/`To`, and bundle/cable descriptions with the target manufacturing team.
- Review the toolbar document icon for discoverability alongside project JSON and BOM CSV icons.
- Exercise unusually large production harnesses in the supported Edge/Chrome/Firefox versions and with the organization's PDF print settings.

## Security and escaping considerations

- Project-controlled text is escaped at final rendering, including metadata, notes, designators, signal names, part fields, warnings, and image alt text.
- The report has no JavaScript and supplies a restrictive CSP that denies network, script, object, form, and base-URI behavior.
- Connector images are accepted only as embedded base64 JPEG/PNG/WebP data URLs. Invalid, blob, HTTP, HTTPS, and SVG image values are omitted.
- The CSP deliberately allows inline style because the report's complete stylesheet is embedded in the file. It does not allow external styles.
- Any future addition of raw markup fields, Markdown rendering, interactive script, SVG uploads, or additional image MIME types must be reviewed against these boundaries rather than interpolated directly.

## SVG concerns

- The sanitizer reconstructs the generated SVG from explicit allowed elements and attributes; it rejects rather than strips unknown active content.
- Current real WireViz/Graphviz output was tested, including `xml:space`, `xmlns:xlink`, and embedded connector images.
- Event attributes, style attributes/elements, scripts, `foreignObject`, unsafe declarations, external image URLs, JavaScript URLs, and URL-bearing non-image attributes are rejected.
- This safety policy is intentionally coupled to the current renderer's output vocabulary. After upgrading Graphviz or `@viz-js/viz`, run a real connector-image report export and review any proposed allowlist addition carefully.
- The SVG namespace string contains the standard `http://www.w3.org/2000/svg` identifier. It is a namespace identifier, not an external resource request; offline Edge verification confirmed no HTTP(S) requests.

## Large-report and file-size concerns

- Every connector photo is embedded in both its connector section and, where WireViz includes it, the SVG diagram. The same base64 payload can therefore appear twice and increase file size.
- WireForm already normalizes uploaded photos and limits persisted image/project sizes. No additional recompression or deduplication was introduced.
- Very large harnesses can create wide SVGs and long pin/BOM tables. The report remains correct, but browser memory, Blob download, and print pagination limits are browser-dependent.
- A future optimization could reference one embedded image payload from a CSS custom mechanism, but that would add complexity and should not weaken the current self-contained security model.

## Renderer determinism limitations

- Report-model and HTML rendering order are deterministic, and no timestamp or random identifier is added.
- The generated SVG is supplied by the existing WireViz/Graphviz toolchain. The current version was stable in repeated tests, but upgrades may legitimately alter element ordering, numeric geometry, comments, or identifiers.
- The implementation does not perform fragile ID or geometry rewriting merely to normalize third-party SVG output.

## Print-layout limitations

- CSS print pagination is ultimately browser-controlled. The implementation repeats table headers and avoids breaking rows, metadata, images, and compact notes where supported.
- Connector cards after the first prefer new pages. A connector with a very large pin table must still span pages.
- The diagram is capped to a print-page height. Extremely wide, detailed harnesses may be legible only with landscape orientation or a larger paper size selected by the user.
- Edge's generated PDF was structurally validated and the equivalent print-media view was visually inspected. Automated headless screenshots of the installed Edge/Chrome PDF viewer were blank because the viewer plugin did not paint in that mode.

## Legacy-project considerations

- No schema change is required. Schema-1/schema-2 projects continue through existing normalization.
- Projects without termination metadata display connector/cable/pin information and an explicit empty termination message.
- Missing manufacturer, MPN, length, notes, and images are rendered as omitted metadata or neutral empty cells; values are not invented.
- Invalid legacy image sources are omitted rather than exported as broken or network-dependent links.
- The BOM continues to use `buildBomRows()`, so legacy incomplete-length behavior exactly matches native CSV export.

## Recommended future improvements

- Add browser-level export coverage to continuous integration if the project adopts Playwright or another maintained end-to-end framework.
- Add optional landscape/portrait report controls only if real manufacturing reports demonstrate a recurring need.
- Consider an explicit project document number/author/part-number model if those become first-class project metadata; do not infer them from component data.
- Consider displaying connector-level manual additional components below connector metadata for assembly context while retaining the shared BOM as the sole quantity calculation.
- Measure and warn about unusually large output before Blob creation if production projects approach practical browser limits.
- Resolve the vendored Pyodide checksum mismatch so the repository's integrity check returns green.

## Production-use concerns

- `vendor:verify` still fails because the checked-in Pyodide JavaScript hash differs from `vendor/manifest.json`. The HTML-report work did not modify either file, and full WireViz runtime tests pass, but the integrity baseline should be reconciled before release.
- The report export depends on successful local WireViz/Pyodide initialization at generation time. A runtime startup failure prevents export rather than producing documentation without a diagram.
- The strict SVG allowlist is safer than permissive embedding, but it must be part of the review checklist whenever the rendering stack changes.
- Procurement/manufacturing users should still review warnings and incomplete part data before treating the generated report or BOM as a released build document.
