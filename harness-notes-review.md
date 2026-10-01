# Harness notes review notes

## Areas needing manual review

- Confirm that the left-panel **Harness notes** entry is sufficiently prominent
  for the intended documentation workflow.
- Review textarea height and typography on the minimum supported desktop width.
- Confirm whether the repository-wide 4,000-character text limit is adequate
  for real manufacturing and revision documentation.
- Exercise long editing sessions to decide whether future history coalescing is
  desirable for textarea input.

## Project-schema considerations

The field is additive and normalized to an empty string for legacy files, so
the existing schema version remains 3. Exported new projects include `notes`
even when blank. Older WireForm builds may ignore the unknown property, but
round-tripping through an older build could discard it; the current
`.wireform.json` should remain the authoritative editable source.

## HTML escaping and security

Harness notes use the same centralized HTML escaping as all report-controlled
text and are never interpreted as markup. Newline presentation relies on CSS
`white-space: pre-wrap`; there is no HTML or Markdown parsing surface. The
report CSP continues to prohibit scripts, remote resources, connections, and
objects. Tests and Chrome verification cover script-like input and `&`, `<`,
and `>` escaping.

## Harness notes versus component notes

Harness notes document the complete project and appear once near the end of the
HTML report. Connector, cable/wire, termination, twisted-pair, accessory, and
BOM notes remain attached to their existing engineering contexts. The removal
applies only to the former top-level report `warnings` model and combined
**Notes / Validation** section.

Validation remains an interactive editor/design-checking system and is not
stored in harness notes or exported as report documentation. Users can copy an
issue into harness notes deliberately, but WireForm never does so implicitly.

## UI/UX considerations

The feature reuses the existing Harness inspector rather than introducing a new
modal or full application tab. This keeps project metadata together and leaves
the editor layout stable, but the canvas remains visible while writing. A
future dedicated documentation workspace could provide more room if user
testing shows the inspector is too narrow.

## Future Markdown or rich-text support

Plain text is intentional for version 1. If Markdown is later requested, it
should remain optional, use a tightly configured and sanitized renderer, retain
the original source text in project JSON, preserve deterministic output, and
receive separate CSP/security review. Rich text should not be introduced merely
for typed bullets and line breaks, which already render correctly.

## Production-use concerns

No feature-specific production blocker was found: lint, type checking, the full
71-test suite, production build, and Chrome offline-report verification pass.
The repository-wide vendor integrity check still reports an existing Pyodide
JavaScript checksum mismatch. The affected file is unchanged from `HEAD`, but
the manifest/file discrepancy remains a separate release-gate concern.

