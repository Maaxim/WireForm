// Invoked with: node --experimental-strip-types scripts/browser-property-editor-smoke.mjs --bulk
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createEmptyProject, makeComponent, serializeProjectFile } from "../app/model.ts";

export async function runBulkPropertyChecks({ command, evaluate, click, setValue, key, openEditor, waitFor, saved, readProject, load, tab, flush, output, exceptions }) {
  const project = createEmptyProject("Bulk Property Editor verification");
  for (let index = 1; index <= 5; index++) {
    const node = makeComponent("connector", index, `j${index}`);
    node.manufacturer = index === 1 ? "Harting" : "Amphenol"; node.mpn = "PN-OLD";
    node.approvedAlternatives = [{ id: `alt-${index}`, mpn: "ALT" }]; project.components.push(node);
  }
  for (const kind of ["cable", "bundle"]) for (let index = 1; index <= 2; index++) {
    const node = makeComponent(kind, index, `${kind}-${index}`); node.designator = `${kind === "bundle" ? "B" : "W"}${index}`;
    node.length = "600 mm"; node.conductorIds = Array.from({ length: 4 }, (_, n) => `${node.id}-c${n + 1}`);
    if (kind === "bundle") node.conductorLengthOverrides = { [node.conductorIds[0]]: "750 mm" };
    project.components.push(node);
  }
  project.components[0].shieldTerminations = [{ id: "shell", label: "Shell", mpn: "SHIELD-PN" }];
  project.links = [{ id: "left", from: { nodeId: "j1", portId: "pin:1", side: "right" }, to: { nodeId: "bundle-1", portId: "wire:1", side: "left" }, termination: { contact: { mpn: "CONTACT-PN" }, stripLength: "7.5 mm" } }];
  project.twistedPairs = [{ id: "tp", designator: "TP1", members: [{ kind: "bundle-conductor", bundleId: "bundle-1", conductorId: "bundle-1-c1" }, { kind: "bundle-conductor", bundleId: "bundle-1", conductorId: "bundle-1-c2" }], twistDirection: "S" }];
  project.attachments = [{ id: "file", filename: "PN-OLD.txt", mimeType: "text/plain", sizeBytes: 6, data: "UE4tT0xE" }];
  const fixturePath = join(output, "bulk.wireform.json"); await writeFile(fixturePath, serializeProjectFile(project));
  await load(fixturePath);
  const node = (project, id) => project.components.find((node) => node.id === id);
  const toolbar = async (label) => { await evaluate(`[...document.querySelectorAll('.property-selection-toolbar button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}).click()`); await flush(); };
  const modalButton = async (label) => { await evaluate(`[...document.querySelectorAll('.property-bulk-modal button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}).click()`); await flush(); };
  const action = (property, value) => setValue(`[aria-label="Action for ${property}"]`, value);
  const newText = (property, value) => setValue(`[aria-label="New ${property}"]`, value);
  const selectAll = () => click('.property-editor-table thead input[type="checkbox"]');
  const preview = async () => { await modalButton("Preview Changes"); await waitFor(`document.querySelector('.property-preview-counts')`, "preview"); };
  const apply = async (count) => { await modalButton(`Apply ${count} Changes`); await waitFor(`!document.querySelector('.property-bulk-modal')`, "bulk apply"); await saved(); };
  const undo = async () => { await click('[aria-label="Undo property change"]'); await saved(); };
  const redo = async () => { await click('[aria-label="Redo property change"]'); await saved(); };
  const summary = () => evaluate(`document.querySelector('[data-testid="property-selection-summary"]').textContent`);
  const expectMpn = async (values) => { const current = await readProject(); for (const [id, value] of Object.entries(values)) assert.equal(node(current, id).mpn, value, id); };
  await openEditor();
  await evaluate(`window.bulkWrites=0;const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(v,k){if(k==='project-autosave')bulkWrites++;return put.apply(this,arguments)}`);
  await setValue('[aria-label="Filter column"]', "manufacturer"); await setValue('[aria-label="Filter value"]', "value:Amphenol");
  await click('[data-select-component="j2"]');
  await evaluate(`document.querySelector('[data-select-component="j5"]').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))`); await flush();
  assert.match(await summary(), /4 selected/);
  await setValue('[aria-label="Filter value"]', "value:Harting"); assert.match(await summary(), /4 selected · 0 visible · 4 hidden/);
  await click('.property-editor-table th[data-property="mpn"] button');
  await toolbar("Edit Selected");
  await action("MPN", "set"); await newText("MPN", "NEW-PN");
  await action("Notes", "set"); await newText("Notes", "Assembly drawing\nSecond line");
  await action("Manufacturer", "set"); // Already equal; excluded from the eight actual changes.
  await preview();
  assert.equal(await evaluate(`document.querySelectorAll('.property-preview-table tbody tr').length`), 8);
  await new Promise((resolve) => setTimeout(resolve, 900)); assert.equal(await evaluate("bulkWrites"), 0, "selection, hidden filters, drafts and preview do not autosave");
  await apply(8); assert.equal(await evaluate("bulkWrites"), 1, "one logical mutation autosaves once");
  await expectMpn({ j1: "PN-OLD", j2: "NEW-PN", j3: "NEW-PN", j4: "NEW-PN", j5: "NEW-PN" });
  await undo(); await expectMpn({ j2: "PN-OLD", j3: "PN-OLD", j4: "PN-OLD", j5: "PN-OLD" });
  assert.equal(node(await readProject(), "j2").notes, "");
  await redo(); await expectMpn({ j2: "NEW-PN", j3: "NEW-PN", j4: "NEW-PN", j5: "NEW-PN" });
  assert.equal(node(await readProject(), "j2").notes, "Assembly drawing\nSecond line");
  const writesAfterApply = await evaluate("bulkWrites");
  await toolbar("Edit Selected"); await preview();
  assert.equal(await evaluate(`document.querySelector('.property-bulk-modal .primary-button').disabled`), true);
  await modalButton("Cancel");
  await toolbar("Edit Selected"); await action("MPN", "set"); await newText("MPN", "NEW-PN"); await preview();
  assert.match(await evaluate(`document.querySelector('.property-preview-counts').textContent`), /Actual changes: 0/);
  await modalButton("Cancel");
  await toolbar("Edit Selected"); await action("MPN", "set"); await newText("MPN", "CANCELLED"); await modalButton("Cancel");
  await new Promise((resolve) => setTimeout(resolve, 900)); assert.equal(await evaluate("bulkWrites"), writesAfterApply, "no-op and cancelled operations do not autosave");
  await toolbar("Edit Selected"); await action("MPN", "clear"); await preview(); await apply(4);
  await expectMpn({ j2: "", j3: "", j4: "", j5: "" });
  await undo(); await expectMpn({ j2: "NEW-PN", j3: "NEW-PN", j4: "NEW-PN", j5: "NEW-PN" });

  await toolbar("Clear Selection"); await setValue('[aria-label="Filter value"]', "value:Amphenol");
  await toolbar("Find & Replace");
  assert.equal(await evaluate(`document.querySelector('input[name="replace-scope"]:checked').value`), "filtered");
  await setValue('[aria-label="Replacement property"]', "mpn"); await setValue('[aria-label="Find text"]', "NEW"); await setValue('[aria-label="Replace with"]', "UPDATED");
  await evaluate(`[...document.querySelectorAll('.property-replace-form label')].find(e=>e.textContent.includes('Match entire cell')).querySelector('input').click()`); await flush();
  await modalButton("Preview Matches");
  assert.equal(await evaluate(`document.querySelectorAll('.property-preview-table tbody tr').length`), 4);
  assert.match(await evaluate(`document.querySelector('.property-preview-table').textContent`), /UPDATED-PN/);
  await modalButton("Back to Edit"); await setValue('[aria-label="Replace with"]', "x".repeat(4001)); await modalButton("Preview Matches");
  assert.equal(await evaluate(`document.querySelector('.property-bulk-modal .primary-button').disabled`), true);
  assert.ok(await evaluate(`document.querySelector('.property-bulk-modal [role="alert"]').textContent.includes('No changes were made')`));
  await modalButton("Back to Edit"); await setValue('[aria-label="Replace with"]', "UPDATED"); await modalButton("Preview Matches");
  await modalButton("Replace 4 Values"); await saved();
  await expectMpn({ j1: "PN-OLD", j2: "UPDATED-PN", j3: "UPDATED-PN", j4: "UPDATED-PN", j5: "UPDATED-PN" });
  await undo();
  await click('[data-select-component="j2"]'); await setValue('[aria-label="Filter value"]', "value:Harting");
  await toolbar("Find & Replace");
  assert.equal(await evaluate(`document.querySelector('input[name="replace-scope"]:checked').value`), "selected");
  await setValue('[aria-label="Replacement property"]', "mpn"); await setValue('[aria-label="Find text"]', "NEW-PN"); await setValue('[aria-label="Replace with"]', "ONE-PN");
  await modalButton("Preview Matches"); await modalButton("Replace 1 Values"); await saved(); await expectMpn({ j2: "ONE-PN", j3: "NEW-PN" }); await undo();

  // Force a normal inspector edit while preview is open to simulate an external update.
  await toolbar("Clear Selection"); await setValue('[aria-label="Filter column"]', ""); await selectAll(); await toolbar("Edit Selected");
  await action("MPN", "set"); await newText("MPN", "STALE-TARGET"); await preview();
  await evaluate(`(()=>{const label=[...document.querySelectorAll('.inspector-panel label')].find(e=>e.querySelector('span')?.textContent==='Manufacturer part number');const input=label.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'EXTERNAL-PN');input.dispatchEvent(new Event('input',{bubbles:true}))})()`); await flush();
  await waitFor(`document.querySelector('.property-bulk-modal [role="alert"]')?.textContent.includes('since preview')`, "stale preview detection");
  assert.equal(await evaluate(`document.querySelector('.property-bulk-modal .primary-button').disabled`), true);
  await saved(); await expectMpn({ j1: "EXTERNAL-PN", j2: "NEW-PN" });
  await modalButton("Refresh Preview"); await apply(5); await undo(); await expectMpn({ j1: "EXTERNAL-PN", j2: "NEW-PN" }); await undo();

  await tab("Bundles"); assert.match(await summary(), /^0 selected/); await selectAll(); await toolbar("Edit Selected");
  await action("Default length", "set"); await setValue('.property-bulk-value [aria-label="Length value"]', "-50"); await preview();
  assert.equal(await evaluate(`document.querySelector('.property-bulk-modal .primary-button').disabled`), true);
  assert.equal(node(await readProject(), "bundle-1").length, "600 mm");
  await modalButton("Cancel"); await toolbar("Edit Selected"); await action("Default length", "set"); await setValue('.property-bulk-value [aria-label="Length value"]', "700"); await preview(); await apply(2);
  let current = await readProject(); assert.equal(node(current, "bundle-1").length, "700 mm"); assert.equal(node(current, "bundle-1").conductorLengthOverrides["bundle-1-c1"], "750 mm");
  await undo(); assert.equal(node(await readProject(), "bundle-2").length, "600 mm");
  await tab("Conductors"); await setValue('[aria-label="Filter column"]', "parent"); await setValue('[aria-label="Filter value"]', "value:B1"); await selectAll(); await toolbar("Edit Selected");
  await action("Effective length", "set"); await setValue('.property-bulk-value [aria-label="Length unit"]', "mm"); await setValue('.property-bulk-value [aria-label="Length value"]', "600"); await preview(); await apply(4);
  current = await readProject(); assert.equal(Object.keys(node(current, "bundle-1").conductorLengthOverrides).length, 4);
  await toolbar("Edit Selected"); await action("Effective length", "clear"); await preview(); await apply(4);
  assert.equal(node(await readProject(), "bundle-1").conductorLengthOverrides, undefined);
  await undo(); assert.equal(Object.keys(node(await readProject(), "bundle-1").conductorLengthOverrides).length, 4);
  await undo(); assert.deepEqual(node(await readProject(), "bundle-1").conductorLengthOverrides, { "bundle-1-c1": "750 mm" });
  current = await readProject(); assert.deepEqual(current.links, project.links); assert.deepEqual(current.twistedPairs, project.twistedPairs); assert.deepEqual(current.attachments, project.attachments);
  await click('[aria-label="Close Property Editor"]');
  const large = createEmptyProject("Large bulk Property Editor");
  large.attachments = project.attachments;
  for (let index = 0; index < 100; index++) {
    const component = makeComponent("bundle", index + 1, `large-${index}`); component.wireCount = 12;
    component.conductorIds = Array.from({ length: 12 }, (_, n) => `large-${index}-c${n}`);
    component.colors = Array.from({ length: 12 }, (_, n) => ["BK", "RD", "BUWH", "GNYE"][n % 4]); large.components.push(component);
  }
  const largePath = join(output, "large-bulk.wireform.json"); await writeFile(largePath, serializeProjectFile(large)); await load(largePath); await openEditor(); await tab("Conductors");
  await setValue('[aria-label="Filter column"]', "color"); await setValue('[aria-label="Filter value"]', "value:BK"); await selectAll(); assert.match(await summary(), /^300 selected/);
  assert.ok(await evaluate(`document.querySelectorAll('tr[data-property-row]').length`) < 50);
  await toolbar("Edit Selected"); await action("Color", "set"); await setValue('[aria-label="Primary wire color"]', "GN"); await setValue('[aria-label="Secondary wire color"]', "YE"); await preview();
  assert.equal(await evaluate(`document.querySelectorAll('.property-preview-table tbody tr').length`), 50, "large preview paginates");
  await modalButton("Next"); assert.match(await evaluate(`document.querySelector('.property-bulk-modal nav').textContent`), /Page 2 \/ 6/);
  const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(join(output, "bulk-preview.png"), Buffer.from(screenshot.data, "base64"));
  await apply(300); assert.match(await summary(), /300 selected · 0 visible · 300 hidden/);
  current = await readProject(); assert.equal(current.components.flatMap((component) => component.colors).filter((color) => color === "BK").length, 0);
  await undo(); assert.match(await summary(), /^300 selected · 300 visible/); await redo();
  assert.deepEqual((await readProject()).attachments, project.attachments);
  await key("Escape"); assert.equal(await evaluate(`document.body.style.overflow`), "");
  assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({ result: "passed", selectedConductors: 300, tableConductors: 1200,
    verified: ["shift range", "hidden selection", "multi-field bulk edits", "one update/undo/redo", "no-op/cancel autosave isolation", "explicit clear", "literal scoped replacements", "stale preview refresh", "invalid atomic operations", "bundle inheritance/override reset", "paginated preview", "virtualized select-all", "attachment/topology preservation"], output }, null, 2));
}
