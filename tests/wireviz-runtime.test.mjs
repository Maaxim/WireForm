import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { instance } from "@viz-js/viz";
import { loadPyodide } from "pyodide";
import vendorManifest from "../vendor/manifest.json" with { type: "json" };

const { addWireFormDiagramIdsToDot, getTwistedPairAnnotationGeometry } = await import(
  "../app/diagram-annotations.ts"
);
const { prepareHarnessDiagramSvg } = await import("../app/html-report.ts");
const model = await import("../app/model.ts");
const twistedPair = await import("../app/twisted-pair.ts");

test(
  "vendored WireViz produces DOT that GraphViz WASM renders",
  { timeout: 60_000 },
  async () => {
    const pyodideRoot = new URL("../node_modules/pyodide/", import.meta.url);
    const pyodide = await loadPyodide({ indexURL: fileURLToPath(pyodideRoot) });
    const wheels = vendorManifest.components
      .filter((component) => component.artifact?.endsWith(".whl"))
      .map((component) => `../${component.artifact}`);

    for (const wheel of wheels) {
      pyodide.unpackArchive(
        new Uint8Array(await readFile(new URL(wheel, import.meta.url))),
        "wheel",
      );
    }

    pyodide.runPython(`
import sys
import types
yaml_module = types.ModuleType("yaml")
yaml_module.safe_load = lambda _value: None
sys.modules["yaml"] = yaml_module
from wireviz.wireviz import parse as wireviz_parse
`);

    const imagePath = "/wireform-images/test.png";
    const imageDataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA";
    pyodide.FS.mkdirTree("/wireform-images");
    pyodide.FS.writeFile(
      imagePath,
      new Uint8Array(Buffer.from(imageDataUrl.split(",")[1], "base64")),
    );

    const document = {
      metadata: { title: "Runtime smoke test", revision: "A" },
      connectors: {
        J1: {
          type: "Source",
          pincount: 2,
          pinlabels: ["PWR", "GND"],
          additional_components: [
            {
              type: "Crimp contact",
              manufacturer: "HARTING",
              mpn: "09 15 200 6224",
              qty: 2,
            },
          ],
          image: {
            src: imagePath,
            width: 80,
            height: 60,
            scale: "both",
            fixedsize: false,
          },
        },
        J2: { type: "Load", pincount: 2, pinlabels: ["PWR", "GND"] },
      },
      cables: {
        W1: {
          wirecount: 2,
          colors: ["BUWH", "WHBU"],
          wirelabels: ["POWER", "RETURN"],
          gauge: "22 AWG",
          length: "1 m",
          additional_components: [
            {
              type: "Wire label",
              manufacturer: "Brady",
              mpn: "B-342",
              qty: 1,
              unit: "pcs",
              qty_multiplier: "terminations",
            },
            {
              type: "Ferrite",
              manufacturer: "TDK",
              mpn: "ZCAT2035-0930",
              qty: 1,
            },
          ],
        },
      },
      connections: [
        [{ J1: 1 }, { W1: 1 }, { J2: 1 }],
        [{ J1: 2 }, { W1: 2 }, { J2: 2 }],
      ],
    };

    const pythonDocument = pyodide.toPy(document);
    pyodide.globals.set("WIREFORM_DOCUMENT", pythonDocument);
    const dot = pyodide.runPython(`
harness = wireviz_parse(WIREFORM_DOCUMENT, return_types="harness")
harness.graph.source
`);

    assert.match(dot, /J1/);
    assert.match(dot, /W1/);
    assert.match(dot, /J2/);
    assert.match(dot, /POWER/);
    assert.match(dot, /#0066ff:#ffffff:#0066ff/);
    assert.match(dot, /#ffffff:#0066ff:#ffffff/);

    const viz = await instance();
    const diagramDot = addWireFormDiagramIdsToDot(dot);
    assert.match(diagramDot, /id="wireform-member-57_31-1-1"/);
    assert.match(diagramDot, /id="wireform-member-57_31-2-1"/);
    let svg = viz.renderString(diagramDot, {
      engine: "dot",
      format: "svg",
      images: [{ name: imagePath, width: 80, height: 60 }],
    });
    svg = svg.split(imagePath).join(imageDataUrl);
    assert.match(svg, /<svg\b/);
    assert.match(svg, />J1</);
    assert.match(svg, />W1</);
    assert.match(svg, /data:image\/png;base64/);
    assert.match(svg, /#0066ff/);
    assert.match(svg, /#ffffff/);
    assert.match(svg, /id="wireform&#45;member&#45;57_31&#45;1&#45;1"/);
    assert.match(svg, /id="wireform&#45;member&#45;57_31&#45;2&#45;1"/);

    const project = model.createEmptyProject("Runtime annotation test");
    const bundle = model.makeComponent("bundle", 2, "runtime-bundle");
    bundle.designator = "W1";
    bundle.colors = ["BUWH", "WHBU"];
    project.components.push(bundle);
    project.twistedPairs.push({
      id: "runtime-pair",
      designator: "TP1",
      members: [
        twistedPair.bundleConductorMember(bundle.id, bundle.conductorIds[0]),
        twistedPair.bundleConductorMember(bundle.id, bundle.conductorIds[1]),
      ],
      twistDirection: "unspecified",
    });
    const markerGeometry = getTwistedPairAnnotationGeometry(
      project.twistedPairs[0],
      svg,
      project,
    );
    assert.equal(markerGeometry.markers.length, 2);
    assert.ok(markerGeometry.markers.every((marker) => marker.source === "conductor"));
    assert.equal(
      new Set(markerGeometry.markers.map((marker) => `${marker.point.x},${marker.point.y}`)).size,
      2,
    );
    const annotatedSvg = prepareHarnessDiagramSvg(project, svg);
    assert.equal(
      (annotatedSvg.match(/class="wireform-twisted-pair-marker"/g) ?? []).length,
      2,
    );
    assert.equal((annotatedSvg.match(/>TP1<\/text>/g) ?? []).length, 2);
    assert.match(annotatedSvg, /stroke="#0066ff"/);
    assert.match(annotatedSvg, /stroke="#ffffff"/);

    pythonDocument.destroy?.();
  },
);
