// Invoked through browser-property-editor-smoke.mjs --topology-zoom.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeComponent, parseProjectFile, serializeProjectFile } from "../app/model.ts";

export async function runTopologyZoomChecks({ command, evaluate, click, load, saved, readProject, flush, output, exceptions }) {
  const fixture = parseProjectFile(await readFile(join(output, "fixture.wireform.json"), "utf8")).project;
  fixture.title = "Topology wheel zoom verification";
  for (let index = 0; index < 80; index++) {
    const node = makeComponent("connector", index + 20, `zoom-${index}`);
    node.x = 1200 + (index % 10) * 600; node.y = Math.floor(index / 10) * 400;
    fixture.components.push(node);
  }
  const path = join(output, "topology-zoom.wireform.json"); await writeFile(path, serializeProjectFile(fixture)); await load(path);
  await saved(); const original = await readProject();
  await evaluate(`window.zoomWrites=0;window.zoomWorkerPosts=0;
    const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(v,k){if(k==='project-autosave')zoomWrites++;return put.apply(this,arguments)};
    const post=Worker.prototype.postMessage;Worker.prototype.postMessage=function(){zoomWorkerPosts++;return post.apply(this,arguments)};`);
  const state = () => evaluate(`(()=>{const v=document.querySelector('.canvas-scroll'),c=document.querySelector('.canvas'),r=v.getBoundingClientRect();return {
    zoom:new DOMMatrix(getComputedStyle(c).transform).a, indicator:document.querySelector('.zoom-value').textContent,
    scroll:{x:v.scrollLeft,y:v.scrollTop},origin:{x:+c.dataset.workspaceMinX,y:+c.dataset.workspaceMinY},
    rect:{x:r.left,y:r.top,width:v.clientWidth,height:v.clientHeight},dpr:devicePixelRatio}})()`);
  const pan = async (x, y) => { await evaluate(`(()=>{const v=document.querySelector('.canvas-scroll');v.scrollLeft=${x};v.scrollTop=${y}})()`); await flush(); };
  const wheel = async (delta, point) => {
    await command("Input.dispatchMouseEvent", { type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY: delta, modifiers: 2 }); await flush();
  };
  const world = (s, point) => ({ x: s.origin.x + (s.scroll.x + point.x - s.rect.x) / s.zoom, y: s.origin.y + (s.scroll.y + point.y - s.rect.y) / s.zoom });
  await pan(1000, 500); let before = await state();
  const point = { x: before.rect.x + before.rect.width * 0.4, y: before.rect.y + before.rect.height * 0.4 };
  const fixed = world(before, point);
  await wheel(-100, point); let after = await state();
  assert.ok(after.zoom > before.zoom); assert.equal(after.dpr, before.dpr, "native Ctrl+wheel does not zoom the browser");
  const closePoint = (actual, expected) => { assert.ok(Math.abs(actual.x - expected.x) < 3); assert.ok(Math.abs(actual.y - expected.y) < 3); };
  closePoint(world(after, point), fixed);
  assert.equal(after.indicator, `${Math.round(after.zoom * 100)}%`);
  await wheel(100, point); after = await state(); assert.ok(after.zoom < before.zoom * 1.01); closePoint(world(after, point), fixed);
  await pan(1400, 650); before = await state(); await wheel(-80, point); after = await state(); closePoint(world(after, point), world(before, point));
  await click('[aria-label="Zoom out"]'); before = await state(); await wheel(-50, point); after = await state(); assert.ok(after.zoom > before.zoom, "toolbar and wheel share state");
  await click('[aria-label="Zoom in"]'); before = await state(); assert.ok(before.zoom > after.zoom);
  const ordinary = await evaluate(`(()=>{const e=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:100});document.querySelector('.canvas-scroll').dispatchEvent(e);return e.defaultPrevented})()`);
  assert.equal(ordinary, false);
  const outside = await evaluate(`(()=>{const e=new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:-100});document.querySelector('.canvas-toolbar').dispatchEvent(e);return e.defaultPrevented})()`);
  assert.equal(outside, false);
  before = await state();
  await command("Input.dispatchMouseEvent", { type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY: 100 });
  await new Promise(resolve => setTimeout(resolve, 200)); after = await state();
  assert.equal(after.zoom, before.zoom); assert.ok(after.scroll.y > before.scroll.y, "ordinary wheel still scrolls");
  for (let i = 0; i < 6; i++) await wheel(-1000, point);
  after = await state(); assert.equal(after.zoom, 1.25); before = after; await wheel(-1000, point); assert.deepEqual(await state(), before, "no movement at max zoom");
  for (let i = 0; i < 8; i++) await wheel(1000, point);
  after = await state(); assert.equal(after.zoom, 0.25); before = after; await wheel(1000, point); assert.deepEqual(await state(), before, "no movement at min zoom");
  await click('[aria-label="Zoom to fit harness"]'); before = await state();
  await wheel(-100, point); after = await state(); assert.ok(after.zoom > before.zoom);
  await click('[aria-label="Zoom to fit harness"]'); after = await state(); assert.equal(after.zoom, before.zoom); assert.deepEqual(after.scroll, before.scroll, "fit framing restored");
  await pan(after.scroll.x + 90, after.scroll.y + 60); after = await state(); assert.ok(after.scroll.x > before.scroll.x, "panning works after wheel and fit");
  await new Promise(resolve => setTimeout(resolve, 900));
  assert.deepEqual(await readProject(), original, "view interactions do not mutate the project");
  assert.equal(await evaluate("zoomWrites"), 0, "no autosave from zoom/pan");
  assert.equal(await evaluate("zoomWorkerPosts"), 0, "no Graphviz/layout work from zoom/pan");
  assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({ result: "passed", components: fixture.components.length, verified: ["trusted Ctrl+wheel", "pointer anchor after pan", "toolbar/indicator/fit", "native scrolling", "outside browser behavior", "limits/no drift", "no mutation/autosave/layout"], output }, null, 2));
}
