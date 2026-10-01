import assert from "node:assert/strict";
import test from "node:test";

const model = await import("../app/model.ts");
const report = await import("../app/html-report.ts");

const SAFE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z" /></svg>';

test("legacy projects without harness notes load with a blank value", () => {
  const project = model.normalizeProject({
    schemaVersion: 3,
    title: "Legacy harness",
    revision: "A",
    company: "",
    components: [],
    links: [],
  }).project;
  assert.equal(project.notes, "");
});

test("project save/load and autosave serialization retain multiline notes", () => {
  const project = model.createEmptyProject("Documented harness");
  project.notes =
    "Assembly notes\n\n- Keep TP1 away from power wiring.\n- Mount ferrite within 30 mm.\n\nRevision A:\nInitial prototype.";
  const serialized = model.serializeProjectFile(project);
  assert.equal(JSON.parse(serialized).project.notes, project.notes);
  assert.equal(model.parseProjectFile(serialized).project.notes, project.notes);
});

test("blank notes are valid and history snapshots isolate note edits", () => {
  const project = model.createEmptyProject();
  const before = model.cloneProject(project);
  project.notes = "Edited harness note";
  assert.equal(before.notes, "");
  assert.equal(project.notes, "Edited harness note");
  const undo = model.cloneProject(before);
  const redo = model.cloneProject(project);
  assert.equal(undo.notes, "");
  assert.equal(redo.notes, "Edited harness note");
});

test("HTML uses only escaped harness notes and preserves component notes", () => {
  const project = model.createEmptyProject("Notes safety");
  project.notes = "Line one & two\n\n<script>alert(1)</script>\n- Keep <clear>";
  const connector = model.makeComponent("connector", 1, "connector-1");
  connector.designator = "X1";
  connector.notes = "Connector-specific note";
  project.components.push(connector);
  const value = report.buildHarnessReportModel(project, SAFE_SVG);
  assert.equal(value.project.notes, project.notes);
  assert.equal(value.connectors[0].notes, "Connector-specific note");
  const html = report.renderHarnessReportHtml(value);
  assert.match(html, /id="notes"/);
  assert.match(
    html,
    /Line one &amp; two\n\n&lt;script&gt;alert\(1\)&lt;\/script&gt;\n- Keep &lt;clear&gt;/,
  );
  assert.match(html, /Connector-specific note/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test("HTML omits blank notes and all report-level validation content", () => {
  const project = model.createEmptyProject("Blank notes");
  project.notes = "\n   \n";
  const html = report.renderHarnessReportHtml(
    report.buildHarnessReportModel(project, SAFE_SVG),
  );
  assert.doesNotMatch(html, /id="notes"|href="#notes"/);
  assert.doesNotMatch(
    html,
    /id="validation"|Notes \/ Validation|No validation warnings|Review open ends/i,
  );
});

