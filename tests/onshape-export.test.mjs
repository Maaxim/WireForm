import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { buildBomRows } from "../app/bom.ts";
import {
  buildConnectionMappingRows,
} from "../app/connection-mapping.ts";
import {
  ONSHAPE_CSV_HEADERS,
  ONSHAPE_CSV_TARGET,
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
import { parseLengthMeters, parseLengthMillimeters } from "../app/length.ts";
import { resolvePhysicalConnections } from "../app/connection-topology.ts";

const EXPECTED_HEADERS = [
  "Wire ID", "From Ref", "From Pin", "To Ref", "To Pin", "Gauge", "Color",
  "From Part No", "To Part No", "From Contact PN", "To Contact PN",
  "From Strip Length (mm)", "To Strip Length (mm)",
];
const EMPTY_MANUFACTURING_FIELDS = {
  fromPartNo: "",
  toPartNo: "",
  fromContactPn: "",
  toContactPn: "",
  fromStripLengthMm: "",
  toStripLengthMm: "",
};

/** Parse quoted records independently of the exporter's escaping implementation. */
function parseCsv(csv) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === ",") {
      row.push(value);
      value = "";
    } else if (!quoted && character === "\r" && csv[index + 1] === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      index += 1;
    } else {
      value += character;
    }
  }
  assert.equal(quoted, false, "CSV must not contain unterminated quotes");
  assert.equal(value, "");
  assert.equal(row.length, 0);
  return rows;
}

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
    ...EMPTY_MANUFACTURING_FIELDS,
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

for (const kind of ["wire", "bundle", "cable"]) {
  test(`${kind} exports connector and per-end contact MPNs and millimeter strips`, () => {
    const count = kind === "wire" ? 1 : 2;
    const { project, j1, j2, cable } = completeProject(kind, count);
    j1.mpn = "09 32 040 3001";
    j2.mpn = "10142708-040021LF";
    cable.gauge = "14 AWG";
    for (let index = 0; index < count; index += 1) {
      project.links[index * 2].termination = {
        contact: { mpn: index ? "CAVITY-2" : "09 33 000 6102" },
        stripLength: index ? "8.25 mm" : "7.5 mm",
      };
      project.links[index * 2 + 1].termination = {
        contact: { mpn: index ? "OTHER-CAVITY-2" : "10158070-121LF" },
        stripLength: index ? "6.125 mm" : "5.7 mm",
      };
    }
    const before = JSON.stringify(project);
    const result = buildOnshapeCableWireExport(project);
    assert.equal(result.rows.length, count);
    assert.equal(onshapeExportHasErrors(result), false);
    for (let index = 0; index < count; index += 1) {
      const row = result.rows[index];
      assert.equal(row.wireId, onshapeWireId(cable.id, cable.conductorIds[index]));
      assert.equal(row.fromPartNo, j1.mpn);
      assert.equal(row.toPartNo, j2.mpn);
      assert.equal(row.fromContactPn, index ? "CAVITY-2" : "09 33 000 6102");
      assert.equal(row.toContactPn, index ? "OTHER-CAVITY-2" : "10158070-121LF");
      assert.equal(row.fromStripLengthMm, index ? "8.25" : "7.5");
      assert.equal(row.toStripLengthMm, index ? "6.125" : "5.7");
    }
    const csv = serializeOnshapeCableWireCsv(result.rows);
    const records = parseCsv(csv);
    assert.deepEqual(records[0], EXPECTED_HEADERS);
    assert.ok(records.every((record) => record.length === 13));
    assert.deepEqual(records[1].slice(7), [
      j1.mpn, j2.mpn, "09 33 000 6102", "10158070-121LF", "7.5", "5.7",
    ]);
    assert.equal(csv, serializeOnshapeCableWireCsv(buildOnshapeCableWireExport(project).rows));
    assert.equal(JSON.stringify(project), before);
  });
}

test("reversed endpoint ordering retains each physical pin's own contact and strip length", () => {
  const { project, j1, j2, cable } = completeProject("wire", 1);
  // Deliberately store J5:10 before J1:3, with distinct parts at each end.
  j1.designator = "J5";
  j1.pinCount = 10;
  j1.mpn = "CONNECTOR-A";
  j2.designator = "J1";
  j2.pinCount = 3;
  j2.mpn = "CONNECTOR-B";
  project.links[0].from.portId = "pin:10";
  project.links[0].termination = { contact: { mpn: "PN-A" }, stripLength: "5.7 mm" };
  project.links[1].to.portId = "pin:3";
  project.links[1].termination = { contact: { mpn: "PN-B" }, stripLength: "7.5 mm" };

  const resolved = resolvePhysicalConnections(project)[0];
  assert.equal(resolved.from.connectorId, j2.id);
  assert.equal(resolved.from.termination.contact.mpn, "PN-B");
  assert.equal(resolved.to.connectorId, j1.id);
  assert.equal(resolved.to.termination.contact.mpn, "PN-A");
  const originalCsv = serializeOnshapeCableWireCsv(buildOnshapeCableWireExport(project).rows);
  const record = parseCsv(originalCsv)[1];
  assert.deepEqual(record.slice(0, 5), [
    onshapeWireId(cable.id, cable.conductorIds[0]), "J1", "3", "J5", "10",
  ]);
  assert.deepEqual(record.slice(7), [
    "CONNECTOR-B", "CONNECTOR-A", "PN-B", "PN-A", "7.5", "5.7",
  ]);

  project.links.reverse();
  project.components.reverse();
  for (const entry of project.links) [entry.from, entry.to] = [entry.to, entry.from];
  assert.equal(
    serializeOnshapeCableWireCsv(buildOnshapeCableWireExport(project).rows),
    originalCsv,
  );
});

test("missing manufacturing data stays empty without inferring alternatives or generic hardware", () => {
  const { project, j1, j2 } = completeProject("bundle", 2);
  j1.manufacturer = "Not a connector MPN";
  j2.mpn = "   ";
  j2.name = "Not a connector MPN either";
  j1.approvedAlternatives = [{ id: "alt", mpn: "ALTERNATIVE-PN" }];
  j1.additionalComponents = [{ id: "extra", mpn: "GENERIC-CONTACT-PN" }];
  project.links[0].termination = {
    contact: { manufacturer: "Not a contact MPN", pn: "GENERIC-PN" },
    seal: { mpn: "SEAL-PN" },
  };
  project.links[2].termination = {
    contact: { mpn: "OTHER-CAVITY-CONTACT" }, stripLength: "7.5 mm",
  };
  const result = buildOnshapeCableWireExport(project);
  assert.equal(onshapeExportHasErrors(result), false);
  const records = parseCsv(serializeOnshapeCableWireCsv(result.rows));
  assert.deepEqual(records[1].slice(7), ["", "", "", "", "", ""]);
  assert.deepEqual(records[2].slice(7), ["", "", "OTHER-CAVITY-CONTACT", "", "7.5", ""]);
});

test("one-sided manufacturing metadata never fills the other physical endpoint", () => {
  const { project, j1 } = completeProject("wire", 1);
  j1.mpn = "FROM-CONNECTOR";
  project.links[0].termination = { contact: { mpn: "FROM-CONTACT" }, stripLength: "7.5 mm" };
  const result = buildOnshapeCableWireExport(project);
  assert.equal(onshapeExportHasErrors(result), false);
  const record = parseCsv(serializeOnshapeCableWireCsv(result.rows))[1];
  assert.deepEqual(record.slice(7), ["FROM-CONNECTOR", "", "FROM-CONTACT", "", "7.5", ""]);
});

test("strip units convert exactly to millimeters without rounding meaningful decimals", () => {
  for (const [input, expected] of [
    ["7.5 mm", "7.5"], ["5,7 mm", "5.7"], ["0.75 cm", "7.5"],
    ["0.0057 m", "5.7"], ['0.3"', "7.62"], ["0.1 inches", "2.54"],
    ["7.1234567890123456789 mm", "7.1234567890123456789"],
    ["0.0000001 mm", "0.0000001"], ["007.500 mm", "7.5"],
  ]) {
    const { project } = completeProject("wire", 1);
    project.links[0].termination = { stripLength: input };
    const result = buildOnshapeCableWireExport(project);
    assert.equal(result.rows[0].fromStripLengthMm, expected, input);
    assert.equal(result.rows[0].toStripLengthMm, "");
    assert.equal(onshapeExportHasErrors(result), false);
    assert.equal(parseLengthMillimeters(input), expected);
  }
  // Existing meter-based callers keep their previous rounding behavior.
  assert.equal(parseLengthMeters("7.123456789 mm"), 0.007123457);
});

test("malformed optional strip lengths warn and leave blanks without blocking routing", () => {
  for (const stripLength of ["7.5", "invalid", "0 mm", "-5 mm", "Infinity mm"]) {
    const { project } = completeProject("wire", 1);
    project.links[0].termination = { stripLength };
    const result = buildOnshapeCableWireExport(project);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].fromStripLengthMm, "");
    assert.equal(onshapeExportHasErrors(result), false);
    assert.ok(issueCodes(result).has("INVALID_STRIP_LENGTH"));
  }
});

test("all thirteen fields retain alignment and quoting for manufacturing part numbers", () => {
  assert.deepEqual(ONSHAPE_CSV_HEADERS, EXPECTED_HEADERS);
  assert.deepEqual(parseCsv(serializeOnshapeCableWireCsv([])), [EXPECTED_HEADERS]);
  const { project, j1, j2 } = completeProject("wire", 1);
  j1.mpn = ' 09 32,040 "3001" ';
  j2.mpn = "10142708-040021LF\nÜ";
  project.links[0].termination = { contact: { mpn: ' 09 33 "000", 6102 ' }, stripLength: "7.500 mm" };
  project.links[1].termination = { contact: { mpn: "10158070-121LF\n端" }, stripLength: "5.7 mm" };
  const result = buildOnshapeCableWireExport(project);
  const records = parseCsv(serializeOnshapeCableWireCsv(result.rows));
  assert.equal(records[0].length, 13);
  assert.equal(records[1].length, 13);
  assert.deepEqual(records[1].slice(7), [
    j1.mpn, j2.mpn, project.links[0].termination.contact.mpn,
    project.links[1].termination.contact.mpn, "7.5", "5.7",
  ]);
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
    "fromPin",
    "toRef",
    "toPin",
    "gauge",
    "color",
    ...Object.keys(EMPTY_MANUFACTURING_FIELDS),
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
  assert.equal(ONSHAPE_CSV_TARGET.bicolorEncodingVerified, true);
  assert.equal(ONSHAPE_CSV_TARGET.liveImportVerified, false);
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
        EXPECTED_HEADERS.join(",") + "\r\n" +
          `${result.rows[0].wireId},"J1,""Ü""",1,"J2\n端",1,24,${expected},,,,,,\r\n`,
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
      ...EMPTY_MANUFACTURING_FIELDS,
    },
  ];
  const first = serializeOnshapeCableWireCsv(rows);
  const second = serializeOnshapeCableWireCsv(rows);
  assert.equal(first, second);
  assert.equal(first.endsWith("\r\n"), true);
  assert.equal(first.split("\r\n")[0], EXPECTED_HEADERS.join(","));
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
