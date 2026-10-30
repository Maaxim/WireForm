import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import YAML from "yaml";
import * as files from "../app/project-files.ts";
import * as model from "../app/model.ts";
import * as bom from "../app/bom.ts";
import * as report from "../app/html-report.ts";
import * as pdf from "../app/pdf-report.ts";
import * as onshape from "../app/onshape-export.ts";
import * as library from "../app/library.ts";
import * as terminations from "../app/termination.ts";
import * as accessories from "../app/additional-components.ts";
import * as pins from "../app/pin-labels.ts";
import * as shields from "../app/shield-routing.ts";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><path d="M0 25L100 25" /></svg>';
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA", "base64");
const source = await readFile(new URL("../app/HarnessStudio.tsx", import.meta.url), "utf8");

function attachment(name = "Reference.bin", content = Uint8Array.from([0, 255, 128, 13, 10, 34]), type = "application/octet-stream") {
  return files.prepareProjectAttachment(new File([content], name, { type }));
}

function reopen(project) { return model.parseProjectFile(model.serializeProjectFile(project)).project; }

test("legacy schema-4 and empty projects have no required attachment property", () => {
  const project = model.createEmptyProject();
  const restored = reopen(project);
  assert.equal(restored.schemaVersion, 4);
  assert.deepEqual(restored.attachments ?? [], []);
  assert.equal(Object.hasOwn(restored, "attachments"), false);
});

for (const [filename, bytes, mime] of [
  ["Reference.png", PNG, "image/png"],
  ["Reference.jpg", Buffer.from([255, 216, 255, 224, 0, 17, 0, 255, 217]), "image/jpeg"],
  ["Connector_Datasheet.pdf", Buffer.from("%PDF-1.7\n%binary\0\xff\n%%EOF"), "application/pdf"],
  ["Cable_Calculations.xlsx", Buffer.from([80, 75, 3, 4, 255, 0, 13, 10]), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["Archive.zip", Buffer.from([80, 75, 3, 4, 0, 0, 254, 127]), "application/zip"],
  ["Manufacturing_Instructions.docx", Buffer.from([80, 75, 3, 4, 1, 255]), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["Arbitrary.bin", Uint8Array.from({ length: 256 }, (_, index) => index), "application/octet-stream"],
]) {
  test(`${filename}: add → native save → reopen → download preserves every original byte`, async () => {
    const added = await attachment(filename, bytes, mime);
    added.description = "Internal engineering reference – µ-version";
    const project = model.createEmptyProject();
    project.attachments = [added];
    const loaded = reopen(project).attachments[0];
    assert.deepEqual(loaded, added);
    const downloaded = new Uint8Array(await (await files.projectAttachmentDownloadBlob(loaded)).arrayBuffer());
    assert.deepEqual(downloaded, new Uint8Array(bytes));
    assert.equal(loaded.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(loaded.filename, filename);
    assert.equal(loaded.mimeType, mime);
    assert.equal(loaded.sizeBytes, bytes.length);
  });
}

test("duplicate filenames coexist by stable ID, and Save As / clones preserve files independently", async () => {
  const first = await attachment("same.bin");
  const second = await attachment("same.bin", new Uint8Array([33]));
  const project = model.createEmptyProject();
  project.attachments = files.addProjectAttachments([], [first, second]);
  assert.notEqual(first.id, second.id);
  const duplicate = model.cloneProject(project);
  duplicate.title = "Save As / duplicate";
  duplicate.attachments[0].description = "Separate clone metadata";
  assert.equal(project.attachments[0].description, undefined);
  assert.deepEqual(reopen(duplicate).attachments, duplicate.attachments);
  assert.equal(duplicate.attachments[0].data, first.data);
});

test("rename and description edits preserve binary identity, checksum, MIME and size", async () => {
  const original = await attachment("Original.xlsx");
  const updated = files.updateProjectAttachment([original], original.id, { filename: "Calculations.xlsx", description: "Voltage drop" })[0];
  assert.deepEqual(updated, { ...original, filename: "Calculations.xlsx", description: "Voltage drop" });
  assert.equal(original.filename, "Original.xlsx");
  assert.throws(() => files.updateProjectAttachment([original], original.id, { filename: "C:\\private\\file.bin" }), /filename/);
});

test("replacement preserves ID/description and only commits successfully prepared data", async () => {
  const original = { ...await attachment(), description: "Important notes" };
  const replacement = await attachment("New.pdf", Buffer.from("%PDF-1.7\n"), "application/pdf");
  const result = files.replaceProjectAttachment([original], original.id, replacement);
  assert.equal(result[0].id, original.id);
  assert.equal(result[0].description, original.description);
  assert.equal(result[0].addedAt, original.addedAt);
  assert.equal(result[0].filename, replacement.filename);
  assert.equal(result[0].data, replacement.data);
  assert.equal(result[0].sha256, replacement.sha256);
  const before = JSON.stringify(original);
  const failed = { size: 10, name: "broken.bin", arrayBuffer: async () => { throw new Error("Read failed"); } };
  await assert.rejects(files.prepareProjectAttachment(failed), /Read failed/);
  assert.equal(JSON.stringify(original), before);
  assert.throws(() => files.replaceProjectAttachment([original], original.id, { ...replacement, sizeBytes: files.MAX_ATTACHMENT_SIZE + 1 }), /Maximum attachment size/);
  assert.equal(JSON.stringify(original), before);
});

test("size limits are checked before reading and account for replacement credits", async () => {
  let read = false;
  await assert.rejects(files.prepareProjectAttachment({ name: "huge.bin", size: files.MAX_ATTACHMENT_SIZE + 1, arrayBuffer: async () => { read = true; } }), /Maximum attachment size/);
  assert.equal(read, false);
  const metadata = Array.from({ length: 5 }, (_, index) => ({ id: `file-${index}`, sizeBytes: files.MAX_ATTACHMENT_SIZE }));
  assert.throws(() => files.assertProjectFilesFit(metadata, [{ name: "extra.bin", size: 1 }]), /Maximum total/);
  assert.doesNotThrow(() => files.assertProjectFilesFit(metadata, [{ name: "replacement.bin", size: files.MAX_ATTACHMENT_SIZE }], "file-0"));
});

test("valid existing over-limit data loads intact with actionable warnings", () => {
  const data = Buffer.alloc(files.MAX_ATTACHMENT_SIZE + 1, 97).toString("base64");
  const raw = Array.from({ length: 6 }, (_, index) => ({
    id: `oversize-${index}`, filename: "old.bin", mimeType: "application/octet-stream", sizeBytes: files.MAX_ATTACHMENT_SIZE + 1, data,
  }));
  const loaded = files.normalizeProjectAttachments(raw);
  assert.equal(loaded.length, 6);
  assert.equal(loaded[0].data, data);
  assert.equal(files.projectAttachmentLimitWarnings(loaded).length, 7);
});

test("malformed Base64, size/checksum metadata and duplicate IDs cannot silently discard files", async () => {
  const original = await attachment();
  for (const invalid of [
    { ...original, data: "%%%%" }, { ...original, data: "AA=A" },
    { ...original, data: "AB==", sizeBytes: 1 },
    { ...original, sizeBytes: original.sizeBytes + 1 },
    { ...original, sha256: "invalid" }, { ...original, filename: "/private/data" },
  ]) {
    const project = model.createEmptyProject(); project.attachments = [invalid];
    assert.throws(() => reopen(project), /Project file/);
  }
  assert.throws(() => files.normalizeProjectAttachments([original, original]), /duplicate attachment ID/);
  assert.throws(() => files.normalizeProjectAttachments({}), /array/);
  assert.equal(files.normalizeProjectAttachments([{ ...original, mimeType: 'text/html\nunsafe' }])[0].mimeType, "application/octet-stream");
  await assert.rejects(files.projectAttachmentDownloadBlob({ ...original, sha256: "0".repeat(64) }), /checksum mismatch/);
});

test("safe previews use binary signatures, plain text, and release object URLs", async () => {
  const revoked = [];
  const revoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (url) => { revoked.push(url); revoke(url); };
  try {
    for (const [name, bytes, type, kind] of [
      ["picture.png", PNG, "image/png", "image"],
      ["picture.jpg", new Uint8Array([255, 216, 255]), "image/jpeg", "image"],
      ["picture.webp", Buffer.from("RIFF0000WEBPbinary"), "image/webp", "image"],
      ["document.pdf", Buffer.from("%PDF-1.7\n"), "application/pdf", "pdf"],
      ["notes.txt", Buffer.from('<script>globalThis.executed=true</script>'), "text/plain", "text"],
      ["mapping.csv", Buffer.from("one,two\r\n1,2"), "text/csv", "text"],
      ["document.xlsx", Buffer.from("PK\0binary"), "application/zip", "download"],
      ["attack.svg", Buffer.from('<svg onload="alert(1)"/>'), "image/svg+xml", "download"],
      ["fake.png", Buffer.from('<html><script>alert(1)</script></html>'), "image/png", "download"],
      ["unknown.bin", new Uint8Array([0, 255, 12]), "application/octet-stream", "download"],
    ]) {
      const preview = files.createProjectFilePreview(await attachment(name, bytes, type));
      assert.equal(preview.kind, kind);
      if (kind === "text") assert.equal(preview.text, Buffer.from(bytes).toString("utf8"));
      if (preview.url) assert.ok(preview.url.startsWith("blob:"));
      const count = revoked.length;
      preview.dispose(); preview.dispose();
      assert.equal(revoked.length, count + (preview.url ? 1 : 0));
    }
    assert.equal(globalThis.executed, undefined);
  } finally { URL.revokeObjectURL = revoke; }
});

test("text preview is bounded while download retains the full original", async () => {
  const bytes = Buffer.alloc(1024 * 1024 + 10, 97);
  const file = await attachment("large.txt", bytes, "text/plain");
  assert.match(files.createProjectFilePreview(file).text, /Preview truncated/);
  assert.equal((await files.projectAttachmentDownloadBlob(file)).size, bytes.length);
});

function harness() {
  const project = model.createEmptyProject("Project files isolation");
  const left = model.makeComponent("connector", 1, "j1");
  const right = model.makeComponent("connector", 2, "j2");
  const wire = model.makeComponent("wire", 1, "w1");
  project.components = [left, right, wire];
  project.links = [
    { id: "left", from: { nodeId: left.id, portId: "pin:1", side: "right" }, to: { nodeId: wire.id, portId: "wire:1", side: "left" } },
    { id: "right", from: { nodeId: wire.id, portId: "wire:1", side: "right" }, to: { nodeId: right.id, portId: "pin:1", side: "left" } },
  ];
  project.harnessImages = [{ id: "report-image", title: "Harness photo retained", dataUrl: `data:image/png;base64,${PNG.toString("base64")}`, mimeType: "image/png", width: 1, height: 1 }];
  return project;
}

// Exercise the real existing WireViz builder without mounting the React editor.
function wirevizBuilder() {
  const builder = source.slice(source.indexOf("export function buildWireVizDocument"), source.indexOf("function validateProject"));
  const js = ts.transpileModule(builder, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const deps = {
    CONNECTOR_KINDS: model.CONNECTOR_KINDS, CABLE_KINDS: model.CABLE_KINDS,
    naturalSort: bom.naturalCompare, pinLabelsForCount: pins.pinLabelsForCount,
    parseLoops: () => [], collectConnectorAdditionalComponents: terminations.collectConnectorAdditionalComponents,
    listForCount: (values, count, fallback) => Array.from({ length: count }, (_, index) => values[index] || fallback),
    additionalComponentToWireViz: accessories.additionalComponentToWireViz,
    oppositePort: (link, id) => link.from.nodeId === id ? link.to : link.from,
    parsePortNumber: (port) => Number(port.split(":")[1]),
    buildWireVizShieldConnections: shields.buildWireVizShieldConnections,
  };
  const exports = {};
  new Function("exports", ...Object.keys(deps), js)(exports, ...Object.values(deps));
  return exports.buildWireVizDocument;
}

test("native project alone includes Project Files; every manufacturing export and library excludes them", async () => {
  const project = harness();
  const buildWireviz = wirevizBuilder();
  const before = {
    html: report.renderHarnessReportHtml(report.buildHarnessReportModel(project, SVG)),
    pdf: JSON.stringify(pdf.buildHarnessPdfDocument(report.buildHarnessReportModel(project, SVG))),
    bom: bom.serializeBomCsv(bom.buildBomRows(project)),
    onshape: onshape.serializeOnshapeCableWireCsv(onshape.buildOnshapeCableWireExport(project).rows),
    yaml: YAML.stringify(buildWireviz(project)),
  };
  project.attachments = await Promise.all([
    attachment("Cable_Calculations.xlsx"), attachment("Connector_Datasheet.pdf"),
    attachment("Confidential_Notes.txt"), attachment("Assembly_Reference.jpg"),
  ]);
  project.attachments.forEach((file) => { file.description = "CONFIDENTIAL-PROJECT-FILES-ONLY"; });
  const reportModel = report.buildHarnessReportModel(project, SVG);
  assert.equal(Object.hasOwn(reportModel, "attachments"), false);
  const after = {
    html: report.renderHarnessReportHtml(reportModel),
    pdf: JSON.stringify(pdf.buildHarnessPdfDocument(reportModel)),
    bom: bom.serializeBomCsv(bom.buildBomRows(project)),
    onshape: onshape.serializeOnshapeCableWireCsv(onshape.buildOnshapeCableWireExport(project).rows),
    yaml: YAML.stringify(buildWireviz(project)),
  };
  assert.deepEqual(after, before);
  assert.match(after.html, /Harness photo retained/);
  assert.match(after.pdf, /Harness photo retained/);
  const native = model.serializeProjectFile(project);
  for (const file of project.attachments) {
    assert.ok(native.includes(file.filename));
    for (const output of Object.values(after)) {
      assert.ok(!output.includes(file.filename));
      assert.ok(!output.includes(file.description));
    }
  }
  const template = library.componentToTemplate(project.components[0]);
  assert.ok(!JSON.stringify(template).includes("CONFIDENTIAL"));
  assert.equal(reopen(project).attachments.length, 4);
});

test("editor exposes multiple-file/drop management with sandboxed PDF and plain-text previews", async () => {
  const dialog = await readFile(new URL("../app/ProjectFilesDialog.tsx", import.meta.url), "utf8");
  assert.match(source, /open-project-files/);
  assert.match(dialog, /type="file" multiple/);
  assert.match(dialog, /onDrop=/);
  assert.match(dialog, /window\.confirm/);
  assert.match(dialog, /sandbox="" referrerPolicy="no-referrer"/);
  assert.match(dialog, /<pre>\{preview\.text\}<\/pre>/);
  assert.doesNotMatch(dialog, /dangerouslySetInnerHTML|eval\(/);
  assert.match(source, /indexedDbOnly: Boolean\(project\.attachments\?\.length\)/);
  assert.match(source, /Latest changes have not been saved locally/);
  assert.match(source, /!storageReady \|\| autosaveBlocked/);
});
