import assert from "node:assert/strict";
import test from "node:test";

const model = await import("../app/model.ts");
const libraryTools = await import("../app/library.ts");
const terminationTools = await import("../app/termination.ts");
const wirevizImport = await import("../app/wireviz-import.ts");

test("schema-1 projects migrate and round-trip through the project file", () => {
  const schema1 = {
    schemaVersion: 1,
    title: "Legacy Harness",
    revision: "B",
    company: "Example",
    components: [
      {
        ...model.makeComponent("connector", 1, "legacy-j1"),
        photo: {
          dataUrl:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA",
          fileName: "j1.png",
          mimeType: "image/png",
          width: 1,
          height: 1,
          alt: "J1",
        },
      },
    ],
    links: [],
  };

  const migrated = model.normalizeProject(schema1);
  assert.equal(migrated.migratedFrom, 1);
  assert.equal(migrated.project.schemaVersion, 3);
  assert.match(migrated.project.projectId, /^project-/);
  assert.equal(migrated.project.components[0].photo.alt, "J1");

  const serialized = model.serializeProjectFile(migrated.project);
  const reopened = model.parseProjectFile(serialized);
  assert.equal(reopened.project.title, "Legacy Harness");
  assert.equal(reopened.project.components[0].photo.fileName, "j1.png");
});

test("schema-2 projects migrate without inventing termination metadata", () => {
  const connector = model.makeComponent("connector", 1, "legacy-j1");
  const cable = model.makeComponent("wire", 1, "legacy-w1");
  const migrated = model.normalizeProject({
    schemaVersion: 2,
    projectId: "legacy-project",
    title: "Schema 2 Harness",
    revision: "A",
    company: "",
    components: [connector, cable],
    links: [
      {
        id: "legacy-link",
        from: { nodeId: connector.id, portId: "pin:1", side: "right" },
        to: { nodeId: cable.id, portId: "wire:1", side: "left" },
      },
    ],
  });

  assert.equal(migrated.migratedFrom, 2);
  assert.equal(migrated.project.schemaVersion, 3);
  assert.equal(migrated.project.links[0].termination, undefined);
});

test("termination contact, seal, and manufacturing metadata round-trip", () => {
  const connector = model.makeComponent("connector", 1, "j1");
  const cable = model.makeComponent("wire", 1, "w1");
  const project = model.createEmptyProject("Termination round trip");
  project.components = [connector, cable];
  project.links = [
    {
      id: "termination-link",
      from: { nodeId: connector.id, portId: "pin:1", side: "right" },
      to: { nodeId: cable.id, portId: "wire:1", side: "left" },
      termination: {
        contact: {
          type: "Crimp contact",
          subtype: "Female contact",
          pn: "CONTACT-INTERNAL",
          manufacturer: "HARTING",
          mpn: "09 15 200 6224",
          supplier: "Example distributor",
          spn: "DIST-123",
        },
        seal: {
          type: "Wire seal",
          manufacturer: "HARTING",
          mpn: "SEAL-1",
        },
        stripLength: "5 mm",
        tooling: "Applicator A",
        notes: "Inspect crimp height",
      },
    },
  ];

  const reopened = model.parseProjectFile(model.serializeProjectFile(project));
  assert.deepEqual(
    reopened.project.links[0].termination,
    project.links[0].termination,
  );
});

test("invalid nested termination values are ignored without crashing", () => {
  const connector = model.makeComponent("connector", 1, "j1");
  const cable = model.makeComponent("wire", 1, "w1");
  const parsed = model.normalizeProject({
    schemaVersion: 3,
    title: "Malformed nested values",
    components: [connector, cable],
    links: [
      {
        id: "link-1",
        from: { nodeId: connector.id, portId: "pin:1", side: "right" },
        to: { nodeId: cable.id, portId: "wire:1", side: "left" },
        termination: {
          contact: { type: "Crimp contact", mpn: 123, unknown: "ignored" },
          seal: ["invalid"],
          stripLength: { value: 5 },
          tooling: false,
        },
      },
    ],
  });

  assert.deepEqual(parsed.project.links[0].termination, {
    contact: { type: "Crimp contact" },
  });
});

function aggregationProject() {
  const project = model.createEmptyProject("Contact aggregation");
  const j1 = model.makeComponent("connector", 1, "j1");
  j1.designator = "J1";
  j1.pinCount = 4;
  const j2 = model.makeComponent("connector", 2, "j2");
  j2.designator = "J2";
  j2.pinCount = 3;
  const cable = model.makeComponent("cable", 1, "w1");
  cable.designator = "W1";
  cable.wireCount = 3;
  project.components = [j1, cable, j2];
  const contactA = { manufacturer: "HARTING", mpn: "CONTACT-A" };
  const contactB = { manufacturer: "HARTING", mpn: "CONTACT-B" };
  for (let pin = 1; pin <= 3; pin += 1) {
    project.links.push(
      {
        id: `j1-${pin}`,
        from: { nodeId: j1.id, portId: `pin:${pin}`, side: "right" },
        to: { nodeId: cable.id, portId: `wire:${pin}`, side: "left" },
        termination: { contact: pin < 3 ? contactA : contactB },
      },
      {
        id: `j2-${pin}`,
        from: { nodeId: cable.id, portId: `wire:${pin}`, side: "right" },
        to: { nodeId: j2.id, portId: `pin:${pin}`, side: "left" },
        termination: {
          contact: { manufacturer: "TE", mpn: `RIGHT-${pin}` },
        },
      },
    );
  }
  return { project, j1, j2, cable };
}

test("WireViz aggregation keeps mixed contacts separate with explicit quantities", () => {
  const { project, j1, j2 } = aggregationProject();
  const left = terminationTools.collectConnectorAdditionalComponents(project, j1.id);
  assert.deepEqual(left, [
    {
      type: "Crimp contact",
      manufacturer: "HARTING",
      mpn: "CONTACT-A",
      qty: 2,
    },
    {
      type: "Crimp contact",
      manufacturer: "HARTING",
      mpn: "CONTACT-B",
      qty: 1,
    },
  ]);
  assert.ok(left.every((item) => !("qty_multiplier" in item)));

  const right = terminationTools.collectConnectorAdditionalComponents(project, j2.id);
  assert.deepEqual(
    right.map(({ mpn, qty }) => ({ mpn, qty })),
    [
      { mpn: "RIGHT-1", qty: 1 },
      { mpn: "RIGHT-2", qty: 1 },
      { mpn: "RIGHT-3", qty: 1 },
    ],
  );
});

test("connectors without contact metadata gain no additional components", () => {
  const project = model.createEmptyProject("No contacts");
  const connector = model.makeComponent("connector", 1, "j1");
  project.components = [connector];
  assert.deepEqual(
    terminationTools.collectConnectorAdditionalComponents(project, connector.id),
    [],
  );
});

test("manual connector components are preserved and exact contacts are de-duplicated", () => {
  const { project, j1 } = aggregationProject();
  j1.additionalComponents = [
    { type: "Backshell", manufacturer: "Example", mpn: "BACK-1", qty: 1 },
    {
      type: "Crimp contact",
      manufacturer: "HARTING",
      mpn: "CONTACT-A",
      qty: 1,
    },
  ];
  const components = terminationTools.collectConnectorAdditionalComponents(
    project,
    j1.id,
  );
  assert.deepEqual(components[0], {
    type: "Backshell",
    manufacturer: "Example",
    mpn: "BACK-1",
    qty: 1,
  });
  assert.equal(
    components.filter((component) => component.mpn === "CONTACT-A").length,
    1,
  );
  assert.equal(
    components.find((component) => component.mpn === "CONTACT-A").qty,
    3,
  );
});

test("history snapshots and pasted links isolate nested termination data", () => {
  const { project } = aggregationProject();
  const before = model.cloneProject(project);
  project.links[0].termination.contact.mpn = "EDITED";
  assert.equal(before.links[0].termination.contact.mpn, "CONTACT-A");

  const nodeIds = new Map([
    ["j1", "j1-copy"],
    ["w1", "w1-copy"],
  ]);
  const pasted = model.remapTopologyLink(
    before.links[0],
    "copy-link",
    nodeIds,
  );
  pasted.termination.contact.mpn = "PASTED-CONTACT";
  assert.equal(before.links[0].termination.contact.mpn, "CONTACT-A");
  assert.equal(pasted.from.nodeId, "j1-copy");
  assert.equal(pasted.to.nodeId, "w1-copy");
});

test("deleting and reconnecting a wire end does not retain its old termination", () => {
  const { project } = aggregationProject();
  const removed = project.links.shift();
  assert.ok(removed?.termination);
  project.links.push({
    id: "reconnected",
    from: removed.from,
    to: removed.to,
  });
  assert.equal(project.links.at(-1).termination, undefined);
});

test("termination validation reports malformed strip lengths and invalid link kinds", () => {
  const connectorA = model.makeComponent("connector", 1, "j1");
  const connectorB = model.makeComponent("connector", 2, "j2");
  const project = model.createEmptyProject("Invalid termination");
  project.components = [connectorA, connectorB];
  project.links = [
    {
      id: "invalid-link",
      from: { nodeId: connectorA.id, portId: "pin:1", side: "right" },
      to: { nodeId: connectorB.id, portId: "pin:1", side: "left" },
      termination: {
        contact: { mpn: "CONTACT" },
        stripLength: "five-ish",
      },
    },
  ];
  const warnings = terminationTools.validateTerminationMetadata(project);
  assert.ok(warnings.some((warning) => warning.includes("not a connector-pin")));
  assert.ok(warnings.some((warning) => warning.includes("invalid strip length")));
});

test("WireViz YAML import builds components, parallel links, and a report", () => {
  const candidate = wirevizImport.importWireVizYaml(
    `
metadata:
  title: Imported Harness
  revision: C
connectors:
  J1:
    type: Controller
    pincount: 2
    pinlabels: [POWER, RETURN]
    additional_components:
      - type: Backshell
        manufacturer: Example
        mpn: BACK-1
        qty: 1
  J2:
    type: Load
    pincount: 2
cables:
  W1:
    wirecount: 2
    colors: [RD, BK]
    wirelabels: [POWER, RETURN]
connections:
  - - J1: [1, 2]
    - W1: [1, 2]
    - J2: [1, 2]
additional_bom_items:
  - description: Tie wrap
`,
    "import.yml",
  );

  assert.equal(candidate.project.title, "Imported Harness");
  assert.equal(candidate.project.components.length, 3);
  assert.equal(candidate.project.links.length, 4);
  assert.equal(candidate.report.components, 3);
  assert.equal(candidate.report.links, 4);
  assert.deepEqual(candidate.project.components[0].additionalComponents, [
    {
      type: "Backshell",
      manufacturer: "Example",
      mpn: "BACK-1",
      qty: 1,
    },
  ]);
  assert.ok(
    candidate.report.warnings.some((message) =>
      message.includes("no per-pin termination assignments were inferred"),
    ),
  );
  assert.ok(
    candidate.report.unsupported.some((message) =>
      message.includes("Additional BOM"),
    ),
  );
});

test("named libraries preserve photos and honor duplicate policies", () => {
  const connector = model.makeComponent("connector", 1, "connector-j1");
  connector.name = "DT Connector";
  connector.manufacturer = "Example";
  connector.mpn = "DT-4";
  connector.photo = {
    dataUrl:
      "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2Q==",
    fileName: "dt.jpg",
    mimeType: "image/jpeg",
    width: 1,
    height: 1,
    alt: "DT connector",
  };
  const template = libraryTools.componentToTemplate(connector);
  const userLibrary = libraryTools.createLibrary("Connectors");

  let result = libraryTools.mergeTemplates(userLibrary, [template], "keep");
  assert.deepEqual(result, { added: 1, replaced: 0, skipped: 0 });
  result = libraryTools.mergeTemplates(userLibrary, [template], "skip");
  assert.deepEqual(result, { added: 0, replaced: 0, skipped: 1 });
  result = libraryTools.mergeTemplates(userLibrary, [template], "replace");
  assert.deepEqual(result, { added: 0, replaced: 1, skipped: 0 });
  assert.equal(userLibrary.templates[0].component.photo.alt, "DT connector");

  const collection = {
    schemaVersion: 1,
    activeLibraryId: userLibrary.id,
    libraries: [userLibrary],
  };
  const backup = libraryTools.serializeLibraryBackup(collection);
  const restored = libraryTools.parseLibraryFile(backup);
  assert.equal(restored.kind, "backup");
  assert.equal(restored.collection.libraries[0].templates.length, 1);
  assert.equal(
    restored.collection.libraries[0].templates[0].component.photo.fileName,
    "dt.jpg",
  );
});
