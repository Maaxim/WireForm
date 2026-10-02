import assert from "node:assert/strict";
import test from "node:test";

const bom = await import("../app/bom.ts");
const model = await import("../app/model.ts");

function projectWith(...components) {
  const project = model.createEmptyProject("BOM Test Harness");
  project.components = components;
  return project;
}

function connector(designator, manufacturer, mpn, name = "Connector housing") {
  const component = model.makeComponent("connector", 1, designator.toLowerCase());
  component.designator = designator;
  component.manufacturer = manufacturer;
  component.mpn = mpn;
  component.name = name;
  return component;
}

function cable(kind, designator, manufacturer, mpn, length, wireCount = 1) {
  const component = model.makeComponent(kind, 1, designator.toLowerCase());
  component.designator = designator;
  component.manufacturer = manufacturer;
  component.mpn = mpn;
  component.name = kind === "wire" ? "Hook-up wire" : "Shielded cable";
  component.length = length;
  component.wireCount = wireCount;
  component.gauge = "22 AWG";
  return component;
}

function addTermination(project, id, connectorNode, pin, cableNode, side, data) {
  project.links.push({
    id,
    from: {
      nodeId: connectorNode.id,
      portId: `pin:${pin}`,
      side: side === "left" ? "right" : "left",
    },
    to: {
      nodeId: cableNode.id,
      portId: `wire:${pin}`,
      side,
    },
    ...(data ? { termination: data } : {}),
  });
}

test("one connector produces one housing row", () => {
  const project = projectWith(connector("X1", "HARTING", "HOUSING-A"));
  assert.deepEqual(bom.buildBomRows(project), [
    {
      category: "Connector",
      manufacturer: "HARTING",
      mpn: "HOUSING-A",
      description: "Connector housing",
      quantity: 1,
      unit: "pcs",
      designators: ["X1"],
      notes: "",
    },
  ]);
});

test("identical connector MPNs aggregate while different MPNs remain separate", () => {
  const project = projectWith(
    connector("X10", "HARTING", "HOUSING-A"),
    connector("X2", "HARTING", "HOUSING-A"),
    connector("X3", "Molex", "HOUSING-B"),
  );
  const rows = bom.buildBomRows(project);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.find((row) => row.mpn === "HOUSING-A"),
    {
      category: "Connector",
      manufacturer: "HARTING",
      mpn: "HOUSING-A",
      description: "Connector housing",
      quantity: 2,
      unit: "pcs",
      designators: ["X2", "X10"],
      notes: "",
    },
  );
  assert.equal(rows.find((row) => row.mpn === "HOUSING-B").quantity, 1);
});

test("unrelated connectors without MPNs do not merge", () => {
  const project = projectWith(
    connector("X1", "", "", "Circular connector"),
    connector("X2", "", "", "Rectangular connector"),
  );
  const rows = bom.buildBomRows(project);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.description),
    ["Circular connector", "Rectangular connector"],
  );
});

test("contacts aggregate per physical termination with mixed parts kept separate", () => {
  const j1 = connector("X1", "", "");
  j1.pinCount = 3;
  const j2 = connector("X2", "", "");
  j2.pinCount = 1;
  const w1 = cable("cable", "W1", "", "", "1 m", 3);
  const project = projectWith(j1, w1, j2);
  addTermination(project, "left-1", j1, 1, w1, "left", {
    contact: { manufacturer: "HARTING", mpn: "CONTACT-A" },
  });
  addTermination(project, "left-2", j1, 2, w1, "left", {
    contact: { manufacturer: "HARTING", mpn: "CONTACT-A" },
  });
  addTermination(project, "left-3", j1, 3, w1, "left", {
    contact: { manufacturer: "HARTING", mpn: "CONTACT-B" },
  });
  addTermination(project, "right-1", j2, 1, w1, "right", {
    contact: { manufacturer: "HARTING", mpn: "CONTACT-A" },
  });

  const contacts = bom
    .buildBomRows(project)
    .filter((row) => row.category === "Crimp contact");
  assert.deepEqual(
    contacts.map(({ mpn, quantity, designators }) => ({
      mpn,
      quantity,
      designators,
    })),
    [
      {
        mpn: "CONTACT-A",
        quantity: 3,
        designators: ["X1:1", "X1:2", "X2:1"],
      },
      { mpn: "CONTACT-B", quantity: 1, designators: ["X1:3"] },
    ],
  );
});

test("different contacts at opposite ends of one conductor remain separate", () => {
  const j1 = connector("X1", "", "");
  const j2 = connector("X2", "", "");
  const w1 = cable("wire", "W1", "", "", "1 m");
  const project = projectWith(j1, w1, j2);
  addTermination(project, "left", j1, 1, w1, "left", {
    contact: { mpn: "LEFT-CONTACT" },
  });
  addTermination(project, "right", j2, 1, w1, "right", {
    contact: { mpn: "RIGHT-CONTACT" },
  });
  const contacts = bom
    .buildBomRows(project)
    .filter((row) => row.category === "Crimp contact");
  assert.deepEqual(
    contacts.map(({ manufacturer, mpn, quantity }) => ({
      manufacturer,
      mpn,
      quantity,
    })),
    [
      { manufacturer: "", mpn: "LEFT-CONTACT", quantity: 1 },
      { manufacturer: "", mpn: "RIGHT-CONTACT", quantity: 1 },
    ],
  );
});

test("no contact metadata contributes no contact row and seals aggregate independently", () => {
  const j1 = connector("X1", "", "");
  j1.pinCount = 2;
  const w1 = cable("cable", "W1", "", "", "1 m", 2);
  const project = projectWith(j1, w1);
  addTermination(project, "one", j1, 1, w1, "left", {
    seal: { manufacturer: "TE", mpn: "SEAL-A" },
  });
  addTermination(project, "two", j1, 2, w1, "left", {
    seal: { manufacturer: "TE", mpn: "SEAL-A" },
  });
  const rows = bom.buildBomRows(project);
  assert.equal(rows.some((row) => row.category === "Crimp contact"), false);
  const seal = rows.find((row) => row.category === "Wire seal");
  assert.equal(seal.quantity, 2);
  assert.deepEqual(seal.designators, ["X1:1", "X1:2"]);
});

test("manual additional components retain quantities and add to overlapping contacts", () => {
  const j1 = connector("X1", "", "");
  j1.pinCount = 2;
  j1.additionalComponents = [
    { type: "Backshell", manufacturer: "TE", mpn: "BACK-A", qty: 2 },
    {
      type: "Crimp contact",
      manufacturer: "TE",
      mpn: "CONTACT-A",
      qty: 5,
    },
    { type: "Cavity plug", mpn: "PLUG-A", qty: 1, qtyMultiplier: "pincount" },
  ];
  const w1 = cable("cable", "W1", "", "", "1 m", 2);
  const project = projectWith(j1, w1);
  addTermination(project, "one", j1, 1, w1, "left", {
    contact: { type: "Crimp contact", manufacturer: "TE", mpn: "CONTACT-A" },
  });
  addTermination(project, "two", j1, 2, w1, "left", {
    contact: { type: "Crimp contact", manufacturer: "TE", mpn: "CONTACT-A" },
  });
  const rows = bom.buildBomRows(project);
  assert.equal(rows.find((row) => row.mpn === "BACK-A").quantity, 2);
  assert.equal(rows.find((row) => row.mpn === "PLUG-A").quantity, 2);
  assert.equal(
    rows.filter((row) => row.mpn === "CONTACT-A").length,
    1,
  );
  assert.equal(rows.find((row) => row.mpn === "CONTACT-A").quantity, 7);
});

test("termination contacts are not counted from synthesized WireViz components", () => {
  const j1 = connector("X1", "", "");
  j1.pinCount = 2;
  const w1 = cable("cable", "W1", "", "", "1 m", 2);
  const project = projectWith(j1, w1);
  addTermination(project, "one", j1, 1, w1, "left", {
    contact: { mpn: "CONTACT-A" },
  });
  addTermination(project, "two", j1, 2, w1, "left", {
    contact: { mpn: "CONTACT-A" },
  });
  const row = bom.buildBomRows(project).find((item) => item.mpn === "CONTACT-A");
  assert.equal(row.quantity, 2);
});

test("identical cable MPNs sum normalized lengths without conductor multiplication", () => {
  const w1 = cable("cable", "W1", "LAPP", "CABLE-A", "2 m", 8);
  const w2 = cable("cable", "W2", "LAPP", "CABLE-A", "150 cm", 4);
  const w3 = cable("cable", "W3", "LAPP", "CABLE-B", "800 mm", 2);
  const rows = bom.buildBomRows(projectWith(w1, w2, w3));
  const cableA = rows.find((row) => row.mpn === "CABLE-A");
  assert.equal(cableA.quantity, 3.5);
  assert.equal(cableA.unit, "m");
  assert.deepEqual(cableA.designators, ["W1", "W2"]);
  assert.equal(rows.find((row) => row.mpn === "CABLE-B").quantity, 0.8);
});

test("bundle wire length counts each loose conductor", () => {
  const bundle = cable("bundle", "W1", "Example", "WIRE-A", "2 m", 3);
  const row = bom.buildBomRows(projectWith(bundle))[0];
  assert.equal(row.category, "Bundle wire");
  assert.equal(row.quantity, 6);
  assert.equal(row.unit, "m");
});

test("missing and malformed cable lengths export explicit piece rows", () => {
  const missing = cable("cable", "W1", "LAPP", "CABLE-A", "", 4);
  const malformed = cable("cable", "W2", "LAPP", "CABLE-A", "two metres", 4);
  const rows = bom.buildBomRows(projectWith(missing, malformed));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 2);
  assert.equal(rows[0].unit, "pcs");
  assert.match(rows[0].notes, /missing/);
  assert.match(rows[0].notes, /Unrecognized modeled length/);
});

test("length sums avoid floating point artifacts", () => {
  const rows = bom.buildBomRows(
    projectWith(
      cable("wire", "W1", "Example", "WIRE-A", "0.1 m"),
      cable("wire", "W2", "Example", "WIRE-A", "0.2 m"),
    ),
  );
  assert.equal(rows[0].quantity, 0.3);
  assert.match(bom.serializeBomCsv(rows), /,0\.3,m,/);
});

test("CSV escaping preserves commas, quotes, newlines, and Unicode", () => {
  const csv = bom.serializeBomCsv([
    {
      category: "Connector",
      manufacturer: "Müller GmbH",
      mpn: "A-1",
      description: 'Housing, size "A"',
      quantity: 1,
      unit: "pcs",
      designators: ["X1", "X2"],
      notes: "Line one\nLine two",
    },
  ]);
  assert.ok(csv.startsWith("\uFEFFItem,Category"));
  assert.match(csv, /Müller GmbH/);
  assert.match(csv, /"Housing, size ""A"""/);
  assert.match(csv, /"X1, X2"/);
  assert.match(csv, /"Line one\nLine two"/);
  assert.ok(csv.endsWith("\r\n"));
});

test("BOM rows and CSV are deterministic with natural designator ordering", () => {
  const project = projectWith(
    connector("X10", "HARTING", "A"),
    connector("X2", "HARTING", "A"),
    connector("X1", "HARTING", "A"),
    connector("J1", "Molex", "B"),
  );
  const rows = bom.buildBomRows(project);
  assert.deepEqual(
    rows.find((row) => row.mpn === "A").designators,
    ["X1", "X2", "X10"],
  );
  const first = bom.serializeBomCsv(rows);
  const second = bom.serializeBomCsv(bom.buildBomRows(project));
  assert.equal(first, second);
});

test("legacy projects without termination metadata export normally", () => {
  const component = connector("X1", "Legacy", "LEGACY-A");
  const migrated = model.normalizeProject({
    schemaVersion: 2,
    title: "Legacy BOM",
    components: [component],
    links: [],
  });
  const rows = bom.buildBomRows(migrated.project);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].mpn, "LEGACY-A");
  assert.equal(migrated.project.links[0]?.termination, undefined);
});

test("BOM filenames are sanitized with a stable fallback", () => {
  assert.equal(
    bom.bomFilenameForTitle(" Amplifier Main Harness "),
    "amplifier-main-harness.bom.csv",
  );
  assert.equal(bom.bomFilenameForTitle(""), "wireform-harness.bom.csv");
});

test("an empty project produces a deterministic header-only CSV", () => {
  assert.equal(
    bom.serializeBomCsv([]),
    "\uFEFFItem,Category,Manufacturer,MPN,Description,Qty,Unit,Designators,Approved Alternatives,Notes\r\n",
  );
});
