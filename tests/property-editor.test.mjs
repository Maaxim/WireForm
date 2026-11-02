import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { cloneProject, createEmptyProject, makeComponent, parseProjectFile, serializeProjectFile } from "../app/model.ts";
import { applyPropertyEdit, buildPropertyRows, propertyColumns, propertyDisplay, propertyIsReadOnly,
  queryPropertyRows, resolvePropertyRow, validatePropertyEdit, nextEditablePropertyCell, propertyVisibleRange } from "../app/property-editor.ts";
import { getEffectiveBundleConductorLength } from "../app/bundle-conductors.ts";
import { getLengthInputParts } from "../app/length.ts";
import { parseWireSize, validateWireSize } from "../app/wire-size.ts";
import { buildHarnessReportModel, renderHarnessReportHtml } from "../app/html-report.ts";
import { buildBomRows } from "../app/bom.ts";
import { buildOnshapeCableWireExport, serializeOnshapeCableWireCsv } from "../app/onshape-export.ts";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M0 0L100 100"/></svg>';

function fixture() {
  const project = createEmptyProject("Property editing");
  const j1 = makeComponent("connector", 1, "j1"), j2 = makeComponent("connector", 2, "j2"), j10 = makeComponent("connector", 10, "j10");
  for (const node of [j1, j2, j10]) { node.manufacturer = "Amphenol"; node.mpn = `ORIGINAL-${node.id}`; }
  j2.manufacturer = "Harting";
  j1.approvedAlternatives = [{ id: "alternate", manufacturer: "Other", mpn: "ALTERNATE" }];
  j1.shieldTerminations = [{ id: "shell", label: "Chassis", mpn: "SHELL" }];
  const cable = makeComponent("cable", 1, "w1"), bundle = makeComponent("bundle", 1, "b1"), wire = makeComponent("wire", 2, "w2");
  cable.designator = "W1"; cable.length = "600 mm";
  bundle.designator = "B1"; bundle.length = "600 mm";
  for (const node of [cable, bundle]) {
    node.wireCount = 2; node.conductorIds = [`${node.id}-a`, `${node.id}-b`]; node.wireLabels = ["CAN_H", "CAN_L"]; node.colors = ["BUWH", "RD"];
  }
  wire.length = "0.2 m"; wire.colors = ["BK"];
  bundle.conductorLengthOverrides = { "b1-a": "750 mm" };
  project.components = [j10, cable, j2, bundle, j1, wire];
  project.links = [{ id: "left", from: { nodeId: "j1", portId: "pin:1", side: "right" }, to: { nodeId: "b1", portId: "wire:1", side: "left" },
    termination: { contact: { mpn: "CONTACT" }, stripLength: "7.5 mm" } }];
  project.twistedPairs = [{ id: "tp", designator: "TP4", members: [{ kind: "bundle-conductor", bundleId: "b1", conductorId: "b1-a" },
    { kind: "bundle-conductor", bundleId: "b1", conductorId: "b1-b" }], twistDirection: "S", twistPitchMm: 60 }];
  project.attachments = [{ id: "file", filename: "Notes.txt", mimeType: "text/plain", sizeBytes: 3, data: "YWJj" }];
  return project;
}
const component = (project, id) => project.components.find((node) => node.id === id);
const ref = (category, componentId, conductorId) => ({ category, componentId, ...(conductorId ? { conductorId } : {}) });
const edit = (project, target, propertyId, newValue) => applyPropertyEdit(project, { target, propertyId, newValue });

test("categories enumerate current objects and stable physical conductor references", () => {
  const project = fixture();
  assert.deepEqual(buildPropertyRows(project, "connectors").map((row) => row.component.id), ["j10", "j2", "j1"]);
  assert.deepEqual(buildPropertyRows(project, "cables").map((row) => row.component.id), ["w1"]);
  assert.deepEqual(buildPropertyRows(project, "bundles").map((row) => row.component.id), ["b1"]);
  const conductors = buildPropertyRows(project, "conductors");
  assert.equal(conductors.length, 5); assert.equal(new Set(conductors.map((row) => row.key)).size, 5);
  for (const row of conductors) assert.equal(resolvePropertyRow(project, row.ref).component, component(project, row.ref.componentId));
  for (const category of ["connectors", "cables", "bundles", "conductors"]) assert.equal(buildPropertyRows(createEmptyProject(), category).length, 0);
});

test("optional metadata clears without placeholders, and Notes preserve newlines", () => {
  const project = fixture(), target = ref("connectors", "j1");
  for (const [property, value] of [["manufacturer", "Harting"], ["mpn", 'PN, "001"'], ["name", "Detailed connector"], ["notes", "Line one\nLine two"]]) {
    assert.equal(edit(project, target, property, value), true); assert.equal(component(project, "j1")[property], value);
  }
  assert.equal(component(project, "j1").approvedAlternatives[0].mpn, "ALTERNATE");
  edit(project, target, "mpn", ""); assert.equal(component(project, "j1").mpn, "");
  assert.equal(edit(project, target, "mpn", ""), false, "unchanged Save needs no history/autosave action");
});

test("bundle defaults update inherited lengths without overwriting explicit overrides", () => {
  const project = fixture();
  edit(project, ref("bundles", "b1"), "length", "900 mm");
  const bundle = component(project, "b1");
  assert.equal(getEffectiveBundleConductorLength(bundle, "b1-a"), "750 mm");
  assert.equal(getEffectiveBundleConductorLength(bundle, "b1-b"), "900 mm");
  const rows = buildPropertyRows(project, "conductors").filter((row) => row.component.id === "b1");
  const source = propertyColumns("conductors").find((column) => column.id === "lengthSource");
  assert.deepEqual(rows.map((row) => source.get(row)), ["Override", "Default"]);
});

test("stable-ID bundle override edits and reset preserve cable length semantics", () => {
  const project = fixture(), target = ref("conductors", "b1", "b1-b");
  edit(project, target, "length", "1.2 m");
  assert.equal(component(project, "b1").conductorLengthOverrides["b1-b"], "1.2 m");
  edit(project, target, "length", "");
  assert.equal(Object.hasOwn(component(project, "b1").conductorLengthOverrides, "b1-b"), false);
  assert.equal(getEffectiveBundleConductorLength(component(project, "b1"), "b1-b"), "600 mm");
  assert.equal(edit(project, target, "length", ""), false);
  assert.throws(() => edit(project, ref("conductors", "w1", "w1-a"), "length", "500 mm"), /read-only/);
  edit(project, ref("cables", "w1"), "length", "800 mm");
  assert.equal(propertyColumns("conductors").find((column) => column.id === "length").get(resolvePropertyRow(project, ref("conductors", "w1", "w1-a"))), "800 mm");
});

test("labels, bi-colors and shared gauges use authoritative fields", () => {
  const project = fixture(), target = ref("conductors", "b1", "b1-b");
  edit(project, target, "label", "POWER+"); edit(project, target, "color", " whbu ");
  assert.equal(component(project, "b1").wireLabels[1], "POWER+");
  assert.equal(component(project, "b1").colors[1], "WHBU");
  assert.throws(() => edit(project, target, "gauge", "14 AWG"), /read-only/);
  edit(project, ref("bundles", "b1"), "gauge", "14 AWG");
  assert.equal(component(project, "b1").gauge, "14 AWG");
  const row = resolvePropertyRow(project, target), color = propertyColumns("conductors").find((column) => column.id === "color");
  assert.equal(propertyDisplay(color, row), "White / Blue (WHBU)");
  assert.equal(row.twistedPair, "TP4");
  const standalone = buildPropertyRows(project, "conductors").find((row) => row.component.id === "w2");
  edit(project, standalone.ref, "gauge", "0.5 mm²"); edit(project, standalone.ref, "length", "0.3 m");
  assert.equal(component(project, "w2").gauge, "0.5 mm²"); assert.equal(component(project, "w2").length, "0.3 m");
  const legacyWire = component(project, "w2"); legacyWire.wireCount = 2; legacyWire.conductorIds.push("legacy-second");
  assert.throws(() => edit(project, standalone.ref, "gauge", "14 AWG"), /read-only/);
});

test("invalid edits reject before touching the draft; structural fields cannot be changed", () => {
  const project = fixture(), before = serializeProjectFile(project);
  for (const [target, property, value] of [[ref("bundles", "b1"), "length", "-25 mm"], [ref("bundles", "b1"), "length", "NaN m"],
    [ref("bundles", "b1"), "gauge", "-14 AWG"], [ref("bundles", "b1"), "gauge", "invalid"],
    [ref("conductors", "b1", "b1-a"), "color", "XX"], [ref("connectors", "j1"), "pinCount", "9"],
    [ref("connectors", "j1"), "designator", "J2"], [ref("bundles", "b1"), "wireCount", "9"],
    [ref("conductors", "b1", "b1-a"), "twistedPair", "TP9"], [ref("connectors", "j1"), "notes", "x".repeat(4001)]]) {
    assert.throws(() => edit(project, target, property, value));
  }
  assert.equal(serializeProjectFile(project).replace(/"savedAt": "[^"]+"/, '"savedAt": "time"'), before.replace(/"savedAt": "[^"]+"/, '"savedAt": "time"'));
  assert.match(validatePropertyEdit(project, { target: ref("conductors", "b1", "deleted-id"), propertyId: "color", newValue: "RD" }).error, /no longer exists/);
});

test("natural/numeric sorting, search and exact filters do not mutate the model", () => {
  const project = fixture(), snapshot = structuredClone(project);
  const rows = buildPropertyRows(project, "connectors"), columns = propertyColumns("connectors");
  assert.deepEqual(queryPropertyRows(rows, columns, { sortColumn: "designator" }).map((row) => row.component.designator), ["J1", "J2", "J10"]);
  assert.equal(queryPropertyRows(rows, columns, { search: "aMpHeNoL" }).length, 2);
  assert.equal(queryPropertyRows(rows, columns, { search: "original-j10" }).length, 1);
  assert.equal(queryPropertyRows(rows, columns, { filterColumn: "manufacturer", filterValue: "harting" })[0].component.id, "j2");
  const conductors = buildPropertyRows(project, "conductors"), cc = propertyColumns("conductors");
  assert.deepEqual(queryPropertyRows(conductors, cc, { filterColumn: "color", filterValue: "RD" }).map((row) => row.ref.conductorId), ["w1-b", "b1-b"]);
  const lengths = queryPropertyRows(conductors, cc, { sortColumn: "length" }).map((row) => cc.find((column) => column.id === "length").get(row));
  assert.deepEqual(lengths, ["0.2 m", "600 mm", "600 mm", "600 mm", "750 mm"]);
  assert.deepEqual(project, snapshot);
});

test("edits after sorting/filtering and conductor reordering retain exact stable identity", () => {
  const project = fixture();
  const connectors = queryPropertyRows(buildPropertyRows(project, "connectors"), propertyColumns("connectors"), { sortColumn: "designator", descending: true, filterColumn: "manufacturer", filterValue: "Amphenol" });
  edit(project, connectors[0].ref, "mpn", "J10-NEW");
  assert.equal(component(project, "j10").mpn, "J10-NEW"); assert.equal(component(project, "j1").mpn, "ORIGINAL-j1");
  const target = queryPropertyRows(buildPropertyRows(project, "conductors"), propertyColumns("conductors"), { filterColumn: "parent", filterValue: "B1", sortColumn: "conductor", descending: true })[0].ref;
  const bundle = component(project, "b1");
  bundle.conductorIds.reverse(); bundle.colors.reverse(); bundle.wireLabels.reverse();
  edit(project, target, "label", "STABLE-B");
  assert.equal(bundle.wireLabels[0], "STABLE-B"); assert.equal(bundle.wireLabels[1], "CAN_H");
  edit(project, target, "length", "1 m"); assert.equal(bundle.conductorLengthOverrides["b1-b"], "1 m");
});

test("reports, BOM and native save/reopen consume updated fields; topology and attachments stay intact", () => {
  const project = fixture(), links = structuredClone(project.links), pairs = structuredClone(project.twistedPairs), files = structuredClone(project.attachments);
  edit(project, ref("connectors", "j1"), "mpn", "UPDATED-CONNECTOR-PN");
  edit(project, ref("connectors", "j1"), "name", "Updated description");
  const html = renderHarnessReportHtml(buildHarnessReportModel(project, SVG));
  assert.match(html, /UPDATED-CONNECTOR-PN/); assert.match(JSON.stringify(buildBomRows(project)), /UPDATED-CONNECTOR-PN/);
  const reopened = parseProjectFile(serializeProjectFile(project)).project;
  assert.equal(component(reopened, "j1").mpn, "UPDATED-CONNECTOR-PN");
  assert.deepEqual(project.links, links); assert.deepEqual(project.twistedPairs, pairs); assert.deepEqual(project.attachments, files);
  assert.deepEqual(component(project, "j1").shieldTerminations, [{ id: "shell", label: "Chassis", mpn: "SHELL" }]);
  const clone = cloneProject(project); assert.equal(clone.attachments[0].data, project.attachments[0].data);
});

test("shared gauge parser extraction preserves Onshape CSV output and physical identity", () => {
  const project = fixture();
  const before = serializeOnshapeCableWireCsv(buildOnshapeCableWireExport(project).rows);
  queryPropertyRows(buildPropertyRows(project, "conductors"), propertyColumns("conductors"), { search: "blue", sortColumn: "length" });
  assert.equal(serializeOnshapeCableWireCsv(buildOnshapeCableWireExport(project).rows), before);
  assert.deepEqual(parseWireSize("24 AWG"), { unit: "AWG", number: 24 });
  assert.deepEqual(parseWireSize("4/0 AWG"), { unit: "AWG", number: -3 });
  assert.deepEqual(parseWireSize("0.5 mm²"), { unit: "mm²", number: 0.5 });
  assert.ok(validateWireSize("-1 mm2")); assert.ok(validateWireSize("41 AWG"));
  assert.deepEqual(getLengthInputParts("2 inches"), { quantity: "2", unit: "in" });
});

test("keyboard Tab skips protected cells; virtualization limits mounted rows", () => {
  const project = fixture(), rows = buildPropertyRows(project, "connectors"), columns = propertyColumns("connectors");
  const next = nextEditablePropertyCell(rows, columns, { row: 0, column: 4 }, 1);
  assert.deepEqual(next, { row: 1, column: 1 });
  assert.equal(propertyIsReadOnly(columns[0], rows[0]), true);
  for (const scroll of [0, 10000, 41900]) { const range = propertyVisibleRange(1000, scroll, 600); assert.ok(range.end - range.start <= 27); assert.ok(range.start >= 0 && range.end <= 1000); }
});

test("large harness row queries do not inspect large attachment binaries", () => {
  const project = createEmptyProject();
  project.components = Array.from({ length: 100 }, (_, index) => makeComponent("connector", index + 1, `j-${index}`));
  for (let index = 0; index < 100; index++) {
    const node = makeComponent(index % 2 ? "bundle" : "cable", index + 1, `w-${index}`);
    node.wireCount = 12; node.conductorIds = Array.from({ length: 12 }, (_, n) => `id-${index}-${n}`); project.components.push(node);
  }
  Object.defineProperty(project, "attachments", { get() { throw new Error("Row queries must not process attachments"); } });
  const rows = buildPropertyRows(project, "conductors"); assert.equal(rows.length, 1200);
  assert.equal(queryPropertyRows(rows, propertyColumns("conductors"), { search: "AWG", sortColumn: "conductor" }).length, 1200);
});

test("UI mounts the shared editor through the existing history/autosave update path", async () => {
  const studio = await readFile(new URL("../app/HarnessStudio.tsx", import.meta.url), "utf8");
  const dialog = await readFile(new URL("../app/PropertyEditorDialog.tsx", import.meta.url), "utf8");
  assert.match(studio, /Tools/); assert.match(studio, /onUpdate=\{updateProject\}/);
  assert.match(studio, /projectFilesOpen \|\| propertyEditorOpen/);
  assert.match(dialog, /if \(result.changed\) props.onUpdate/);
  assert.match(dialog, /<WireColorEditor/); assert.match(dialog, /<WireGaugeEditor/); assert.match(dialog, /<LengthValueEditor/);
  assert.match(dialog, /createPortal/); assert.match(dialog, /nextEditablePropertyCell/);
  assert.doesNotMatch(dialog, /writeLocalDocument|serializeProjectFile|localStorage|structuredClone/);
});
