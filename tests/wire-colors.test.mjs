import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bom = await import("../app/bom.ts");
const colors = await import("../app/wire-colors.ts");
const library = await import("../app/library.ts");
const model = await import("../app/model.ts");
const pdf = await import("../app/pdf-report.ts");
const report = await import("../app/html-report.ts");
const wirevizImport = await import("../app/wireviz-import.ts");

const SAFE_SVG =
  '<svg width="120pt" height="60pt" viewBox="0 0 120 60" xmlns="http://www.w3.org/2000/svg"><path d="M0 30 L120 30" stroke="#3f74b8"/><path d="M0 30 L120 30" stroke="#f5f5f1" stroke-width="1"/></svg>';

function wire(id, designator, color) {
  const component = model.makeComponent("wire", 1, id);
  component.designator = designator;
  component.name = "Hook-up wire";
  component.colors = [color];
  component.gauge = "24 AWG";
  component.length = "1 m";
  return component;
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

test("shared parser distinguishes solid, bicolor, reversed, and unknown codes", () => {
  const blue = colors.parseWireColor("BU");
  assert.equal(blue.primaryCode, "BU");
  assert.equal(blue.primary.name, "Blue");
  assert.equal(blue.secondary, undefined);
  assert.equal(blue.supported, true);

  const blueWhite = colors.parseWireColor("BUWH");
  assert.equal(blueWhite.primary.name, "Blue");
  assert.equal(blueWhite.secondary.name, "White");
  assert.equal(blueWhite.isBicolor, true);

  const whiteBlue = colors.parseWireColor("WHBU");
  assert.equal(whiteBlue.primary.name, "White");
  assert.equal(whiteBlue.secondary.name, "Blue");
  assert.notDeepEqual(blueWhite, whiteBlue);
  assert.notEqual(
    colors.getWireColorCssBackground("BUWH"),
    colors.getWireColorCssBackground("WHBU"),
  );

  const unknown = colors.parseWireColor("BUXX");
  assert.equal(unknown.code, "BUXX");
  assert.equal(unknown.supported, false);
  assert.equal(colors.getWireColorDisplay("BUXX"), "Unknown color (BUXX)");
});

test("formatter emits WireViz-compatible codes and normalizes identical colors", () => {
  assert.equal(colors.formatWireColor("BU", "WH"), "BUWH");
  assert.equal(colors.formatWireColor("WH", "BU"), "WHBU");
  assert.equal(colors.formatWireColor("BU"), "BU");
  assert.equal(colors.formatWireColor("BU", "BU"), "BU");
  assert.equal(colors.getWireColorDisplay("GNYE"), "Green / Yellow (GNYE)");
});

test("valid bicolor codes pass validation while missing and unsupported values warn", () => {
  const project = model.createEmptyProject("Color validation");
  project.components = [
    wire("valid", "W1", "BUWH"),
    wire("missing", "W2", ""),
    wire("unknown", "W3", "BUXX"),
    wire("same", "W4", "BUBU"),
  ];
  const warnings = colors.validateWireColors(project);
  assert.equal(warnings.some((warning) => warning.includes("W1")), false);
  assert.match(warnings.join("\n"), /W2 conductor 1 has no wire color/);
  assert.match(warnings.join("\n"), /W3 conductor 1 uses unsupported/);
  assert.match(warnings.join("\n"), /W4 conductor 1 repeats BU/);
});

test("project, copy, and User Library round trips preserve the combined code", () => {
  const project = model.createEmptyProject("Color persistence");
  const original = wire("wire-blue-white", "W1", "BUWH");
  project.components = [original];
  const parsed = model.parseProjectFile(model.serializeProjectFile(project)).project;
  assert.equal(parsed.components[0].colors[0], "BUWH");

  const copy = model.cloneProject(project);
  copy.components[0].colors[0] = "WHBU";
  assert.equal(project.components[0].colors[0], "BUWH");

  const template = library.componentToTemplate(original, "Striped wire");
  const inserted = library.instantiateTemplate(template, 2);
  assert.equal(inserted.colors[0], "BUWH");
  inserted.colors[0] = "GNYE";
  assert.equal(template.component.colors[0], "BUWH");
});

test("WireViz import preserves bicolor order and exporter uses standard colors only", async () => {
  const imported = wirevizImport.importWireVizYaml(`
cables:
  W1: {wirecount: 1, colors: [BU]}
  W2: {wirecount: 1, colors: [BUWH]}
  W3: {wirecount: 1, colors: [WHBU]}
  W4: {wirecount: 1, colors: [GNYE]}
connections: []
`, "bicolor.yml").project;
  assert.deepEqual(
    imported.components.map((component) => component.colors[0]),
    ["BU", "BUWH", "WHBU", "GNYE"],
  );

  const source = await readFile(new URL("../app/HarnessStudio.tsx", import.meta.url), "utf8");
  const builder = source.slice(
    source.indexOf("export function buildWireVizDocument"),
    source.indexOf("function validateProject"),
  );
  assert.match(builder, /cable\.colors = colors/);
  assert.doesNotMatch(builder, /primary_color|secondary_color|primaryColor|secondaryColor/);
});

test("HTML report uses shared textual colors and self-contained directional swatches", () => {
  const project = model.createEmptyProject("Bicolor report");
  const w1 = wire("w1", "W1", "BU");
  const w2 = wire("w2", "W2", "BUWH");
  const w3 = wire("w3", "W3", "WHBU");
  const w4 = wire("w4", "W4", "GNYE");
  project.components = [w1, w2, w3, w4];
  project.twistedPairs = [
    {
      id: "tp1",
      designator: "TP1",
      members: [w2.id, w3.id],
      twistDirection: "unspecified",
    },
  ];
  const value = report.buildHarnessReportModel(project, SAFE_SVG);
  assert.deepEqual(value.cables.map((item) => item.color), ["BU", "BUWH", "WHBU", "GNYE"]);
  assert.equal(value.twistedPairs[0].wireAColor, "BUWH");
  assert.equal(value.twistedPairs[0].wireBColor, "WHBU");

  const html = report.renderHarnessReportHtml(value);
  assert.match(html, /Blue \/ White \(BUWH\)/);
  assert.match(html, /White \/ Blue \(WHBU\)/);
  assert.match(html, /Green \/ Yellow \(GNYE\)/);
  assert.match(html, /linear-gradient\(to bottom, #3f74b8 0 34%, #f5f5f1/);
  assert.match(html, /linear-gradient\(to bottom, #f5f5f1 0 34%, #3f74b8/);
  assert.match(html, /wire-color-swatch/);
  assert.doesNotMatch(html, /(?:src|href)="https?:\/\//);
});

test("PDF uses vector swatches and shared textual color interpretation", () => {
  const blueWhite = pdf.pdfWireColorCell("BUWH");
  const whiteBlue = pdf.pdfWireColorCell("WHBU");
  assert.equal(blueWhite.columns[0].canvas[0].color, "#3f74b8");
  assert.equal(blueWhite.columns[0].canvas[1].color, "#f5f5f1");
  assert.equal(whiteBlue.columns[0].canvas[0].color, "#f5f5f1");
  assert.equal(whiteBlue.columns[0].canvas[1].color, "#3f74b8");
  assert.match(allText(blueWhite), /Blue \/ White \(BUWH\)/);
  assert.equal(allText(blueWhite).includes("image"), false);

  const project = model.createEmptyProject("Bicolor PDF");
  project.components = [wire("w1", "W1", "BUWH"), wire("w2", "W2", "WHBU")];
  const definition = pdf.buildHarnessPdfDocument(
    report.buildHarnessReportModel(project, SAFE_SVG),
  );
  assert.match(allText(definition.content), /Blue \/ White \(BUWH\)/);
  assert.match(allText(definition.content), /White \/ Blue \(WHBU\)/);
  const canvasColors = [];
  visit(definition.content, (item) => {
    if (item?.type === "rect" && typeof item.color === "string") canvasColors.push(item.color);
  });
  assert.ok(canvasColors.includes("#3f74b8"));
  assert.ok(canvasColors.includes("#f5f5f1"));
});

test("wire color affects no-MPN BOM identity but never changes quantity", () => {
  const blue = wire("blue", "W1", "BU");
  const striped = wire("striped", "W2", "BUWH");
  const project = model.createEmptyProject("Color BOM");
  project.components = [blue, striped];
  const rows = bom.buildBomRows(project);
  assert.equal(rows.length, 2);
  assert.equal(rows.reduce((sum, row) => sum + row.quantity, 0), 2);
  assert.ok(rows.some((row) => row.description.includes("Blue (BU)")));
  assert.ok(rows.some((row) => row.description.includes("Blue / White (BUWH)")));
});

test("UI source uses shared editor, striped canvas path, and library swatch", async () => {
  const source = await readFile(new URL("../app/HarnessStudio.tsx", import.meta.url), "utf8");
  assert.match(source, /aria-label="Primary wire color"/);
  assert.match(source, /aria-label="Secondary wire color"/);
  assert.match(source, /formatWireColor\(/);
  assert.match(source, /className="connection-stripe"/);
  assert.match(source, /getWireColorCssBackground\(colorCode\)/);
  assert.match(source, /template\.component\.kind === "wire"/);
  assert.match(source, /validateWireColors\(project\)/);
});
