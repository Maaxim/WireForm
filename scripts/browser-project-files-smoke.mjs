import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const endpoint = process.argv[2] ?? "http://127.0.0.1:9246";
const downloadPath = resolve(process.argv[3] ?? `work/project-files-smoke/downloads-${Date.now()}`);
await mkdir(downloadPath, { recursive: true });
const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const target = targets.find((entry) => entry.type === "page" && entry.url.includes("5181"));
if (!target) throw new Error("Open WireForm in the isolated CDP browser first.");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve); socket.addEventListener("error", reject); });
const pending = new Map();
const downloads = [];
const exceptions = [];
let sequence = 0;
let navigations = 0;
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const operation = pending.get(message.id);
    if (!operation) return;
    pending.delete(message.id);
    if (message.error) operation.reject(new Error(message.error.message));
    else operation.resolve(message.result);
  } else if (message.method === "Page.frameNavigated" && !message.params.frame.parentId) navigations += 1;
  else if (message.method === "Browser.downloadWillBegin") downloads.push(message.params);
  else if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
  else if (message.method === "Page.javascriptDialogOpening") void command("Page.handleJavaScriptDialog", { accept: true });
});
function command(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(expression, label, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await evaluate(expression);
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
}
async function click(selector) {
  assert.ok(await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e)return false;e.click();return true;})()`), selector);
}
async function rowClick(filename, label) {
  assert.ok(await evaluate(`(() => { const row=[...document.querySelectorAll('.project-file-card')].find(e=>e.querySelector('strong').textContent===${JSON.stringify(filename)});const button=[...row?.querySelectorAll('button')??[]].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!button)return false;button.click();return true;})()`), `${filename}: ${label}`);
}
async function setValue(selector, value) {
  await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
}
async function addFiles(samples, replace = false, drop = false) {
  await evaluate(`(() => { const dt=new DataTransfer();for(const f of ${JSON.stringify(samples)}){dt.items.add(new File([Uint8Array.from(atob(f.data),c=>c.charCodeAt(0))],f.name,{type:f.type}));} ${drop
    ? "document.querySelector('.project-files-body').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));"
    : `const e=document.querySelector('[data-testid="project-files-${replace ? "replace" : "add"}"]');e.files=dt.files;e.dispatchEvent(new Event('change',{bubbles:true}));`} })()`);
  await waitFor(`!document.querySelector('.project-files-toolbar .primary-button').disabled`, "file processing");
}
const sample = (name, bytes, type) => ({ name, data: Buffer.from(bytes).toString("base64"), type });
const samples = [
  sample("Connector_Datasheet.pdf", "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF", "application/pdf"),
  sample("Cable_Calculations.xlsx", [80, 75, 3, 4, 255, 0, 13, 10], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  { name: "Assembly_Reference.png", type: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=" },
  sample("Manufacturing_Instructions.docx", [80, 75, 3, 4, 128, 0], "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
  sample("Confidential_Notes.txt", "<script>globalThis.projectFileExecuted=true</script>\nµ engineering reference", "text/plain"),
  sample("Archive.zip", [80, 75, 3, 4, 0, 255, 128], "application/zip"),
];
try {
  await command("Runtime.enable"); await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await command("Browser.setDownloadBehavior", { behavior: "allow", downloadPath, eventsEnabled: true });
  await waitFor(`document.querySelector('[data-testid="open-project-files"]') && document.querySelector('.autosave-chip').textContent.includes('Saved locally')`, "application/autosave");
  await evaluate(`window.confirm=()=>true; window.fileUrls={created:[],revoked:[]}; const c=URL.createObjectURL.bind(URL),r=URL.revokeObjectURL.bind(URL); URL.createObjectURL=b=>{const u=c(b);fileUrls.created.push(u);return u;}; URL.revokeObjectURL=u=>{fileUrls.revoked.push(u);r(u);};`);
  if (await evaluate(`Boolean(document.querySelector('[aria-label="Close Project Files"]'))`)) await click('[aria-label="Close Project Files"]');
  await click('[aria-label="New empty project"]');
  await click('[data-testid="open-project-files"]');
  await addFiles(samples);
  await waitFor(`document.querySelectorAll('.project-file-card').length===6`, "six attachments");
  await setValue('[aria-label="Description for Cable_Calculations.xlsx"]', "Voltage drop and capacity calculations");
  const excelId = await evaluate(`document.querySelector('[aria-label="Description for Cable_Calculations.xlsx"]').closest('article').dataset.attachmentId`);
  await rowClick("Connector_Datasheet.pdf", "Rename");
  await setValue('[aria-label="New attachment filename"]', "J1_Datasheet.pdf");
  await evaluate(`document.querySelector('.project-file-rename').requestSubmit()`);
  samples[0].name = "J1_Datasheet.pdf";
  await rowClick("Confidential_Notes.txt", "View");
  await waitFor(`document.querySelector('.project-file-preview pre')?.textContent.includes('<script>')`, "escaped text preview");
  assert.equal(await evaluate("globalThis.projectFileExecuted===undefined"), true);
  await rowClick("Assembly_Reference.png", "View");
  await waitFor(`document.querySelector('.project-file-preview img')?.naturalWidth===1`, "PNG preview");
  await rowClick("J1_Datasheet.pdf", "View");
  await waitFor(`document.querySelector('.project-file-preview iframe')?.getAttribute('sandbox')===''`, "sandboxed PDF / download fallback");
  await click('[aria-label="Close file preview"]');
  const dropped = sample("Dropped.csv", "one,two\r\n1,2", "text/csv");
  await addFiles([dropped], false, true); samples.push(dropped);
  await waitFor(`document.querySelectorAll('.project-file-card').length===7`, "drop adds file");
  await rowClick("Cable_Calculations.xlsx", "Replace");
  const replacement = sample("Revised_Calculations.xlsx", [80, 75, 3, 4, 1, 2, 3, 255], samples[1].type);
  await addFiles([replacement], true); samples[1] = replacement;
  assert.equal(await evaluate(`document.querySelector('[aria-label="Description for Revised_Calculations.xlsx"]').closest('article').dataset.attachmentId`), excelId);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Description for Revised_Calculations.xlsx"]').value`), "Voltage drop and capacity calculations");
  await rowClick("Revised_Calculations.xlsx", "Replace");
  await evaluate(`(() => {const e=document.querySelector('[data-testid="project-files-replace"]'),dt=new DataTransfer();dt.items.add(new File([new Uint8Array(10*1024*1024+1)],'oversized.bin'));e.files=dt.files;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(`document.querySelector('.project-files-error')?.textContent.includes('Maximum attachment size')`, "oversized replacement rejection");
  assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="Description for Revised_Calculations.xlsx"]'))`), true);
  await evaluate("window.confirm=()=>false");
  await rowClick("Manufacturing_Instructions.docx", "Delete");
  assert.equal(await evaluate("document.querySelectorAll('.project-file-card').length"), 7);
  await evaluate("window.confirm=()=>true");
  await rowClick("Manufacturing_Instructions.docx", "Delete");
  samples.splice(samples.findIndex((file) => file.name.endsWith(".docx")), 1);
  await waitFor(`document.querySelectorAll('.project-file-card').length===6`, "confirmed delete");
  for (const original of samples) {
    const start = downloads.length;
    await rowClick(original.name, "Download");
    const startTime = Date.now();
    while (downloads.length === start && Date.now() - startTime < 10000) await new Promise((resolve) => setTimeout(resolve, 100));
    await waitFor(`true`, "download start");
    let downloaded;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { downloaded = await readFile(join(downloadPath, original.name)); break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    assert.deepEqual(downloaded, Buffer.from(original.data, "base64"), original.name);
  }
  await click('[aria-label="Close Project Files"]');
  await waitFor(`fileUrls.created.every(url=>fileUrls.revoked.includes(url))`, "preview/download URL cleanup");
  await waitFor(`document.querySelector('.autosave-chip').textContent.includes('Saved locally')`, "IndexedDB autosave");
  assert.equal(await evaluate(`localStorage.getItem('wireform:project-autosave')`), null);
  await click('[aria-label="Save WireForm project"]');
  const startTime = Date.now();
  while (!downloads.some((entry) => entry.suggestedFilename.endsWith(".wireform.json")) && Date.now() - startTime < 10000) await new Promise((resolve) => setTimeout(resolve, 100));
  const nativeName = downloads.findLast((entry) => entry.suggestedFilename.endsWith(".wireform.json")).suggestedFilename;
  let native;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { native = JSON.parse(await readFile(join(downloadPath, nativeName), "utf8")); break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  assert.equal(native.project.attachments.length, samples.length);
  for (const original of samples) {
    const embedded = native.project.attachments.find((file) => file.filename === original.name);
    assert.equal(embedded.data, original.data);
    assert.equal(embedded.sha256, createHash("sha256").update(Buffer.from(original.data, "base64")).digest("hex"));
  }
  const beforeNavigation = navigations;
  await command("Page.reload");
  const navigationDeadline = Date.now() + 20000;
  while (navigations === beforeNavigation && Date.now() < navigationDeadline) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(navigations > beforeNavigation, "reload navigation completed");
  await waitFor(`document.querySelector('[data-testid="open-project-files"]') && document.querySelector('.autosave-chip').textContent.includes('Saved locally')`, "autosave reload");
  await evaluate("window.confirm=()=>true");
  await click('[data-testid="open-project-files"]');
  assert.equal(await evaluate("document.querySelectorAll('.project-file-card').length"), samples.length);
  await click('[aria-label="Close Project Files"]');
  await click('[aria-label="New empty project"]');
  const dom = await command("DOM.getDocument");
  const input = await command("DOM.querySelector", { nodeId: dom.root.nodeId, selector: '[data-testid="native-project-input"]' });
  await command("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [join(downloadPath, nativeName)] });
  await waitFor(`document.querySelector('.autosave-chip').textContent.includes('Saved locally')`, "native reopen autosave");
  await click('[data-testid="open-project-files"]');
  await waitFor(`document.querySelectorAll('.project-file-card').length===${samples.length}`, "native reopen attachment restoration");
  await evaluate(`window.originalPut=IDBObjectStore.prototype.put; IDBObjectStore.prototype.put=function(value,key){if(key==='project-autosave')throw new DOMException('Quota exceeded','QuotaExceededError');return originalPut.apply(this,arguments);};`);
  await setValue('[aria-label="Description for Revised_Calculations.xlsx"]', "Unsaved quota-test changes");
  await waitFor(`document.querySelector('.autosave-chip').textContent.includes('Not saved locally')`, "quota failure indication");
  assert.equal(await evaluate(`document.querySelector('.project-files-error')?.textContent.includes('Latest changes have not been saved locally')`), true);
  assert.equal(await evaluate(`localStorage.getItem('wireform:project-autosave')`), null);
  await evaluate("IDBObjectStore.prototype.put=window.originalPut");
  await setValue('[aria-label="Description for Revised_Calculations.xlsx"]', "Voltage drop and capacity calculations");
  await waitFor(`document.querySelector('.autosave-chip').textContent.includes('Saved locally')`, "quota recovery");
  const screenshot = await command("Page.captureScreenshot", { format: "png" });
  await writeFile(resolve(downloadPath, "..", "project-files-ui.png"), Buffer.from(screenshot.data, "base64"));
  let capacityBytes = 0;
  if (process.argv.includes("--capacity")) {
    await click('[aria-label="Close Project Files"]');
    await click('[aria-label="New empty project"]');
    await setValue('.title-input', "Capacity integrity");
    await click('[data-testid="open-project-files"]');
    await evaluate(`(() => {const dt=new DataTransfer();for(let index=1;index<=5;index++)dt.items.add(new File([new Uint8Array(10*1024*1024).fill(index)],'Capacity-'+index+'.bin'));const e=document.querySelector('[data-testid="project-files-add"]');e.files=dt.files;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await waitFor(`document.querySelectorAll('.project-file-card').length===5 && !document.querySelector('.project-files-toolbar .primary-button').disabled`, "50 MiB attachment upload", 60000);
    await waitFor(`document.querySelector('.autosave-chip').textContent.includes('Saved locally')`, "50 MiB IndexedDB save", 30000);
    await addFiles([sample("one-byte-over-total.bin", [1], "application/octet-stream")]);
    await waitFor(`document.querySelector('.project-files-error')?.textContent.includes('Maximum total Project Files size')`, "50 MiB total rejection");
    assert.equal(await evaluate(`document.querySelectorAll('.project-file-card').length`), 5);
    await click('[aria-label="Close Project Files"]');
    await click('[aria-label="Save WireForm project"]');
    let capacity;
    const capacityPath = join(downloadPath, "capacity-integrity.wireform.json");
    for (let attempt = 0; attempt < 300; attempt += 1) {
      try { capacity = JSON.parse(await readFile(capacityPath, "utf8")); break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    assert.equal(capacity.project.attachments.length, 5);
    for (const embedded of capacity.project.attachments) {
      const index = Number(embedded.filename.match(/\d+/)[0]);
      const original = Buffer.alloc(10 * 1024 * 1024, index);
      const decoded = Buffer.from(embedded.data, "base64");
      assert.deepEqual(decoded, original);
      assert.equal(embedded.sha256, createHash("sha256").update(original).digest("hex"));
      capacityBytes += decoded.length;
    }
    const capacityDom = await command("DOM.getDocument");
    const capacityInput = await command("DOM.querySelector", { nodeId: capacityDom.root.nodeId, selector: '[data-testid="native-project-input"]' });
    await command("DOM.setFileInputFiles", { nodeId: capacityInput.nodeId, files: [capacityPath] });
    await waitFor(`document.querySelector('.autosave-chip').textContent.includes('Saved locally')`, "large native project reload", 30000);
    await click('[data-testid="open-project-files"]');
    await waitFor(`document.querySelectorAll('.project-file-card').length===5`, "large native attachment restoration");
    assert.equal(await evaluate(`localStorage.getItem('wireform:project-autosave')`), null);
  }
  assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({ status: "passed", attachments: samples.length, capacityBytes, verified: ["multi-add", "drag/drop", "rename", "description", "replace", "oversize rollback", "cancel/confirm deletion", "image/plain-text/sandboxed-PDF preview", "original binary downloads", "native save/reopen", "IndexedDB reload", "quota failure/recovery"], nativeName, screenshot: resolve(downloadPath, "..", "project-files-ui.png") }, null, 2));
} finally { socket.close(); }
