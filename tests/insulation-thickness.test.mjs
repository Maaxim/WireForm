import assert from "node:assert/strict";
import test from "node:test";
import { cloneProject, createConductorUuidMap, createEmptyProject, makeComponent, normalizeProject, parseProjectFile, serializeProjectFile } from "../app/model.ts";
import { componentToTemplate, createLibraryCollection, instantiateTemplate, parseLibraryFile, serializeLibraryBackup } from "../app/library.ts";
import { getConductorInsulationThickness } from "../app/insulation-thickness.ts";
import { formatNumericProperty, parseOptionalNonNegativeNumberInput, validateOptionalNonNegativeNumberInput } from "../app/numeric-property.ts";
import { applyPropertyEdit, buildPropertyRows, propertyColumns, propertyDisplay, propertyIsReadOnly, queryPropertyRows } from "../app/property-editor.ts";
import { applyPropertyTransaction, createBulkPropertyTransaction, createFindReplaceTransaction, previewPropertyTransaction } from "../app/property-transactions.ts";
import { ONSHAPE_CSV_HEADERS, ONSHAPE_CSV_PREVIEW_COLUMNS, buildOnshapeCableWireExport, onshapeExportHasErrors, onshapeWireId, serializeOnshapeCableWireCsv } from "../app/onshape-export.ts";
import { resolvePhysicalConnections } from "../app/connection-topology.ts";

function fixture() {
  const project = createEmptyProject("Insulation verification");
  const j1 = makeComponent("connector", 1, "j1"), j2 = makeComponent("connector", 2, "j2");
  j1.pinCount = 20; j2.pinCount = 20; j1.mpn = "PN, LEFT"; j2.mpn = 'PN "RIGHT"';
  project.components = [j1, j2];
  let pin = 1;
  for (const [kind, id, designator, count] of [["wire", "w1", "W1", 1], ["bundle", "b1", "B1", 4], ["cable", "c1", "C1", 8], ["wire", "w2", "W2", 1]]) {
    const component = makeComponent(kind, 1, id); component.designator = designator; component.wireCount = count;
    component.conductorIds = Array.from({ length: count }, (_, index) => `${id}-c${index + 1}`);
    component.conductorUuids = createConductorUuidMap(component.conductorIds);
    component.colors = Array.from({ length: count }, (_, index) => index % 2 ? "WHBU" : "BUWH");
    component.wireLabels = Array.from({ length: count }, () => "CAN");
    project.components.push(component);
    for (let index = 0; index < count; index++, pin++) {
      project.links.push({ id: `${id}-${index}-left`, from: { nodeId: "j1", portId: `pin:${pin}`, side: "right" }, to: { nodeId: id, portId: `wire:${index + 1}`, side: "left" }, termination: { contact: { mpn: `CONTACT-L-${pin}` }, stripLength: "7.5 mm" } },
        { id: `${id}-${index}-right`, from: { nodeId: id, portId: `wire:${index + 1}`, side: "right" }, to: { nodeId: "j2", portId: `pin:${pin}`, side: "left" }, termination: { contact: { mpn: `CONTACT-R-${pin}` }, stripLength: "5.7 mm" } });
    }
  }
  const bundle = project.components.find((component) => component.id === "b1");
  bundle.conductorLengthOverrides = { "b1-c1": "750 mm" };
  project.twistedPairs = [{ id: "tp", designator: "TP1", members: [{ kind: "bundle-conductor", bundleId: "b1", conductorId: "b1-c1" }, { kind: "bundle-conductor", bundleId: "b1", conductorId: "b1-c2" }], twistDirection: "S" }];
  return project;
}
const component = (project, id) => project.components.find((node) => node.id === id);
const reopen = (project) => parseProjectFile(serializeProjectFile(project)).project;
const column = () => propertyColumns("conductors").find((column) => column.id === "insulationThicknessMm");

for (const kind of ["wire", "bundle", "cable"]) {
  test(`${kind}: optional numeric mm, zero and precision survive native save/load and library duplication`, () => {
    const project = createEmptyProject(); project.components = [makeComponent(kind, 1, kind)];
    assert.equal(Object.hasOwn(reopen(project).components[0], "insulationThicknessMm"), false);
    for (const value of [0, 0.5, 0.127, 0.123456789012345, 1e-7]) {
      project.components[0].insulationThicknessMm = value;
      assert.equal(reopen(project).components[0].insulationThicknessMm, value);
      assert.equal(cloneProject(project).components[0].insulationThicknessMm, value);
      const collection = createLibraryCollection(); collection.libraries[0].templates = [componentToTemplate(project.components[0])];
      const restored = parseLibraryFile(serializeLibraryBackup(collection));
      const inserted = instantiateTemplate(restored.collection.libraries[0].templates[0], 2);
      assert.equal(inserted.insulationThicknessMm, value);
      assert.notEqual(inserted.id, project.components[0].id);
      assert.notDeepEqual(inserted.conductorIds, project.components[0].conductorIds);
    }
    delete project.components[0].insulationThicknessMm;
    const library = createLibraryCollection(); library.libraries[0].templates = [componentToTemplate(project.components[0])];
    assert.equal(Object.hasOwn(parseLibraryFile(serializeLibraryBackup(library)).collection.libraries[0].templates[0].component, "insulationThicknessMm"), false);
  });
}

test("invalid imported/model measurements are rejected without coercing them or defaulting to zero", () => {
  for (const value of [-0.5, NaN, Infinity, -Infinity, "0.5", "abc", "0.5 mm", null]) {
    const project = fixture(); component(project, "b1").insulationThicknessMm = value;
    assert.throws(() => normalizeProject(project), /Insulation Thickness/);
    assert.throws(() => serializeProjectFile(project), /Insulation Thickness/);
  }
  for (const value of ["-0.5", "abc", "NaN", "Infinity", "0.5 mm", "0,5", "0x10", "1e400", "1e-400", "1.2.3"]) {
    assert.ok(validateOptionalNonNegativeNumberInput(value), value);
    assert.throws(() => parseOptionalNonNegativeNumberInput(value), undefined, value);
  }
  for (const [text, value] of [["", undefined], [" ", undefined], ["0", 0], ["0.50", 0.5], ["0.127", 0.127], ["1e-7", 1e-7]]) {
    assert.equal(parseOptionalNonNegativeNumberInput(text), value);
  }
  assert.equal(formatNumericProperty(1e-7), "0.0000001");
  assert.equal(formatNumericProperty(undefined), ""); assert.equal(formatNumericProperty(0), "0");
});

test("stable member resolver inherits parent values and distinguishes zero from missing", () => {
  const project = fixture(); component(project, "w1").insulationThicknessMm = 0.5;
  component(project, "b1").insulationThicknessMm = 0; component(project, "c1").insulationThicknessMm = 0.127;
  const before = structuredClone(project);
  for (const connection of resolvePhysicalConnections(project)) {
    const parent = component(project, connection.conductor.componentId);
    assert.equal(getConductorInsulationThickness(parent, connection.conductor), parent.insulationThicknessMm);
  }
  assert.equal(getConductorInsulationThickness(component(project, "b1"), { componentId: "b1", conductorId: "missing" }), undefined);
  assert.equal(getConductorInsulationThickness(component(project, "b1"), { componentId: "w1", conductorId: "b1-c1" }), undefined);
  component(project, "b1").conductorIds.reverse(); component(project, "b1").colors.reverse();
  assert.equal(getConductorInsulationThickness(component(project, "b1"), { componentId: "b1", conductorId: "b1-c1" }), 0);
  project.components.reverse(); project.links.reverse();
  assert.equal(component(project, "w2").insulationThicknessMm, undefined);
  assert.equal(before.components.find((node) => node.id === "w1").insulationThicknessMm, 0.5);
});

test("property editing, numeric sorting/filtering and inherited read-only cells use the one parent field", () => {
  const project = fixture();
  const refs = buildPropertyRows(project, "conductors");
  const wire = refs.find((row) => row.component.id === "w1");
  applyPropertyEdit(project, { target: wire.ref, propertyId: "insulationThicknessMm", newValue: "0.127" });
  assert.equal(component(project, "w1").insulationThicknessMm, 0.127);
  assert.equal(propertyDisplay(column(), buildPropertyRows(project, "conductors").find((row) => row.component.id === "w1")), "0.127 mm");
  for (const category of ["cables", "bundles"]) {
    const row = buildPropertyRows(project, category)[0];
    applyPropertyEdit(project, { target: row.ref, propertyId: "insulationThicknessMm", newValue: category === "cables" ? "0" : "0.5" });
  }
  const rows = buildPropertyRows(project, "conductors"), columns = propertyColumns("conductors");
  assert.equal(queryPropertyRows(rows, columns, { filterColumn: "insulationThicknessMm", filterValue: "0" }).length, 8);
  const sorted = queryPropertyRows(rows, columns, { sortColumn: "insulationThicknessMm" });
  assert.equal(sorted[0].component.id, "w2"); assert.equal(column().get(sorted[1]), 0); assert.equal(column().get(sorted.at(-1)), 0.5);
  for (const row of rows.filter((row) => ["bundle", "cable"].includes(row.component.kind))) {
    assert.equal(propertyIsReadOnly(column(), row), true);
    assert.throws(() => applyPropertyEdit(project, { target: row.ref, propertyId: "insulationThicknessMm", newValue: "0.2" }), /read-only/);
  }
  applyPropertyEdit(project, { target: wire.ref, propertyId: "insulationThicknessMm", newValue: "" });
  assert.equal(Object.hasOwn(component(project, "w1"), "insulationThicknessMm"), false);
  assert.equal(propertyColumns("connectors").some((column) => column.id === "insulationThicknessMm"), false);
});

test("typed bulk set/clear/no-op/invalid transactions reuse atomic parent updates", () => {
  const project = fixture(), before = structuredClone(project);
  for (const category of ["bundles", "cables", "conductors"]) {
    const refs = buildPropertyRows(project, category).filter((row) => category !== "conductors" || row.component.kind === "wire").map((row) => row.ref);
    let transaction = createBulkPropertyTransaction(category, refs, { insulationThicknessMm: { action: "set", value: "0.50" } });
    let preview = previewPropertyTransaction(project, transaction); assert.equal(preview.issues.length, 0);
    applyPropertyTransaction(project, preview);
    preview = previewPropertyTransaction(project, transaction); assert.equal(preview.changes.length, 0);
    transaction = createBulkPropertyTransaction(category, refs, { insulationThicknessMm: { action: "set", value: "-0.1" } });
    preview = previewPropertyTransaction(project, transaction); assert.throws(() => applyPropertyTransaction(project, preview));
    for (const ref of refs) assert.equal(component(project, ref.componentId).insulationThicknessMm, 0.5);
    transaction = createBulkPropertyTransaction(category, refs, { insulationThicknessMm: { action: "clear" } });
    applyPropertyTransaction(project, previewPropertyTransaction(project, transaction));
    for (const ref of refs) assert.equal(Object.hasOwn(component(project, ref.componentId), "insulationThicknessMm"), false);
  }
  assert.deepEqual(project, before);
  assert.throws(() => createFindReplaceTransaction(project, "bundles", buildPropertyRows(project, "bundles").map((row) => row.ref),
    { propertyId: "insulationThicknessMm", find: "0", replacement: "1", caseSensitive: true, wholeCell: true }), /editable text/);
});

test("14-column CSV appends plain numeric mm for all physical sources without changing the first thirteen fields", () => {
  const project = fixture(), beforeRows = buildOnshapeCableWireExport(project).rows;
  component(project, "w1").insulationThicknessMm = 0.5; component(project, "b1").insulationThicknessMm = 0.4; component(project, "c1").insulationThicknessMm = 0.2;
  const snapshot = structuredClone(project), result = buildOnshapeCableWireExport(project);
  assert.equal(onshapeExportHasErrors(result), false); assert.equal(result.rows.length, 14);
  assert.equal(ONSHAPE_CSV_HEADERS.length, 14); assert.equal(ONSHAPE_CSV_HEADERS.at(-1), "Insulation");
  assert.equal(ONSHAPE_CSV_HEADERS[12], "To Strip Length (mm)");
  for (let index = 0; index < result.rows.length; index++) {
    const { insulation, ...unchanged } = result.rows[index]; const { insulation: ignored, ...before } = beforeRows[index]; void ignored;
    assert.deepEqual(unchanged, before);
    assert.equal(typeof insulation, "string");
  }
  const expected = new Map(resolvePhysicalConnections(project).map((connection) => [
    onshapeWireId(connection.conductor.uuid), formatNumericProperty(component(project, connection.conductor.componentId).insulationThicknessMm),
  ]));
  for (const row of result.rows) assert.equal(row.insulation, expected.get(row.wireId));
  for (const parent of project.components.filter((component) => component.wireCount)) {
    const ids = new Set(parent.conductorIds.map((id) => onshapeWireId(parent.conductorUuids[id])));
    const exported = result.rows.filter((row) => ids.has(row.wireId));
    assert.equal(exported.length, parent.wireCount);
  }
  assert.deepEqual(project, snapshot);
  assert.equal(serializeOnshapeCableWireCsv(result.rows), serializeOnshapeCableWireCsv(buildOnshapeCableWireExport(project).rows));
  assert.equal(ONSHAPE_CSV_PREVIEW_COLUMNS.at(-1).key, "insulation");
  for (const value of [undefined, 0, 0.127, 1e-7]) {
    component(project, "w1").insulationThicknessMm = value;
    const row = buildOnshapeCableWireExport(project).rows.find((row) => row.wireId === onshapeWireId(component(project, "w1").conductorUuids["w1-c1"]));
    assert.equal(row.insulation, formatNumericProperty(value)); assert.doesNotMatch(row.insulation, /mm|,|e/);
  }
});

test("invalid raw insulation produces a real export error instead of fabricated data", () => {
  const project = fixture();
  for (const value of [-1, NaN, Infinity, "abc"]) {
    component(project, "w1").insulationThicknessMm = value;
    const result = buildOnshapeCableWireExport(project);
    assert.ok(result.issues.some((issue) => issue.code === "INVALID_INSULATION_THICKNESS"));
    assert.equal(onshapeExportHasErrors(result), true);
  }
});
