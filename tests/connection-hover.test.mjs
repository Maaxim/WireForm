import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const hover = await import("../app/connection-hover.ts");
const topology = await import("../app/connection-topology.ts");
const model = await import("../app/model.ts");
const twistedPair = await import("../app/twisted-pair.ts");

function component(kind, id, designator, count = 1) {
  const value = model.makeComponent(kind, 1, id);
  value.designator = designator;
  if (["wire", "cable", "bundle"].includes(kind)) {
    value.wireCount = count;
    value.conductorIds = Array.from({ length: count }, () =>
      model.createConductorId(),
    );
    value.wireLabels = Array.from({ length: count }, () => "");
    value.colors = Array.from({ length: count }, () => "BK");
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
  const project = model.createEmptyProject("Connection hover fixture");
  const j1 = component("connector", "j1", "J1");
  const j5 = component("connector", "j5", "J5");
  j1.pinCount = 12;
  j5.pinCount = 12;
  j1.pinLabels[2] = "A1";
  j5.pinLabels[9] = "B4";

  const wire = component("wire", "wire-1", "W1");
  wire.wireLabels = ["CAN_H"];
  const bundle = component("bundle", "bundle-1", "B1", 2);
  bundle.wireLabels = ["CAN_L", ""];

  project.components = [j5, bundle, wire, j1];
  project.links = [
    connect("wire-right", j5, 10, wire, 1, true),
    connect("wire-left", j1, 3, wire, 1),
    connect("bundle-left", j1, 4, bundle, 1),
    connect("bundle-right", j5, 2, bundle, 1, true),
  ];
  project.twistedPairs = [
    {
      id: "tp-4",
      designator: "TP4",
      members: [
        twistedPair.wireMember(wire.id),
        twistedPair.bundleConductorMember(bundle.id, bundle.conductorIds[0]),
      ],
      twistDirection: "unspecified",
    },
  ];
  return { project, j1, j5, wire, bundle };
}

test("standalone wire hover preserves physical pins, pin labels, label, and TP", () => {
  const { project, wire } = fixture();
  const info = hover.buildConnectionHoverInfoIndex(project).get(
    `${wire.id}:wire:1`,
  );
  assert.equal(info.primaryText, "J1:3 (A1) – J5:10 (B4)");
  assert.equal(info.secondaryText, "CAN_H · TP4");
  assert.equal(info.state, "connected");
});

test("bundle conductors use conductor-specific labels and generalized TP membership", () => {
  const { project, bundle } = fixture();
  const info = hover.buildConnectionHoverInfoIndex(project).get(
    `${bundle.id}:wire:1`,
  );
  assert.equal(info.primaryText, "J1:4 – J5:2");
  assert.equal(info.secondaryText, "CAN_L · TP4");
  assert.equal(info.twistedPairDesignator, "TP4");
});

test("optional metadata produces label-only, TP-only, or no second line", () => {
  const { project, wire, bundle } = fixture();
  project.twistedPairs = [];
  let index = hover.buildConnectionHoverInfoIndex(project);
  assert.equal(index.get(`${wire.id}:wire:1`).secondaryText, "CAN_H");
  assert.equal(index.get(`${bundle.id}:wire:2`).secondaryText, undefined);

  wire.wireLabels[0] = "";
  project.twistedPairs = [
    {
      id: "tp-only",
      designator: "TP8",
      members: [
        twistedPair.wireMember(wire.id),
        twistedPair.bundleConductorMember(bundle.id, bundle.conductorIds[1]),
      ],
      twistDirection: "unspecified",
    },
  ];
  index = hover.buildConnectionHoverInfoIndex(project);
  assert.equal(index.get(`${wire.id}:wire:1`).secondaryText, "TP8");
});

test("a conductor label matching its TP is not duplicated", () => {
  const { project, wire } = fixture();
  wire.wireLabels[0] = "TP4";
  const info = hover.buildConnectionHoverInfoIndex(project).get(
    `${wire.id}:wire:1`,
  );
  assert.equal(info.secondaryText, "TP4");
});

test("open, unresolved, and multidrop endpoints are explicit and safe", () => {
  const { project, j1, j5, bundle } = fixture();
  const openWire = component("wire", "open-wire", "W2");
  project.components.push(openWire);
  project.links.push(connect("open", j1, 6, openWire, 1));

  const brokenWire = component("wire", "broken-wire", "W3");
  project.components.push(brokenWire);
  project.links.push({
    id: "broken",
    from: { nodeId: brokenWire.id, portId: "wire:1", side: "left" },
    to: { nodeId: "missing", portId: "pin:1", side: "right" },
  });

  const multiWire = component("wire", "multi-wire", "W4");
  const j8 = component("connector", "j8", "J8");
  j8.pinCount = 8;
  project.components.push(multiWire);
  project.components.push(j8);
  project.links.push(
    connect("multi-j5", j5, 8, multiWire, 1),
    connect("multi-j1", j1, 7, multiWire, 1),
    connect("multi-third", j8, 4, multiWire, 1),
  );

  const index = hover.buildConnectionHoverInfoIndex(project);
  assert.equal(index.get(`${openWire.id}:wire:1`).primaryText, "J1:6 – OPEN");
  assert.equal(index.get(`${openWire.id}:wire:1`).state, "open");
  assert.equal(
    index.get(`${brokenWire.id}:wire:1`).primaryText,
    "UNRESOLVED – OPEN",
  );
  assert.equal(index.get(`${brokenWire.id}:wire:1`).state, "unresolved");
  assert.equal(
    index.get(`${multiWire.id}:wire:1`).primaryText,
    "J1:7 → J5:8, J8:4",
  );
  assert.equal(index.get(`${multiWire.id}:wire:1`).state, "multidrop");
  assert.equal(bundle.wireLabels[0], "CAN_L");
});

test("both rendered link halves resolve to the same stable physical member", () => {
  const { project, wire } = fixture();
  const keys = project.links
    .filter((link) => link.id.startsWith("wire-"))
    .map((link) =>
      topology.physicalConnectionMemberKey(
        topology.getPhysicalConnectionMemberForLink(project, link),
      ),
    );
  assert.deepEqual(keys, [`${wire.id}:wire:1`, `${wire.id}:wire:1`]);
});

test("interactive SVG uses stable identity, wide hit paths, custom tooltip, and exact-member hover", async () => {
  const [source, css, htmlSource, pdfSource] = await Promise.all([
    readFile(new URL("../app/HarnessStudio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/html-report.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/pdf-report.ts", import.meta.url), "utf8"),
  ]);
  assert.match(source, /data-connection-member-id=\{connectionMemberKey\}/);
  assert.match(source, /onPointerEnter=/);
  assert.match(source, /onPointerMove=/);
  assert.match(source, /onPointerLeave=/);
  assert.match(source, /connectionMemberKey === hoveredConnectionMember/);
  assert.match(source, /className="connection-hover-tooltip"/);
  assert.match(css, /\.connection-hit[\s\S]*stroke-width:\s*14/);
  assert.match(css, /\.connection-hover-tooltip[\s\S]*pointer-events:\s*none/);
  assert.doesNotMatch(htmlSource, /connection-hover-tooltip/);
  assert.doesNotMatch(pdfSource, /connection-hover-tooltip/);
});
