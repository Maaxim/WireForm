import assert from "node:assert/strict";
import test from "node:test";
import { cloneProject, createEmptyProject, makeComponent, parseProjectFile, serializeProjectFile } from "../app/model.ts";
import { buildPropertyRows, propertyColumns, propertyRowKey, queryPropertyRows } from "../app/property-editor.ts";
import { applyPropertyTransaction, bulkPropertyColumns, createBulkPropertyTransaction, createFindReplaceTransaction,
  previewPropertyTransaction, reconcilePropertySelection, replacePropertyText, selectFilteredPropertyRows,
  selectPropertyRange, validatePropertyPreview } from "../app/property-transactions.ts";
import { getEffectiveBundleConductorLength } from "../app/bundle-conductors.ts";
import { buildHarnessReportModel, renderHarnessReportHtml } from "../app/html-report.ts";
import { buildBomRows } from "../app/bom.ts";

function fixture() {
  const project = createEmptyProject("Bulk property editing");
  for (let index = 1; index <= 5; index++) {
    const node = makeComponent("connector", index, `j${index}`);
    node.manufacturer = index === 1 ? "Harting" : "Amphenol"; node.mpn = "PN-OLD";
    node.approvedAlternatives = [{ id: `alt-${index}`, mpn: "ALT-PN" }];
    project.components.push(node);
  }
  for (const kind of ["cable", "bundle"]) for (let index = 1; index <= 2; index++) {
    const node = makeComponent(kind, index, `${kind}-${index}`);
    node.designator = `${kind === "bundle" ? "B" : "W"}${index}`;
    node.length = "600 mm"; node.conductorIds = Array.from({ length: 4 }, (_, n) => `${node.id}-c${n + 1}`);
    if (kind === "bundle") node.conductorLengthOverrides = { [node.conductorIds[0]]: "750 mm" };
    project.components.push(node);
  }
  project.components[0].shieldTerminations = [{ id: "shell", label: "Shell", mpn: "SHELL-PN" }];
  project.links = [{ id: "contact", from: { nodeId: "j1", portId: "pin:1", side: "right" }, to: { nodeId: "bundle-1", portId: "wire:1", side: "left" }, termination: { contact: { mpn: "CONTACT-PN" }, stripLength: "7.5 mm" } }];
  project.twistedPairs = [{ id: "tp", designator: "TP1", members: [{ kind: "bundle-conductor", bundleId: "bundle-1", conductorId: "bundle-1-c1" }, { kind: "bundle-conductor", bundleId: "bundle-1", conductorId: "bundle-1-c2" }], twistDirection: "S" }];
  project.attachments = [{ id: "file", filename: "PN-OLD.txt", mimeType: "text/plain", sizeBytes: 6, data: "UE4tT0xE" }];
  return project;
}
const node = (project, id) => project.components.find((node) => node.id === id);
const targets = (project, category) => buildPropertyRows(project, category).map((row) => row.ref);
const set = (value) => ({ action: "set", value });
const run = (project, category, refs, actions) => {
  const preview = previewPropertyTransaction(project, createBulkPropertyTransaction(category, refs, actions));
  applyPropertyTransaction(project, preview); return preview;
};

test("stable checkbox selection, ranges and filtered select-all include unmounted rows", () => {
  const project = fixture(), rows = buildPropertyRows(project, "connectors");
  let selected = selectFilteredPropertyRows(new Set(), [rows[0]], true);
  selected = selectPropertyRange(selected, rows, rows[1].key, rows[4].key, true);
  assert.equal(selected.size, 5);
  const filtered = queryPropertyRows(rows, propertyColumns("connectors"), { filterColumn: "manufacturer", filterValue: "Amphenol", sortColumn: "designator", descending: true });
  selected = selectFilteredPropertyRows(new Set(), filtered, true);
  assert.equal(selected.size, 4); assert.equal(selected.has(rows[0].key), false);
  selected.add(rows[0].key); selected = selectFilteredPropertyRows(selected, filtered, false);
  assert.deepEqual([...selected], [rows[0].key], "unchecking filtered select-all retains hidden selections");
  assert.equal(reconcilePropertySelection(selected, []).size, 0);
  const many = Array.from({ length: 1000 }, (_, index) => ({ key: String(index) }));
  assert.equal(selectFilteredPropertyRows(new Set(), many.slice(200, 500), true).size, 300);
});

test("selection survives query order and reports hidden matches without touching data", () => {
  const project = fixture(), snapshot = structuredClone(project), rows = buildPropertyRows(project, "connectors");
  const selected = new Set([rows[0].key, rows[3].key]);
  const filtered = queryPropertyRows(rows, propertyColumns("connectors"), { filterColumn: "manufacturer", filterValue: "Amphenol", sortColumn: "designator", descending: true });
  assert.equal(filtered.filter((row) => selected.has(row.key)).length, 1);
  assert.equal(reconcilePropertySelection(selected, rows).size, 2);
  assert.equal(reconcilePropertySelection(selected, buildPropertyRows(project, "bundles")).size, 0);
  assert.deepEqual(project, snapshot);
});

test("multiple connector fields change together and preserve alternative/contact/shield metadata", () => {
  const project = fixture(), before = structuredClone(project);
  const refs = targets(project, "connectors").slice(1);
  const preview = run(project, "connectors", refs, { manufacturer: set("Harting"), mpn: set("NEW-PN"), name: set("New housing"), notes: set("Assembly note\nSecond line") });
  assert.equal(preview.changes.length, 16); assert.equal(preview.changedObjects, 4);
  for (const ref of refs) { assert.equal(node(project, ref.componentId).mpn, "NEW-PN"); assert.equal(node(project, ref.componentId).notes, "Assembly note\nSecond line"); }
  assert.equal(node(project, "j1").mpn, "PN-OLD");
  assert.deepEqual(project.links, before.links); assert.deepEqual(project.twistedPairs, before.twistedPairs); assert.deepEqual(project.attachments, before.attachments);
  assert.deepEqual(node(project, "j1").shieldTerminations, before.components[0].shieldTerminations);
  assert.deepEqual(node(project, "j2").approvedAlternatives, before.components[1].approvedAlternatives);
});

test("Set/Clear/Keep semantics are explicit and optional clears never become zero", () => {
  const project = fixture();
  run(project, "connectors", targets(project, "connectors"), { mpn: { action: "clear" }, manufacturer: { action: "keep" } });
  assert.ok(project.components.filter((node) => node.kind === "connector").every((node) => node.mpn === ""));
  assert.equal(node(project, "j2").manufacturer, "Amphenol");
  run(project, "cables", targets(project, "cables"), { length: { action: "clear" }, gauge: { action: "keep" } });
  assert.equal(node(project, "cable-1").length, ""); assert.notEqual(node(project, "cable-1").length, 0);
  const invalid = previewPropertyTransaction(project, createBulkPropertyTransaction("connectors", targets(project, "connectors"), { name: set("") }));
  assert.match(invalid.issues[0].message, /Clear value explicitly/);
  const colorClear = previewPropertyTransaction(project, createBulkPropertyTransaction("conductors", targets(project, "conductors"), { color: { action: "clear" } }));
  assert.ok(colorClear.issues.length); assert.throws(() => applyPropertyTransaction(project, colorClear));
});

test("bulk cable and bundle lengths retain overrides and inheritance", () => {
  const project = fixture();
  run(project, "cables", targets(project, "cables"), { length: set("0.9 m"), gauge: set("14 AWG") });
  assert.equal(node(project, "cable-2").length, "0.9 m");
  run(project, "bundles", targets(project, "bundles"), { length: set("700 mm") });
  assert.equal(getEffectiveBundleConductorLength(node(project, "bundle-1"), "bundle-1-c1"), "750 mm");
  assert.equal(getEffectiveBundleConductorLength(node(project, "bundle-1"), "bundle-1-c2"), "700 mm");
});

test("explicit conductor override creation is a real change even when it equals its default", () => {
  const project = fixture(), refs = targets(project, "conductors").filter((ref) => ref.componentId.startsWith("bundle"));
  const preview = run(project, "conductors", refs, { length: set("600 mm"), color: set("GNYE") });
  assert.equal(preview.changedObjects, 8);
  assert.equal(node(project, "bundle-1").conductorLengthOverrides["bundle-1-c2"], "600 mm");
  assert.ok(preview.changes.some((change) => change.next === "600 mm (override)"));
  run(project, "bundles", targets(project, "bundles"), { length: set("900 mm") });
  assert.equal(getEffectiveBundleConductorLength(node(project, "bundle-1"), "bundle-1-c2"), "600 mm");
  run(project, "conductors", refs, { length: { action: "clear" } });
  assert.equal(node(project, "bundle-1").conductorLengthOverrides, undefined);
  assert.equal(getEffectiveBundleConductorLength(node(project, "bundle-1"), "bundle-1-c2"), "900 mm");
});

test("invalid values or read-only targets reject the entire transaction without partial mutations", () => {
  const project = fixture(), original = structuredClone(project);
  const refs = targets(project, "bundles");
  const transaction = { category: "bundles", targets: refs, edits: [{ target: refs[0], propertyId: "length", newValue: "700 mm" }, { target: refs[1], propertyId: "length", newValue: "-50 mm" }] };
  const preview = previewPropertyTransaction(project, transaction);
  assert.equal(preview.changes.length, 1); assert.equal(preview.issues.length, 1);
  assert.throws(() => applyPropertyTransaction(project, preview), /B2.*Length.*positive/);
  assert.deepEqual(project, original);
  const mixed = previewPropertyTransaction(project, createBulkPropertyTransaction("conductors", targets(project, "conductors"), { length: set("1 m") }));
  assert.throws(() => applyPropertyTransaction(project, mixed), /read-only/); assert.deepEqual(project, original);
  assert.equal(bulkPropertyColumns("conductors", buildPropertyRows(project, "conductors")).some((column) => column.id === "length"), false);
});

test("structural, mixed-category, duplicate and unsupported requests are rejected", () => {
  const project = fixture(), refs = targets(project, "connectors");
  for (const propertyId of ["id", "designator", "pinCount", "links", "shieldTerminations", "twistedPair"]) {
    const preview = previewPropertyTransaction(project, createBulkPropertyTransaction("connectors", refs, { [propertyId]: set("bad") }));
    assert.ok(preview.issues.length); assert.throws(() => applyPropertyTransaction(project, preview));
  }
  const cross = previewPropertyTransaction(project, createBulkPropertyTransaction("connectors", [refs[0], targets(project, "cables")[0]], { mpn: set("NEW") }));
  assert.throws(() => applyPropertyTransaction(project, cross), /category/);
  const transaction = createBulkPropertyTransaction("connectors", [refs[0]], { mpn: set("NEW") });
  transaction.edits.push(transaction.edits[0]);
  assert.match(previewPropertyTransaction(project, transaction).issues[0].message, /Duplicate/);
  const unsupported = { ...transaction, edits: [{ ...transaction.edits[0], action: "remove" }] };
  assert.match(previewPropertyTransaction(project, unsupported).issues[0].message, /Unsupported field action/);
});

test("matching and kept requests produce no mutation or replacement project array", () => {
  const project = fixture(), refs = targets(project, "connectors"), components = project.components;
  const preview = previewPropertyTransaction(project, createBulkPropertyTransaction("connectors", refs, { mpn: set("PN-OLD") }));
  assert.equal(preview.changes.length, 0); assert.equal(preview.unchangedObjects, 5);
  assert.equal(applyPropertyTransaction(project, preview), 0); assert.equal(project.components, components);
  const keep = previewPropertyTransaction(project, createBulkPropertyTransaction("connectors", refs, { mpn: { action: "keep" } }));
  assert.equal(applyPropertyTransaction(project, keep), 0); assert.equal(project.components, components);
  node(project, "j2").mpn = "NEW";
  assert.ok(validatePropertyPreview(project, preview).issues.some((issue) => /since preview/.test(issue.message)));
});

test("stale values, inheritance, deleted targets and different projects cannot be overwritten", () => {
  for (const mutation of [
    (project) => { node(project, "j2").mpn = "NEWER"; },
    (project) => { project.components = project.components.filter((node) => node.id !== "j2"); },
    (project) => { project.projectId = "another-project"; },
  ]) {
    const project = fixture();
    const preview = previewPropertyTransaction(project, createBulkPropertyTransaction("connectors", targets(project, "connectors"), { mpn: set("DESIRED") }));
    mutation(project); const before = structuredClone(project);
    assert.throws(() => applyPropertyTransaction(project, preview), /No changes were made/); assert.deepEqual(project, before);
  }
  const project = fixture(), refs = targets(project, "conductors").filter((ref) => ref.componentId === "bundle-1");
  const preview = previewPropertyTransaction(project, createBulkPropertyTransaction("conductors", refs, { length: { action: "clear" } }));
  node(project, "bundle-1").length = "1 m";
  assert.throws(() => applyPropertyTransaction(project, preview), /source changed/);
});

test("an unexpected staging failure never publishes any partially updated components", () => {
  const project = fixture();
  const preview = previewPropertyTransaction(project, createBulkPropertyTransaction("connectors", targets(project, "connectors"), { mpn: set("NEW") }));
  const before = project.components;
  Object.defineProperty(node(project, "j2"), "supplier", { enumerable: true, get() { throw new Error("Simulated staging failure"); } });
  assert.throws(() => applyPropertyTransaction(project, preview), /Simulated staging failure/);
  assert.equal(project.components, before);
  assert.equal(node(project, "j1").mpn, "PN-OLD");
  assert.equal(node(project, "j2").mpn, "PN-OLD");
});

test("literal whole/substring replacements preserve unrelated content and replacement metacharacters", () => {
  const options = { propertyId: "mpn", find: "OLD", replacement: "$& [new]", caseSensitive: false, wholeCell: false };
  assert.equal(replacePropertyText("old+OLD+Old", options), "$& [new]+$& [new]+$& [new]");
  assert.equal(replacePropertyText("Cable preliminary text", { ...options, find: "preliminary", replacement: "approved" }), "Cable approved text");
  assert.equal(replacePropertyText("abcdef", { ...options, find: "bcde", replacement: "" }), "af");
  assert.equal(replacePropertyText("pn-old", { ...options, wholeCell: true }), undefined);
  assert.equal(replacePropertyText("old", { ...options, wholeCell: true }), "$& [new]");
  assert.equal(replacePropertyText("old", { ...options, caseSensitive: true }), undefined);
  assert.equal(replacePropertyText("xİOLDz", options), "xİ$& [new]z", "Unicode case mapping never shifts source offsets");
});

test("Find & Replace has explicit stable scope and never replaces topology or attachment data", () => {
  const project = fixture(), before = structuredClone(project);
  const rows = queryPropertyRows(buildPropertyRows(project, "connectors"), propertyColumns("connectors"), { filterColumn: "manufacturer", filterValue: "Amphenol", sortColumn: "designator", descending: true });
  const refs = rows.slice(0, 2).map((row) => row.ref);
  const transaction = createFindReplaceTransaction(project, "connectors", refs, { propertyId: "mpn", find: "PN-OLD", replacement: "NEW", caseSensitive: true, wholeCell: true });
  const preview = previewPropertyTransaction(project, transaction); assert.equal(preview.matchedObjects, 2);
  const extra = makeComponent("connector", 6, "j6"); extra.mpn = "PN-OLD"; project.components.push(extra);
  applyPropertyTransaction(project, preview);
  assert.equal(node(project, "j5").mpn, "NEW"); assert.equal(node(project, "j4").mpn, "NEW"); assert.equal(node(project, "j3").mpn, "PN-OLD"); assert.equal(node(project, "j6").mpn, "PN-OLD");
  assert.deepEqual(project.links, before.links); assert.deepEqual(project.attachments, before.attachments);
  for (const propertyId of ["color", "length", "gauge", "id", "conductor", "designator"]) {
    assert.throws(() => createFindReplaceTransaction(project, "conductors", targets(project, "conductors"), { propertyId, find: "RD", replacement: "BU", caseSensitive: false, wholeCell: false }), /editable text/);
  }
  assert.throws(() => createFindReplaceTransaction(project, "connectors", refs, { propertyId: "mpn", find: "", replacement: "", caseSensitive: false, wholeCell: false }), /Enter literal/);
});

test("replacement with empty text clears optional values; invalid replacement applies nothing", () => {
  const project = fixture(), refs = targets(project, "connectors");
  const invalid = previewPropertyTransaction(project, createFindReplaceTransaction(project, "connectors", refs, { propertyId: "mpn", find: "PN-OLD", replacement: "x".repeat(4001), caseSensitive: false, wholeCell: true }));
  assert.throws(() => applyPropertyTransaction(project, invalid)); assert.equal(node(project, "j1").mpn, "PN-OLD");
  const clear = previewPropertyTransaction(project, createFindReplaceTransaction(project, "connectors", refs, { propertyId: "mpn", find: "PN-OLD", replacement: "", caseSensitive: false, wholeCell: true }));
  applyPropertyTransaction(project, clear); assert.equal(node(project, "j1").mpn, "");
});

test("stable identities survive sorted selection and reordering before preview", () => {
  const project = fixture(), rows = queryPropertyRows(buildPropertyRows(project, "conductors"), propertyColumns("conductors"), { filterColumn: "parent", filterValue: "B1", sortColumn: "conductor", descending: true });
  const refs = rows.slice(0, 2).map((row) => row.ref);
  const bundle = node(project, "bundle-1"); bundle.conductorIds.reverse(); bundle.colors.reverse(); bundle.wireLabels.reverse();
  run(project, "conductors", refs, { color: set("WHBU") });
  for (const ref of refs) assert.equal(node(project, ref.componentId).colors[node(project, ref.componentId).conductorIds.indexOf(ref.conductorId)], "WHBU");
  assert.equal(bundle.colors[3], "RD", "original object was not partially mutated during staging");
});

test("multi-field values persist and are consumed by reports/BOM through the native model", () => {
  const project = fixture();
  run(project, "connectors", targets(project, "connectors"), { mpn: set("BULK-PN"), notes: set("Assembly\nMultiline") });
  const restored = parseProjectFile(serializeProjectFile(project)).project;
  assert.equal(node(restored, "j5").mpn, "BULK-PN");
  assert.match(JSON.stringify(buildBomRows(restored)), /BULK-PN/);
  assert.match(renderHarnessReportHtml(buildHarnessReportModel(restored, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"></svg>')), /BULK-PN/);
});

test("hundreds of edits stage only affected components without reading attachments", () => {
  const project = createEmptyProject();
  for (let index = 0; index < 100; index++) {
    const component = makeComponent("bundle", index + 1, `b-${index}`); component.wireCount = 12;
    component.conductorIds = Array.from({ length: 12 }, (_, n) => `b-${index}-c-${n}`);
    component.colors = Array.from({ length: 12 }, () => "BK"); project.components.push(component);
  }
  Object.defineProperty(project, "attachments", { get() { throw new Error("Do not decode/serialize attachments in transactions"); } });
  const refs = targets(project, "conductors").slice(100, 400), firstUnchanged = project.components[0];
  const preview = previewPropertyTransaction(project, createBulkPropertyTransaction("conductors", refs, { color: set("GNYE"), label: set("NEW") }));
  assert.equal(preview.changes.length, 600); assert.equal(applyPropertyTransaction(project, preview), 600);
  assert.equal(project.components[0], firstUnchanged);
  assert.equal(new Set(preview.changes.map((change) => propertyRowKey(change.edit.target))).size, 300);
  assert.equal(cloneProject(fixture()).attachments[0].data, "UE4tT0xE");
});
