import assert from "node:assert/strict";
import test from "node:test";
import YAML from "yaml";

const model = await import("../app/model.ts");
const accessories = await import("../app/additional-components.ts");
const bom = await import("../app/bom.ts");
const report = await import("../app/html-report.ts");
const library = await import("../app/library.ts");
const termination = await import("../app/termination.ts");
const wirevizImport = await import("../app/wireviz-import.ts");

const SAFE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg>';

function connectorProject() {
  const project = model.createEmptyProject("Connector accessory harness");
  const x1 = model.makeComponent("connector", 1, "x1");
  x1.designator = "X1";
  x1.pinCount = 4;
  x1.manufacturer = "Molex";
  x1.mpn = "HOUSING";
  const wire = model.makeComponent("wire", 1, "w1");
  wire.designator = "W1";
  project.components = [x1, wire];
  project.links = [
    {
      id: "link-1",
      from: { nodeId: x1.id, portId: "pin:1", side: "right" },
      to: { nodeId: wire.id, portId: "wire:1", side: "left" },
      termination: {
        contact: { manufacturer: "Molex", mpn: "CONTACT-1" },
        seal: { manufacturer: "Molex", mpn: "SEAL-1" },
      },
    },
  ];
  return { project, x1, wire };
}

test("connector presets use the shared additional-component model", () => {
  const tpa = accessories.createAdditionalComponentPreset("secondary-lock-tpa");
  const generic = accessories.createAdditionalComponentPreset("connector-generic");
  assert.equal(tpa.type, "Secondary Lock / TPA");
  assert.equal(tpa.qty, 1);
  assert.equal(tpa.unit, "pcs");
  assert.equal(tpa.qtyMultiplier, undefined);
  assert.equal(generic.type, undefined);
  assert.equal(generic.qty, 1);
  assert.equal(generic.unit, "pcs");
  assert.match(tpa.id, /^additional-/);
});

test("connector accessories persist while legacy connectors remain empty", () => {
  const { project, x1 } = connectorProject();
  x1.additionalComponents = [
    {
      id: "tpa-1",
      type: "Secondary Lock / TPA",
      subtype: "4-position",
      manufacturer: "Molex",
      mpn: "5051520400",
      qty: 1,
      unit: "pcs",
      notes: "Install after final inspection",
    },
  ];
  const reopened = model.parseProjectFile(model.serializeProjectFile(project)).project;
  assert.deepEqual(reopened.components[0].additionalComponents, x1.additionalComponents);

  const legacy = model.normalizeProject({
    schemaVersion: 2,
    title: "Legacy connector",
    components: [model.makeComponent("connector", 1, "legacy-x1")],
    links: [],
  }).project;
  assert.equal(legacy.components[0].additionalComponents, undefined);
});

test("fixed and populated quantities use connector semantics", () => {
  const { project, x1 } = connectorProject();
  assert.equal(
    accessories.additionalComponentQuantity(project, x1, {
      id: "fixed",
      type: "Accessory",
      qty: 2,
    }),
    2,
  );
  assert.equal(
    accessories.additionalComponentQuantity(project, x1, {
      id: "populated",
      type: "Cavity accessory",
      qty: 2,
      qtyMultiplier: "populated",
    }),
    2,
  );
});

test("WireViz serialization strips internal IDs and WireForm notes", () => {
  const { x1 } = connectorProject();
  const fixed = accessories.additionalComponentToWireViz(x1, {
    id: "internal-only",
    type: "Secondary Lock / TPA",
    manufacturer: "Molex",
    mpn: "5051520400",
    qty: 1,
    unit: "pcs",
    notes: "WireForm-only assembly note",
  });
  const populated = accessories.additionalComponentToWireViz(x1, {
    id: "populated",
    type: "Cavity plug",
    qty: 1,
    qtyMultiplier: "populated",
  });
  assert.deepEqual(fixed, {
    type: "Secondary Lock / TPA",
    manufacturer: "Molex",
    mpn: "5051520400",
    qty: 1,
    unit: "pcs",
  });
  assert.equal(populated.qty_multiplier, "populated");
  assert.doesNotMatch(YAML.stringify([fixed, populated]), /internal-only|WireForm-only|notes:/);
});

test("connector WireViz import preserves generic accessories and round-trips", () => {
  const candidate = wirevizImport.importWireVizYaml(`
connectors:
  X1:
    type: Connector
    pincount: 4
    additional_components:
      - type: Secondary Lock / TPA
        manufacturer: Molex
        mpn: "5051520400"
        qty: 1
      - type: Cavity plug
        qty: 1
        qty_multiplier: populated
connections: []
`, "connector-accessories.yml");
  const connector = candidate.project.components.find(
    (component) => component.designator === "X1",
  );
  assert.equal(connector.additionalComponents.length, 2);
  assert.equal(connector.additionalComponents[1].qtyMultiplier, "populated");
  assert.deepEqual(
    connector.additionalComponents.map((item) =>
      accessories.additionalComponentToWireViz(connector, item),
    ),
    [
      {
        type: "Secondary Lock / TPA",
        manufacturer: "Molex",
        mpn: "5051520400",
        qty: 1,
      },
      { type: "Cavity plug", qty: 1, qty_multiplier: "populated" },
    ],
  );
});

test("WireViz export combines user accessories with generated terminations only in output", () => {
  const { project, x1 } = connectorProject();
  x1.additionalComponents = [
    {
      id: "tpa-1",
      type: "Secondary Lock / TPA",
      manufacturer: "Molex",
      mpn: "5051520400",
      qty: 1,
    },
  ];
  const output = termination.collectConnectorAdditionalComponents(project, x1.id);
  assert.deepEqual(
    output.map((item) => [item.type, item.mpn, item.qty]),
    [
      ["Secondary Lock / TPA", "5051520400", 1],
      ["Crimp contact", "CONTACT-1", 1],
      ["Wire seal", "SEAL-1", 1],
    ],
  );
  assert.equal(x1.additionalComponents.length, 1);
  assert.equal(x1.additionalComponents[0].type, "Secondary Lock / TPA");
});

test("native BOM aggregates connector accessories once and keeps terminations separate", () => {
  const { project, x1 } = connectorProject();
  x1.additionalComponents = [
    {
      id: "tpa-1",
      type: "Secondary Lock / TPA",
      manufacturer: "Molex",
      mpn: "5051520400",
      qty: 1,
    },
  ];
  const x2 = structuredClone(x1);
  x2.id = "x2";
  x2.designator = "X2";
  x2.additionalComponents = accessories.cloneAdditionalComponentsWithNewIds(
    x1.additionalComponents,
  );
  project.components.push(x2);
  const rows = bom.buildBomRows(project);
  const tpa = rows.find((row) => row.mpn === "5051520400");
  assert.equal(tpa.quantity, 2);
  assert.deepEqual(tpa.designators, ["X1", "X2"]);
  assert.equal(rows.filter((row) => row.mpn === "5051520400").length, 1);
  assert.equal(rows.find((row) => row.mpn === "CONTACT-1").quantity, 1);
  assert.equal(rows.find((row) => row.mpn === "SEAL-1").quantity, 1);
});

test("connector and library duplication regenerate IDs and deep-clone accessory data", () => {
  const { x1 } = connectorProject();
  x1.additionalComponents = [
    {
      id: "tpa-original",
      type: "Secondary Lock / TPA",
      manufacturer: "Molex",
      mpn: "5051520400",
      qty: 1,
      notes: "Original",
    },
  ];
  const cloned = accessories.cloneAdditionalComponentsWithNewIds(
    x1.additionalComponents,
  );
  assert.notEqual(cloned[0].id, x1.additionalComponents[0].id);
  cloned[0].notes = "Changed";
  assert.equal(x1.additionalComponents[0].notes, "Original");

  const template = library.componentToTemplate(x1, "Connector with TPA");
  const inserted = library.instantiateTemplate(template, 2);
  assert.notEqual(inserted.additionalComponents[0].id, "tpa-original");
  inserted.additionalComponents[0].mpn = "CHANGED";
  assert.equal(template.component.additionalComponents[0].mpn, "5051520400");
});

test("cloned connector snapshots isolate accessory edits for undo and redo", () => {
  const { project, x1 } = connectorProject();
  x1.additionalComponents = [
    { id: "tpa-1", type: "Secondary Lock / TPA", qty: 1 },
  ];
  const before = model.cloneProject(project);
  x1.additionalComponents[0].mpn = "5051520400";
  const after = model.cloneProject(project);
  assert.equal(before.components[0].additionalComponents[0].mpn, undefined);
  assert.equal(after.components[0].additionalComponents[0].mpn, "5051520400");
});

test("HTML connector section includes accessories and reuses the native BOM", () => {
  const { project, x1 } = connectorProject();
  x1.additionalComponents = [
    {
      id: "tpa-1",
      type: "Secondary Lock / TPA",
      subtype: "4-position",
      manufacturer: "Molex",
      mpn: "5051520400",
      qty: 1,
      unit: "pcs",
      notes: "Latch after crimp inspection",
    },
  ];
  const reportModel = report.buildHarnessReportModel(project, SAFE_SVG);
  assert.deepEqual(reportModel.bomRows, bom.buildBomRows(project));
  assert.equal(reportModel.connectors[0].additionalComponents[0].calculatedQuantity, 1);
  const html = report.renderHarnessReportHtml(reportModel);
  assert.match(html, /<h4>Additional Components<\/h4>/);
  assert.match(html, /Secondary Lock \/ TPA/);
  assert.match(html, /5051520400/);
  assert.match(html, /Latch after crimp inspection/);
  assert.match(html, /Crimp contact/);
});

test("malformed connector accessories report actionable validation issues", () => {
  const { project, x1 } = connectorProject();
  x1.additionalComponents = [
    { id: "missing-type", qty: 1 },
    {
      id: "bad-quantity",
      type: "Secondary Lock / TPA",
      qty: -1,
      qtyMultiplier: "wirecount",
    },
  ];
  const issues = accessories.validateAdditionalComponents(project);
  assert.ok(
    issues.warnings.some(
      (message) => message.includes("X1 additional component 1") && message.includes("missing"),
    ),
  );
  assert.ok(
    issues.errors.some(
      (message) => message.includes("Secondary Lock / TPA") && message.includes("quantity"),
    ),
  );
  assert.ok(
    issues.warnings.some(
      (message) => message.includes("wirecount") && message.includes("unknown"),
    ),
  );
  assert.doesNotThrow(() => bom.buildBomRows(project));
  assert.doesNotThrow(() =>
    report.buildHarnessReportModel(project, SAFE_SVG),
  );
});
