import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const annotations = await import("../app/diagram-annotations.ts");
const htmlReport = await import("../app/html-report.ts");
const model = await import("../app/model.ts");
const pdfReport = await import("../app/pdf-report.ts");
const twistedPair = await import("../app/twisted-pair.ts");

function node(id, designator, x, y, width = 120, height = 32) {
  return `<g id="${id}" class="node"><title>${designator}</title><polygon fill="white" stroke="black" points="${x},${y} ${x + width},${y} ${x + width},${y + height} ${x},${y + height}"/><text x="${x + 4}" y="${y + 16}">${designator}</text></g>`;
}

function edge(id, path, stroke = "#333333") {
  return `<g id="${id}" class="edge"><title>connector--bundle</title><path fill="none" stroke="${stroke}" d="${path}"/></g>`;
}

function diagram({ vertical = false, conductors = true } = {}) {
  const b1 = annotations.encodeDiagramKey("B1");
  const w1 = annotations.encodeDiagramKey("W1");
  const w2 = annotations.encodeDiagramKey("W2");
  const standaloneEdges = vertical
    ? `${edge(`wireform-member-${w1}-1-1`, "M 100 20 C 100 70 100 100 100 145", "#0066ff")}
${edge(`wireform-member-${w1}-1-2`, "M 100 145 C 100 190 100 220 100 270", "#0066ff")}
${edge(`wireform-member-${w2}-1-1`, "M 130 20 C 130 70 130 100 130 145", "#ffffff")}
${edge(`wireform-member-${w2}-1-2`, "M 130 145 C 130 190 130 220 130 270", "#ffffff")}`
    : `${edge(`wireform-member-${w1}-1-1`, "M 20 80 C 90 80 160 80 240 80", "#0066ff")}
${edge(`wireform-member-${w1}-1-2`, "M 240 80 C 320 80 390 80 480 80", "#0066ff")}
${edge(`wireform-member-${w2}-1-1`, "M 20 110 C 90 110 160 110 240 110", "#ffffff")}
${edge(`wireform-member-${w2}-1-2`, "M 240 110 C 320 110 390 110 480 110", "#ffffff")}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="500pt" height="300pt" viewBox="0 0 500 300"><g id="graph0" class="graph">
${vertical ? node("wire-w1", "W1", 90, 35, 40, 100) : node("wire-w1", "W1", 40, 45)}
${vertical ? node("wire-w2", "W2", 280, 35, 40, 100) : node("wire-w2", "W2", 40, 180)}
${node("bundle-b1", "B1", 280, 90, 160, 100)}
${standaloneEdges}
${conductors ? edge(`wireform-member-${b1}-1-1`, "M 180 115 C 215 115 245 115 280 115", "#0066ff") : ""}
${conductors ? edge(`wireform-member-${b1}-2-1`, "M 180 145 C 215 145 245 145 280 145", "#ffffff") : ""}
</g></svg>`;
}

function wire(id, designator, color = "BUWH") {
  const value = model.makeComponent("wire", 1, id);
  value.designator = designator;
  value.colors = [color];
  return value;
}

function standaloneProject() {
  const project = model.createEmptyProject("Annotated harness");
  project.components.push(wire("wire-1", "W1"), wire("wire-2", "W2", "WHBU"));
  project.twistedPairs.push({
    id: "pair-1",
    designator: "TP1",
    members: [
      twistedPair.wireMember("wire-1"),
      twistedPair.wireMember("wire-2"),
    ],
    twistPitchMm: 25,
    twistDirection: "Z",
  });
  return project;
}

function bundleProject(pairCount = 1) {
  const project = model.createEmptyProject("Bundle pairs");
  const conductorCount = Math.max(4, pairCount * 2);
  const bundle = model.makeComponent("bundle", 1, "bundle-1");
  bundle.designator = "B1";
  bundle.wireCount = conductorCount;
  bundle.conductorIds = Array.from({ length: conductorCount }, () =>
    model.createConductorId(),
  );
  bundle.wireLabels = Array.from({ length: conductorCount }, (_, index) =>
    String(index + 1),
  );
  bundle.colors = Array.from({ length: conductorCount }, (_, index) =>
    index % 2 ? "WHBU" : "BUWH",
  );
  project.components.push(bundle);
  for (let index = 0; index < pairCount; index += 1) {
    project.twistedPairs.push({
      id: `bundle-pair-${index + 1}`,
      designator: `TP${index + 1}`,
      members: [
        twistedPair.bundleConductorMember(bundle.id, bundle.conductorIds[index * 2]),
        twistedPair.bundleConductorMember(bundle.id, bundle.conductorIds[index * 2 + 1]),
      ],
      twistDirection: "unspecified",
    });
  }
  return project;
}

function markerCount(svg) {
  return (svg.match(/class="wireform-twisted-pair-marker"/g) ?? []).length;
}

function annotationMarkup(svg) {
  return svg.slice(svg.indexOf('<g id="wireform-twisted-pair-annotations"'));
}

function visit(value, callback) {
  if (value === null || value === undefined || typeof value === "function") return;
  callback(value);
  if (Array.isArray(value)) value.forEach((item) => visit(item, callback));
  else if (typeof value === "object") Object.values(value).forEach((item) => visit(item, callback));
}

test("no twisted pairs leave the SVG byte-for-byte unchanged", () => {
  const project = model.createEmptyProject("No pairs");
  const svg = diagram();
  assert.equal(annotations.addTwistedPairAnnotations(svg, project), svg);
});

test("standalone pairs create two compact deterministic badges without connector lines", () => {
  const project = standaloneProject();
  const svg = diagram();
  const first = annotations.addTwistedPairAnnotations(svg, project);
  const second = annotations.addTwistedPairAnnotations(svg, project);
  assert.equal(first, second);
  assert.equal(markerCount(first), 2);
  assert.match(first, /id="wireform-twisted-pair-annotations"/);
  assert.match(first, /data-pair-id="pair-1"/);
  assert.equal((first.match(/<text[^>]*>TP1<\/text>/g) ?? []).length, 2);
  assert.match(first, /<rect[^>]*fill="#ffffff"/);
  assert.doesNotMatch(annotationMarkup(first), /<(?:path|line|polyline)\b/);
  assert.doesNotMatch(annotationMarkup(first), /stroke-dasharray/);
  assert.match(first, /Members: W1 \+ W2 · Pitch: 25 mm · Direction: Z/);
  assert.ok(first.includes(svg.match(/<polygon[^>]*points="40,45[^"]*"\/>/)[0]));
});

test("multiple pair markers are naturally ordered without free-space spreading", () => {
  const project = standaloneProject();
  project.twistedPairs = [
    { ...structuredClone(project.twistedPairs[0]), id: "pair-10", designator: "TP10" },
    { ...structuredClone(project.twistedPairs[0]), id: "pair-2", designator: "TP2" },
  ];
  const svg = annotations.addTwistedPairAnnotations(diagram(), project);
  assert.equal(markerCount(svg), 4);
  assert.ok(svg.indexOf(">TP2</text>") < svg.indexOf(">TP10</text>"));
  const geometries = project.twistedPairs.map((pair) =>
    annotations.getTwistedPairAnnotationGeometry(pair, diagram(), project),
  );
  assert.deepEqual(
    geometries[0].markers.map((marker) => marker.point),
    geometries[1].markers.map((marker) => marker.point),
    "markers remain on their member paths instead of wandering for collision avoidance",
  );
});

test("each standalone member gets its own marker on its wire near the component entry", () => {
  const project = standaloneProject();
  const pair = project.twistedPairs[0];
  const geometry = annotations.getTwistedPairAnnotationGeometry(pair, diagram(), project);
  assert.equal(geometry.markers.length, 2);
  geometry.markers.forEach((marker, index) => {
    const memberGeometry = annotations.resolveDiagramMemberGeometry(
      pair.members[index],
      diagram(),
      project,
    );
    assert.equal(marker.memberIndex, index);
    assert.deepEqual(marker.member, pair.members[index]);
    assert.deepEqual(marker.point, memberGeometry.entryPoint);
    assert.equal(marker.source, "conductor");
  });
  const expectedPoints = [
    { x: 40, y: 80 },
    { x: 40, y: 110 },
  ];
  geometry.markers.forEach((marker, index) => {
    assert.ok(Math.abs(marker.point.x - expectedPoints[index].x) < 0.001);
    assert.ok(Math.abs(marker.point.y - expectedPoints[index].y) < 0.001);
  });
});

test("bundle conductors use semantic edge geometry when it is available", () => {
  const project = bundleProject();
  const [first, second] = project.twistedPairs[0].members;
  assert.equal(annotations.resolveDiagramMemberGeometry(first, diagram(), project).source, "conductor");
  assert.equal(annotations.resolveDiagramMemberGeometry(second, diagram(), project).source, "conductor");
  const geometry = annotations.getTwistedPairAnnotationGeometry(project.twistedPairs[0], diagram(), project);
  assert.deepEqual(geometry.markers.map((marker) => marker.source), ["conductor", "conductor"]);
  assert.deepEqual(geometry.markers.map((marker) => marker.point.y), [115, 145]);
  assert.ok(geometry.markers.every((marker) => Math.abs(marker.point.x - 260) < 0.01));
  assert.equal(markerCount(annotations.addTwistedPairAnnotations(diagram(), project)), 2);
});

test("curved conductor markers follow the actual path near the bundle entry", () => {
  const project = bundleProject();
  const curved = diagram().replace(
    "M 180 115 C 215 115 245 115 280 115",
    "M 180 115 C 215 55 250 75 280 115",
  );
  const geometry = annotations.getTwistedPairAnnotationGeometry(
    project.twistedPairs[0],
    curved,
    project,
  );
  const marker = geometry.markers[0].point;
  assert.ok(marker.x < 280 && marker.x > 250);
  assert.ok(marker.y < 115, "marker should follow the curve, not use a blind x/y offset");
  assert.ok(Math.abs(Math.hypot(280 - marker.x, 115 - marker.y) - 20) < 2);
});

test("aggregate bundles get deterministic bundle-level badges", () => {
  const project = bundleProject(2);
  const svg = annotations.addTwistedPairAnnotations(diagram({ conductors: false }), project);
  assert.equal(markerCount(svg), 4);
  assert.equal((svg.match(/>TP1<\/text>/g) ?? []).length, 2);
  assert.equal((svg.match(/>TP2<\/text>/g) ?? []).length, 2);
  const positions = [...svg.matchAll(/<rect x="([^"]+)" y="([^"]+)"/g)].map((match) => match.slice(1).join(","));
  assert.equal(new Set(positions).size, 4);
  assert.ok(
    annotations
      .getTwistedPairAnnotationGeometry(project.twistedPairs[0], diagram({ conductors: false }), project)
      .markers.every((marker) => marker.source === "bundle"),
  );
  assert.doesNotMatch(annotationMarkup(svg), /<(?:path|line|polyline)\b/);
});

test("three adjacent bundle pairs produce six labels tied to six member rows", () => {
  const project = bundleProject(3);
  const svg = annotations.addTwistedPairAnnotations(
    diagram({ conductors: false }),
    project,
  );
  assert.equal(markerCount(svg), 6);
  for (const designator of ["TP1", "TP2", "TP3"]) {
    assert.equal((svg.match(new RegExp(`>${designator}<\\/text>`, "g")) ?? []).length, 2);
  }
  const points = project.twistedPairs.flatMap((pair) =>
    annotations
      .getTwistedPairAnnotationGeometry(
        pair,
        diagram({ conductors: false }),
        project,
      )
      .markers.map((marker) => marker.point),
  );
  assert.equal(new Set(points.map((point) => `${point.x},${point.y}`)).size, 6);
  assert.ok(points.every((point) => point.x === 300));
});

test("one unresolved pair is skipped without suppressing resolvable markers", () => {
  const project = standaloneProject();
  project.twistedPairs.unshift({
    id: "missing",
    designator: "TP0",
    members: [twistedPair.wireMember("missing-a"), twistedPair.wireMember("missing-b")],
    twistDirection: "unspecified",
  });
  const svg = annotations.addTwistedPairAnnotations(diagram(), project);
  assert.equal(markerCount(svg), 2);
  assert.doesNotMatch(svg, />TP0<\/text>/);
  assert.match(svg, />TP1<\/text>/);
});

test("DOT post-processing assigns stable conductor IDs without changing edge endpoints", () => {
  const dot = `graph harness {\n  X1:p1r:e -- B1:w1:w\n  B1:w1:e -- X2:p1l:w\n  X1:p2r:e -- "B Ü":w2:w\n}`;
  const result = annotations.addWireFormDiagramIdsToDot(dot);
  assert.match(result, /X1:p1r:e -- B1:w1:w \[id="wireform-member-42_31-1-1"\]/);
  assert.match(result, /B1:w1:e -- X2:p1l:w \[id="wireform-member-42_31-1-2"\]/);
  assert.match(result, /wireform-member-42_20_dc-2-1/);
  assert.equal(result.replace(/ \[id="wireform-member-[^"]+"\]/g, ""), dot);
  assert.equal(annotations.addWireFormDiagramIdsToDot(dot), result);
});

test("shared Graphviz layout triples horizontal rank spacing without changing vertical spacing", () => {
  const dot = `graph harness {
  graph [bgcolor="#ffffff" nodesep=0.33 rankdir=LR ranksep=2]
  A -- B
}`;
  const result = annotations.applyHarnessDiagramLayout(dot);
  assert.equal(annotations.HARNESS_DIAGRAM_HORIZONTAL_RANK_SEPARATION, 6);
  assert.match(result, /ranksep=6/);
  assert.match(result, /nodesep=0\.33/);
  assert.equal(result.replace("ranksep=6", "ranksep=2"), dot);
  assert.equal(annotations.applyHarnessDiagramLayout(result), result);
});

test("shared report preparation gives HTML and PDF the exact same annotated SVG", () => {
  const project = standaloneProject();
  const report = htmlReport.buildHarnessReportModel(project, diagram());
  assert.equal(markerCount(report.diagramSvg), 2);
  assert.match(htmlReport.renderHarnessReportHtml(report), /wireform-twisted-pair-marker/);
  assert.match(htmlReport.renderHarnessReportHtml(report), /id="twisted-pairs"/);

  const definition = pdfReport.buildHarnessPdfDocument(report);
  const svgNodes = [];
  visit(definition.content, (item) => {
    if (item && typeof item === "object" && typeof item.svg === "string") svgNodes.push(item.svg);
  });
  assert.deepEqual(svgNodes, [report.diagramSvg]);
  assert.match(svgNodes[0], /wireform-twisted-pair-marker/);
});

test("pdfmake renders the shared annotated SVG into a valid PDF", async () => {
  const project = standaloneProject();
  const report = htmlReport.buildHarnessReportModel(project, diagram());
  const definition = pdfReport.buildHarnessPdfDocument(report);
  const [pdfModule, vfsModule] = await Promise.all([
    import("pdfmake/build/pdfmake.js"),
    import("pdfmake/build/vfs_fonts.js"),
  ]);
  const pdfMake = pdfModule.default;
  pdfMake.addVirtualFileSystem(vfsModule.default);
  const buffer = await pdfMake.createPdf(definition).getBuffer();
  assert.equal(Buffer.from(buffer).subarray(0, 5).toString("ascii"), "%PDF-");
  assert.match(report.diagramSvg, /wireform-twisted-pair-marker/);
});

test("annotation preserves existing bi-color wire SVG paths", () => {
  const project = standaloneProject();
  const svg = diagram().replace(
    "</g></svg>",
    '<path id="bicolor-base" stroke="#0066ff" d="M40 80 L160 80"/><path id="bicolor-stripe" stroke="#ffffff" d="M40 80 L160 80"/></g></svg>',
  );
  const result = annotations.addTwistedPairAnnotations(svg, project);
  assert.match(result, /id="bicolor-base"[^>]*stroke="#0066ff"/);
  assert.match(result, /id="bicolor-stripe"[^>]*stroke="#ffffff"/);
});

test("worker and live preview are wired to the shared annotation pipeline", async () => {
  const workerSource = await readFile(new URL("../app/preview.worker.ts", import.meta.url), "utf8");
  const studioSource = await readFile(new URL("../app/HarnessStudio.tsx", import.meta.url), "utf8");
  const pdfSource = await readFile(new URL("../app/pdf-report.ts", import.meta.url), "utf8");
  assert.match(workerSource, /prepareHarnessDiagramDot\(dot\)/);
  assert.match(studioSource, /prepareHarnessDiagramSvg\(project, previewSvg\)/);
  assert.doesNotMatch(pdfSource, /addTwistedPairAnnotations|wireform-twisted-pair-marker/);
});
