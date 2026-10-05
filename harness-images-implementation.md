# Harness Images implementation

## Implementation summary

WireForm now supports ordered, project-level Harness Images for assembly,
routing, installation, and manufacturing documentation. Users can open the
Harness Images view without selecting a component, add several JPEG/PNG files
in one operation, edit optional titles and captions, replace or delete images,
and move images up or down. The normalized image bytes are embedded in the
editable project and the same ordered report data is rendered at the bottom of
both HTML and PDF reports.

Harness Images are independent from connector photos and component User
Libraries. Component copy/paste and duplication do not copy this project-level
collection.

## Files changed

- `app/model.ts` — shared `HarnessImage` model, IDs, safe data-URL validation,
  legacy normalization, limits, and project serialization support.
- `app/images.ts` — shared connector/harness raster decode and canvas pipeline,
  harness-image preparation, size calculation, and validation.
- `app/HarnessStudio.tsx` — project Images navigation/view, batch upload,
  metadata editing, replacement, deletion, ordering, storage display, history,
  and project validation integration.
- `app/globals.css` — compact gallery/editor styling.
- `app/html-report.ts` — ordered shared report images and self-contained
  Additional Images section.
- `app/pdf-report.ts` — final page-oriented Additional Images section using the
  shared report model.
- `tests/harness-images.test.mjs` — focused model, persistence, validation,
  report, and integration coverage.
- `tests/static-build.test.mjs` — production bundle assertions for the UI and
  report action.
- `scripts/browser-harness-images-smoke.mjs` — repeatable Chrome/CDP workflow
  covering upload, history, autosave, downloads, and offline HTML.
- `package.json` — includes the new focused suite in `npm test`.
- `README.md` — user-facing workflow, format, storage, report, and component
  image distinction.

## Data model

`HarnessProject.harnessImages` is an ordered array of `HarnessImage` records:

```ts
interface HarnessImage {
  id: string;
  dataUrl: string;
  mimeType: "image/jpeg" | "image/png";
  originalFilename?: string;
  title?: string;
  caption?: string;
  width: number;
  height: number;
}
```

Normal UI imports currently normalize to JPEG, although PNG data URLs remain a
valid project/report representation for compatibility. Array position is the
only ordering mechanism. Legacy projects receive an empty array during normal
loading, so no project schema bump was necessary.

Normal loading enforces 40 images, 16 million data-URL characters per image,
and 60 million total image data-URL characters. The project parser limit was
raised from 25 MB to 90 MB to accommodate the supported embedded collection.
Duplicate or missing image IDs are regenerated during normalization. External,
blob, filesystem, WebP, SVG, or malformed image references are not admitted to
normalized project state.

## Shared image helpers and normalization

The former connector-photo implementation was refactored around one shared
raster preparation path. Connector behavior remains 720 px, JPEG quality 0.84,
and JPEG/PNG/WebP input. Harness Images use:

- JPEG and PNG input only;
- 25 MB maximum source file;
- 1920 px maximum longest edge;
- no upscaling;
- aspect-ratio-preserving dimensions;
- JPEG quality 0.85;
- a white canvas background (transparent PNG areas become white);
- approximately 12 MB maximum normalized data per image.

Browser decoding prefers `createImageBitmap(file, { imageOrientation:
"from-image" })`; the fallback uses the browser's oriented `Image` decode.
Drawing and re-encoding through canvas bakes orientation into the pixels and
does not carry source EXIF metadata, including GPS/camera fields, into the
stored JPEG.

## Persistence and undo/redo

Only stable data URLs and scalar metadata enter project state; no `File`, blob
URL, object URL, or local path is persisted. Existing project serialization is
also the source for downloads, IndexedDB autosave, and local-storage fallback,
so Harness Images participate in each path automatically.

Every add batch, replace, delete, and reorder is one normal project history
commit. Title and caption edits use the same immediate history behavior as the
existing harness/component metadata fields. Undo/redo therefore restores both
the image bytes and metadata. This deliberately follows the current snapshot
history architecture rather than introducing an image-specific history store.

## UI workflow and ordering

The Build sidebar now has **Harness images** beside **Harness notes**. It opens
a project-level inspector and clears component selection. The view provides:

- a multiple-file Add images control;
- one large contained preview per record;
- original filename, normalized dimensions, and MIME display;
- optional title and multiline caption fields;
- Up/Down, Replace, and Delete controls;
- approximate embedded storage usage;
- per-file failure reporting, while valid files from the same batch are kept.

Explicit array order controls the UI, HTML, and PDF sequence. Filename and title
are never used to reorder the collection.

## Report-model integration

`HarnessReportModel` now contains an ordered `ReportHarnessImage[]`. The report
builder accepts only validated embedded JPEG/PNG data and builds this list once.
HTML and PDF consume that same list rather than walking raw project state or
implementing separate sorting/filtering rules.

## HTML implementation

When at least one Harness Image exists, a self-contained **Additional Images**
section is emitted after Harness Notes and immediately before the report
footer. Each item uses a large, contained, uncropped embedded image, an optional
heading, and an optional pre-wrapped caption. The section and table-of-contents
link are omitted when no images exist. Print CSS begins the image section on a
new page and avoids breaking normal image groups where practical.

Titles, captions, IDs, alt text, and data URLs all use the existing HTML escape
path. Only report-model-approved embedded image URLs can reach `<img src>`.
There are no external files or network origins.

## PDF implementation

The native pdfmake renderer appends **Additional Images** after all existing
content and forces the section onto a new page. Raster images use a 440 × 400
point `fit`, preserving aspect ratio without cropping or stretching and leaving
room for title, caption, header, footer, and margins. Normal groups are kept
together. A smaller fit was selected after real rendering found that an
unbreakable 500-point portrait group could be dropped by pdfmake when its other
content exceeded the usable page body.

If pdfmake rejects an embedded graphic, the existing graphics fallback still
downloads a valid engineering PDF with placeholders and a user-visible warning
instead of crashing the export.

## Size and error handling

The editor displays approximate embedded image storage. Validation reports
missing data/IDs, duplicate IDs, unsupported or inconsistent MIME data, and
invalid dimensions; it warns above approximately 25 MB of embedded image data.
Unsupported or corrupt upload files show a visible filename-specific message.
In a batch, successfully decoded files are added even when another file fails.

## Tests added

The focused suite covers legacy/empty projects, ordered persistence, IDs and
metadata, cloned history isolation, accepted formats, resize/no-upscale/aspect
logic, orientation/re-encode implementation, validation, unsafe record
normalization, shared report-model ordering, HTML embedding/escaping/placement,
PDF page break/fit/fallback, UI presence, and independence from BOM/component
duplication. Production static-bundle assertions cover the user-visible Images
view and report section. Existing connector photo, HTML, PDF, BOM, WireViz,
accessory, alternatives, twisted-pair, notes, termination, and wire-color suites
remain in the full regression run.

## Commands run and results

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm test` — passed: production build plus 120 tests.
- `npm run build` — passed as part of `npm test`; Vite transformed 1,658
  modules. Existing large-chunk warnings remain for the lazy PDF/font and
  preview-worker assets.
- `node scripts/browser-harness-images-smoke.mjs ...` — passed in Chrome with
  no console errors or external report resources.
- Ghostscript `txtwrite` plus 110-DPI page rendering — generated and inspected
  all 9 PDF pages; the final three pages contain all three ordered image groups.
- `npm run vendor:verify` — still fails on the pre-existing
  `public/vendor/pyodide/pyodide.asm.js` checksum mismatch (actual
  `f4f3c6…70285`, manifest `1263f0…ce91`). This task did not modify vendor
  assets or the manifest.

## Manual verification performed

Chrome on Windows was tested with:

1. a 4000 × 2000 landscape JPEG;
2. a raw 4000 × 2000 JPEG carrying EXIF orientation 6, displayed/stored as a
   960 × 1920 portrait;
3. a 640 × 480 PNG with no title/caption;
4. an unsupported GIF in the same batch.

The three supported files were retained and the GIF produced a clear message.
The large images normalized to 1920 on their longest displayed edge, the small
PNG was not upscaled, and all three stored as embedded JPEG data. Titles,
multiline captions, replacement, deletion, reorder, undo/redo, IndexedDB reload,
and connector-photo independence were verified. The exported project contained
three ordered records and no blob/filesystem URLs; WireViz YAML contained no
harness image data. Standalone `file://` HTML contained three embedded images
at the bottom, preserved order, made no network requests, and rendered a
malicious-looking caption as text. The PDF downloaded directly, rendered all
three groups on pages 7–9 without clipping/distortion, and exposed the titles
and captions as searchable text. Project JSON was about 143 kB for these
fixtures after normalization.

## Known limitations

- Transparent PNG pixels are flattened onto white because all normal imports
  are re-encoded as JPEG.
- IndexedDB quotas vary by browser/device; the model's limits cannot guarantee
  that every supported maximum collection fits every private/quota-constrained
  browser profile.
- History currently snapshots the full project, so repeated edits to projects
  containing many large images can consume substantial memory.
- PDF page composition uses a conservative fixed fit. It does not offer a user
  crop or full-bleed layout.
- WebP, GIF, HEIC/HEIF, and user-uploaded SVG are intentionally unsupported.

