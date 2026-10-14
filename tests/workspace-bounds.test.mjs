import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  boundsHeight,
  boundsWidth,
  fitBoundsToViewport,
  getAdaptiveGridStep,
  getContentBounds,
  getDragWorldDelta,
  getWorkspaceBounds,
  gridLineOffset,
  screenDeltaToWorld,
  screenToWorld,
  snapToGrid,
  snapWorldPoint,
  unionBounds,
  workspaceToWorld,
  worldToScreen,
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

test("world and screen transforms round-trip exactly across zoom and pan", () => {
  const point = { x: -123.5, y: 987.25 };
  const transform = {
    zoom: 1.25,
    worldOrigin: { x: -700, y: -300 },
    screenOrigin: { x: -215, y: 84 },
  };
  const screen = worldToScreen(point, transform);
  assert.deepEqual(screenToWorld(screen, transform), point);

  const panned = worldToScreen(point, {
    ...transform,
    screenOrigin: { x: transform.screenOrigin.x + 140, y: transform.screenOrigin.y - 75 },
  });
  assert.equal(panned.x - screen.x, 140);
  assert.equal(panned.y - screen.y, -75);
  assert.deepEqual(
    screenToWorld(panned, {
      ...transform,
      screenOrigin: { x: transform.screenOrigin.x + 140, y: transform.screenOrigin.y - 75 },
    }),
    point,
  );

  let cycled = point;
  for (let index = 0; index < 100; index += 1) {
    cycled = screenToWorld(worldToScreen(cycled, transform), transform);
  }
  assert.deepEqual(cycled, point);
});

test("adaptive grid uses a useful 1/2/5 progression at every zoom", () => {
  const zooms = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];
  const steps = zooms.map((zoom) => getAdaptiveGridStep(zoom));
  for (const [index, step] of steps.entries()) {
    const exponent = 10 ** Math.floor(Math.log10(step));
    const normalized = Number((step / exponent).toFixed(10));
    assert.ok([1, 2, 5].includes(normalized));
    const screenSpacing = step * zooms[index];
    assert.ok(screenSpacing >= 20 && screenSpacing <= 40);
  }
  assert.ok(getAdaptiveGridStep(0.25) > getAdaptiveGridStep(1));
  assert.ok(getAdaptiveGridStep(2) < getAdaptiveGridStep(1));
});

test("world grid offsets stay anchored to zero as workspace bounds move", () => {
  assert.equal(gridLineOffset(-305, 20), 5);
  assert.equal(gridLineOffset(115, 20), 5);
  assert.equal(gridLineOffset(-400, 20), 0);
});

test("world-space snapping is deterministic and free of decimal drift", () => {
  assert.equal(snapToGrid(103, 20), 100);
  assert.equal(snapToGrid(111, 20), 120);
  assert.deepEqual(snapWorldPoint({ x: 111, y: -103 }, 20), {
    x: 120,
    y: -100,
  });
  assert.equal(snapToGrid(0.3, 0.1), 0.3);
});

test("drag snapping uses one group delta and Alt-style bypass remains free", () => {
  const anchor = { x: 103, y: 207 };
  const atOneHundredPercent = getDragWorldDelta(
    anchor,
    { x: 8, y: 14 },
    1,
    20,
    true,
  );
  const atTwoHundredPercent = getDragWorldDelta(
    anchor,
    { x: 16, y: 28 },
    2,
    20,
    true,
  );
  assert.deepEqual(atOneHundredPercent, { x: 17, y: 13 });
  assert.deepEqual(atTwoHundredPercent, atOneHundredPercent);

  const second = { x: 153, y: 257 };
  const movedAnchor = {
    x: anchor.x + atOneHundredPercent.x,
    y: anchor.y + atOneHundredPercent.y,
  };
  const movedSecond = {
    x: second.x + atOneHundredPercent.x,
    y: second.y + atOneHundredPercent.y,
  };
  assert.deepEqual(movedAnchor, { x: 120, y: 220 });
  assert.deepEqual(
    { x: movedSecond.x - movedAnchor.x, y: movedSecond.y - movedAnchor.y },
    { x: 50, y: 50 },
  );
  assert.deepEqual(
    getDragWorldDelta(anchor, { x: 16, y: 28 }, 2, 20, false),
    { x: 8, y: 14 },
  );
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
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.doesNotMatch(source, /CANVAS_WIDTH|CANVAS_HEIGHT/);
  assert.match(source, /getWorkspaceBounds/);
  assert.match(source, /setDragWorkspaceBounds/);
  assert.match(source, /worldToWorkspace/);
  assert.match(source, /screenToWorld/);
  assert.match(source, /fitBoundsToViewport/);
  assert.match(source, /Zoom to fit harness/);
  assert.match(source, /component\.x \+ offset/);
  assert.match(source, /Show Grid/);
  assert.match(source, /Snap to Grid/);
  assert.match(source, /snapToGridEnabled && !event\.altKey/);
  assert.match(source, /anchorId: node\.id/);
  assert.match(source, /data-grid-step=\{activeGridStep\}/);
  assert.match(css, /\.canvas\.grid-visible[\s\S]*--grid-minor-size/);
  const scrollRule = css.match(/\.canvas-scroll \{([\s\S]*?)\}/)?.[1] ?? "";
  assert.doesNotMatch(scrollRule, /background-image|background-size/);
  assert.doesNotMatch(source, /Math\.max\(12 - minX|Math\.min\(\s*CANVAS/);
});
