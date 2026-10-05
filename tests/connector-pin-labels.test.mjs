import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bom = await import("../app/bom.ts");
const htmlReport = await import("../app/html-report.ts");
const library = await import("../app/library.ts");
const model = await import("../app/model.ts");
const pdfReport = await import("../app/pdf-report.ts");
const pinLabels = await import("../app/pin-labels.ts");
const wirevizImport = await import("../app/wireviz-import.ts");

const SAFE_SVG =
  '<svg width="100" height="40" viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg"><text x="5" y="20">Harness</text></svg>';

function fixture() {
  const project = model.createEmptyProject("Pin labels");
  const connector = model.makeComponent("connector", 1, "x1");
  connector.designator = "X1";
  connector.pinCount = 4;
  connector.pinLabels = ["A1", "", "B1", ""];
  const cable = model.makeComponent("cable", 1, "w1");
  cable.designator = "W1";
  cable.wireCount = 4;
  cable.wireLabels = ["I2C_SDA", "I2C_SCL", "FAN_PWM", "GND"];
  cable.colors = ["BU", "WH", "GN", "BK"];
  project.components = [connector, cable];
  project.links = Array.from({ length: 4 }, (_, index) => ({
    id: `link-${index + 1}`,
    from: { nodeId: connector.id, portId: `pin:${index + 1}`, side: "right" },
    to: { nodeId: cable.id, portId: `wire:${index + 1}`, side: "left" },
    termination: {
      contact: { manufacturer: "Molex", mpn: `CONTACT-${index + 1}` },
      seal: { manufacturer: "Molex", mpn: `SEAL-${index + 1}` },
      stripLength: `${5 + index} mm`,
      tooling: `Tool ${index + 1}`,
    },
  }));
  return { project, connector, cable };
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

test("pin-label helpers preserve physical positions, trim edits, and provide fallbacks", () => {
  const { connector } = fixture();
  assert.deepEqual(pinLabels.pinLabelsForCount(connector.pinLabels, 4), [
    "A1",
    "",
    "B1",
    "",
  ]);
  assert.equal(pinLabels.getPinDisplayName(connector, 1), "A1");
  assert.equal(pinLabels.getPinDisplayName(connector, 2), "Pin 2");
  assert.equal(pinLabels.getPinTraceLabel(connector, 3), "B1 (pin 3)");
  assert.deepEqual(pinLabels.setConnectorPinLabel(connector, 3, "  B01  "), [
    "A1",
    "",
    "B01",
    "",
  ]);
  assert.deepEqual(pinLabels.setConnectorPinLabel(connector, 1, "  "), [
    "",
    "",
    "B1",
    "",
  ]);
});

test("project round trip preserves full and partial labels while legacy connectors stay valid", () => {
  const { project } = fixture();
  const reopened = model.parseProjectFile(model.serializeProjectFile(project)).project;
  assert.deepEqual(reopened.components[0].pinLabels, ["A1", "", "B1", ""]);

  const legacy = model.normalizeProject({
    schemaVersion: 2,
    title: "Legacy",
    components: [{ ...model.makeComponent("connector", 1, "legacy"), pinLabels: undefined }],
    links: [],
  }).project;
  assert.deepEqual(legacy.components[0].pinLabels, []);
});

test("renaming a label changes no topology or termination manufacturing data", () => {
  const { project, connector } = fixture();
  const linksBefore = structuredClone(project.links);
  connector.pinLabels = pinLabels.setConnectorPinLabel(connector, 3, "B01");
  assert.deepEqual(project.links, linksBefore);
  assert.equal(project.links[2].from.portId, "pin:3");
  assert.deepEqual(project.links[2].termination, linksBefore[2].termination);

  const before = model.cloneProject(project);
  connector.pinLabels = pinLabels.setConnectorPinLabel(connector, 3, "B02");
  const after = model.cloneProject(project);
  const undone = model.cloneProject(before);
  const redone = model.cloneProject(after);
  assert.equal(undone.components[0].pinLabels[2], "B01");
  assert.equal(redone.components[0].pinLabels[2], "B02");
  assert.deepEqual(undone.links, redone.links);
});

test("connector copy and User Library insertion preserve independent pin-label arrays", () => {
  const { connector } = fixture();
  const duplicate = structuredClone(connector);
  duplicate.id = "x2";
  duplicate.pinLabels = [...connector.pinLabels];
  duplicate.pinLabels[0] = "COPY-A1";
  assert.equal(connector.pinLabels[0], "A1");

  const template = library.componentToTemplate(connector, "Four pin connector");
  const inserted = library.instantiateTemplate(template, 2);
  assert.deepEqual(inserted.pinLabels, ["A1", "", "B1", ""]);
  inserted.pinLabels[2] = "LIB-B01";
  assert.equal(template.component.pinLabels[2], "B1");
});

test("WireViz import preserves full and partial pinlabels without shifting", () => {
  const imported = wirevizImport.importWireVizYaml(`
connectors:
  X1:
    pincount: 4
    pinlabels: [A1, "", B1, ""]
cables:
  W1:
    wirecount: 4
    colors: [BU, WH, GN, BK]
connections:
  - - X1: 3
    - W1: 3
`, "pinlabels.yml");
  const connector = imported.project.components.find((item) => item.designator === "X1");
  assert.deepEqual(connector.pinLabels, ["A1", "", "B1", ""]);
  assert.equal(imported.project.links[0].from.portId, "pin:3");

  const noLabels = wirevizImport.importWireVizYaml(`
connectors:
  X1: {pincount: 2}
`, "no-labels.yml");
  assert.deepEqual(noLabels.project.components[0].pinLabels, ["", ""]);
});

test("WireViz exporter uses standard positional pinlabels and numeric connections", async () => {
  const source = await readFile(new URL("../app/HarnessStudio.tsx", import.meta.url), "utf8");
  const builder = source.slice(
    source.indexOf("export function buildWireVizDocument"),
    source.indexOf("function validateProject"),
  );
  assert.match(builder, /pinLabelsForCount\(node\.pinLabels, node\.pinCount\)/);
  assert.match(builder, /connector\.pinlabels = labels/);
  assert.match(builder, /parsePortNumber\(other\.portId\)/);
  assert.doesNotMatch(builder, /approvedAlternatives|pin_mapping|pinMapping/);
});

test("shared report model keeps physical pin, label, and conductor signal separate", () => {
  const { project } = fixture();
  const report = htmlReport.buildHarnessReportModel(project, SAFE_SVG);
  assert.deepEqual(
    report.connectors[0].pins.map(({ pin, label, signal }) => ({ pin, label, signal })),
    [
      { pin: "1", label: "A1", signal: "I2C_SDA" },
      { pin: "2", label: "", signal: "I2C_SCL" },
      { pin: "3", label: "B1", signal: "FAN_PWM" },
      { pin: "4", label: "", signal: "GND" },
    ],
  );
  assert.equal(report.terminations[2].pin, "3");
  assert.equal(report.terminations[2].pinLabel, "B1");
  assert.equal(report.terminations[2].stripLength, "7 mm");

  const html = htmlReport.renderHarnessReportHtml(report);
  assert.match(html, />Pin<\/th><th>Label<\/th><th>Signal<\/th>/);
  assert.match(html, />B1<\/td><td>FAN_PWM<\/td>/);
  assert.match(html, />Pin label<\/th>/);

  const pdf = pdfReport.buildHarnessPdfDocument(report);
  const text = allText(pdf.content);
  assert.ok(text.indexOf("Pin") < text.indexOf("Label"));
  assert.ok(text.indexOf("Label") < text.indexOf("Signal"));
  assert.match(text, /B1/);
  assert.match(text, /FAN_PWM/);
});

test("duplicate non-empty labels warn case-insensitively while blanks and symbols are valid", () => {
  const { project, connector } = fixture();
  connector.pinLabels = ["A1", " a1 ", "", "+"];
  const warnings = pinLabels.validateConnectorPinLabels(project);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /X1: pin label "A1" is assigned to pins 1 and 2/);
  connector.pinLabels = ["", "", "PE", "-"];
  assert.deepEqual(pinLabels.validateConnectorPinLabels(project), []);
});

test("pin-label edits do not alter BOM quantities or grouping", () => {
  const { project, connector } = fixture();
  connector.manufacturer = "Molex";
  connector.mpn = "HOUSING-4";
  const before = bom.buildBomRows(project);
  connector.pinLabels = ["A01", "A02", "B01", "B02"];
  assert.deepEqual(bom.buildBomRows(project), before);
});

test("connector inspector and canvas use shared label helpers while stable ports remain numeric", async () => {
  const source = await readFile(new URL("../app/HarnessStudio.tsx", import.meta.url), "utf8");
  assert.match(source, /function PinLabelsEditor/);
  assert.match(source, /aria-label={`Pin \$\{pin\} label`}/);
  assert.match(source, /getPinDisplayName\(node, number\)/);
  assert.match(source, /getPinTraceLabel\(node, number\)/);
  assert.match(source, /Physical pin \$\{number\}/);
  assert.match(source, /`pin:\$\{number\}`/);
  assert.match(source, /validateConnectorPinLabels\(project\)/);
  assert.match(source, /Apply contact to connected pins/);
});
