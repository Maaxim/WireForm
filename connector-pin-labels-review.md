# Connector Pin Labels Review

## Areas needing manual review

- Check the compact five-column pin editor at the minimum supported inspector
  width and with connectors near the 64-pin limit.
- Verify keyboard tab order and screen-reader announcements in the preferred
  production browser set.
- Review unusually long, non-Latin, symbol-only, and right-to-left labels on the
  canvas and in print/PDF output.
- Exercise imported WireViz files produced by the exact deployed WireViz 0.4.1
  toolchain, especially partial `pinlabels` arrays.

## Partial `pinlabels` serialization

WireForm intentionally exports the complete positional array through
`pincount` whenever any label exists. Empty strings are retained as
placeholders. Removing interior empty entries would shift later labels to the
wrong physical pins, so this behavior must remain covered by regression tests.

## Duplicate-label considerations

Duplicate non-empty labels are warnings rather than errors. This supports real
connector markings but may make a human-facing label selector ambiguous. The
editor and reports always retain the physical number, and WireForm exports
numeric connection selectors. Importing an external connection that selects a
duplicate label follows the existing first-match behavior, so such source YAML
should be corrected or use numeric pins.

## WireViz round-trip concerns

Standard `pinlabels` round-trip without custom keys. WireForm does not emit a
mapping table and does not replace numeric topology identity. External WireViz
documents can also define custom `pins`; the existing importer maps those to
visual ordinal positions and reports that compatibility decision. That
pre-existing custom-pin path is separate from this label feature.

## Canvas readability

The numeric badge remains visible and the label occupies the row text. Tooltips
add physical pin, label, and signal. Very long labels can still be truncated by
the fixed node width; expanding node geometry was deliberately out of scope.

## Connector-library concerns

Templates deep-clone connector data, including the positional string array.
There are no per-label object IDs or shared mutable label objects. Future
first-class pin objects would require a deliberate migration and must retain
the current stable numeric topology keys.

## Production-use concerns

No feature-specific production blocker was found. All 132 automated tests and
the production build pass, and Chrome end-to-end verification completed without
console errors. The repository-wide vendor verification still reports a
pre-existing checksum mismatch for `public/vendor/pyodide/pyodide.asm.js`; this
feature did not modify vendored assets or their manifest, but release owners
should reconcile that separately before relying on the vendor-integrity check.

