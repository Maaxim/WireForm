# Harness Images review notes

## Areas needing manual review

- Exercise the Images inspector at narrower supported desktop sizes and with a
  collection near the 40-image model limit.
- Test IndexedDB recovery after a browser crash with a multi-megabyte project,
  not only normal reload.
- Inspect representative real manufacturing photos in both color and monochrome
  PDF printing. The automated/manual fixtures are deliberately high-contrast.
- Confirm the 1920 px / JPEG 0.85 balance on photos containing fine label text,
  pin callouts, and laser markings.

## JSON size and storage concerns

Base64 adds roughly one third over compressed binary size, and each exported
HTML embeds another copy. Normalization and hard admission limits prevent raw
phone originals from being stored, but a large collection can still produce a
large project and report. The UI displays approximate embedded size and warns
above 25 MB. Browser IndexedDB quota is implementation- and device-specific;
users should retain downloaded `.wireform.json` backups for image-heavy jobs.

The project parser now admits up to 90 MB so supported collections can be
reopened. This is intentionally higher than before and deserves memory testing
on lower-end production devices.

## Autosave and undo-history concerns

Autosave serializes the complete project. Current undo/redo also keeps up to 80
deep-cloned project snapshots. Image operations are correct and independent,
but editing title/caption character-by-character can retain many copies of the
same base64 strings. JavaScript engines may share immutable strings, but that is
not a contractual memory guarantee. A future history design could coalesce text
edits and store image blobs/content-addressed payloads separately without
changing the project-file format.

## Image quality, metadata, and orientation

Canvas re-encoding reliably strips source metadata and normalizes the tested
EXIF orientation-6 phone case. Other orientation values and older browser
fallback behavior merit device/browser coverage. The implementation depends on
modern browser decode behavior rather than carrying an EXIF parser.

PNG transparency is flattened to white. This is suitable for engineering
documentation and pdfmake compatibility but can be surprising for logos or
overlay artwork. The UI currently communicates normalization generically rather
than explicitly calling out transparency loss.

## PDF limitations

pdfmake can drop an oversized `unbreakable` group. The renderer therefore uses
a conservative 440 × 400 point fit verified with portrait and landscape images.
Very long titles/captions can still create awkward pagination; the image itself
will not be cropped. Image decoding failure invokes the existing all-graphics
fallback, so one corrupt image can cause the downloaded retry to omit the
diagram and other images while preserving engineering text. A future renderer
could preflight each raster independently and omit only the failing record.

The output images are intentionally raster content; the rest of the report and
harness diagram remain text/vector where supported.

## HTML limitations

Self-contained HTML size grows linearly with embedded image data. Browser file
URL behavior was verified in Chrome with no external requests. Other browsers
may impose different data-URL or document-size limits on exceptionally large
reports.

## Component and library separation

Harness Images live only on `HarnessProject`. Connector photos remain attached
to connector components and User Library connector templates. Copying or
duplicating connectors, wires, cables, bundles, or twisted pairs does not touch
the project image collection. If project templates are introduced later, their
image policy should be designed explicitly instead of extending ordinary
component libraries.

## Validation and malformed records

Normal project loading rejects unsafe/external data and regenerates duplicate
IDs before the interactive validator sees them. In-memory malformed records are
still reported. This is consistent with the current defensive normalization
style, but users opening a malformed file receive a safely reduced project
rather than a per-image repair UI.

## Production-use concerns

- The existing vendor verification command fails because the checked-in
  Pyodide JavaScript checksum does not match `vendor/manifest.json`. It predates
  and is unrelated to Harness Images, but should be reconciled before a release
  that requires reproducible vendor attestation.
- Run a quota/memory soak with realistic 25–50 MB image collections on the
  minimum supported Windows hardware.
- Consider coalesced metadata history before encouraging long narrative
  captions in image-heavy projects.

## Future improvements

- Content-addressed image storage within history/autosave to reduce duplicate
  memory, while retaining self-contained project export.
- Optional lossless PNG output when transparency is important and file size is
  acceptable.
- More granular per-image PDF preflight/fallback.
- Drag-to-reorder in addition to accessible Up/Down controls.
- Project-template support designed separately from component User Libraries.
- A project-size budget indicator incorporating all embedded connector and
  harness images.

