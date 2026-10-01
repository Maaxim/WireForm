import assert from "node:assert/strict";
import test from "node:test";
import YAML from "yaml";

const model = await import("../app/model.ts");
const accessories = await import("../app/additional-components.ts");
const bom = await import("../app/bom.ts");
const report = await import("../app/html-report.ts");
const library = await import("../app/library.ts");
const wirevizImport = await import("../app/wireviz-import.ts");

function projectWithCable(wireCount = 3) {
  const project = model.createEmptyProject("Accessory harness");
  const x1 = model.makeComponent("connector", 1, "x1");
  x1.designator = "X1";
  x1.pinCount = wireCount;
  x1.pinLabels = Array.from({ length: wireCount }, (_, index) => `SIG${index + 1}`);
  const x2 = model.makeComponent("connector", 2, "x2");
  x2.designator = "X2";
  x2.pinCount = wireCount;
  const cable = model.makeComponent("cable", 1, "w1");
  cable.designator = "W1";
  cable.wireCount = wireCount;
  cable.wireLabels = Array.from({ length: wireCount }, (_, index) => `W${index + 1}`);
  cable.colors = Array.from({ length: wireCount }, () => "BK");
  cable.length = "2 m";
  project.components = [x1, cable, x2];
  project.links = Array.from({ length: wireCount }, (_, index) => index + 1).flatMap(
    (wire) => [
      {
        id: `left-${wire}`,
        from: { nodeId: "x1", portId: `pin:${wire}`, side: "right" },
        to: { nodeId: "w1", portId: `wire:${wire}`, side: "left" },
      },
      {
        id: `right-${wire}`,
        from: { nodeId: "w1", portId: `wire:${wire}`, side: "right" },
        to: { nodeId: "x2", portId: `pin:${wire}`, side: "left" },
      },
    ],
  );
  return { project, cable, x1, x2 };
}

test("cable additional-component presets use one generic model", () => {
  const heatShrink = accessories.createAdditionalComponentPreset("heat-shrink");
  const wireLabel = accessories.createAdditionalComponentPreset("wire-label");
  const ferrite = accessories.createAdditionalComponentPreset("ferrite");
  const generic = accessories.createAdditionalComponentPreset("generic");

  assert.deepEqual(
    { ...heatShrink, id: "stable" },
    { id: "stable", type: "Heat shrink", qty: 1, unit: "pcs" },
  );
  assert.equal(wireLabel.qtyMultiplier, "terminations");
  assert.deepEqual(wireLabel.placement, { scope: "termination" });
  assert.deepEqual(ferrite.placement, { scope: "cable" });
  assert.equal(generic.type, undefined);
  assert.match(generic.id, /^additional-/);
});

test("project persistence preserves accessories and legacy projects stay empty", () => {
  const { project, cable } = projectWithCable();
  cable.additionalComponents = [
    {
      id: "heat-1",
      type: "Heat shrink",
      manufacturer: "TE",
      mpn: "HS-1",
      qty: 2,
      unit: "pcs",
      placement: {
        scope: "cable",
        end: "both",
        pieceLengthMm: 30,
        wireIds: [1, "W2"],
        note: "Cover breakout",
      },
    },
  ];
  const reopened = model.parseProjectFile(model.serializeProjectFile(project)).project;
  assert.deepEqual(reopened.components[1].additionalComponents, cable.additionalComponents);

  const legacy = model.normalizeProject({
    schemaVersion: 2,
    title: "Legacy",
    components: [model.makeComponent("wire", 1, "legacy-wire")],
    links: [],
  });
  assert.equal(legacy.project.components[0].additionalComponents, undefined);
});

test("all WireViz cable multiplier modes use the shared quantity calculator", () => {
  const { project, cable } = projectWithCable(3);
  const values = new Map([
    [undefined, 2],
    ["wirecount", 6],
    ["terminations", 6],
    ["length", 4],
    ["total_length", 12],
  ]);
  for (const [qtyMultiplier, expected] of values) {
    const component = {
      id: `mode-${qtyMultiplier ?? "fixed"}`,
      type: "Accessory",
      qty: 2,
      ...(qtyMultiplier ? { qtyMultiplier } : {}),
    };
    assert.equal(
      accessories.additionalComponentQuantity(project, cable, component),
      expected,
    );
  }
  assert.equal(accessories.wireVizCableConnectionCount(project, cable), 3);
});

test("WireViz serialization emits standard fields and strips WireForm placement", () => {
  const { cable } = projectWithCable();
  const serialized = accessories.additionalComponentToWireViz(cable, {
    id: "ferrite-1",
    type: "Ferrite",
    subtype: "Clamp-on",
    manufacturer: "TDK",
    mpn: "ZCAT2035-0930",
    supplier: "Digi-Key",
    spn: "445-1234-ND",
    pn: "INT-1",
    qty: 1,
    unit: "pcs",
    qtyMultiplier: "wirecount",
    bgcolor: "WH",
    placement: { scope: "cable", end: "from", offsetMm: 30 },
  });
  assert.deepEqual(serialized, {
    type: "Ferrite",
    subtype: "Clamp-on",
    pn: "INT-1",
    manufacturer: "TDK",
    mpn: "ZCAT2035-0930",
    supplier: "Digi-Key",
    spn: "445-1234-ND",
    qty: 1,
    unit: "pcs",
    bgcolor: "WH",
    qty_multiplier: "wirecount",
  });
  const yaml = YAML.stringify({ cables: { W1: { additional_components: [serialized] } } });
  assert.doesNotMatch(yaml, /placement|offsetMm|wireIds|id:/);
});

test("WireViz cable additional components import and round-trip standard fields", () => {
  const yaml = `
metadata:
  title: Imported accessories
cables:
  W1:
    type: Control cable
    wirecount: 2
    gauge: 24 AWG
    length: 1 m
    colors: [RD, BK]
    additional_components:
      - type: Ferrite
        manufacturer: TDK
        mpn: ZCAT2035-0930
        qty: 1
      - type: Wire label
        manufacturer: Brady
        mpn: B-342
        qty: 1
        unit: pcs
        qty_multiplier: terminations
connections: []
`;
  const candidate = wirevizImport.importWireVizYaml(yaml, "accessories.yml");
  const cable = candidate.project.components.find((item) => item.designator === "W1");
  assert.equal(cable.additionalComponents.length, 2);
  assert.equal(cable.additionalComponents[1].qtyMultiplier, "terminations");
  assert.equal(cable.additionalComponents[0].placement, undefined);
  assert.deepEqual(
    cable.additionalComponents.map((item) =>
      accessories.additionalComponentToWireViz(cable, item),
    ),
    [
      { type: "Ferrite", manufacturer: "TDK", mpn: "ZCAT2035-0930", qty: 1 },
      {
        type: "Wire label",
        manufacturer: "Brady",
        mpn: "B-342",
        qty: 1,
        unit: "pcs",
        qty_multiplier: "terminations",
      },
    ],
  );
  assert.ok(!candidate.report.unsupported.some((item) => item.includes("additional_components")));
});

test("BOM aggregates cable accessories across cables without placement splitting", () => {
  const first = projectWithCable(2);
  const secondCable = model.makeComponent("cable", 2, "w2");
  secondCable.designator = "W2";
  secondCable.wireCount = 2;
  secondCable.length = "1 m";
  secondCable.additionalComponents = [
    {
      id: "ferrite-2",
      type: "Ferrite",
      manufacturer: "TDK",
      mpn: "ZCAT2035-0930",
      qty: 2,
      placement: { scope: "cable", end: "to" },
    },
  ];
  first.cable.additionalComponents = [
    {
      id: "ferrite-1",
      type: "Ferrite",
      manufacturer: "TDK",
      mpn: "ZCAT2035-0930",
      qty: 1,
      placement: { scope: "cable", end: "from", offsetMm: 30 },
    },
    {
      id: "label-1",
      type: "Wire label",
      manufacturer: "Brady",
      mpn: "B-342",
      qty: 1,
      unit: "pcs",
      qtyMultiplier: "terminations",
    },
  ];
  first.project.components.push(secondCable);
  const rows = bom.buildBomRows(first.project);
  const ferrite = rows.find((row) => row.mpn === "ZCAT2035-0930");
  const labels = rows.find((row) => row.mpn === "B-342");
  assert.equal(ferrite.quantity, 3);
  assert.deepEqual(ferrite.designators, ["W1", "W2"]);
  assert.equal(labels.quantity, 2);
  assert.equal(rows.filter((row) => row.mpn === "ZCAT2035-0930").length, 1);
});

test("HTML report shows effective quantity and resolved placement while reusing BOM", () => {
  const { project, cable } = projectWithCable(2);
  cable.additionalComponents = [
    {
      id: "ferrite-1",
      type: "Ferrite <safe>",
      manufacturer: "TDK",
      mpn: "ZCAT2035-0930",
      qty: 1,
      placement: { scope: "cable", end: "from", offsetMm: 30 },
    },
  ];
  const modelValue = report.buildHarnessReportModel(
    project,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>Harness</text></svg>',
  );
  assert.equal(modelValue.cables[0].additionalComponents[0].calculatedQuantity, 1);
  assert.match(modelValue.cables[0].additionalComponents[0].placement, /30 mm from X1/);
  assert.deepEqual(modelValue.bomRows, bom.buildBomRows(project));
  const html = report.renderHarnessReportHtml(modelValue);
  assert.match(html, /W1 <span>Additional Components<\/span>/);
  assert.match(html, /Ferrite &lt;safe&gt;/);
  assert.match(html, /30 mm from X1 end/);
});

test("library instantiation and copy helpers clone data with fresh internal IDs", () => {
  const { cable } = projectWithCable();
  cable.additionalComponents = [
    {
      id: "original-accessory",
      type: "Heat shrink",
      qty: 2,
      placement: { scope: "cable", end: "both", pieceLengthMm: 30 },
    },
  ];
  const template = library.componentToTemplate(cable, "Control cable");
  const inserted = library.instantiateTemplate(template, 4);
  assert.deepEqual(
    { ...inserted.additionalComponents[0], id: "original-accessory" },
    cable.additionalComponents[0],
  );
  assert.notEqual(inserted.additionalComponents[0].id, "original-accessory");
  inserted.additionalComponents[0].placement.note = "Changed";
  assert.equal(template.component.additionalComponents[0].placement.note, undefined);

  const pasted = accessories.cloneAdditionalComponentsWithNewIds(
    cable.additionalComponents,
  );
  assert.notEqual(pasted[0].id, cable.additionalComponents[0].id);
  assert.deepEqual(pasted[0].placement, cable.additionalComponents[0].placement);
});

test("accessory validation identifies malformed data and affected cable", () => {
  const { project, cable } = projectWithCable(2);
  cable.additionalComponents = [
    {
      id: "bad-1",
      qty: -1,
      qtyMultiplier: "made-up",
      placement: {
        scope: "wire",
        end: "from",
        wireIds: [9],
        offsetMm: -2,
        pieceLengthMm: -3,
      },
    },
  ];
  const issues = accessories.validateAdditionalComponents(project);
  assert.ok(issues.errors.some((item) => item.includes("W1 additional component 1") && item.includes("quantity")));
  assert.ok(issues.errors.some((item) => item.includes("invalid offset")));
  assert.ok(issues.errors.some((item) => item.includes("invalid piece length")));
  assert.ok(issues.errors.some((item) => item.includes('missing conductor "9"')));
  assert.ok(issues.warnings.some((item) => item.includes("missing its type")));
  assert.ok(issues.warnings.some((item) => item.includes("made-up")));
  assert.equal(
    accessories.additionalComponentToWireViz(cable, cable.additionalComponents[0]),
    undefined,
  );
});

test("cloned project snapshots isolate accessory edits for undo and redo", () => {
  const { project, cable } = projectWithCable();
  cable.additionalComponents = [
    { id: "label-1", type: "Wire label", qty: 1 },
  ];
  const before = model.cloneProject(project);
  cable.additionalComponents[0].mpn = "B-342";
  const after = model.cloneProject(project);
  assert.equal(before.components[1].additionalComponents[0].mpn, undefined);
  assert.equal(after.components[1].additionalComponents[0].mpn, "B-342");
});
