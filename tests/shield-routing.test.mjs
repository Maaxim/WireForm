import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const annotations = await import("../app/diagram-annotations.ts");
const model = await import("../app/model.ts");
const shields = await import("../app/shield-routing.ts");

function fixture() {
  const project = model.createEmptyProject("Shield routing fixture");
  const j1 = model.makeComponent("connector", 1, "j1");
  const j2 = model.makeComponent("connector", 2, "j2");
  const cable = model.makeComponent("cable", 3, "w1");
  j1.designator = "J1";
  j2.designator = "J2";
  j1.pinCount = 12;
  j2.pinCount = 12;
  cable.designator = "W1";
  cable.shield = true;
  project.components = [j1, cable, j2];
  return { project, j1, j2, cable };
}

function shieldLink(id, connector, pin, cable, side) {
  return {
    id,
    from: {
      nodeId: connector.id,
      portId: `pin:${pin}`,
      // Deliberately opposite the cable side: routing must use the cable port.
      side: side === "left" ? "right" : "left",
    },
    to: { nodeId: cable.id, portId: "shield", side },
  };
}

test("left-only shield termination serializes connector to cable shield", () => {
  const { project, j1, cable } = fixture();
  project.links = [shieldLink("left", j1, 9, cable, "left")];
  assert.deepEqual(shields.resolveShieldTerminations(project, cable), [
    {
      side: "left",
      connectorDesignator: "J1",
      endpoint: { kind: "pin", physicalPin: 9 },
    },
  ]);
  assert.deepEqual(shields.buildWireVizShieldConnections(project, cable), [
    [{ J1: 9 }, { W1: "s" }],
  ]);
});

test("right-only shield termination serializes cable shield to connector", () => {
  const { project, j2, cable } = fixture();
  project.links = [shieldLink("right", j2, 9, cable, "right")];
  assert.deepEqual(shields.buildWireVizShieldConnections(project, cable), [
    [{ W1: "s" }, { J2: 9 }],
  ]);
});

test("both-end shields produce two local standard WireViz connections", () => {
  const { project, j1, j2, cable } = fixture();
  project.links = [
    shieldLink("left", j1, 9, cable, "left"),
    shieldLink("right", j2, 9, cable, "right"),
  ];
  assert.deepEqual(shields.buildWireVizShieldConnections(project, cable), [
    [{ J1: 9 }, { W1: "s" }],
    [{ W1: "s" }, { J2: 9 }],
  ]);
});

test("floating shields produce no invented external connection", () => {
  const { project, cable } = fixture();
  assert.deepEqual(shields.resolveShieldTerminations(project, cable), []);
  assert.deepEqual(shields.buildWireVizShieldConnections(project, cable), []);
});

const SHIELD_DOT = `graph harness {
  W1 [label=<
  <table border="0">
   <tr>
    <td>J1:9</td>
    <td>Shield</td>
    <td><!-- s_out --></td>
   </tr>
   <tr><td colspan="3" cellpadding="0" height="2" bgcolor="#000000" border="0" port="ws"></td></tr>
  </table>
  >]
  J1:p9r:e -- W1:ws:w
  J1:p1r:e -- W1:w1:w
}`;

test("DOT routing adds dedicated Shield-row ports and preserves physical pin text", () => {
  const result = annotations.applyShieldDiagramRouting(SHIELD_DOT);
  assert.match(result, /<td port="shield_l">J1:9<\/td>/);
  assert.match(result, /<td port="shield_r"><!-- s_out --><\/td>/);
  assert.match(result, /J1:p9r:e -- W1:shield_l:w/);
  assert.doesNotMatch(result, /-- W1:ws:w/);
  assert.doesNotMatch(result, /W1:ws:e --/);
  assert.match(result, /J1:p1r:e -- W1:w1:w/);
  assert.equal(annotations.applyShieldDiagramRouting(result), result);
});

test("right and both-end shield edges use their matching side-local ports", () => {
  const both = `${SHIELD_DOT.replace("<!-- s_out -->", "J2:9")}
  W1:ws:e -- J2:p9l:w`;
  const result = annotations.prepareHarnessDiagramDot(both);
  assert.match(result, /J1:p9r:e -- W1:shield_l:w/);
  assert.match(result, /W1:shield_r:e -- J2:p9l:w/);
  assert.doesNotMatch(result, /(?:^|\s)W1:ws:[ew]/m);
  assert.match(result, /J1:p1r:e -- W1:w1:w \[id="wireform-member-/);
});

test("shared worker pipeline applies shield routing before UI, HTML, and PDF consume SVG", async () => {
  const [worker, studio, html, pdf] = await Promise.all([
    readFile(new URL("../app/preview.worker.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/HarnessStudio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/html-report.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/pdf-report.ts", import.meta.url), "utf8"),
  ]);
  assert.match(
    worker,
    /prepareHarnessDiagramDot\([\s\S]*?dot,[\s\S]*?message\.connectorShieldRoutes,[\s\S]*?message\.shieldStyles/,
  );
  assert.match(studio, /buildWireVizShieldConnections\(project, cable\)/);
  assert.match(studio, /prepareHarnessDiagramSvg\(project, previewSvg\)/);
  assert.match(html, /diagramSvg: prepareHarnessDiagramSvg\(project, diagramSvg\)/);
  assert.match(pdf, /svg: model\.diagramSvg/);
  assert.doesNotMatch(html, /applyShieldDiagramRouting/);
  assert.doesNotMatch(pdf, /applyShieldDiagramRouting/);
});
