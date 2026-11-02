// Run via browser-property-editor-smoke.mjs --insulation against a production build.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createEmptyProject, makeComponent, serializeProjectFile } from "../app/model.ts";
import { buildOnshapeCableWireExport, onshapeCsvFilenameForTitle, onshapeWireId, serializeOnshapeCableWireCsv } from "../app/onshape-export.ts";

export async function runInsulationChecks({ command, evaluate, click, setValue, key, openEditor, waitFor, saved, readProject, load, tab, flush, output, exceptions }) {
  const project = createEmptyProject("Insulation verification");
  const j1 = makeComponent("connector", 1, "j1"), j2 = makeComponent("connector", 2, "j2");
  j1.pinCount = 32; j2.pinCount = 32; j1.mpn = "09 32 040 3001"; j2.mpn = "10142708-040021LF";
  j1.shieldTerminations = [{ id: "shell", label: "Chassis" }]; project.components = [j1, j2];
  let pin = 1;
  for (const [kind, id, count, insulation] of [["wire", "W1", 1], ["wire", "W2", 1], ["bundle", "B1", 4], ["bundle", "B2", 4, 0.6], ["cable", "C1", 8], ["cable", "C2", 8, 0.25]]) {
    const node = makeComponent(kind, 1, id); node.designator = id; node.wireCount = count;
    node.conductorIds = Array.from({ length: count }, (_, n) => `${id}-c${n + 1}`); node.colors = Array.from({ length: count }, (_, n) => ["RD", "BK", "BUWH", "WHBU"][n % 4]);
    node.wireLabels = Array.from({ length: count }, (_, n) => `Signal ${n + 1}`); if (insulation !== undefined) node.insulationThicknessMm = insulation;
    if (kind === "bundle") node.conductorLengthOverrides = { [node.conductorIds[0]]: "750 mm" };
    project.components.push(node);
    for (let n = 1; n <= count; n++, pin++) project.links.push(
      { id: `${id}-${n}-left`, from: { nodeId: "j1", portId: `pin:${pin}`, side: "right" }, to: { nodeId: id, portId: `wire:${n}`, side: "left" }, termination: { contact: { mpn: "09 33 000 6102" }, stripLength: "7.5 mm" } },
      { id: `${id}-${n}-right`, from: { nodeId: id, portId: `wire:${n}`, side: "right" }, to: { nodeId: "j2", portId: `pin:${pin}`, side: "left" }, termination: { contact: { mpn: "10158070-121LF" }, stripLength: "5.7 mm" } });
  }
  project.components.find((node) => node.id === "C1").shield = true;
  project.links.push({ id: "shield", from: { nodeId: "j1", portId: "connector-shield:shell", side: "right" }, to: { nodeId: "C1", portId: "shield", side: "left" } });
  project.twistedPairs = [{ id: "tp", designator: "TP1", members: [{ kind: "bundle-conductor", bundleId: "B1", conductorId: "B1-c1" }, { kind: "bundle-conductor", bundleId: "B1", conductorId: "B1-c2" }], twistDirection: "S" }];
  const originalRows = buildOnshapeCableWireExport(project).rows.map(({ insulation, ...row }) => { void insulation; return row; });
  const path = join(output, "insulation.wireform.json"); await writeFile(path, serializeProjectFile(project)); await load(path);
  const node = (project, id) => project.components.find((node) => node.id === id);
  const thickness = async (id) => node(await readProject(), id).insulationThicknessMm;
  const inspector = '.inspector-panel [aria-label="Insulation Thickness"]';
  for (const [id, value] of [["W1", "0.5"], ["B1", "0.4"], ["C1", "0.2"]]) {
    await click(`[data-testid="node-${id}"]`); await waitFor(`document.querySelector(${JSON.stringify(inspector)})`, `${id} inspector field`);
    await setValue(inspector, value); await saved(); assert.equal(await thickness(id), Number(value));
  }
  await click('[data-testid="node-W2"]'); assert.equal(await evaluate(`document.querySelector(${JSON.stringify(inspector)}).value`), "");
  await setValue(inspector, "0"); await saved(); assert.equal(await thickness("W2"), 0);
  await setValue(inspector, ""); await saved(); assert.equal(await thickness("W2"), undefined);
  await click('[data-testid="node-W1"]');
  await evaluate(`window.insulationWrites=0;const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(v,k){if(k==='project-autosave')insulationWrites++;return put.apply(this,arguments)}`);
  await setValue(inspector, "-0.5"); await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal(await thickness("W1"), 0.5); assert.equal(await evaluate("insulationWrites"), 0);
  assert.ok(await evaluate(`!!document.querySelector('.optional-number-property [role="alert"]')`));
  await setValue(inspector, "0.5");
  await evaluate(`document.querySelector(${JSON.stringify(inspector)}).focus()`); await key("a", "KeyA", 2);
  await command("Input.insertText", { text: "e" }); await flush();
  assert.equal(await thickness("W1"), 0.5, "unfinished exponent input does not clear the model");
  await openEditor(); await tab("Conductors"); await setValue('[aria-label="Filter column"]', "parent"); await setValue('[aria-label="Filter value"]', "value:W1");
  await evaluate(`(()=>{const c=document.querySelector('td[data-component-id="W1"][data-property="insulationThicknessMm"]');c.focus();c.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))})()`); await flush();
  await setValue('.property-cell-editor [aria-label="Numeric value"]', "0.127"); await click('.property-cell-editor button[type="submit"]'); await saved();
  await click('[aria-label="Close Property Editor"]');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(inspector)}).value`), "0.127", "inspector resynchronizes even after invalid local typing");
  await setValue(inspector, "0.5"); await saved();
  await click('[aria-label="Copy selected components"]'); await click('[aria-label="Paste copied components"]'); await saved();
  let current = await readProject(); const duplicate = current.components.find((component) => !project.components.some((original) => original.id === component.id));
  assert.equal(duplicate.insulationThicknessMm, 0.5); await click('[aria-label="Undo"]'); await saved();
  await openEditor(); await tab("Bundles");
  const cell = (id, conductor) => `.property-editor-table td[data-property="insulationThicknessMm"][data-component-id="${id}"]${conductor ? `[data-conductor-id="${conductor}"]` : ""}`;
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(cell("B1"))}).textContent`), "0.4 mm");
  await evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(cell("B1"))});c.focus();c.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))})()`); await flush();
  await setValue('.property-cell-editor [aria-label="Numeric value"]', "0.127"); await click('.property-cell-editor button[type="submit"]'); await saved(); assert.equal(await thickness("B1"), 0.127);
  const undo = async () => { await click('[aria-label="Undo property change"]'); await saved(); };
  const redo = async () => { await click('[aria-label="Redo property change"]'); await saved(); };
  await undo(); assert.equal(await thickness("B1"), 0.4);
  const toolbar = async () => { await evaluate(`[...document.querySelectorAll('.property-selection-toolbar button')].find(e=>e.textContent==='Edit Selected').click()`); await flush(); };
  const modalButton = async (text) => { await evaluate(`[...document.querySelectorAll('.property-bulk-modal button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}).click()`); await flush(); };
  const action = (value) => setValue('[aria-label="Action for Insulation Thickness (mm)"]', value);
  const apply = async () => { await modalButton("Preview Changes"); await modalButton("Apply 2 Changes"); await saved(); };
  await click('.property-editor-table thead input'); await toolbar(); await action("set"); await setValue('.property-bulk-value [aria-label="Numeric value"]', "0.5"); await apply();
  assert.equal(await thickness("B1"), 0.5); assert.equal(await thickness("B2"), 0.5);
  await undo(); assert.equal(await thickness("B1"), 0.4); assert.equal(await thickness("B2"), 0.6);
  await redo(); await toolbar(); await action("set"); await setValue('.property-bulk-value [aria-label="Numeric value"]', "-0.1"); await modalButton("Preview Changes");
  assert.equal(await evaluate(`document.querySelector('.property-bulk-modal .primary-button').disabled`), true); await modalButton("Cancel");
  assert.equal(await thickness("B1"), 0.5); await toolbar(); await action("clear"); await apply(); assert.equal(await thickness("B1"), undefined); assert.equal(await thickness("B2"), undefined);
  await undo(); await toolbar(); await action("set"); await setValue('.property-bulk-value [aria-label="Numeric value"]', "0.50"); await modalButton("Preview Changes");
  assert.equal(await evaluate(`document.querySelector('.property-bulk-modal .primary-button').disabled`), true); await modalButton("Cancel");
  await undo(); assert.equal(await thickness("B1"), 0.4, "no-op makes no history entry");
  await tab("Cables"); await click('.property-editor-table thead input'); await toolbar(); await action("set"); await setValue('.property-bulk-value [aria-label="Numeric value"]', "0"); await apply();
  assert.equal(await thickness("C1"), 0); assert.equal(await thickness("C2"), 0); await undo();
  await tab("Conductors"); await setValue('[aria-label="Filter column"]', "parent"); await setValue('[aria-label="Filter value"]', "value:B1");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(cell("B1", "B1-c1"))}).getAttribute('aria-readonly')`), "true");
  assert.ok(await evaluate(`[...document.querySelectorAll('td[data-property="insulationThicknessMm"]')].every(e=>e.textContent==='0.4 mm')`));
  await setValue('[aria-label="Filter value"]', "value:C1"); assert.ok(await evaluate(`[...document.querySelectorAll('td[data-property="insulationThicknessMm"]')].every(e=>e.textContent==='0.2 mm')`));
  await setValue('[aria-label="Filter value"]', "value:W1"); await click('.property-editor-table thead input');
  await setValue('[aria-label="Filter value"]', "value:W2"); await click('.property-editor-table thead input');
  await toolbar(); await action("set"); await setValue('.property-bulk-value [aria-label="Numeric value"]', "0.127"); await apply();
  assert.equal(await thickness("W1"), 0.127); assert.equal(await thickness("W2"), 0.127); await undo();
  await click('[aria-label="Close Property Editor"]'); await click('[data-testid="node-B1"]'); assert.equal(await evaluate(`document.querySelector(${JSON.stringify(inspector)}).value`), "0.4");
  await click('[aria-label="Save WireForm project"]');
  const savedPath = join(output, "insulation-verification.wireform.json");
  for (let attempt = 0; attempt < 100; attempt++) { try { await readFile(savedPath); break; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); } }
  await load(savedPath); current = await readProject();
  assert.equal(node(current, "W1").insulationThicknessMm, 0.5); assert.equal(node(current, "W2").insulationThicknessMm, undefined); assert.equal(node(current, "C1").insulationThicknessMm, 0.2);
  assert.deepEqual(current.links, project.links); assert.deepEqual(current.twistedPairs, project.twistedPairs); assert.deepEqual(node(current, "B1").conductorLengthOverrides, node(project, "B1").conductorLengthOverrides);
  await click('[aria-label="Export Onshape CSV"]');
  assert.equal(await evaluate(`[...document.querySelectorAll('.onshape-preview-section th')].at(-1).textContent`), "Insulation");
  const expectedRows = buildOnshapeCableWireExport(current).rows;
  assert.deepEqual(expectedRows.map(({ insulation, ...row }) => { void insulation; return row; }), originalRows);
  const firstPreview = await evaluate(`[...document.querySelector('.onshape-preview-section tbody tr').querySelectorAll('td')].at(-1).textContent`);
  assert.equal(firstPreview, expectedRows[0].insulation);
  if (await evaluate(`!!document.querySelector('.onshape-warning-acknowledgement input')`)) await click('.onshape-warning-acknowledgement input');
  const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(output, "insulation-csv-preview.png"), Buffer.from(screenshot.data, "base64"));
  await click('.onshape-export-modal .modal-footer .primary-button').catch(async () => {
    await evaluate(`[...document.querySelectorAll('[aria-labelledby="onshape-export-title"] button')].find(e=>e.textContent.includes('Export CSV')).click()`);
  });
  let csv;
  for (let attempt = 0; attempt < 100; attempt++) { try { csv = await readFile(join(output, onshapeCsvFilenameForTitle(current.title)), "utf8"); break; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); } }
  assert.equal(csv, serializeOnshapeCableWireCsv(expectedRows));
  assert.equal(csv.split("\r\n")[0].split(",").length, 14);
  assert.equal(expectedRows.find((row) => row.wireId === onshapeWireId("W2", "W2-c1")).insulation, "");
  assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({ result: "passed", conductorRows: expectedRows.length, csvColumns: 14, verified: ["wire/bundle/cable inspectors", "zero and unspecified", "invalid/partial-input rejection", "duplication", "direct property cells", "bulk set/clear/no-op", "single undo/redo", "inherited read-only cells", "save/reopen", "CSV preview/download", "unchanged first thirteen fields"], output }, null, 2));
}
