import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const alternatives = await import("../app/approved-alternatives.ts");
const bom = await import("../app/bom.ts");
const report = await import("../app/html-report.ts");
const library = await import("../app/library.ts");
const model = await import("../app/model.ts");
const wirevizImport = await import("../app/wireviz-import.ts");

const SAFE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg>';

function component(kind, id, designator, manufacturer, mpn) {
  const value = model.makeComponent(kind, 1, id);
  value.designator = designator;
  value.manufacturer = manufacturer;
  value.mpn = mpn;
  return value;
}

function alternative(id, manufacturer, mpn, note) {
  return {
    id,
    ...(manufacturer !== undefined ? { manufacturer } : {}),
    ...(mpn !== undefined ? { mpn } : {}),
    ...(note !== undefined ? { note } : {}),
  };
}

test("one shared model supports connectors, wires, cables, and bundles", () => {
  for (const kind of ["connector", "wire", "cable", "bundle"]) {
    assert.equal(alternatives.supportsApprovedAlternatives(kind), true);
  }
  assert.equal(alternatives.supportsApprovedAlternatives("splice"), false);
  assert.equal(alternatives.supportsApprovedAlternatives("junction"), false);

  const created = alternatives.createApprovedPartAlternative();
  assert.match(created.id, /^alternative-/);
  assert.equal(created.manufacturer, undefined);
  assert.equal(created.mpn, undefined);
});

test("project round-trip preserves alternatives, user order, and stable IDs", () => {
  const project = model.createEmptyProject("Approved parts");
  const x1 = component("connector", "x1", "X1", "Molex", "123456");
  x1.approvedAlternatives = [
    alternative("alt-te", "TE Connectivity", "ABC123", "Drop-in"),
    alternative("alt-amphenol", "Amphenol", "XYZ987"),
  ];
  const wire = component("wire", "w1", "W1", "Alpha Wire", "6713");
  wire.approvedAlternatives = [alternative("alt-wire", "Maker B", "ALT-001")];
  const cable = component("cable", "c1", "C1", "LAPP", "2170001");
  cable.approvedAlternatives = [alternative("alt-cable", "HELUKABEL", "C-2")];
  const bundle = component("bundle", "b1", "B1", "Generic", "BUNDLE-A");
  bundle.approvedAlternatives = [alternative("alt-bundle", "Generic", "BUNDLE-B")];
  project.components = [x1, wire, cable, bundle];

  const reopened = model.parseProjectFile(model.serializeProjectFile(project)).project;
  assert.deepEqual(
    reopened.components.map((item) => item.approvedAlternatives),
    project.components.map((item) => item.approvedAlternatives),
  );
  assert.deepEqual(
    reopened.components[0].approvedAlternatives.map((item) => item.id),
    ["alt-te", "alt-amphenol"],
  );
});

test("legacy projects load without alternatives and malformed values normalize safely", () => {
  const legacy = model.normalizeProject({
    schemaVersion: 2,
    title: "Legacy",
    components: [model.makeComponent("connector", 1, "x1")],
    links: [],
  }).project;
  assert.equal(legacy.components[0].approvedAlternatives, undefined);

  const normalized = model.normalizeApprovedPartAlternatives([
    null,
    "bad",
    { id: "same", manufacturer: 42, mpn: " ALT " },
    { id: "same", note: "note only" },
    {},
  ]);
  assert.equal(normalized.length, 3);
  assert.equal(normalized[0].id, "same");
  assert.notEqual(normalized[1].id, "same");
  assert.equal(normalized[0].manufacturer, undefined);
  assert.equal(normalized[0].mpn, " ALT ");
  assert.doesNotThrow(() =>
    alternatives.formatApprovedAlternatives([
      { manufacturer: 42, mpn: null, note: { bad: true } },
    ]),
  );
  const malformedProject = model.createEmptyProject("Malformed alternative");
  const connector = component("connector", "bad-x1", "X1", "Primary", "P1");
  connector.approvedAlternatives = [
    { id: "bad", manufacturer: 42, mpn: null, note: { bad: true } },
  ];
  malformedProject.components = [connector];
  assert.doesNotThrow(() => bom.buildBomRows(malformedProject));
  assert.doesNotThrow(() =>
    report.renderHarnessReportHtml(
      report.buildHarnessReportModel(malformedProject, SAFE_SVG),
    ),
  );
});

test("copy helpers and history snapshots clone alternatives independently", () => {
  const project = model.createEmptyProject("Copies");
  const x1 = component("connector", "x1", "X1", "Molex", "A");
  x1.approvedAlternatives = [
    alternative("original", "TE", "B", "Drop-in"),
  ];
  project.components = [x1];
  const cloned = alternatives.cloneApprovedAlternativesWithNewIds(
    x1.approvedAlternatives,
  );
  assert.notEqual(cloned[0].id, "original");
  cloned[0].note = "Changed clone";
  assert.equal(x1.approvedAlternatives[0].note, "Drop-in");

  const before = model.cloneProject(project);
  x1.approvedAlternatives[0].mpn = "B2";
  const after = model.cloneProject(project);
  assert.equal(before.components[0].approvedAlternatives[0].mpn, "B");
  assert.equal(after.components[0].approvedAlternatives[0].mpn, "B2");
});

test("User Library templates preserve all eligible kinds with independent IDs", () => {
  for (const [index, kind] of ["connector", "wire", "cable", "bundle"].entries()) {
    const source = component(kind, `${kind}-source`, `${kind[0].toUpperCase()}1`, "Primary", "P1");
    source.approvedAlternatives = [
      alternative(`${kind}-alt`, "Alternate", `ALT-${index}`, "Approved"),
    ];
    const template = library.componentToTemplate(source, `${kind} template`);
    const serialized = library.serializeTemplateSelection("Selection", [source]);
    const restored = library.parseLibraryFile(serialized);
    assert.equal(
      restored.library.templates[0].component.approvedAlternatives[0].mpn,
      `ALT-${index}`,
    );
    const inserted = library.instantiateTemplate(template, index + 2);
    assert.notEqual(inserted.approvedAlternatives[0].id, `${kind}-alt`);
    inserted.approvedAlternatives[0].note = "Changed";
    assert.equal(template.component.approvedAlternatives[0].note, "Approved");
  }
});

test("validation finds empty, primary-identical, and duplicate alternatives case-insensitively", () => {
  const project = model.createEmptyProject("Validation");
  const x1 = component("connector", "x1", "X1", " Molex ", "A123");
  x1.approvedAlternatives = [
    alternative("empty"),
    alternative("same", "molex", " a123 "),
    alternative("first", "TE Connectivity", "B456"),
    alternative("duplicate", " te connectivity ", "b456", "Different note"),
  ];
  project.components = [x1];
  const issues = alternatives.validateApprovedAlternatives(project);
  assert.deepEqual(issues.errors, []);
  assert.ok(issues.warnings.some((message) => message.includes("X1 approved alternative 1") && message.includes("empty")));
  assert.ok(issues.warnings.some((message) => message.includes("identical to the primary")));
  assert.ok(issues.warnings.some((message) => message.includes("duplicates approved alternative 3")));
});

test("BOM alternatives are metadata and do not increase quantity", () => {
  const project = model.createEmptyProject("BOM alternatives");
  const x1 = component("connector", "x1", "X1", "Molex", "A123");
  x1.approvedAlternatives = [
    alternative("te", "TE", "B456"),
    alternative("amp", "Amphenol", "C789", "Black housing only"),
  ];
  project.components = [x1];
  const rows = bom.buildBomRows(project);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 1);
  assert.deepEqual(rows[0].approvedAlternatives, [
    { manufacturer: "TE", mpn: "B456", note: undefined },
    { manufacturer: "Amphenol", mpn: "C789", note: "Black housing only" },
  ]);
  assert.equal(rows.some((row) => row.mpn === "B456"), false);
  assert.equal(rows.some((row) => row.mpn === "C789"), false);
});

test("BOM grouping ignores alternative order but separates different sets", () => {
  const project = model.createEmptyProject("Grouping");
  const x1 = component("connector", "x1", "X1", "Molex", "A123");
  const x2 = component("connector", "x2", "X2", "Molex", "A123");
  x1.approvedAlternatives = [
    alternative("b", "TE", "B456", "Drop-in"),
    alternative("c", "Amphenol", "C789"),
  ];
  x2.approvedAlternatives = [
    alternative("c2", " amphenol ", "c789"),
    alternative("b2", "te", "b456", "drop-in"),
  ];
  project.components = [x1, x2];
  let rows = bom.buildBomRows(project);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 2);
  assert.deepEqual(rows[0].designators, ["X1", "X2"]);
  assert.equal(rows[0].approvedAlternatives[0].manufacturer, "TE");

  x2.approvedAlternatives = [alternative("different", "Hirose", "D000")];
  rows = bom.buildBomRows(project);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.flatMap((row) => row.designators).sort(),
    ["X1", "X2"],
  );
});

test("CSV has one deterministic escaped Approved Alternatives column", () => {
  const project = model.createEmptyProject("CSV alternatives");
  const x1 = component("connector", "x1", "X1", "Molex", "A123");
  x1.approvedAlternatives = [
    alternative(
      "special",
      "T\u00c9, Connectivity",
      'B"456',
      "Drop-in\nRev B",
    ),
  ];
  project.components = [x1];
  const first = bom.serializeBomCsv(bom.buildBomRows(project));
  const second = bom.serializeBomCsv(bom.buildBomRows(project));
  assert.equal(first, second);
  assert.match(first, /Designators,Approved Alternatives,Notes/);
  assert.match(first, /"T\u00c9, Connectivity B""456 \(Drop-in\nRev B\)"/);
  assert.equal(first.split("\r\n").length, 3);
});

test("HTML details and shared BOM show escaped alternatives for every eligible kind", () => {
  const project = model.createEmptyProject("HTML alternatives");
  const x1 = component("connector", "x1", "X1", "Molex", "A123");
  x1.approvedAlternatives = [
    alternative("x-alt", "TE <unsafe>", "B456", '<script>alert("x")</script>'),
  ];
  const wire = component("wire", "w1", "W1", "Alpha", "W-A");
  wire.approvedAlternatives = [alternative("w-alt", "Maker W", "W-B")];
  const cable = component("cable", "c1", "C1", "LAPP", "C-A");
  cable.approvedAlternatives = [alternative("c-alt", "Maker C", "C-B")];
  const bundle = component("bundle", "b1", "B1", "Primary B", "B-A");
  bundle.approvedAlternatives = [alternative("b-alt", "Maker B", "B-B")];
  project.components = [x1, wire, cable, bundle];
  const value = report.buildHarnessReportModel(project, SAFE_SVG);
  assert.deepEqual(value.bomRows, bom.buildBomRows(project));
  assert.equal(value.connectors[0].approvedAlternatives[0].mpn, "B456");
  assert.deepEqual(
    value.cables.map((item) => [item.designator, item.approvedAlternatives[0].mpn]),
    [["B1", "B-B"], ["C1", "C-B"], ["W1", "W-B"]],
  );
  const html = report.renderHarnessReportHtml(value);
  assert.match(html, /X1[\s\S]*Approved Alternatives[\s\S]*TE &lt;unsafe&gt;/);
  assert.match(html, /W1 <span>Approved Alternatives<\/span>/);
  assert.match(html, /C1 <span>Approved Alternatives<\/span>/);
  assert.match(html, /B1 <span>Approved Alternatives<\/span>/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /Bill of Materials[\s\S]*Approved alternatives/);
  assert.doesNotMatch(html, /(?:src|href)="https?:\/\//);

  const blankHtml = report.renderHarnessReportHtml(
    report.buildHarnessReportModel(
      { ...project, components: project.components.map((item) => ({ ...item, approvedAlternatives: undefined })) },
      SAFE_SVG,
    ),
  );
  assert.doesNotMatch(blankHtml, /Approved Alternatives|Approved alternatives/);
});

test("WireViz uses only primary parts and import never invents alternatives", async () => {
  const source = await readFile(new URL("../app/HarnessStudio.tsx", import.meta.url), "utf8");
  const start = source.indexOf("export function buildWireVizDocument");
  const end = source.indexOf("function validateProject", start);
  const builder = source.slice(start, end);
  assert.match(builder, /connector\.manufacturer = node\.manufacturer/);
  assert.match(builder, /connector\.mpn = node\.mpn/);
  assert.match(builder, /cable\.manufacturer = node\.manufacturer/);
  assert.match(builder, /cable\.mpn = node\.mpn/);
  assert.doesNotMatch(builder, /approvedAlternatives|approved_alternatives|alternative_mpn/);

  const imported = wirevizImport.importWireVizYaml(`
connectors:
  X1:
    type: Connector
    pincount: 2
    manufacturer: Molex
    mpn: "123456"
cables:
  W1:
    wirecount: 1
    manufacturer: Alpha Wire
    mpn: "6713"
connections: []
`, "primary-only.yml").project;
  assert.equal(imported.components[0].manufacturer, "Molex");
  assert.equal(imported.components[0].mpn, "123456");
  assert.equal(imported.components[0].approvedAlternatives, undefined);
  assert.equal(imported.components[1].approvedAlternatives, undefined);
});
