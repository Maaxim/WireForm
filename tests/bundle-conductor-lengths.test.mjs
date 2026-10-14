import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const model = await import("../app/model.ts");
const bundleLengths = await import("../app/bundle-conductors.ts");
const bom = await import("../app/bom.ts");
const report = await import("../app/html-report.ts");
const pdf = await import("../app/pdf-report.ts");
const library = await import("../app/library.ts");
const additional = await import("../app/additional-components.ts");

const SAFE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><path d="M0 0L1 1"/></svg>';

function makeBundle() {
  const bundle = model.makeComponent("bundle", 1, "bundle-1");
  bundle.designator = "W1";
  bundle.name = "Hook-up wire";
  bundle.manufacturer = "Example";
  bundle.mpn = "WIRE-22";
  bundle.gauge = "14 AWG";
  bundle.length = "600 mm";
  bundle.wireCount = 4;
  bundle.colors = ["RD", "BK", "RD", "BK"];
  bundle.wireLabels = ["A", "B", "C", "D"];
  bundle.conductorIds = ["cond-a", "cond-b", "cond-c", "cond-d"];
  bundle.conductorLengthOverrides = {
    "cond-c": "750 mm",
    "cond-d": "550 mm",
  };
  return bundle;
}

function projectWith(bundle) {
  const project = model.createEmptyProject("Bundle lengths");
  project.components = [bundle];
  return project;
}

test("effective length inherits the bundle default and supports clear/reset", () => {
  const bundle = makeBundle();
  assert.equal(
    bundleLengths.getEffectiveBundleConductorLength(bundle, "cond-a"),
    "600 mm",
  );
  assert.equal(
    bundleLengths.getEffectiveBundleConductorLength(bundle, "cond-c"),
    "750 mm",
  );

  bundle.length = "700 mm";
  assert.equal(
    bundleLengths.getEffectiveBundleConductorLength(bundle, "cond-a"),
    "700 mm",
  );
  assert.equal(
    bundleLengths.getEffectiveBundleConductorLength(bundle, "cond-c"),
    "750 mm",
  );

  bundle.conductorLengthOverrides =
    bundleLengths.withBundleConductorLengthOverride(
      bundle,
      "cond-c",
      undefined,
    );
  assert.equal(
    bundleLengths.getEffectiveBundleConductorLength(bundle, "cond-c"),
    "700 mm",
  );
});

test("project persistence keeps sparse overrides by stable conductor identity", () => {
  const bundle = makeBundle();
  const reopened = model.parseProjectFile(
    model.serializeProjectFile(projectWith(bundle)),
  ).project.components[0];
  assert.deepEqual(reopened.conductorLengthOverrides, {
    "cond-c": "750 mm",
    "cond-d": "550 mm",
  });
  assert.equal(reopened.conductorLengthOverrides["cond-a"], undefined);

  reopened.conductorIds = ["cond-d", "cond-b", "cond-c", "cond-a"];
  assert.equal(
    bundleLengths.getEffectiveBundleConductorLength(reopened, "cond-d"),
    "550 mm",
  );
  assert.equal(
    bundleLengths.getEffectiveBundleConductorLength(reopened, "cond-a"),
    "600 mm",
  );
});

test("legacy bundles do not gain redundant override values", () => {
  const bundle = makeBundle();
  delete bundle.conductorLengthOverrides;
  const normalized = model.normalizeProject(projectWith(bundle)).project.components[0];
  assert.equal(normalized.conductorLengthOverrides, undefined);
  assert.equal(
    bundleLengths.getEffectiveBundleConductorLength(normalized, "cond-c"),
    "600 mm",
  );
});

test("bundle length validation rejects zero/negative overrides and permits partial overrides", () => {
  const bundle = makeBundle();
  bundle.length = "";
  bundle.conductorLengthOverrides = {
    "cond-a": "100 mm",
    "cond-b": "0 mm",
    "cond-c": "-5 mm",
  };
  const issues = bundleLengths.validateBundleConductorLengths(projectWith(bundle));
  assert.equal(issues.errors.length, 2);
  assert.match(issues.errors.join("\n"), /conductor 2/);
  assert.match(issues.errors.join("\n"), /conductor 3/);
  assert.ok(issues.warnings.some((warning) => /conductor 4/.test(warning)));
  assert.ok(!issues.warnings.some((warning) => /conductor 1/.test(warning)));
});

test("BOM sums effective physical length by existing wire identity", () => {
  const rows = bom.buildBomRows(projectWith(makeBundle()));
  const red = rows.find((row) => /Red \(RD\)/.test(row.description));
  const black = rows.find((row) => /Black \(BK\)/.test(row.description));
  assert.equal(red.quantity, 1.35);
  assert.equal(black.quantity, 1.15);
  assert.equal(red.unit, "m");
  assert.equal(black.unit, "m");
  assert.deepEqual(red.designators, ["W1"]);
});

test("bundle without overrides retains length-times-conductor BOM behavior", () => {
  const bundle = makeBundle();
  bundle.colors = ["RD", "RD", "RD", "RD"];
  delete bundle.conductorLengthOverrides;
  const rows = bom.buildBomRows(projectWith(bundle));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 2.4);
});

test("length-based bundle accessories use summed effective conductor lengths", () => {
  const bundle = makeBundle();
  assert.equal(
    additional.additionalComponentQuantity(projectWith(bundle), bundle, {
      id: "sleeve",
      qty: 1,
      qtyMultiplier: "total_length",
    }),
    2.5,
  );
});

test("HTML and PDF share effective conductor lengths while bundle summary omits default", () => {
  const bundle = makeBundle();
  const cable = model.makeComponent("cable", 2, "cable-1");
  cable.designator = "C1";
  cable.length = "2 m";
  const project = projectWith(bundle);
  project.components.push(cable);
  const reportModel = report.buildHarnessReportModel(project, SAFE_SVG);
  const bundleRow = reportModel.cables.find((row) => row.designator === "W1");
  const cableRow = reportModel.cables.find((row) => row.designator === "C1");
  assert.equal(bundleRow.length, "");
  assert.equal(cableRow.length, "2 m");
  assert.deepEqual(
    bundleRow.conductors.map((conductor) => conductor.length),
    ["600 mm", "600 mm", "750 mm", "550 mm"],
  );
  assert.ok(bundleRow.conductors.every((conductor) => conductor.gauge === "14 AWG"));

  const html = report.renderHarnessReportHtml(reportModel);
  assert.match(html, />Wire size</);
  assert.match(html, />Length</);
  assert.doesNotMatch(html, /600 mm \((?:default|inherited|override)\)/i);
  const document = pdf.buildHarnessPdfDocument(reportModel);
  const serializedDocument = JSON.stringify(document);
  assert.match(serializedDocument, /Bundle Conductors/);
  assert.match(serializedDocument, /750 mm/);
  assert.match(serializedDocument, /14 AWG/);
  assert.doesNotMatch(serializedDocument, /600 mm \((?:default|inherited|override)\)/i);
});

test("User Library preserves overrides and remaps them to cloned conductor IDs", () => {
  const bundle = makeBundle();
  const template = library.componentToTemplate(bundle, "Bundle template");
  const inserted = library.instantiateTemplateWithRelationships(template, 3).component;
  assert.equal(inserted.length, "600 mm");
  assert.notDeepEqual(inserted.conductorIds, bundle.conductorIds);
  assert.equal(
    bundleLengths.getEffectiveBundleConductorLength(
      inserted,
      inserted.conductorIds[2],
    ),
    "750 mm",
  );
  assert.equal(
    bundleLengths.getEffectiveBundleConductorLength(
      inserted,
      inserted.conductorIds[3],
    ),
    "550 mm",
  );
});

test("editor exposes bundle-only override controls and copy remapping", async () => {
  const source = await readFile(
    new URL("../app/HarnessStudio.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /Default length/);
  assert.match(source, /length override/);
  assert.match(source, /Use default/);
  assert.match(source, /remapBundleConductorLengthOverrides/);
});
