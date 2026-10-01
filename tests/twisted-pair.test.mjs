import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const model = await import("../app/model.ts");
const pairs = await import("../app/twisted-pair.ts");
const bom = await import("../app/bom.ts");
const report = await import("../app/html-report.ts");
const wirevizImport = await import("../app/wireviz-import.ts");

const SAFE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z" /></svg>';

function wire(id, designator, color = "WH", length = "220 mm", gauge = "24 AWG") {
  const component = model.makeComponent("wire", 1, id);
  component.designator = designator;
  component.wireCount = 1;
  component.colors = [color];
  component.length = length;
  component.gauge = gauge;
  return component;
}

function projectWithWires() {
  const project = model.createEmptyProject("Twisted pair harness");
  project.components.push(wire("wire-a", "W1"), wire("wire-b", "W2", "BU"));
  return project;
}

test("creates a stable project-level pair and allocates natural designators", () => {
  const project = projectWithWires();
  const first = pairs.createTwistedPair(project, ["wire-a", "wire-b"]);
  assert.match(first.id, /^twisted-pair-/);
  assert.equal(first.designator, "TP1");
  assert.deepEqual(first.members, ["wire-a", "wire-b"]);
  project.twistedPairs.push(first, {
    ...structuredClone(first),
    id: "existing-3",
    designator: "TP3",
  });
  assert.equal(pairs.allocateTwistedPairDesignator(project.twistedPairs), "TP2");
});

test("save/load preserves pair metadata and legacy projects gain an empty list", () => {
  const project = projectWithWires();
  const pair = pairs.createTwistedPair(project, ["wire-a", "wire-b"]);
  Object.assign(pair, {
    twistPitchMm: 25,
    twistDirection: "Z",
    note: "Keep <pair> together",
  });
  project.twistedPairs.push(pair);
  const parsed = model.parseProjectFile(model.serializeProjectFile(project)).project;
  assert.deepEqual(parsed.twistedPairs, project.twistedPairs);

  const legacy = model.normalizeProject({
    schemaVersion: 3,
    title: "Legacy",
    components: [],
    links: [],
  }).project;
  assert.deepEqual(legacy.twistedPairs, []);
});

test("renaming a member does not change stable pair references", () => {
  const project = projectWithWires();
  project.twistedPairs.push(pairs.createTwistedPair(project, ["wire-a", "wire-b"]));
  project.components[0].designator = "DATA_P";
  assert.deepEqual(project.twistedPairs[0].members, ["wire-a", "wire-b"]);
  assert.equal(pairs.validateTwistedPairs(project).errors.length, 0);
});

test("creation rejects same, missing, multi-conductor, and already-paired wires", () => {
  const project = projectWithWires();
  const cable = model.makeComponent("cable", 3, "cable");
  project.components.push(cable);
  assert.match(pairs.twistedPairCreationIssue(project, ["wire-a", "wire-a"]), /itself/);
  assert.match(pairs.twistedPairCreationIssue(project, ["wire-a", "missing"]), /no longer exists/);
  assert.match(pairs.twistedPairCreationIssue(project, ["wire-a", "cable"]), /single-wire/);
  project.twistedPairs.push(pairs.createTwistedPair(project, ["wire-a", "wire-b"]));
  assert.match(pairs.twistedPairCreationIssue(project, ["wire-a", "cable"]), /already belongs/);
});

test("validation reports malformed relationships and pitch errors", () => {
  const project = projectWithWires();
  const multi = wire("wire-multi", "W3");
  multi.wireCount = 2;
  project.components.push(multi);
  project.twistedPairs.push(
    { id: "short", designator: "TP1", members: ["wire-a"], twistDirection: "unspecified" },
    { id: "same", designator: "TP2", members: ["wire-a", "wire-a"], twistDirection: "unspecified" },
    { id: "missing", designator: "TP3", members: ["wire-a", "missing"], twistDirection: "unspecified" },
    { id: "zero", designator: "TP4", members: ["wire-a", "wire-b"], twistPitchMm: 0, twistDirection: "S" },
    { id: "negative", designator: "TP5", members: ["wire-a", "wire-b"], twistPitchMm: -1, twistDirection: "Z" },
    { id: "infinite", designator: "TP6", members: ["wire-a", "wire-b"], twistPitchMm: Infinity, twistDirection: "unspecified" },
    { id: "duplicate", designator: "TP6", members: ["wire-a", "wire-b"], twistDirection: "unspecified" },
    { id: "multi", designator: "TP7", members: ["wire-multi", "wire-b"], twistDirection: "unspecified" },
  );
  const validation = pairs.validateTwistedPairs(project);
  assert.ok(validation.errors.some((message) => message.includes("exactly two")));
  assert.ok(validation.errors.some((message) => message.includes("same wire twice")));
  assert.ok(validation.errors.some((message) => message.includes("missing wire")));
  assert.equal(validation.errors.filter((message) => message.includes("invalid twist pitch")).length, 3);
  assert.ok(validation.errors.some((message) => message.includes("already a member")));
  assert.ok(validation.errors.some((message) => message.includes("not a single-wire component")));
  assert.ok(validation.errors.some((message) => message.includes("designator tp6")));
});

test("missing pitch is valid while unequal lengths and gauges are warnings", () => {
  const project = projectWithWires();
  project.components[1].length = "230 mm";
  project.components[1].gauge = "22 AWG";
  project.twistedPairs.push(pairs.createTwistedPair(project, ["wire-a", "wire-b"]));
  const validation = pairs.validateTwistedPairs(project);
  assert.deepEqual(validation.errors, []);
  assert.ok(validation.warnings.some((message) => message.includes("different lengths")));
  assert.ok(validation.warnings.some((message) => message.includes("different gauges")));
});

test("deleting a member removes its pair and restoring the snapshot restores both", () => {
  const project = projectWithWires();
  project.twistedPairs.push(pairs.createTwistedPair(project, ["wire-a", "wire-b"]));
  const before = model.cloneProject(project);
  project.components = project.components.filter((component) => component.id !== "wire-a");
  project.twistedPairs = pairs.withoutTwistedPairsForMembers(
    project.twistedPairs,
    new Set(["wire-a"]),
  );
  assert.equal(project.twistedPairs.length, 0);
  assert.equal(project.components.length, 1);
  const afterDeletion = model.cloneProject(project);
  assert.equal(before.components.length, 2);
  assert.equal(before.twistedPairs.length, 1);
  const restored = model.cloneProject(before);
  assert.equal(restored.components.length, 2);
  assert.equal(restored.twistedPairs.length, 1, "undo snapshot restores the pair");
  const redone = model.cloneProject(afterDeletion);
  assert.equal(redone.components.length, 1);
  assert.equal(redone.twistedPairs.length, 0, "redo snapshot remains consistent");
  before.twistedPairs = [];
  assert.equal(before.components.length, 2, "removing a pair must keep its wires");
});

test("copying both members clones the pair; copying one creates no half-pair", () => {
  const project = projectWithWires();
  const original = pairs.createTwistedPair(project, ["wire-a", "wire-b"]);
  project.twistedPairs.push(original);
  const both = pairs.cloneTwistedPairsForPaste(
    [original],
    new Map([["wire-a", "wire-c"], ["wire-b", "wire-d"]]),
    project.twistedPairs,
  );
  assert.equal(both.length, 1);
  assert.notEqual(both[0].id, original.id);
  assert.equal(both[0].designator, "TP2");
  assert.deepEqual(both[0].members, ["wire-c", "wire-d"]);
  const one = pairs.cloneTwistedPairsForPaste(
    [original],
    new Map([["wire-a", "wire-c"]]),
    project.twistedPairs,
  );
  assert.deepEqual(one, []);
});

test("pair membership does not alter BOM rows or member accessory quantities", () => {
  const project = projectWithWires();
  project.components[0].manufacturer = "Alpha";
  project.components[0].mpn = "WIRE-A";
  project.components[0].additionalComponents = [{
    id: "label",
    type: "Wire label",
    manufacturer: "Brady",
    mpn: "LAB-1",
    qty: 2,
    unit: "pcs",
  }];
  const before = bom.buildBomRows(project);
  project.twistedPairs.push(pairs.createTwistedPair(project, ["wire-a", "wire-b"]));
  assert.deepEqual(bom.buildBomRows(project), before);
  assert.ok(!before.some((row) => /twisted/i.test(row.category)));
});

test("HTML report shows natural pair ordering, membership, pitch, direction, and escaped notes", () => {
  const project = projectWithWires();
  project.twistedPairs.push(
    { id: "10", designator: "TP10", members: ["wire-a", "wire-b"], twistDirection: "Z" },
    { id: "2", designator: "TP2", members: ["wire-a", "wire-b"], twistPitchMm: 25, twistDirection: "unspecified", note: "<script>alert(1)</script>" },
    { id: "1", designator: "TP1", members: ["wire-a", "wire-b"], twistDirection: "S" },
  );
  const value = report.buildHarnessReportModel(project, SAFE_SVG);
  assert.deepEqual(value.twistedPairs.map((pair) => pair.designator), ["TP1", "TP2", "TP10"]);
  assert.equal(value.twistedPairs[1].pitch, "25 mm");
  assert.equal(value.twistedPairs[1].direction, "Unspecified");
  assert.match(value.cables[0].twistedPair, /TP10 \/ W2/);
  const html = report.renderHarnessReportHtml(value);
  assert.match(html, /<h2>Twisted Pairs<\/h2>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  const pairSection = html.slice(
    html.indexOf('<section class="report-section" id="twisted-pairs">'),
    html.indexOf("</section>", html.indexOf('id="twisted-pairs"')),
  );
  assert.ok(pairSection.indexOf("TP1") < pairSection.indexOf("TP2"));
  assert.ok(pairSection.indexOf("TP2") < pairSection.indexOf("TP10"));
});

test("WireViz import does not infer pairs and export builder has no pair extension", async () => {
  const imported = wirevizImport.importWireVizYaml(`
metadata:
  title: Pair-like harness
cables:
  W1: {wirecount: 1, length: 220 mm, gauge: 24 AWG, colors: [WH]}
  W2: {wirecount: 1, length: 220 mm, gauge: 24 AWG, colors: [BU]}
`, "pair.yml");
  assert.deepEqual(imported.project.twistedPairs, []);

  const source = await readFile(new URL("../app/HarnessStudio.tsx", import.meta.url), "utf8");
  const builder = source.slice(
    source.indexOf("function buildWireVizDocument"),
    source.indexOf("function validateProject"),
  );
  assert.doesNotMatch(builder, /twistedPairs|twisted_pair|wire_groups/);
});

