import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createEmptyProject, makeComponent, serializeProjectFile } from "../app/model.ts";

const endpoint = process.argv.slice(2).find((argument) => !argument.startsWith("--")) ?? "http://127.0.0.1:9246";
const output = resolve(`work/property-editor-smoke/run-${Date.now()}`);
await mkdir(output, { recursive: true });
const project = createEmptyProject("Property Editor verification");
const j1 = makeComponent("connector", 1, "j1"), j2 = makeComponent("connector", 2, "j2"), j10 = makeComponent("connector", 10, "j10");
for (const node of [j1, j2, j10]) { node.manufacturer = "Amphenol"; node.mpn = `ORIGINAL-${node.id}`; }
j2.manufacturer = "Harting"; j1.approvedAlternatives = [{ id: "alternative", mpn: "ALT-PN" }];
j1.shieldTerminations = [{ id: "chassis", label: "Chassis", mpn: "SHIELD-PN" }];
const cable = makeComponent("cable", 1, "w1"), bundle = makeComponent("bundle", 2, "b1");
bundle.designator = "B1";
for (const node of [cable, bundle]) {
  node.wireCount = 2; node.conductorIds = [`${node.id}-a`, `${node.id}-b`]; node.colors = ["BUWH", "RD"];
  node.wireLabels = ["CAN_H", "CAN_L"]; node.length = "600 mm";
}
bundle.conductorLengthOverrides = { "b1-a": "750 mm" };
cable.shield = true;
project.components = [j10, bundle, j2, cable, j1];
project.twistedPairs = [{ id: "tp", designator: "TP4", members: [{ kind: "bundle-conductor", bundleId: "b1", conductorId: "b1-a" }, { kind: "bundle-conductor", bundleId: "b1", conductorId: "b1-b" }], twistDirection: "S", twistPitchMm: 60 }];
project.links = [{ id: "contact", from: { nodeId: "j1", portId: "pin:1", side: "right" }, to: { nodeId: "b1", portId: "wire:1", side: "left" }, termination: { contact: { mpn: "CONTACT-PN" }, stripLength: "7.5 mm" } },
  { id: "shield", from: { nodeId: "j1", portId: "connector-shield:chassis", side: "right" }, to: { nodeId: "w1", portId: "shield", side: "left" } }];
project.attachments = [{ id: "reference", filename: "Internal.txt", mimeType: "text/plain", sizeBytes: 3, data: "YWJj" }];
await writeFile(join(output, "fixture.wireform.json"), serializeProjectFile(project));
const target = await fetch(`${endpoint}/json/new?http://127.0.0.1:5181`, { method: "PUT" }).then((response) => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve); socket.addEventListener("error", reject); });
const pending = new Map(), exceptions = [];
let sequence = 0;
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const request = pending.get(message.id); if (!request) return; pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  } else if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  else if (message.method === "Page.javascriptDialogOpening") void command("Page.handleJavaScriptDialog", { accept: true });
});
function command(method, params = {}) {
  const id = ++sequence; socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000); pending.set(id, { resolve, reject, timer }); });
}
async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function flush() { await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))"); }
async function waitFor(expression, label) {
  const start = Date.now();
  while (Date.now() - start < 20000) { if (await evaluate(`Boolean(${expression})`)) return; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}`);
}
async function click(selector) { assert.ok(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e?.click();return !!e})()`), selector); await flush(); }
async function setValue(selector, value) {
  await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing input');Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`); await flush();
}
async function key(key, code = key, modifiers = 0) { await command("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers }); await command("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers }); await flush(); }
async function openEditor() {
  const colors = await evaluate(`(()=>{const tools=getComputedStyle(document.querySelector('.tools-menu summary')),button=getComputedStyle(document.querySelector('[aria-label="New empty project"]'));return {tools:[tools.color,tools.backgroundColor],button:[button.color,button.backgroundColor]}})()`);
  assert.deepEqual(colors.tools, colors.button, "Tools uses the visible toolbar button colors");
  await click('.tools-menu summary'); await click('.tools-menu [role="menuitem"]'); await waitFor(`document.querySelector('[data-testid="property-editor"]')`, "Property Editor opens");
}
async function tab(name) { await evaluate(`[...document.querySelectorAll('.property-editor-tabs button')].find(e=>e.textContent===${JSON.stringify(name)}).click()`); await flush(); }
const cell = (id, property, conductor) => `.property-editor-table td[data-component-id="${id}"][data-property="${property}"]${conductor ? `[data-conductor-id="${conductor}"]` : ""}`;
async function begin(id, property, conductor) {
  const selector = cell(id, property, conductor);
  await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))})()`);
  await waitFor(`document.querySelector('.property-cell-editor')`, `${id}/${property} editor`);
}
async function save() { await click('.property-cell-editor button[type="submit"]'); await waitFor(`!document.querySelector('.property-cell-editor')`, "cell committed"); }
async function saved() { await waitFor(`document.querySelector('.autosave-chip')?.textContent.includes('Saved locally')`, "autosave"); }
async function readProject() { return evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('wireform-local-data');r.onsuccess=()=>{const db=r.result,q=db.transaction('documents').objectStore('documents').get('project-autosave');q.onsuccess=()=>{resolve(typeof q.result==='string'?JSON.parse(q.result).project:q.result);db.close()};q.onerror=()=>reject(q.error)}})`); }
async function load(path) {
  const document = await command("DOM.getDocument"), input = await command("DOM.querySelector", { nodeId: document.root.nodeId, selector: '[data-testid="native-project-input"]' });
  await command("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [path] });
  const expectedTitle = JSON.parse(await readFile(path, "utf8")).project.title;
  await waitFor(`document.querySelector('.title-input')?.value===${JSON.stringify(expectedTitle)}`, "native project load");
  await flush(); await saved();
}
try {
  await command("Runtime.enable"); await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 1700, height: 1050, deviceScaleFactor: 1, mobile: false });
  await command("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: output });
  await saved(); await evaluate("window.confirm=()=>true");
  if (process.argv.includes("--topology-zoom")) {
    const { runTopologyZoomChecks } = await import("./browser-topology-zoom-smoke.mjs");
    await runTopologyZoomChecks({ command, evaluate, click, load, saved, readProject, flush, output, exceptions });
  } else if (process.argv.includes("--insulation")) {
    const { runInsulationChecks } = await import("./browser-insulation-smoke.mjs");
    await runInsulationChecks({ command, evaluate, click, setValue, key, openEditor, waitFor, saved, readProject, load, tab, flush, output, exceptions });
  } else if (process.argv.includes("--bulk")) {
    const { runBulkPropertyChecks } = await import("./browser-property-bulk-smoke.mjs");
    await runBulkPropertyChecks({ command, evaluate, click, setValue, key, openEditor, waitFor, saved, readProject, load, tab, flush, output, exceptions });
  } else {
  await load(join(output, "fixture.wireform.json"));
  await waitFor(`document.querySelector('.title-input').value==='Property Editor verification'`, "fixture loaded");
  await evaluate(`window.propertyWrites=0;const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(v,k){if(k==='project-autosave')propertyWrites++;return put.apply(this,arguments)}`);
  await openEditor();
  assert.ok(await evaluate(`(()=>{const r=document.querySelector('.property-editor-modal').getBoundingClientRect();return r.width/innerWidth>.95 && r.height/innerHeight>.95})()`));
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('td[data-property="designator"]')].map(e=>e.textContent)`), ["J1", "J2", "J10"]);
  await setValue('[aria-label="Search properties"]', "aMpHeNoL");
  assert.equal(await evaluate(`document.querySelectorAll('td[data-property="designator"]').length`), 2);
  await click('.property-editor-table th[data-property="mpn"] button');
  await setValue('[aria-label="Filter column"]', "manufacturer"); await setValue('[aria-label="Filter value"]', "value:Amphenol");
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal(await evaluate("propertyWrites"), 0, "opening/search/filter/sort are transient");
  await begin("j10", "mpn"); await setValue('.property-cell-editor [aria-label="Cell value"]', 'NEW, "J10"'); await save();
  assert.match(await evaluate(`document.querySelector(${JSON.stringify(cell("j10", "mpn"))}).textContent`), /NEW/);
  await click('[aria-label="Undo property change"]'); assert.equal(await evaluate(`document.querySelector(${JSON.stringify(cell("j10", "mpn"))}).textContent`), "ORIGINAL-j10");
  await click('[aria-label="Redo property change"]');
  await setValue('[aria-label="Search properties"]', ""); await setValue('[aria-label="Filter column"]', "");
  await begin("j1", "notes"); await setValue('.property-cell-editor textarea', "First line\nSecond line"); await key("Enter");
  assert.ok(await evaluate(`!!document.querySelector('.property-cell-editor')`), "Notes Enter does not commit"); await save();
  await evaluate(`document.querySelector(${JSON.stringify(cell("j1", "manufacturer"))}).focus()`); await key("Enter");
  await setValue('.property-cell-editor [aria-label="Cell value"]', "Changed Manufacturer"); await key("Tab");
  assert.equal(await evaluate(`document.activeElement.dataset.property`), "mpn", "Tab commits and skips correctly");
  await begin("j1", "mpn"); await setValue('.property-cell-editor [aria-label="Cell value"]', "CANCELLED"); await key("Escape");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(cell("j1", "mpn"))}).textContent`), "ORIGINAL-j1");
  await tab("Bundles"); await begin("b1", "length"); await setValue('.property-cell-editor [aria-label="Length value"]', "900"); await save();
  await tab("Conductors");
  await setValue('[aria-label="Filter column"]', "parent"); await setValue('[aria-label="Filter value"]', "value:B1");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(cell("b1", "length", "b1-a"))}).textContent`), "750 mm");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(cell("b1", "length", "b1-b"))}).textContent`), "900 mm");
  await begin("b1", "length", "b1-b"); await setValue('.property-cell-editor [aria-label="Length value"]', "-25"); await click('.property-cell-editor button[type="submit"]');
  await waitFor(`document.querySelector('.property-edit-error')`, "negative length rejected");
  await key("Escape");
  await begin("b1", "color", "b1-b"); await setValue('.property-cell-editor [aria-label="Primary wire color"]', "WH"); await setValue('.property-cell-editor [aria-label="Secondary wire color"]', "BU"); await save();
  assert.match(await evaluate(`document.querySelector(${JSON.stringify(cell("b1", "color", "b1-b"))}).textContent`), /White \/ Blue \(WHBU\)/);
  await begin("b1", "length", "b1-b"); await setValue('.property-cell-editor [aria-label="Length value"]', "1200"); await save();
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(cell("b1", "lengthSource", "b1-b"))}).textContent`), "Override");
  await begin("b1", "length", "b1-b"); await evaluate(`[...document.querySelectorAll('.property-cell-editor button')].find(e=>e.textContent==='Use bundle default').click()`); await flush();
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(cell("b1", "lengthSource", "b1-b"))}).textContent`), "Default");
  await setValue('[aria-label="Filter value"]', "value:W1");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(cell("w1", "length", "w1-a"))}).getAttribute('aria-readonly')`), "true");
  await click('[aria-label="Close Property Editor"]'); await click('[data-testid="node-J10"]');
  assert.equal(await evaluate(`(()=>{const label=[...document.querySelectorAll('.inspector-panel label')].find(e=>e.querySelector('span')?.textContent==='Manufacturer part number');return label?.querySelector('input').value})()`), 'NEW, "J10"');
  await click('[data-testid="node-B1"]');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Conductor 2 color"]').value`), "WHBU");
  await saved();
  const result = await readProject();
  assert.equal(result.components.find((node) => node.id === "b1").length, "900 mm");
  assert.deepEqual(result.twistedPairs, project.twistedPairs); assert.deepEqual(result.links, project.links); assert.deepEqual(result.attachments, project.attachments);
  await click('[aria-label="Save WireForm project"]');
  let native;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { native = JSON.parse(await readFile(join(output, "property-editor-verification.wireform.json"), "utf8")); break; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  assert.equal(native.project.components.find((node) => node.id === "j10").mpn, 'NEW, "J10"');
  await load(join(output, "property-editor-verification.wireform.json"));
  await openEditor();
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(cell("j10", "mpn"))}).textContent`), 'NEW, "J10"');
  await click('[aria-label="Close Property Editor"]');
  const large = createEmptyProject("Large Property Editor");
  for (let index = 0; index < 100; index++) {
    const node = makeComponent(index % 2 ? "bundle" : "cable", index + 1, `large-${index}`);
    node.wireCount = 12; node.conductorIds = Array.from({ length: 12 }, (_, n) => `large-${index}-c-${n}`);
    node.colors = Array.from({ length: 12 }, (_, n) => ["RD", "BK", "BUWH", "GNYE"][n % 4]);
    node.wireLabels = Array.from({ length: 12 }, () => ""); large.components.push(node);
    large.components.push(makeComponent("connector", index + 1, `j-${index}`));
  }
  await writeFile(join(output, "large.wireform.json"), serializeProjectFile(large)); await load(join(output, "large.wireform.json"));
  await openEditor(); await tab("Conductors");
  assert.equal(await evaluate(`document.querySelector('.property-editor-table').getAttribute('aria-rowcount')`), "1201");
  assert.ok(await evaluate(`document.querySelectorAll('tr[data-property-row]').length`) < 50, "only visible rows mounted");
  await evaluate(`document.querySelector('.property-editor-table td[data-property]').focus()`); await key("End", "End", 2);
  assert.equal(await evaluate(`document.activeElement.dataset.componentId`), "large-99");
  assert.equal(await evaluate(`document.activeElement.dataset.property`), "twistedPair");
  await setValue('[aria-label="Filter column"]', "parent"); await setValue('[aria-label="Filter value"]', "value:W100");
  await begin("large-99", "label", "large-99-c-11"); await setValue('.property-cell-editor [aria-label="Cell value"]', "LAST-CONDUCTOR"); await save();
  const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(output, "property-editor.png"), Buffer.from(screenshot.data, "base64"));
  assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({ result: "passed", largeConductors: 1200, verified: ["stable sorted/filtered edits", "typed editors", "multiline Notes", "negative length rejection", "bundle override reset", "cable length protection", "shared color picker", "keyboard navigation", "one-cell undo/redo", "autosave isolation", "inspector sync", "native save/reopen", "virtualized large table"], output }, null, 2));
  }
} finally { for (const operation of pending.values()) clearTimeout(operation.timer); socket.close(); await fetch(`${endpoint}/json/close/${target.id}`).catch(() => undefined); }
