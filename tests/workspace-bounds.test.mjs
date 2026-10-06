import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  boundsHeight,
  boundsWidth,
  fitBoundsToViewport,
  getContentBounds,
  getWorkspaceBounds,
  screenDeltaToWorld,
  unionBounds,
  workspaceToWorld,
  worldToWorkspace,
} from "../app/workspace-bounds.ts";
import {
  createEmptyProject,
  makeComponent,
  parseProjectFile,
  serializeProjectFile,
} from "../app/model.ts";

test("empty layouts retain a comfortable minimum workspace", () => {
  const bounds = getWorkspaceBounds([]);
  assert.deepEqual(bounds, { minX: 0, minY: 0, maxX: 1480, maxY: 820 });
});

test("content bounds union actual component dimensions and add world-space margin", () => {
  const rects = [
    { x: 100, y: 200, width: 224, height: 180 },
    { x: 1700, y: -250, width: 224, height: 300 },
  ];
  assert.deepEqual(getContentBounds(rects), {
    minX: 100,
    minY: -250,
    maxX: 1924,
    maxY: 380,
  });
  const workspace = getWorkspaceBounds(rects);
  assert.equal(workspace.minX, -300);
  assert.equal(workspace.maxX, 2324);
  assert.equal(workspace.minY, -650);
  assert.equal(workspace.maxY, 780);
});

test("workspace expands in every direction and enforces minimum dimensions", () => {
  const single = getWorkspaceBounds([{ x: -500, y: -600, width: 224, height: 120 }]);
  assert.ok(single.minX < -500);
  assert.ok(single.minY < -600);
  assert.ok(boundsWidth(single) >= 1480);
  assert.ok(boundsHeight(single) >= 820);

  const far = getWorkspaceBounds([{ x: 3500, y: 2800, width: 224, height: 120 }]);
  assert.ok(far.maxX >= 4124);
  assert.ok(far.maxY >= 3320);
});

test("drag-time bounds grow monotonically without changing component coordinates", () => {
  const initialRects = [
    { x: 100, y: 100, width: 224, height: 180 },
    { x: 500, y: 100, width: 224, height: 180 },
  ];
  const initialSnapshot = structuredClone(initialRects);
  const initial = getWorkspaceBounds(initialRects);
  const moved = initialRects.map((rect) => ({ ...rect, x: rect.x + 3000, y: rect.y + 1400 }));
  const grown = unionBounds(initial, getWorkspaceBounds(moved));
  assert.ok(grown.maxX > initial.maxX);
  assert.ok(grown.maxY > initial.maxY);
  assert.ok(grown.minX <= initial.minX);
  assert.ok(grown.minY <= initial.minY);
  assert.deepEqual(initialRects, initialSnapshot);
});

test("screen/world conversion keeps drag distance independent from zoom", () => {
  assert.equal(screenDeltaToWorld(100, 1), 100);
  assert.equal(screenDeltaToWorld(100, 0.5), 200);
  assert.equal(screenDeltaToWorld(100, 0.25), 400);

  const workspace = { minX: -700, minY: -300, maxX: 3000, maxY: 1800 };
  const point = { x: -450, y: 1250 };
  assert.deepEqual(workspaceToWorld(worldToWorkspace(point, workspace), workspace), point);
});

test("fit-to-viewport uses content dimensions and natural center", () => {
  const content = { minX: -500, minY: 100, maxX: 3500, maxY: 1100 };
  const fit = fitBoundsToViewport(content, 1200, 700);
  assert.equal(fit.centerX, 1500);
  assert.equal(fit.centerY, 600);
  assert.ok(fit.zoom >= 0.25 && fit.zoom <= 1.25);
  assert.ok(boundsWidth(content) * fit.zoom <= 1200);
});

test("signed spread-out coordinates survive project save/load without workspace fields", () => {
  const project = createEmptyProject("Large layout");
  const left = makeComponent("connector", 1, "left");
  const right = makeComponent("wire", 2, "right");
  left.x = -3200;
  left.y = -900;
  right.x = 27_500;
  right.y = 18_000;
  project.components = [left, right];

  const serialized = serializeProjectFile(project);
  const parsedJson = JSON.parse(serialized);
  assert.equal("workspaceWidth" in parsedJson.project, false);
  assert.equal("workspaceHeight" in parsedJson.project, false);
  const restored = parseProjectFile(serialized).project;
  assert.deepEqual(
    restored.components.map(({ x, y }) => ({ x, y })),
    [
      { x: -3200, y: -900 },
      { x: 27_500, y: 18_000 },
    ],
  );
});

test("editor uses derived bounds for drag, canvas, links, marquee, paste, and fit", async () => {
  const source = await readFile(new URL("../app/HarnessStudio.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /CANVAS_WIDTH|CANVAS_HEIGHT/);
  assert.match(source, /getWorkspaceBounds/);
  assert.match(source, /setDragWorkspaceBounds/);
  assert.match(source, /worldToWorkspace/);
  assert.match(source, /workspaceToWorld/);
  assert.match(source, /fitBoundsToViewport/);
  assert.match(source, /Zoom to fit harness/);
  assert.match(source, /component\.x \+ offset/);
  assert.doesNotMatch(source, /Math\.max\(12 - minX|Math\.min\(\s*CANVAS/);
});
