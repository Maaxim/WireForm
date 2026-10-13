import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const annotations = await import("../app/diagram-annotations.ts");
const colors = await import("../app/wire-colors.ts");
const library = await import("../app/library.ts");
const model = await import("../app/model.ts");
const report = await import("../app/html-report.ts");
const pdf = await import("../app/pdf-report.ts");
const shields = await import("../app/shield-routing.ts");

const SAFE_SVG =
  '<svg width="120pt" height="60pt" viewBox="0 0 120 60" xmlns="http://www.w3.org/2000/svg"><path d="M0 30 L120 30"/></svg>';

function shieldProject(color) {
  const project = model.createEmptyProject("Shield colors");
  const cable = model.makeComponent("cable", 1, "cable-1");
  cable.designator = "W1";
  cable.shield = true;
  if (color !== undefined) cable.shieldColor = color;
  project.components = [cable];
  return { project, cable };
}

test("legacy shields keep an absent color while rendering with the BK fallback", () => {
  const { project } = shieldProject(undefined);
  const reopened = model.parseProjectFile(model.serializeProjectFile(project)).project;
  assert.equal(reopened.components[0].shieldColor, undefined);
  assert.equal(colors.getShieldColorCode(reopened.components[0].shieldColor), "BK");
  assert.deepEqual(shields.buildShieldDiagramStyles(reopened), [
    { cableDesignator: "W1", colorCode: "BK" },
  ]);
});

test("solid and bicolor shield metadata round-trip, copy, and library insertion", () => {
  for (const color of ["GN", "GNYE", "WHBU"]) {
    const { project, cable } = shieldProject(color);
    const reopened = model.parseProjectFile(model.serializeProjectFile(project)).project;
    assert.equal(reopened.components[0].shieldColor, color);
    const copy = model.cloneProject(project);
    assert.equal(copy.components[0].shieldColor, color);
    const inserted = library.instantiateTemplate(
      library.componentToTemplate(cable, `${color} shield`),
      2,
    );
    assert.equal(inserted.shieldColor, color);
  }
});

test("shield validation reuses normal supported and malformed color semantics", () => {
  const { project, cable } = shieldProject("GNYE");
  assert.equal(
    colors.validateWireColors(project).some((warning) => warning.includes("shield")),
    false,
  );
  cable.shieldColor = "GNXX";
  assert.match(colors.validateWireColors(project).join("\n"), /W1 shield uses unsupported/);
});

const SHIELD_DOT = `graph harness {
  W1 [label=<
  <table border="0">
   <tr><td>J1:9</td><td>Shield</td><td><!-- s_out --></td></tr>
   <tr><td colspan="3" port="ws"></td></tr>
  </table>>]
  J1:p9r:e -- W1:ws:w
  J1:p1r:e -- W1:w1:w
}`;

test("shared DOT pipeline gives every shield edge a thin selected vector color", () => {
  const styled = annotations.prepareHarnessDiagramDot(
    SHIELD_DOT,
    [{
      cableDesignator: "W1",
      cableSide: "right",
      connectorDesignator: "J2",
      shieldTerminationId: "shell-1",
      shieldLabel: "Shield",
    }],
    [{ cableDesignator: "W1", colorCode: "GNYE" }],
  );
  const shieldLines = styled
    .split("\n")
    .filter((line) => line.includes("shield_l") || line.includes("shield_r"));
  const edges = shieldLines.filter((line) => line.includes(" -- "));
  assert.equal(edges.length, 2);
  for (const edge of edges) {
    assert.match(edge, /color="#25292d:#3c9669:#e4b72d:#3c9669:#25292d"/);
    assert.match(edge, /penwidth=0\.220/);
    assert.match(edge, /style="solid"/);
  }
  assert.match(styled, /J1:p1r:e -- W1:w1:w \[id=/);
  assert.doesNotMatch(
    styled.split("\n").find((line) => line.includes("W1:w1:w")),
    /penwidth=/,
  );
});

test("reports omit textual shield details while retaining the shared colored diagram", () => {
  const { project } = shieldProject("GNYE");
  project.components[0].additionalComponents = [{
    id: "wire-label",
    type: "Wire label",
    qty: 1,
    unit: "pcs",
  }];
  const coloredSvg = SAFE_SVG.replace(
    "/>",
    ' stroke="#3c9669" stroke-width="0.22"/><path d="M0 31 L120 31" stroke="#e4b72d" stroke-width="0.22"/>',
  );
  const reportModel = report.buildHarnessReportModel(project, coloredSvg);
  assert.equal("shieldColor" in reportModel.cables[0], false);
  const html = report.renderHarnessReportHtml(reportModel);
  assert.doesNotMatch(html, /W1 <span>Shield<\/span>/);
  assert.doesNotMatch(html, /Green \/ Yellow \(GNYE\)/);
  assert.match(html, /W1 <span>Additional Components<\/span>/);
  assert.match(html, /stroke="#3c9669"/);
  assert.match(html, /stroke="#e4b72d"/);
  const definition = pdf.buildHarnessPdfDocument(reportModel);
  const pdfJson = JSON.stringify(definition.content);
  assert.doesNotMatch(pdfJson, /"text":"Shield"/);
  assert.doesNotMatch(pdfJson, /Green \/ Yellow \(GNYE\)/);
  assert.match(pdfJson, /W1 Additional Components/);
  assert.match(pdfJson, /#3c9669/);
  assert.match(pdfJson, /#e4b72d/);
});

test("editor reuses the wire color editor and preserves the wide shield hit target", async () => {
  const [studio, css, worker] = await Promise.all([
    readFile(new URL("../app/HarnessStudio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/preview.worker.ts", import.meta.url), "utf8"),
  ]);
  assert.match(studio, /function WireColorEditor/);
  assert.match(studio, /target="shield"/);
  assert.match(studio, /updateSelected\(\{ shieldColor \}\)/);
  assert.match(studio, /isShieldConnection \? "shield-connection"/);
  assert.match(css, /\.connection-hit[\s\S]*stroke-width: 14/);
  assert.match(css, /\.connection-line\.shield-connection \.connection-visible[\s\S]*stroke-width: 1\.9/);
  assert.match(worker, /message\.shieldStyles/);
});
