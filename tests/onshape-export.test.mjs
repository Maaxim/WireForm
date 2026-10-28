import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { buildBomRows } from "../app/bom.ts";
import {
  buildConnectionMappingRows,
} from "../app/connection-mapping.ts";
import {
  ONSHAPE_CSV_PROFILE,
  buildOnshapeCableWireExport,
  convertColorForOnshape,
  convertGaugeForOnshape,
  onshapeCsvFilenameForTitle,
  onshapeExportHasErrors,
  onshapeExportHasWarnings,
  onshapeWireId,
  serializeOnshapeCableWireCsv,
} from "../app/onshape-export.ts";
import {
  createEmptyProject,
  makeComponent,
} from "../app/model.ts";

function addConnector(project, designator, pinCount, id = `connector-${designator}`) {
  const connector = makeComponent("connector", project.components.length + 1, id);
  connector.designator = designator;
  connector.pinCount = pinCount;
  connector.pinLabels = Array.from({ length: pinCount }, () => "");
  project.components.push(connector);
  return connector;
}

function addCable(
  project,
  kind,
  designator,
  count,
  id = `${kind}-${designator}`,
) {
  const component = makeComponent(kind, project.components.length + 1, id);
  component.designator = designator;
  component.wireCount = count;
  component.conductorIds = Array.from(
    { length: count },
    (_, index) => `${id}-conductor-${index + 1}`,
  );
  component.wireLabels = Array.from({ length: count }, () => "");
  component.colors = Array.from({ length: count }, () => "RD");
  component.gauge = "24 AWG";
  project.components.push(component);
  return component;
}

function link(project, id, fromNode, fromPort, toNode, toPort) {
  project.links.push({
    id,
    from: { nodeId: fromNode.id, portId: fromPort, side: "right" },
    to: { nodeId: toNode.id, portId: toPort, side: "left" },
  });
}

function connectAll(project, cable, left, right, pinOffset = 0) {
  for (let index = 0; index < cable.wireCount; index += 1) {
    const conductor = index + 1;
    const pin = pinOffset + conductor;
    link(project, `${cable.id}-left-${conductor}`, left, `pin:${pin}`, cable, `wire:${conductor}`);
    link(project, `${cable.id}-right-${conductor}`, cable, `wire:${conductor}`, right, `pin:${pin}`);
  }
}

function completeProject(kind = "wire", count = 1, designator = "W1") {
  const project = createEmptyProject("Onshape export fixture");
  const j1 = addConnector(project, "J1", Math.max(count, 1));
  const j2 = addConnector(project, "J2", Math.max(count, 1));
  const cable = addCable(project, kind, designator, count);
  connectAll(project, cable, j1, j2);
  return { project, j1, j2, cable };
}

function issueCodes(result) {
  return new Set(result.issues.map((candidate) => candidate.code));
}

test("standalone wire exports exactly once with physical pins, not pin labels", () => {
  const { project, j1, j2, cable } = completeProject("wire", 1);
  j1.pinLabels[0] = "CAN+";
  j2.pinLabels[0] = "AUX1";
  cable.wireLabels[0] = "CAN_H";

  const result = buildOnshapeCableWireExport(project);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0], {
    wireId: onshapeWireId(cable.id, cable.conductorIds[0]),
    fromRef: "J1",
    toRef: "J2",
    fromPin: "1",
    toPin: "1",
    gauge: "24",
    color: "red",
  });
  assert.equal(result.totals.byKind.wire.exported, 1);
  assert.equal(onshapeExportHasErrors(result), false);
});

test("bundle exports one row per conductor with stable IDs independent of array order", () => {
  const { project, cable } = completeProject("bundle", 4);
  cable.colors = ["RD", "BK", "GN", "BU"];
  cable.conductorLengthOverrides = {
    [cable.conductorIds[0]]: "1.5 m",
    [cable.conductorIds[3]]: "2 m",
  };
  const first = buildOnshapeCableWireExport(project);
  const firstIds = first.rows.map((row) => row.wireId).sort();

  cable.conductorIds.reverse();
  cable.colors.reverse();
  cable.wireLabels.reverse();
  const reordered = buildOnshapeCableWireExport(project);
  assert.equal(first.rows.length, 4);
  assert.equal(reordered.rows.length, 4);
  assert.deepEqual(reordered.rows.map((row) => row.wireId).sort(), firstIds);
  assert.equal(reordered.totals.byKind["bundle-conductor"].exported, 4);
  assert.ok(reordered.rows.every((row) => !("length" in row)));
});

test("multicore cable exports eight conductor rows and never a whole-cable duplicate", () => {
  const { project } = completeProject("cable", 8);
  const result = buildOnshapeCableWireExport(project);
  assert.equal(result.rows.length, 8);
  assert.equal(new Set(result.rows.map((row) => row.wireId)).size, 8);
  assert.equal(result.totals.byKind["cable-conductor"].exported, 8);
});

test("endpoint orientation exactly matches Connection Mapping normalization", () => {
  const { project, cable } = completeProject("wire", 1);
  project.links.reverse();
  const mapping = buildConnectionMappingRows(project)[0];
  const exported = buildOnshapeCableWireExport(project).rows[0];
  assert.equal(exported.fromRef, mapping.from.connectorDesignator);
  assert.equal(exported.fromPin, String(mapping.from.physicalPin));
  assert.equal(exported.toRef, mapping.to.connectorDesignator);
  assert.equal(exported.toPin, String(mapping.to.physicalPin));
  assert.equal(exported.wireId, onshapeWireId(cable.id, cable.conductorIds[0]));
});

test("duplicate persistent conductor identities are detected and cannot export", () => {
  const { project, cable } = completeProject("bundle", 2);
  cable.conductorIds[1] = cable.conductorIds[0];
  const result = buildOnshapeCableWireExport(project);
  assert.equal(result.rows.length, 0);
  assert.equal(result.totals.excluded, 2);
  assert.ok(issueCodes(result).has("DUPLICATE_WIRE_ID"));
  assert.equal(onshapeExportHasErrors(result), true);
});

test("export is pure and does not alter project JSON or BOM", () => {
  const { project } = completeProject("bundle", 4);
  const projectBefore = JSON.stringify(project);
  const bomBefore = JSON.stringify(buildBomRows(project));
  buildOnshapeCableWireExport(project);
  assert.equal(JSON.stringify(project), projectBefore);
  assert.equal(JSON.stringify(buildBomRows(project)), bomBefore);
});

test("missing connector, missing pin, dangling and multidrop topology are explicit errors", async (context) => {
  await context.test("missing connector", () => {
    const { project } = completeProject("wire", 1);
    project.links[0].from.nodeId = "missing-connector";
    const result = buildOnshapeCableWireExport(project);
    assert.equal(result.rows.length, 0);
    assert.ok(issueCodes(result).has("UNRESOLVED_ENDPOINT"));
  });
  await context.test("missing physical pin", () => {
    const { project } = completeProject("wire", 1);
    project.links[0].from.portId = "pin:99";
    const result = buildOnshapeCableWireExport(project);
    assert.equal(result.rows.length, 0);
    assert.ok(issueCodes(result).has("UNRESOLVED_ENDPOINT"));
  });
  await context.test("dangling conductor", () => {
    const { project } = completeProject("wire", 1);
    project.links.pop();
    const result = buildOnshapeCableWireExport(project);
    assert.equal(result.rows.length, 0);
    assert.ok(issueCodes(result).has("OPEN_ENDPOINT"));
  });
  await context.test("multidrop conductor", () => {
    const { project, cable } = completeProject("wire", 1);
    const j3 = addConnector(project, "J3", 1);
    link(project, "third-end", cable, "wire:1", j3, "pin:1");
    const result = buildOnshapeCableWireExport(project);
    assert.equal(result.rows.length, 0);
    assert.ok(issueCodes(result).has("MULTIDROP_UNSUPPORTED"));
  });
});

test("shield topology is omitted with warning and cannot create a fake numbered row", () => {
  const { project, j1, cable } = completeProject("cable", 1);
  cable.shield = true;
  link(project, "shield-link", j1, "pin:1", cable, "shield");
  const result = buildOnshapeCableWireExport(project);
  assert.equal(result.rows.length, 1);
  assert.equal(result.totals.omittedShields, 1);
  assert.ok(issueCodes(result).has("SHIELD_OMITTED"));
  assert.equal(onshapeExportHasWarnings(result), true);
  assert.ok(result.rows.every((row) => row.fromPin !== "Shield" && row.toPin !== "Shield"));
});

test("twisted-pair members remain separate rows and add no invented CSV columns", () => {
  const project = createEmptyProject("Twisted pair export");
  const j1 = addConnector(project, "J1", 4);
  const j2 = addConnector(project, "J2", 4);
  const w1 = addCable(project, "wire", "W1", 1, "wire-one");
  const w2 = addCable(project, "wire", "W2", 1, "wire-two");
  const bundle = addCable(project, "bundle", "B1", 2, "bundle-one");
  connectAll(project, w1, j1, j2, 0);
  connectAll(project, w2, j1, j2, 1);
  connectAll(project, bundle, j1, j2, 2);
  project.twistedPairs = [
    {
      id: "pair-wire",
      designator: "TP1",
      members: [
        { kind: "wire", wireId: w1.id },
        { kind: "wire", wireId: w2.id },
      ],
      twistDirection: "unspecified",
    },
    {
      id: "pair-bundle",
      designator: "TP2",
      members: bundle.conductorIds.map((conductorId) => ({
        kind: "bundle-conductor",
        bundleId: bundle.id,
        conductorId,
      })),
      twistDirection: "Z",
    },
  ];
  const result = buildOnshapeCableWireExport(project);
  assert.equal(result.rows.length, 4);
  assert.equal(
    result.issues.filter((candidate) => candidate.code === "TWISTED_PAIR_METADATA_OMITTED").length,
    2,
  );
  assert.deepEqual(Object.keys(result.rows[0]), [
    "wireId",
    "fromRef",
    "toRef",
    "fromPin",
    "toPin",
    "gauge",
    "color",
  ]);
});

const COLOR_CASES = [
  ["BK", "black"],
  ["RD", "red"],
  ["BU", "blue"],
  ["GN", "green"],
  ["WH", "white"],
  ["BN", "brown"],
  ["GNYE", "green/yellow"],
  ["OGWH", "orange/white"],
  ["GNWH", "green/white"],
  ["BUWH", "blue/white"],
  ["WHBU", "white/blue"],
  ["BNWH", "brown/white"],
];

test("solid and ordered bicolor codes export lowercase English names", () => {
  assert.equal(ONSHAPE_CSV_PROFILE.bicolorEncodingVerified, true);
  assert.equal(ONSHAPE_CSV_PROFILE.liveImportVerified, false);
  for (const [code, name] of COLOR_CASES) {
    assert.deepEqual(convertColorForOnshape(code), { value: name });
  }
  // WireForm VT differs from Onshape VI; names avoid alias assumptions.
  assert.deepEqual(convertColorForOnshape("VTWH"), { value: "violet/white" });
  assert.deepEqual(convertColorForOnshape(" buwh "), { value: "blue/white" });
  assert.deepEqual(convertColorForOnshape("LB"), { value: "light blue" });
});

test("unknown, malformed, and missing colors remain explicit validation errors", () => {
  for (const code of ["XX", "GNXX", "XXWH", "BUWHXX", "VIWH"]) {
    const converted = convertColorForOnshape(code);
    assert.equal(converted.value, undefined);
    assert.equal(converted.errorCode, "UNSUPPORTED_COLOR");
  }
  assert.equal(convertColorForOnshape("").errorCode, "MISSING_COLOR");
  const { project, cable } = completeProject("bundle", 2);
  cable.colors = ["BUWH", "GNXX"];
  const result = buildOnshapeCableWireExport(project);
  assert.equal(result.rows.length, 1);
  assert.equal(result.totals.excluded, 1);
  assert.equal(onshapeExportHasErrors(result), true);
  assert.ok(issueCodes(result).has("UNSUPPORTED_COLOR"));
});

for (const kind of ["wire", "bundle", "cable"]) {
  test(`${kind} colors use the same conversion without mutation and serialize correctly`, () => {
    for (const [code, expected] of COLOR_CASES) {
      const { project, cable, j1, j2 } = completeProject(kind, 1);
      cable.colors = [code];
      j1.designator = 'J1,"Ü"';
      j2.designator = "J2\n端";
      const before = JSON.stringify(project);
      const result = buildOnshapeCableWireExport(project);
      assert.equal(onshapeExportHasErrors(result), false);
      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0].color, expected);
      const csv = serializeOnshapeCableWireCsv(result.rows);
      assert.equal(
        csv,
        "Wire ID,From Ref,To Ref,From Pin,To Pin,Gauge,Color\r\n" +
          `${result.rows[0].wireId},"J1,""Ü""","J2\n端",1,1,24,${expected}\r\n`,
      );
      assert.equal(
        serializeOnshapeCableWireCsv(buildOnshapeCableWireExport(project).rows),
        csv,
      );
      assert.equal(JSON.stringify(project), before);
    }
  });
}

test("representative shielded CAT5e fixture exports all eight solid and striped conductors", () => {
  const { project, cable, j1 } = completeProject("cable", 8, "W1");
  cable.colors = ["OGWH", "OG", "GNWH", "BU", "BUWH", "GN", "BNWH", "BN"];
  cable.shield = true;
  link(project, "cat5e-shield", j1, "pin:1", cable, "shield");
  const result = buildOnshapeCableWireExport(project);
  assert.equal(result.totals.candidates, 8);
  assert.equal(result.rows.length, 8);
  assert.equal(result.totals.excluded, 0);
  assert.deepEqual(result.rows.map((row) => row.color), [
    "orange/white", "orange", "green/white", "blue",
    "blue/white", "green", "brown/white", "brown",
  ]);
  assert.ok(issueCodes(result).has("SHIELD_OMITTED"));
  assert.equal(onshapeExportHasErrors(result), false);
});

test("AWG conversion is explicit and never fabricates metric or missing gauges", () => {
  assert.deepEqual(convertGaugeForOnshape("24 AWG"), { value: "24" });
  assert.deepEqual(convertGaugeForOnshape("AWG 12"), { value: "12" });
  assert.deepEqual(convertGaugeForOnshape("4/0 AWG"), { value: "4/0" });
  assert.equal(convertGaugeForOnshape("0.5 mm²").errorCode, "UNSUPPORTED_GAUGE");
  assert.equal(convertGaugeForOnshape("").errorCode, "MISSING_GAUGE");
});

test("CSV serialization is RFC4180, UTF-8 compatible, CRLF terminated and deterministic", () => {
  const rows = [
    {
      wireId: "wire,\"one\"",
      fromRef: "J,1",
      toRef: "J\nÜ",
      fromPin: "3",
      toPin: "10",
      gauge: "24",
      color: "Blue",
    },
  ];
  const first = serializeOnshapeCableWireCsv(rows);
  const second = serializeOnshapeCableWireCsv(rows);
  assert.equal(first, second);
  assert.equal(first.endsWith("\r\n"), true);
  assert.match(first, /^Wire ID,From Ref,To Ref,From Pin,To Pin,Gauge,Color\r\n/);
  assert.match(first, /"wire,""one"""/);
  assert.match(first, /"J,1"/);
  assert.match(first, /"J\nÜ"/);
  assert.equal(first.replaceAll("\r\n", "").includes("\r"), false);
});

test("rows sort naturally by designator and use stable identity as a deterministic tie-breaker", () => {
  const project = createEmptyProject("Sorting");
  const j1 = addConnector(project, "J1", 3);
  const j2 = addConnector(project, "J2", 3);
  const w10 = addCable(project, "wire", "W10", 1, "wire-10");
  const w2b = addCable(project, "wire", "W2", 1, "wire-2-b");
  const w2a = addCable(project, "wire", "W2", 1, "wire-2-a");
  connectAll(project, w10, j1, j2, 0);
  connectAll(project, w2b, j1, j2, 1);
  connectAll(project, w2a, j1, j2, 2);
  const result = buildOnshapeCableWireExport(project);
  assert.deepEqual(result.rows.map((row) => row.wireId), [
    onshapeWireId(w2a.id, w2a.conductorIds[0]),
    onshapeWireId(w2b.id, w2b.conductorIds[0]),
    onshapeWireId(w10.id, w10.conductorIds[0]),
  ]);
});

test("filename is deterministic and safely uses the project title", () => {
  assert.equal(
    onshapeCsvFilenameForTitle(' PRELIM: E00/036 "A" '),
    "PRELIM-E00-036-A.onshape-cable-wire.csv",
  );
});

test("stable Wire IDs safely encode non-ASCII and separator characters", () => {
  const first = onshapeWireId("组件/一", "conductor,\"A\"");
  const second = onshapeWireId("组件/一", "conductor,\"A\"");
  assert.equal(first, second);
  assert.match(first, /^WF-[A-Za-z0-9._-]+$/);
  assert.doesNotMatch(first, /[,"/\s]/);
  assert.notEqual(first, onshapeWireId("组件/一", "conductor-A"));
});

test("editor exposes a local preview/download flow with fatal and warning gates", async () => {
  const source = await fs.readFile(new URL("../app/HarnessStudio.tsx", import.meta.url), "utf8");
  assert.match(source, /Export Onshape Cable\/Wire Routing CSV/);
  assert.match(source, /buildOnshapeCableWireExport\(project\)/);
  assert.match(source, /serializeOnshapeCableWireCsv\(onshapeExport\.rows\)/);
  assert.match(source, /onshapeExportHasErrors\(onshapeExport\)/);
  assert.match(source, /onshapeWarningsAcknowledged/);
  assert.doesNotMatch(source, /onshape[^\n]{0,80}(fetch\(|oauth|authentication)/i);
});
