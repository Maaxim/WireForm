import assert from "node:assert/strict";
import test from "node:test";

const bom = await import("../app/bom.ts");
const mapping = await import("../app/connection-mapping.ts");
const htmlReport = await import("../app/html-report.ts");
const model = await import("../app/model.ts");
const pdfReport = await import("../app/pdf-report.ts");
const twistedPair = await import("../app/twisted-pair.ts");

const SAFE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><path d="M0 25 L100 25" /></svg>';

function component(kind, id, designator, count = 1) {
  const value = model.makeComponent(kind, 1, id);
  value.designator = designator;
  if (["wire", "cable", "bundle"].includes(kind)) {
    value.wireCount = count;
    value.conductorIds = Array.from({ length: count }, () =>
      model.createConductorId(),
    );
    value.wireLabels = Array.from({ length: count }, () => "");
    value.colors = Array.from({ length: count }, () => "");
  }
  return value;
}

function connect(id, connector, pin, conductor, conductorNumber, reverse = false) {
  const connectorPort = {
    nodeId: connector.id,
    portId: `pin:${pin}`,
    side: "right",
  };
  const conductorPort = {
    nodeId: conductor.id,
    portId: `wire:${conductorNumber}`,
    side: "left",
  };
  return reverse
    ? { id, from: conductorPort, to: connectorPort }
    : { id, from: connectorPort, to: conductorPort };
}

function fixture() {
  const project = model.createEmptyProject("Connection mapping fixture");
  const j1 = component("connector", "j1", "J1");
  const j2 = component("connector", "j2", "J2");
  const j3 = component("connector", "j3", "J3");
  const j10 = component("connector", "j10", "J10");
  for (const connector of [j1, j2, j3, j10]) connector.pinCount = 12;
  j1.pinLabels = ["A1", "A2", "OPEN_END"];
  j2.pinLabels[1] = "B2";
  j10.pinLabels[9] = "Z10";

  const w1 = component("wire", "w1", "W1");
  w1.wireLabels = ["CAN_H"];
  w1.colors = ["BU"];
  const w2 = component("wire", "w2", "W2");
  w2.wireLabels = ["CAN_L"];
  w2.colors = ["WH"];

  const b1 = component("bundle", "b1", "B1", 4);
  b1.wireLabels = ["PAIR_H", "PAIR_L", "SPARE", "BROKEN"];
  b1.colors = ["BUWH", "WHBU", "RD", "BK"];

  project.components = [j10, b1, w2, j3, w1, j1, j2];
  project.links = [
    connect("b1-1-left", j1, 1, b1, 1),
    connect("b1-1-right", j3, 4, b1, 1, true),
    connect("b1-2-left", j1, 2, b1, 2),
    connect("b1-2-right", j3, 5, b1, 2, true),
    connect("w2-left", j1, 3, w2, 1),
    connect("w1-right", j10, 10, w1, 1, true),
    connect("w1-left", j2, 2, w1, 1),
    {
      id: "broken-endpoint",
      from: { nodeId: b1.id, portId: "wire:4", side: "left" },
      to: { nodeId: "missing-connector", portId: "pin:1", side: "right" },
    },
  ];
  project.twistedPairs = [
    {
      id: "tp-1",
      designator: "TP1",
      members: [twistedPair.wireMember(w1.id), twistedPair.wireMember(w2.id)],
      twistDirection: "unspecified",
    },
    {
      id: "tp-2",
      designator: "TP2",
      members: [
        twistedPair.bundleConductorMember(b1.id, b1.conductorIds[0]),
        twistedPair.bundleConductorMember(b1.id, b1.conductorIds[1]),
      ],
      twistDirection: "unspecified",
    },
  ];
  return { project, j1, j2, j3, j10, w1, w2, b1 };
}

function visit(value, callback) {
  if (value === null || value === undefined || typeof value === "function") return;
  callback(value);
  if (Array.isArray(value)) value.forEach((item) => visit(item, callback));
  else if (typeof value === "object") Object.values(value).forEach((item) => visit(item, callback));
}

function allText(value) {
  const values = [];
  visit(value, (item) => {
    if (typeof item === "string" || typeof item === "number") values.push(String(item));
  });
  return values.join("\n");
}

function contentText(value) {
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join(" ");
  if (!value || typeof value !== "object") return "";
  if (typeof value.text === "string" || typeof value.text === "number") {
    return String(value.text);
  }
  return [contentText(value.columns), contentText(value.stack)].filter(Boolean).join(" ");
}

function findConnectionMappingTable(definition) {
  let result;
  visit(definition.content, (item) => {
    if (
      item &&
      typeof item === "object" &&
      item.table?.body?.[0]?.map((cell) => cell.text).join("|") ===
        "From|Pin|Wire / Conductor|TP|To|Pin"
    ) {
      result = item;
    }
  });
  return result;
}

test("builder emits exactly one naturally ordered row per physical conductor", () => {
  const { project } = fixture();
  const rows = mapping.buildConnectionMappingRows(project);
  assert.equal(rows.length, 6);
  assert.equal(new Set(rows.map((row) => `${row.conductor.componentId}:${row.conductor.conductorNumber}`)).size, 6);
  assert.deepEqual(
    rows.slice(0, 4).map((row) => `${row.from.connectorDesignator}:${row.from.physicalPin}`),
    ["J1:1", "J1:2", "J1:3", "J2:2"],
  );
  assert.deepEqual(
    rows.map((row) => row.conductor.display),
    [
      "B1 / cond. 1 · PAIR_H · BUWH",
      "B1 / cond. 2 · PAIR_L · WHBU",
      "W2 · CAN_L · WH",
      "W1 · CAN_H · BU",
      "B1 / cond. 4 · BROKEN · BK",
      "B1 / cond. 3 · SPARE · RD",
    ],
  );
});

test("endpoints retain physical pins, labels, deterministic direction, OPEN, and UNRESOLVED", () => {
  const { project } = fixture();
  const rows = mapping.buildConnectionMappingRows(project);
  const pairHigh = rows.find((row) => row.conductor.display.includes("PAIR_H"));
  assert.deepEqual(pairHigh.from, {
    status: "connected",
    connectorId: "j1",
    connectorDesignator: "J1",
    physicalPin: 1,
    pinLabel: "A1",
    pinDisplay: "1 (A1)",
  });
  assert.equal(pairHigh.to.connectorDesignator, "J3");
  assert.equal(pairHigh.to.pinDisplay, "4");

  const wire = rows.find((row) => row.conductor.designator === "W1");
  assert.equal(wire.from.connectorDesignator, "J2");
  assert.equal(wire.from.pinDisplay, "2 (B2)");
  assert.equal(wire.to.connectorDesignator, "J10");
  assert.equal(wire.to.pinDisplay, "10 (Z10)");

  const oneEnded = rows.find((row) => row.conductor.designator === "W2");
  assert.equal(oneEnded.to.status, "open");
  const zeroEnded = rows.find((row) => row.conductor.label === "SPARE");
  assert.equal(zeroEnded.from.status, "open");
  assert.equal(zeroEnded.to.status, "open");
  const broken = rows.find((row) => row.conductor.label === "BROKEN");
  assert.equal(broken.from.status, "unresolved");
  assert.equal(broken.to.status, "open");
});

test("twisted-pair membership is derived for standalone and bundle members", () => {
  const { project } = fixture();
  const rows = mapping.buildConnectionMappingRows(project);
  assert.equal(rows.find((row) => row.conductor.designator === "W1").twistedPair.designator, "TP1");
  assert.equal(rows.find((row) => row.conductor.designator === "W2").twistedPair.designator, "TP1");
  assert.equal(rows.find((row) => row.conductor.label === "PAIR_H").twistedPair.designator, "TP2");
  assert.equal(rows.find((row) => row.conductor.label === "PAIR_L").twistedPair.designator, "TP2");
  assert.equal(rows.find((row) => row.conductor.label === "SPARE").twistedPair, undefined);

  project.twistedPairs = [];
  assert.ok(mapping.buildConnectionMappingRows(project).every((row) => !row.twistedPair));
});

test("multidrop remains one conductor row with explicit deterministic destinations", () => {
  const { project, j1, j2, j3 } = fixture();
  const multidrop = component("wire", "multidrop", "W20");
  multidrop.wireLabels = ["BUS"];
  multidrop.colors = ["GNYE"];
  project.components.push(multidrop);
  project.links.push(
    connect("multi-3", j3, 10, multidrop, 1),
    connect("multi-1", j1, 10, multidrop, 1),
    connect("multi-2", j2, 10, multidrop, 1),
  );
  const rows = mapping.buildConnectionMappingRows(project);
  const row = rows.find((candidate) => candidate.conductor.designator === "W20");
  assert.equal(rows.filter((candidate) => candidate.conductor.designator === "W20").length, 1);
  assert.equal(row.from.connectorDesignator, "J1");
  assert.equal(row.to.status, "multidrop");
  assert.equal(row.to.connectorDesignator, "MULTI-DROP");
  assert.equal(row.to.pinDisplay, "J2:10, J3:10");
});

test("renames and pin-label edits are reflected without stored mapping state", () => {
  const { project, j1 } = fixture();
  const before = mapping.buildConnectionMappingRows(project);
  assert.equal(before[0].from.pinDisplay, "1 (A1)");
  j1.designator = "X1";
  j1.pinLabels[0] = "A01";
  const after = mapping.buildConnectionMappingRows(project);
  const row = after.find((candidate) => candidate.conductor.label === "PAIR_H");
  assert.equal(row.from.connectorDesignator, "J3");
  assert.equal(row.to.connectorDesignator, "X1");
  assert.equal(row.to.pinDisplay, "1 (A01)");
  assert.equal("connectionMapping" in project, false);
});

test("shared report model feeds HTML directly after the diagram with six fixed columns", () => {
  const { project } = fixture();
  const report = htmlReport.buildHarnessReportModel(project, SAFE_SVG);
  assert.deepEqual(report.connectionMapping, mapping.buildConnectionMappingRows(project));
  const html = htmlReport.renderHarnessReportHtml(report);
  assert.ok(html.indexOf('id="diagram"') < html.indexOf('id="connection-mapping"'));
  assert.ok(html.indexOf('id="connection-mapping"') < html.indexOf('id="connectors"'));
  for (const heading of [
    "From Connector",
    "From Pin",
    "Wire / Conductor",
    "Twisted Pair",
    "To Connector",
    "To Pin",
  ]) {
    assert.match(html, new RegExp(`>${heading}<`));
  }
  assert.match(html, /B1 \/ cond\. 1 · PAIR_H · BUWH/);
  assert.match(html, /W1 · CAN_H · BU/);
  assert.match(html, />TP2</);
  assert.match(html, />OPEN</);
  assert.match(html, />UNRESOLVED</);
  assert.match(html, /wire-color-swatch/);
  assert.match(html, /default-src 'none'/);
});

test("PDF uses the same rows, order, repeated header, and compact portrait table", () => {
  const { project } = fixture();
  const report = htmlReport.buildHarnessReportModel(project, SAFE_SVG);
  const definition = pdfReport.buildHarnessPdfDocument(report);
  const headings = [];
  const tables = [];
  visit(definition.content, (item) => {
    if (item && typeof item === "object" && item.style === "sectionHeading") headings.push(item);
    if (item && typeof item === "object" && item.table?.body) tables.push(item);
  });
  const diagramIndex = headings.findIndex((item) => item.text === "Harness Diagram");
  const mappingIndex = headings.findIndex((item) => item.text === "Connection Mapping");
  const connectorsIndex = headings.findIndex((item) => item.text === "Connectors");
  assert.ok(diagramIndex < mappingIndex && mappingIndex < connectorsIndex);
  assert.equal(headings[mappingIndex].pageOrientation, "portrait");
  const mappingTable = findConnectionMappingTable(definition);
  assert.ok(mappingTable);
  assert.equal(mappingTable.table.body.length, report.connectionMapping.length + 1);
  assert.equal(mappingTable.table.headerRows, 1);
  assert.equal(mappingTable.table.keepWithHeaderRows, 1);
  assert.deepEqual(mappingTable.table.widths, [48, 55, "*", 38, 55, 90]);
  assert.deepEqual(
    mappingTable.table.body.slice(1).map((cells) =>
      cells.map(contentText),
    ),
    report.connectionMapping.map((row) => [
      row.from.connectorDesignator,
      row.from.pinDisplay || "—",
      row.conductor.display,
      row.twistedPair?.designator ?? "—",
      row.to.connectorDesignator,
      row.to.pinDisplay || "—",
    ]),
  );
  const rendered = allText(mappingTable);
  for (const row of report.connectionMapping) {
    assert.match(rendered, new RegExp(row.conductor.designator));
  }
});

test("PDF mapping conductor cells reuse vector solid and bicolor swatches", () => {
  const { project } = fixture();
  const report = htmlReport.buildHarnessReportModel(project, SAFE_SVG);
  const definition = pdfReport.buildHarnessPdfDocument(report);
  const mappingTable = findConnectionMappingTable(definition);
  assert.ok(mappingTable);

  const cellFor = (designator) => {
    const rowIndex = report.connectionMapping.findIndex(
      (row) => row.conductor.designator === designator,
    );
    assert.ok(rowIndex >= 0);
    return mappingTable.table.body[rowIndex + 1][2];
  };

  const solidBlue = cellFor("W1");
  assert.equal(solidBlue.columns[0].canvas[0].color, "#3f74b8");
  assert.equal(solidBlue.columns[0].canvas.at(-1).lineColor, "#66777e");
  assert.match(contentText(solidBlue), /W1 · CAN_H · BU/);

  const solidWhite = cellFor("W2");
  assert.equal(solidWhite.columns[0].canvas[0].color, "#f5f5f1");
  assert.equal(solidWhite.columns[0].canvas.at(-1).lineColor, "#66777e");
  assert.match(contentText(solidWhite), /W2 · CAN_L · WH/);

  const bicolor = report.connectionMapping.findIndex(
    (row) => row.conductor.colorCode === "BUWH",
  );
  const bicolorCell = mappingTable.table.body[bicolor + 1][2];
  assert.equal(bicolorCell.columns[0].canvas[0].color, "#3f74b8");
  assert.equal(bicolorCell.columns[0].canvas[1].color, "#f5f5f1");
  assert.match(contentText(bicolorCell), /BUWH/);

  const reversed = report.connectionMapping.findIndex(
    (row) => row.conductor.colorCode === "WHBU",
  );
  const reversedCell = mappingTable.table.body[reversed + 1][2];
  assert.equal(reversedCell.columns[0].canvas[0].color, "#f5f5f1");
  assert.equal(reversedCell.columns[0].canvas[1].color, "#3f74b8");
  assert.match(contentText(reversedCell), /WHBU/);
});

test("PDF mapping swatch handles unknown bundle color without losing text", () => {
  const { project, b1 } = fixture();
  b1.colors[2] = "XX";
  const report = htmlReport.buildHarnessReportModel(project, SAFE_SVG);
  const definition = pdfReport.buildHarnessPdfDocument(report);
  const mappingTable = findConnectionMappingTable(definition);
  const rowIndex = report.connectionMapping.findIndex(
    (row) => row.conductor.componentId === b1.id && row.conductor.conductorNumber === 3,
  );
  const cell = mappingTable.table.body[rowIndex + 1][2];
  assert.equal(cell.columns[0].canvas[0].color, "#70808c");
  assert.equal(cell.columns[0].canvas.at(-1).lineColor, "#66777e");
  assert.match(contentText(cell), /B1 \/ cond\. 3 · SPARE · XX/);
});

test("a long mapping table renders as a valid multipage-capable PDF", async () => {
  const project = model.createEmptyProject("Long connection mapping");
  const from = component("connector", "from", "J1");
  const to = component("connector", "to", "J2");
  from.pinCount = 48;
  to.pinCount = 48;
  const bundle = component("bundle", "bundle", "B1", 48);
  bundle.wireLabels = Array.from({ length: 48 }, (_, index) => `SIGNAL_${index + 1}`);
  bundle.colors = Array.from({ length: 48 }, () => "BUWH");
  project.components = [from, bundle, to];
  project.links = Array.from({ length: 48 }, (_, index) => [
    connect(`from-${index}`, from, index + 1, bundle, index + 1),
    connect(`to-${index}`, to, index + 1, bundle, index + 1, true),
  ]).flat();
  const report = htmlReport.buildHarnessReportModel(project, SAFE_SVG);
  assert.equal(report.connectionMapping.length, 48);
  const definition = pdfReport.buildHarnessPdfDocument(report);
  const [pdfModule, vfsModule] = await Promise.all([
    import("pdfmake/build/pdfmake.js"),
    import("pdfmake/build/vfs_fonts.js"),
  ]);
  pdfModule.default.addVirtualFileSystem(vfsModule.default);
  const buffer = await pdfModule.default.createPdf(definition).getBuffer();
  assert.equal(Buffer.from(buffer).subarray(0, 5).toString("ascii"), "%PDF-");
});

test("connection mapping is report-only and does not affect BOM or WireViz source", async () => {
  const { project } = fixture();
  const before = structuredClone(project);
  const expectedBom = bom.buildBomRows(project);
  htmlReport.buildHarnessReportModel(project, SAFE_SVG);
  assert.deepEqual(project, before);
  assert.deepEqual(bom.buildBomRows(project), expectedBom);
  const studioSource = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../app/HarnessStudio.tsx", import.meta.url), "utf8"),
  );
  assert.doesNotMatch(studioSource, /connection_mapping|connectionMapping\s*:/);
});
