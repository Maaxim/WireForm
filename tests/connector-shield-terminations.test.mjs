import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const model = await import("../app/model.ts");
const shields = await import("../app/connector-shields.ts");
const routing = await import("../app/shield-routing.ts");
const annotations = await import("../app/diagram-annotations.ts");
const reports = await import("../app/html-report.ts");
const pdf = await import("../app/pdf-report.ts");
const hover = await import("../app/connection-hover.ts");
const library = await import("../app/library.ts");
const bom = await import("../app/bom.ts");

function fixture() {
  const project = model.createEmptyProject("Connector shields");
  const j1 = model.makeComponent("connector", 1, "j1");
  const j2 = model.makeComponent("connector", 2, "j2");
  const cable = model.makeComponent("cable", 1, "w1");
  j1.designator = "J1";
  j2.designator = "J2";
  cable.designator = "W1";
  cable.shield = true;
  const shell = {
    id: "shell-a",
    label: "Chassis",
    manufacturer: "Harting",
    mpn: "SH-100",
    stripLength: "20 mm",
    note: "Bond locally",
  };
  j1.shieldTerminations = [shell];
  project.components = [j1, cable, j2];
  project.links = [{
    id: "shield-link",
    from: {
      nodeId: j1.id,
      portId: model.connectorShieldPortId(shell.id),
      side: "right",
    },
    to: { nodeId: cable.id, portId: "shield", side: "left" },
  }];
  return { project, j1, j2, cable, shell };
}

test("connector shield terminations persist without changing pin count", () => {
  const { project, j1 } = fixture();
  const pinCount = j1.pinCount;
  const parsed = model.normalizeProject(JSON.parse(model.serializeProjectFile(project))).project;
  assert.equal(parsed.components[0].pinCount, pinCount);
  assert.deepEqual(parsed.components[0].shieldTerminations, j1.shieldTerminations);
  parsed.components[0].shieldTerminations[0].label = "Shell";
  assert.equal(parsed.links[0].from.portId, "connector-shield:shell-a");
});

test("multiple stable shield IDs normalize and duplicate IDs are regenerated", () => {
  const { project, j1 } = fixture();
  j1.shieldTerminations.push({ id: "shell-a", label: "Shell 2" });
  const parsed = model.normalizeProject(project).project.components[0];
  assert.equal(parsed.shieldTerminations.length, 2);
  assert.notEqual(parsed.shieldTerminations[0].id, parsed.shieldTerminations[1].id);
});

test("dedicated and numbered-pin shield connections coexist", () => {
  const { project, j2, cable } = fixture();
  project.links.push({
    id: "numbered-shield",
    from: { nodeId: cable.id, portId: "shield", side: "right" },
    to: { nodeId: j2.id, portId: "pin:4", side: "left" },
  });
  const resolved = routing.resolveShieldTerminations(project, cable);
  assert.equal(resolved[0].endpoint.kind, "shield");
  assert.deepEqual(resolved[1].endpoint, { kind: "pin", physicalPin: 4 });
  assert.deepEqual(routing.buildWireVizShieldConnections(project, cable), [
    [{ W1: "s" }, { J2: 4 }],
  ]);
  assert.deepEqual(routing.buildConnectorShieldDiagramRoutes(project), [{
    cableDesignator: "W1",
    cableSide: "left",
    connectorDesignator: "J1",
    shieldTerminationId: "shell-a",
    shieldLabel: "Chassis",
  }]);
});

test("native diagram routes add a dedicated connector port and local edge", () => {
  const dot = `graph harness {
  J1 [label=<<table><tr><td>J1</td></tr></table>>]
  W1 [label=<<table><tr><td></td><td>Shield</td><td></td></tr><tr><td colspan="3" port="ws"></td></tr></table>>]
}`;
  const result = annotations.prepareHarnessDiagramDot(dot, [{
    cableDesignator: "W1",
    cableSide: "left",
    connectorDesignator: "J1",
    shieldTerminationId: "shell-a",
    shieldLabel: "Chassis",
  }]);
  assert.match(
    result,
    /port="connector_shield_73_68_65_6c_6c_2d_61" align="center" valign="middle">Chassis/,
  );
  assert.match(result, /"J1":connector_shield_73_68_65_6c_6c_2d_61:e -- "W1":shield_l:w/);
  assert.doesNotMatch(result, /pin:0|pin:-1|pin:SHIELD/i);
});

test("all dedicated shield rows center custom labels without changing route sides", () => {
  const dot = `graph harness {
  J1 [label=<<table><tr><td align="left" port="p1">1</td></tr></table>>]
  W1 [label=<<table><tr><td></td><td>Shield</td><td></td></tr><tr><td colspan="3" port="ws"></td></tr></table>>]
  W2 [label=<<table><tr><td></td><td>Shield</td><td></td></tr><tr><td colspan="3" port="ws"></td></tr></table>>]
}`;
  const result = annotations.prepareHarnessDiagramDot(dot, [
    {
      cableDesignator: "W1",
      cableSide: "left",
      connectorDesignator: "J1",
      shieldTerminationId: "shell-a",
      shieldLabel: "Shell",
    },
    {
      cableDesignator: "W2",
      cableSide: "right",
      connectorDesignator: "J1",
      shieldTerminationId: "chassis-b",
      shieldLabel: "Chassis",
    },
  ]);
  assert.match(
    result,
    /port="connector_shield_73_68_65_6c_6c_2d_61" align="center" valign="middle">Shell/,
  );
  assert.match(
    result,
    /port="connector_shield_63_68_61_73_73_69_73_2d_62" align="center" valign="middle">Chassis/,
  );
  assert.match(
    result,
    /"J1":connector_shield_73_68_65_6c_6c_2d_61:e -- "W1":shield_l:w/,
  );
  assert.match(
    result,
    /"W2":shield_r:e -- "J1":connector_shield_63_68_61_73_73_69_73_2d_62:w/,
  );
  assert.match(result, /<td align="left" port="p1">1<\/td>/);
});

test("hover and reports use the shield label without a fake pin", () => {
  const { project } = fixture();
  const info = hover.buildConnectionHoverInfoIndex(project).get("w1:shield");
  assert.match(info.primaryText, /J1:Chassis/);
  assert.doesNotMatch(info.primaryText, /J1:\d/);
  const report = reports.buildHarnessReportModel(
    project,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
  );
  assert.deepEqual(report.connectors[0].shieldTerminations, [
    { label: "Chassis", connectedTo: "W1:shield" },
  ]);
  assert.equal(report.terminations[0].pin, "Chassis");
  assert.equal(report.terminations[0].contactManufacturer, "Harting");
  assert.equal(report.terminations[0].contactMpn, "SH-100");
  assert.equal(report.terminations[0].stripLength, "20 mm");
  const html = reports.renderHarnessReportHtml(report);
  assert.match(html, /Shield Terminations/);
  assert.match(html, /Chassis/);
  const pdfText = JSON.stringify(pdf.buildHarnessPdfDocument(report));
  assert.match(pdfText, /Shield Terminations/);
  assert.match(pdfText, /Chassis/);
});

test("copy remapping assigns a fresh nested shield identity to topology", () => {
  const { project, j1 } = fixture();
  const clone = shields.cloneConnectorShieldTerminationsWithNewIds(
    j1.shieldTerminations,
  );
  const nodeIds = new Map([[j1.id, "j1-copy"]]);
  const portIds = new Map(
    [...clone.portIds].map(([oldPort, newPort]) => [
      `${j1.id}/${oldPort}`,
      newPort,
    ]),
  );
  const copied = model.remapTopologyLink(
    project.links[0],
    "copied-link",
    nodeIds,
    portIds,
  );
  assert.equal(copied.from.nodeId, "j1-copy");
  assert.equal(
    model.connectorShieldTerminationIdFromPort(copied.from.portId),
    clone.terminations[0].id,
  );
  assert.notEqual(copied.from.portId, project.links[0].from.portId);
});

test("library instantiation preserves metadata and regenerates nested IDs", () => {
  const { j1 } = fixture();
  const template = library.componentToTemplate(j1);
  const inserted = library.instantiateTemplate(template, 8);
  assert.equal(inserted.shieldTerminations[0].label, "Chassis");
  assert.notEqual(inserted.shieldTerminations[0].id, j1.shieldTerminations[0].id);
});

test("connected shield hardware contributes once to the native BOM", () => {
  const { project } = fixture();
  const row = bom.buildBomRows(project).find((candidate) => candidate.mpn === "SH-100");
  assert.equal(row.quantity, 1);
  assert.deepEqual(row.designators, ["J1:Chassis"]);
});

test("editor exposes separate shield controls and WireViz builder has no custom key", async () => {
  const source = await readFile(new URL("../app/HarnessStudio.tsx", import.meta.url), "utf8");
  assert.match(source, /Shield terminations/);
  assert.match(source, /connectorShieldPortId/);
  const builder = source.slice(
    source.indexOf("export function buildWireVizDocument"),
    source.indexOf("function validateProject"),
  );
  assert.doesNotMatch(builder, /shieldTerminations\s*[:=]/);
  assert.doesNotMatch(builder, /connector-shield/);
});

test("malformed strip lengths and missing shield references fail safely", () => {
  const { project, j1 } = fixture();
  j1.shieldTerminations[0].stripLength = "wrong";
  assert.match(shields.validateConnectorShieldTerminations(project)[0], /invalid strip length/);
  project.links[0].from.portId = "connector-shield:missing";
  assert.equal(routing.resolveShieldTerminations(project, project.components[1]).length, 0);
});
