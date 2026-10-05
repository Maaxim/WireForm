import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const images = await import("../app/images.ts");
const model = await import("../app/model.ts");
const report = await import("../app/html-report.ts");
const pdf = await import("../app/pdf-report.ts");
const bom = await import("../app/bom.ts");

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA";
const JPEG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2Q==";
const SAFE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z" /></svg>';

function harnessImage(id, dataUrl, values = {}) {
  return {
    id,
    dataUrl,
    mimeType: dataUrl.startsWith("data:image/png") ? "image/png" : "image/jpeg",
    width: 1,
    height: 1,
    ...values,
  };
}

function visit(value, callback) {
  if (value === null || value === undefined || typeof value === "function") return;
  callback(value);
  if (Array.isArray(value)) {
    for (const item of value) visit(item, callback);
  } else if (typeof value === "object") {
    for (const item of Object.values(value)) visit(item, callback);
  }
}

function findNodes(value, predicate) {
  const found = [];
  visit(value, (item) => {
    if (typeof item === "object" && !Array.isArray(item) && predicate(item)) {
      found.push(item);
    }
  });
  return found;
}

function allText(value) {
  const values = [];
  visit(value, (item) => {
    if (typeof item === "string" || typeof item === "number") values.push(String(item));
  });
  return values.join("\n");
}

test("legacy and empty projects normalize to an empty harness image collection", () => {
  const legacy = model.normalizeProject({
    schemaVersion: 3,
    title: "Legacy",
    components: [],
    links: [],
  }).project;
  assert.deepEqual(legacy.harnessImages, []);
  assert.deepEqual(model.createEmptyProject().harnessImages, []);
  const value = report.buildHarnessReportModel(legacy, SAFE_SVG);
  assert.deepEqual(value.harnessImages, []);
});

test("project round trip preserves embedded data, metadata, IDs, and explicit order", () => {
  const project = model.createEmptyProject("Image documentation");
  project.harnessImages = [
    harnessImage("image-2", JPEG, {
      originalFilename: "routing.jpg",
      title: "Harness routing",
      caption: "Route W12 behind the support bracket.",
      width: 1600,
      height: 900,
    }),
    harnessImage("image-1", PNG, {
      originalFilename: "installation.png",
      title: "Connector installation",
      caption: "X4 after final assembly.",
      width: 900,
      height: 1600,
    }),
  ];
  const serialized = model.serializeProjectFile(project);
  const reopened = model.parseProjectFile(serialized).project;
  assert.deepEqual(reopened.harnessImages, project.harnessImages);
  assert.deepEqual(reopened.harnessImages.map((image) => image.id), ["image-2", "image-1"]);
  assert.match(serialized, /data:image\/jpeg;base64/);
  assert.doesNotMatch(serialized, /blob:|file:\/\//);
});

test("history snapshots isolate add, metadata, reorder, replace, and delete data", () => {
  const project = model.createEmptyProject();
  const before = model.cloneProject(project);
  project.harnessImages.push(harnessImage("one", JPEG, { title: "One" }));
  const afterAdd = model.cloneProject(project);
  project.harnessImages[0].title = "Changed";
  project.harnessImages.push(harnessImage("two", PNG));
  project.harnessImages.reverse();
  project.harnessImages[0].dataUrl = JPEG;
  project.harnessImages.splice(1, 1);
  assert.deepEqual(before.harnessImages, []);
  assert.equal(afterAdd.harnessImages[0].title, "One");
  assert.equal(project.harnessImages[0].id, "two");
  assert.equal(afterAdd.harnessImages.length, 1);
});

test("shared image helpers accept JPEG/PNG and resize without upscaling or distortion", async () => {
  assert.equal(images.isAcceptedHarnessImageType("image/jpeg"), true);
  assert.equal(images.isAcceptedHarnessImageType("image/png"), true);
  assert.equal(images.isAcceptedHarnessImageType("image/webp"), false);
  assert.deepEqual(images.scaledImageDimensions(4000, 2000, 1920), {
    width: 1920,
    height: 960,
  });
  assert.deepEqual(images.scaledImageDimensions(640, 480, 1920), {
    width: 640,
    height: 480,
  });
  assert.throws(() => images.scaledImageDimensions(0, 480, 1920), /invalid dimensions/);
  assert.ok(images.approximateDataUrlBytes(PNG) > 0);

  const source = await readFile(new URL("../app/images.ts", import.meta.url), "utf8");
  assert.match(source, /imageOrientation:\s*"from-image"/);
  assert.match(source, /toDataURL\("image\/jpeg", options\.quality\)/);
  assert.match(source, /HARNESS_IMAGE_MAX_DIMENSION = 1_920/);
});

test("harness image validation identifies malformed data, duplicate IDs, and MIME mismatches", () => {
  const project = model.createEmptyProject();
  project.harnessImages = [
    harnessImage("same", JPEG, { title: "Good" }),
    harnessImage("same", PNG, { title: "Duplicate" }),
    { ...harnessImage("bad-mime", JPEG), mimeType: "image/png" },
    { ...harnessImage("missing", JPEG), dataUrl: "" },
    { ...harnessImage("dimensions", JPEG), width: 0 },
  ];
  const result = images.validateHarnessImages(project);
  assert.match(result.errors.join("\n"), /duplicates internal ID/);
  assert.match(result.errors.join("\n"), /inconsistent MIME/);
  assert.match(result.errors.join("\n"), /no embedded image data/);
  assert.match(result.errors.join("\n"), /invalid dimensions/);
});

test("normalization regenerates duplicate IDs and rejects unsafe or unsupported records", () => {
  const normalized = model.normalizeProject({
    schemaVersion: 3,
    title: "Normalize images",
    components: [],
    links: [],
    harnessImages: [
      harnessImage("duplicate", JPEG),
      harnessImage("duplicate", PNG),
      harnessImage("external", "https://example.com/image.jpg"),
      harnessImage("webp", "data:image/webp;base64,UklGRg=="),
    ],
  }).project;
  assert.equal(normalized.harnessImages.length, 2);
  assert.equal(normalized.harnessImages[0].id, "duplicate");
  assert.notEqual(normalized.harnessImages[1].id, "duplicate");
});

test("shared report model and HTML preserve order, escaping, embedding, and bottom placement", () => {
  const project = model.createEmptyProject("Safe images");
  project.notes = "Harness notes";
  project.harnessImages = [
    harnessImage("first", JPEG, {
      title: "<script>alert(1)</script>",
      caption: "Route & inspect <carefully>\nSecond line",
      originalFilename: "first.jpg",
    }),
    harnessImage("second", PNG, {
      title: "Second image",
      originalFilename: "second.png",
    }),
  ];
  const value = report.buildHarnessReportModel(project, SAFE_SVG);
  assert.deepEqual(value.harnessImages.map((image) => image.id), ["first", "second"]);
  const html = report.renderHarnessReportHtml(value);
  assert.match(html, /id="additional-images"/);
  assert.match(html, /href="#additional-images"/);
  assert.match(html, /data:image\/jpeg;base64/);
  assert.match(html, /data:image\/png;base64/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /Route &amp; inspect &lt;carefully&gt;\nSecond line/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>|src="(?:blob:|https?:|file:)/);
  assert.ok(html.indexOf('data-image-id="first"') < html.indexOf('data-image-id="second"'));
  assert.ok(html.indexOf('id="notes"') < html.indexOf('id="additional-images"'));
  assert.ok(
    html.indexOf('id="additional-images"') < html.lastIndexOf('<p class="report-footer">'),
  );
});

test("HTML omits the Additional Images section when the project has none", () => {
  const html = report.renderHarnessReportHtml(
    report.buildHarnessReportModel(model.createEmptyProject(), SAFE_SVG),
  );
  assert.doesNotMatch(html, /additional-images|Additional Images/);
});

test("PDF uses the shared ordered image list, starts a new page, and preserves fit", () => {
  const project = model.createEmptyProject("PDF images");
  project.harnessImages = [
    harnessImage("landscape", JPEG, {
      title: "Harness routing",
      caption: "Route W12 behind the support bracket.",
      width: 1600,
      height: 900,
    }),
    harnessImage("portrait", PNG, {
      title: "Connector installation",
      caption: "X4 after final assembly.",
      width: 900,
      height: 1600,
    }),
  ];
  const value = report.buildHarnessReportModel(project, SAFE_SVG);
  const definition = pdf.buildHarnessPdfDocument(value);
  const headings = findNodes(
    definition.content,
    (node) => node.text === "Additional Images",
  );
  assert.equal(headings.length, 1);
  assert.equal(headings[0].pageBreak, "before");
  const imageNodes = findNodes(definition.content, (node) => typeof node.image === "string");
  assert.deepEqual(imageNodes.map((node) => node.image), [JPEG, PNG]);
  assert.deepEqual(imageNodes.map((node) => node.fit), [[440, 400], [440, 400]]);
  assert.match(allText(definition.content), /Harness routing/);
  assert.match(allText(definition.content), /Connector installation/);

  const fallback = pdf.buildHarnessPdfDocument(value, { includeImages: false });
  assert.equal(findNodes(fallback.content, (node) => "image" in node).length, 0);
  assert.match(allText(fallback.content), /could not be embedded/);
});

test("UI is project-level and component exports, BOM, and libraries remain independent", async () => {
  const source = await readFile(new URL("../app/HarnessStudio.tsx", import.meta.url), "utf8");
  assert.match(source, /data-testid="open-harness-images"/);
  assert.match(source, /data-testid="harness-images-editor"/);
  assert.match(source, /multiple/);
  assert.match(source, /Move harness image/);
  assert.match(source, /Harness image replaced/);
  assert.match(source, /draft\.harnessImages\.push/);

  const project = model.createEmptyProject("Independent images");
  project.harnessImages = [harnessImage("image", JPEG)];
  const connector = model.makeComponent("connector", 1, "x1");
  project.components.push(connector);
  const rowsBefore = bom.buildBomRows(project);
  const copiedComponent = structuredClone(connector);
  project.components.push({ ...copiedComponent, id: "x2", designator: "X2" });
  assert.equal(project.harnessImages.length, 1);
  assert.equal(bom.buildBomRows(project).reduce((sum, row) => sum + row.quantity, 0), 2);
  assert.equal(rowsBefore.reduce((sum, row) => sum + row.quantity, 0), 1);
});
