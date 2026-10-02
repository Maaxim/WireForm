import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bom = await import("../app/bom.ts");
const htmlReport = await import("../app/html-report.ts");
const model = await import("../app/model.ts");
const pdfReport = await import("../app/pdf-report.ts");

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA";
const SAFE_SVG = `<svg width="240pt" height="120pt" viewBox="0 0 240 120" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="238" height="118" fill="white" stroke="black"/><text x="12" y="60">Harness µ Ω ° ± ×</text></svg>`;

function component(kind, id, designator) {
  const value = model.makeComponent(kind, 1, id);
  value.designator = designator;
  return value;
}

function projectFixture() {
  const project = model.createEmptyProject("Prüfstand µ Harness");
  project.revision = "C";
  project.company = "Müller & Söhne";
  project.notes = "Assembly notes\n\n- Verify ±0.2 mm\n- Torque 2 N·m";

  const x1 = component("connector", "x1", "X1");
  x1.name = "Control connector";
  x1.pinCount = 2;
  x1.pinLabels = ["CAN_H", "CAN_L"];
  x1.manufacturer = "Molex";
  x1.mpn = "123456";
  x1.photo = {
    dataUrl: PIXEL,
    fileName: "x1.png",
    mimeType: "image/png",
    width: 1,
    height: 1,
    alt: "X1 connector",
  };
  x1.approvedAlternatives = [
    { id: "alt-x1", manufacturer: "TE Connectivity", mpn: "ABC123", note: "Drop-in" },
  ];
  x1.additionalComponents = [
    {
      id: "acc-x1",
      type: "Secondary Lock / TPA",
      manufacturer: "Molex",
      mpn: "5051520400",
      qty: 1,
      unit: "pcs",
    },
  ];

  const w1 = component("wire", "w1", "W1");
  w1.name = "CAN high";
  w1.wireCount = 1;
  w1.wireLabels = ["CAN_H"];
  w1.colors = ["WH"];
  w1.length = "0.22 m";
  w1.gauge = "24 AWG";
  w1.manufacturer = "Alpha Wire";
  w1.mpn = "6713";
  w1.approvedAlternatives = [
    { id: "alt-w1", manufacturer: "Wire GmbH", mpn: "ALT-001", note: "Prototype" },
  ];
  w1.additionalComponents = [
    {
      id: "acc-w1",
      type: "Wire label",
      manufacturer: "Brady",
      mpn: "B-342",
      qty: 1,
      qtyMultiplier: "terminations",
      unit: "pcs",
      placement: { scope: "termination", end: "both", note: "Near connector" },
    },
  ];

  const w2 = component("wire", "w2", "W2");
  w2.name = "CAN low";
  w2.wireCount = 1;
  w2.wireLabels = ["CAN_L"];
  w2.colors = ["BU"];
  w2.length = "0.22 m";
  w2.gauge = "24 AWG";

  const c1 = component("cable", "c1", "C1");
  c1.name = "Power cable";
  c1.wireCount = 2;
  c1.length = "1.5 m";
  c1.approvedAlternatives = [
    { id: "alt-c1", manufacturer: "Cable Co", mpn: "C-ALT" },
  ];

  const b1 = component("bundle", "b1", "B1");
  b1.name = "Loose wire bundle";
  b1.wireCount = 3;
  b1.length = "0.5 m";
  b1.approvedAlternatives = [
    { id: "alt-b1", manufacturer: "Bundle Co", mpn: "B-ALT" },
  ];

  project.components = [x1, w1, w2, c1, b1];
  project.links = [
    {
      id: "link-x1-w1",
      from: { nodeId: x1.id, portId: "pin:1", side: "right" },
      to: { nodeId: w1.id, portId: "wire:1", side: "left" },
      termination: {
        contact: { manufacturer: "TE", mpn: "CONTACT-1" },
        seal: { manufacturer: "TE", mpn: "SEAL-1" },
        stripLength: "5 mm",
        tooling: "Applicator 42",
        notes: "Inspect crimp",
      },
    },
    {
      id: "link-x1-w2",
      from: { nodeId: x1.id, portId: "pin:2", side: "right" },
      to: { nodeId: w2.id, portId: "wire:1", side: "left" },
      termination: { contact: { manufacturer: "TE", mpn: "CONTACT-2" } },
    },
  ];
  project.twistedPairs = [
    {
      id: "pair-1",
      designator: "TP1",
      members: [w1.id, w2.id],
      twistPitchMm: 25,
      twistDirection: "Z",
      note: "Data pair",
    },
  ];
  return project;
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

function allText(value) {
  const values = [];
  visit(value, (item) => {
    if (typeof item === "string" || typeof item === "number") values.push(String(item));
  });
  return values.join("\n");
}

function findNodes(value, predicate) {
  const nodes = [];
  visit(value, (item) => {
    if (typeof item === "object" && !Array.isArray(item) && predicate(item)) nodes.push(item);
  });
  return nodes;
}

test("PDF renderer consumes the shared report model and native BOM rows", async () => {
  const project = projectFixture();
  const before = structuredClone(project);
  const report = htmlReport.buildHarnessReportModel(project, SAFE_SVG);
  assert.deepEqual(report.bomRows, bom.buildBomRows(project));

  const definition = pdfReport.buildHarnessPdfDocument(report);
  assert.deepEqual(project, before, "PDF definition generation must not mutate project state");
  const rendered = allText(definition.content);
  for (const expected of [
    "Prüfstand µ Harness",
    "Müller & Söhne",
    "REVISION",
    "C",
    "TE Connectivity",
    "ABC123",
    "Secondary Lock / TPA",
    "5051520400",
    "CONTACT-1",
    "SEAL-1",
    "5 mm",
    "Applicator 42",
    "Wire label",
    "B-342",
    "Wire GmbH",
    "Cable Co",
    "Bundle Co",
    "TP1",
    "25 mm",
    "Assembly notes",
    "±0.2 mm",
  ]) {
    assert.match(rendered, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(rendered, /Validation/i);
});

test("PDF uses sanitized diagram SVG as vector input and embeds valid connector images", () => {
  const report = htmlReport.buildHarnessReportModel(projectFixture(), SAFE_SVG);
  const definition = pdfReport.buildHarnessPdfDocument(report);
  const svgNodes = findNodes(definition.content, (node) => typeof node.svg === "string");
  assert.equal(svgNodes.length, 1);
  assert.equal(svgNodes[0].svg, report.diagramSvg);
  assert.deepEqual(svgNodes[0].fit, [720, 455]);

  const imageNodes = findNodes(definition.content, (node) => typeof node.image === "string");
  assert.equal(imageNodes.length, 1);
  assert.equal(imageNodes[0].image, PIXEL);
});

test("missing or invalid connector image is omitted without changing report content", () => {
  const project = projectFixture();
  project.components[0].photo.dataUrl = "https://example.com/connector.png";
  const report = htmlReport.buildHarnessReportModel(project, SAFE_SVG);
  const definition = pdfReport.buildHarnessPdfDocument(report);
  assert.equal(findNodes(definition.content, (node) => "image" in node).length, 0);
  assert.match(allText(definition.content), /Control connector/);
});

test("PDF BOM is the shared model output and alternatives do not add quantity", () => {
  const project = projectFixture();
  const report = htmlReport.buildHarnessReportModel(project, SAFE_SVG);
  const connectorRow = report.bomRows.find((row) => row.mpn === "123456");
  assert.equal(connectorRow.quantity, 1);
  assert.equal(connectorRow.approvedAlternatives.length, 1);

  const definition = pdfReport.buildHarnessPdfDocument(report);
  const tables = findNodes(definition.content, (node) => node.table?.body);
  const bomTable = tables.find((node) => allText(node.table.body[0]).includes("Item"));
  assert.ok(bomTable, "expected PDF BOM table");
  assert.equal(bomTable.table.body.length, report.bomRows.length + 1);
  assert.equal(bomTable.table.headerRows, 1);
  assert.equal(bomTable.table.keepWithHeaderRows, 1);
});

test("all PDF engineering tables repeat headers and footer has page numbering", () => {
  const report = htmlReport.buildHarnessReportModel(projectFixture(), SAFE_SVG);
  const definition = pdfReport.buildHarnessPdfDocument(report);
  const tables = findNodes(definition.content, (node) => node.table?.body);
  assert.ok(tables.length >= 8);
  for (const node of tables) {
    if (node.layout === "noBorders") continue;
    assert.equal(node.table.headerRows, 1);
    assert.equal(node.table.keepWithHeaderRows, 1);
  }
  assert.equal(typeof definition.footer, "function");
  assert.match(allText(definition.footer(3, 12, { width: 595, height: 842, orientation: "portrait" })), /Page 3 \/ 12/);
});

test("PDF filename uses the HTML report sanitization convention", () => {
  assert.equal(pdfReport.pdfReportFilenameForTitle(" Harness: Rev Ä / 7 "), "harness-rev-7.pdf");
  assert.equal(pdfReport.pdfReportFilenameForTitle("***"), "wireform-harness.pdf");
});

test("graphics fallback document omits SVG and images but keeps engineering text", () => {
  const report = htmlReport.buildHarnessReportModel(projectFixture(), SAFE_SVG);
  const definition = pdfReport.buildHarnessPdfDocument(report, {
    includeDiagram: false,
    includeImages: false,
  });
  assert.equal(findNodes(definition.content, (node) => "svg" in node || "image" in node).length, 0);
  assert.match(allText(definition.content), /could not be embedded/);
  assert.match(allText(definition.content), /CONTACT-1/);
});

test("PDF implementation lazy-loads pdfmake and consumes model BOM without aggregating", async () => {
  const source = await readFile(new URL("../app/pdf-report.ts", import.meta.url), "utf8");
  const studio = await readFile(new URL("../app/HarnessStudio.tsx", import.meta.url), "utf8");
  assert.match(source, /import\("pdfmake\/build\/pdfmake"\)/);
  assert.match(source, /model\.bomRows/);
  assert.doesNotMatch(source, /buildBomRows\s*\(/);
  assert.match(studio, /await import\(\s*"\.\/pdf-report"\s*\)/);
  assert.match(studio, /Export native PDF harness report/);
  assert.match(studio, /PDF report export failed:/);
});
