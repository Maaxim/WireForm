// Run against a production `vite preview` in isolated Chrome/CDP. No external requests.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import pdfmake from "pdfmake/build/pdfmake.js";
import fonts from "pdfmake/build/vfs_fonts.js";

const endpoint = process.argv[2] ?? "http://127.0.0.1:9246";
const output = resolve(process.argv[3] ?? `work/project-file-viewer-smoke/run-${Date.now()}`);
await mkdir(output, { recursive: true });
pdfmake.addVirtualFileSystem(fonts);
const pdf = async (pages, extra = {}) => Buffer.from(await pdfmake.createPdf({
  content: Array.from({ length: pages }, (_, index) => ({
    stack: [{ text: `Engineering Drawing — Page ${index + 1}`, fontSize: 22 },
      { text: "Connector J1: physical dimensions 7.5 mm, tolerance ±0.05 mm", margin: [0, 20, 0, 20] },
      { canvas: [{ type: "rect", x: 20, y: 20, w: 400, h: 250, lineWidth: 0.5 },
        ...Array.from({ length: 16 }, (_, pin) => ({ type: "ellipse", x: 40 + pin % 8 * 45, y: 80 + Math.floor(pin / 8) * 80, r1: 5, r2: 5, lineWidth: 0.25 }))] },
      { text: "Small annotation: inspect connector pin and shield detail.", fontSize: 7 }],
    ...(index ? { pageBreak: "before" } : {}),
  })), ...extra,
}).getBuffer());
const samples = [
  { name: "Twenty_Pages.pdf", type: "application/pdf", data: (await pdf(20)).toString("base64") },
  { name: "Single_Drawing.pdf", type: "application/pdf", data: (await pdf(1)).toString("base64") },
  { name: "Locked.pdf", type: "application/pdf", data: (await pdf(1, { userPassword: "viewer-test", ownerPassword: "owner-test" })).toString("base64") },
  { name: "Invalid.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.7\ninvalid").toString("base64") },
  { name: "Notes.txt", type: "text/plain", data: Buffer.from('<script>globalThis.executedAttachment=true</script>\nEngineering notes\n' + "long line ".repeat(300)).toString("base64") },
];
const target = await fetch(`${endpoint}/json/new?http://127.0.0.1:5181`, { method: "PUT" }).then((response) => response.json());
assert.ok(target.webSocketDebuggerUrl, "An isolated CDP browser is required");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve); socket.addEventListener("error", reject); });
const pending = new Map(), exceptions = [], requests = [];
let sequence = 0;
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const operation = pending.get(message.id); pending.delete(message.id);
    if (!operation) return;
    clearTimeout(operation.timer);
    if (message.error) operation.reject(new Error(message.error.message)); else operation.resolve(message.result);
  } else if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  else if (message.method === "Network.requestWillBeSent") requests.push(message.params.request.url);
  else if (message.method === "Page.javascriptDialogOpening") void command("Page.handleJavaScriptDialog", { accept: true });
});
function command(method, params = {}) {
  const id = ++sequence; socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
  });
}
async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }).catch((error) => { throw new Error(`${error.message}: ${expression.slice(0, 160)}`); });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(expression, label, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
}
async function click(selector) {
  assert.ok(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e?.click();return !!e})()`), selector);
  await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
}
async function button(text) {
  assert.ok(await evaluate(`(()=>{const e=[...document.querySelectorAll('.project-file-viewer button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});e?.click();return !!e})()`), text);
  await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
}
async function open(name) {
  console.log(`Preview: ${name}`);
  await evaluate(`(()=>{const row=[...document.querySelectorAll('.project-file-card')].find(e=>e.querySelector('strong').textContent===${JSON.stringify(name)});[...row.querySelectorAll('button')].find(e=>e.textContent==='View').click()})()`);
  await waitFor(`document.querySelector('[data-testid="project-file-viewer"]')`, `${name} viewer`);
}
async function close() { await click('[aria-label="Close file preview"]'); await waitFor(`!document.querySelector('.project-file-viewer')`, "viewer closes"); }
async function key(key, code = key) {
  await command("Input.dispatchKeyEvent", { type: "keyDown", key, code });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key, code });
}
async function drag(selector, dx, dy) {
  const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await command("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1, x: point.x + dx, y: point.y + dy });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: point.x + dx, y: point.y + dy });
}
const zoom = () => evaluate(`Number(document.querySelector('[aria-label="Zoom percentage"]').textContent.replace('%',''))`);
const saved = () => waitFor(`document.querySelector('.autosave-chip')?.textContent.includes('Saved locally')`, "autosaved");
const screenshot = async (name) => {
  const result = await command("Page.captureScreenshot", { format: "png" });
  await writeFile(join(output, name), Buffer.from(result.data, "base64"));
};
try {
  await command("Runtime.enable"); await command("Network.enable"); await command("Page.enable");
  await command("Page.handleJavaScriptDialog", { accept: true }).catch(() => undefined);
  await command("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false });
  await command("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: output });
  await saved();
  await evaluate("window.confirm=()=>true");
  await click('[aria-label="New empty project"]');
  await click('[data-testid="open-project-files"]');
  await evaluate(`(()=>{const dt=new DataTransfer(); for(const f of ${JSON.stringify(samples)})dt.items.add(new File([Uint8Array.from(atob(f.data),c=>c.charCodeAt(0))],f.name,{type:f.type}));
    const canvas=document.createElement('canvas');canvas.width=5000;canvas.height=3500;const c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,5000,3500);c.fillStyle='#183c5b';c.font='100px monospace';for(let y=100;y<3500;y+=200)for(let x=100;x<5000;x+=400)c.fillText(x+','+y,x,y);
    window.originalImage=canvas.toDataURL('image/png').split(',')[1];dt.items.add(new File([Uint8Array.from(atob(originalImage),c=>c.charCodeAt(0))],'Connector_Drawing.png',{type:'image/png'}));
    window.urls={created:[],revoked:[]};const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=b=>{const u=create(b);urls.created.push(u);return u};URL.revokeObjectURL=u=>{urls.revoked.push(u);revoke(u)};
    const e=document.querySelector('[data-testid="project-files-add"]');e.files=dt.files;e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await waitFor(`document.querySelectorAll('.project-file-card').length===6`, "fixtures uploaded");
  await saved();
  await evaluate(`window.previewWrites=0;window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(key==='project-autosave')previewWrites++;return originalPut.apply(this,arguments)}`);
  await open("Connector_Drawing.png");
  await waitFor(`document.querySelector('.project-viewer-image-viewport img')?.naturalWidth===5000`, "large image decoded");
  await waitFor(`(()=>{const z=Number(document.querySelector('[aria-label="Zoom percentage"]')?.textContent.replace('%',''));return z>1 && z<100})()`, "initial image fit");
  const fit = await evaluate(`(()=>{const v=document.querySelector('[data-testid="image-viewport"]').getBoundingClientRect(),i=document.querySelector('.project-viewer-image-viewport img').getBoundingClientRect(),d=document.querySelector('.project-file-viewer').getBoundingClientRect();return {v:{x:v.x,y:v.y,w:v.width,h:v.height},i:{x:i.x,y:i.y,w:i.width,h:i.height},width:d.width/innerWidth,height:d.height/innerHeight}})()`);
  assert.ok(fit.width >= .95 && fit.height >= .95);
  assert.ok(fit.i.w <= fit.v.w && fit.i.h <= fit.v.h);
  assert.ok(Math.abs(fit.i.x + fit.i.w / 2 - fit.v.x - fit.v.w / 2) < 2, JSON.stringify(fit));
  await button("100%"); assert.equal(await zoom(), 100);
  const pointer = { x: Math.round(fit.v.x + fit.v.w * .6), y: Math.round(fit.v.y + fit.v.h * .4) };
  const focal = () => evaluate(`(()=>{const i=document.querySelector('.project-viewer-image-viewport img').getBoundingClientRect();return {x:(${pointer.x}-i.x)/i.width,y:(${pointer.y}-i.y)/i.height}})()`);
  const before = await focal();
  await command("Input.dispatchMouseEvent", { type: "mouseWheel", ...pointer, deltaX: 0, deltaY: -250 });
  await waitFor(`Number(document.querySelector('[aria-label="Zoom percentage"]').textContent.replace('%',''))>100`, "wheel zoom");
  const after = await focal(); assert.ok(Math.abs(before.x - after.x) < .002 && Math.abs(before.y - after.y) < .002);
  const panBefore = await evaluate(`document.querySelector('.project-viewer-image-viewport img').style.transform`);
  await drag('[data-testid="image-viewport"]', 130, 90);
  assert.notEqual(await evaluate(`document.querySelector('.project-viewer-image-viewport img').style.transform`), panBefore);
  await screenshot("image-zoom.png");
  const doubleZoom = await zoom();
  await evaluate(`(()=>{const e=document.querySelector('[data-testid="image-viewport"]'),r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}))})()`);
  await waitFor(`Number(document.querySelector('[aria-label="Zoom percentage"]').textContent.replace('%',''))>${doubleZoom}`, "double-click zoom");
  await command("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
  const pinchZoom = await zoom();
  const touch = (offset) => [{ x: 700 - offset, y: 400, id: 1 }, { x: 700 + offset, y: 400, id: 2 }];
  await command("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touch(50) });
  await command("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touch(100) });
  await command("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await waitFor(`Number(document.querySelector('[aria-label="Zoom percentage"]').textContent.replace('%',''))>${pinchZoom}`, "two-finger image pinch");
  await command("Emulation.setTouchEmulationEnabled", { enabled: false });
  await button("Fit"); assert.ok((await zoom()) < 100);
  await key("+", "Equal"); const keyboardZoom = await zoom();
  await command("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 2, mobile: false });
  assert.equal(await zoom(), keyboardZoom, "custom zoom preserved on resize");
  await key("0", "Digit0");
  await button("Download Original File");
  let downloadedImage;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { downloadedImage = await readFile(join(output, "Connector_Drawing.png")); break; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  assert.deepEqual(downloadedImage, Buffer.from(await evaluate("originalImage"), "base64"), "image download byte integrity");
  await key("Escape"); await waitFor(`!document.querySelector('.project-file-viewer')`, "Escape only closes preview");
  assert.ok(await evaluate(`!!document.querySelector('[data-testid="project-files-dialog"]')`));
  await open("Notes.txt");
  await waitFor(`document.querySelector('.project-viewer-text pre')?.textContent.includes('<script>')`, "plain text preview");
  assert.equal(await evaluate("globalThis.executedAttachment"), undefined);
  await close();
  await open("Twenty_Pages.pdf");
  await waitFor(`document.querySelector('[data-page="1"] canvas')?.dataset.rendered==='true'`, "production PDF worker render");
  assert.equal(await evaluate(`document.querySelectorAll('[data-page]').length`), 20);
  assert.ok(await evaluate(`document.querySelectorAll('.project-viewer-pdf-page canvas').length<=5`));
  assert.equal(await evaluate(`document.querySelectorAll('.project-file-viewer iframe').length`), 0);
  await click('[aria-label="Next PDF page"]');
  await waitFor(`document.querySelector('[aria-label="PDF page number"]').value==='2'`, "next page");
  await evaluate(`(()=>{const e=document.querySelector('[aria-label="PDF page number"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'12');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await evaluate(`document.querySelector('.project-viewer-page-controls form').requestSubmit()`);
  await waitFor(`document.querySelector('[data-page="12"] canvas')?.dataset.rendered==='true'`, "page 12 navigation/lazy render");
  await button("100%");
  for (let index = 0; index < 5; index++) await click('.project-file-viewer [aria-label="Zoom in"]');
  for (let index = 0; index < 3; index++) await click('.project-file-viewer [aria-label="Zoom out"]');
  await waitFor(`document.querySelector('[data-page="12"] canvas')?.dataset.rendered==='true'`, "rapid zoom final render");
  assert.equal(await evaluate(`document.querySelector('[aria-label="PDF page number"]').value`), "12", "zoom retains page");
  const resolution = await evaluate(`(()=>{const c=document.querySelector('[data-page="12"] canvas'),r=c.getBoundingClientRect();return {pixels:c.width,css:r.width}})()`);
  assert.ok(resolution.pixels > resolution.css * 1.5, "high-DPI canvas");
  await click('.project-file-viewer [aria-label="Zoom in"]');
  await click('.project-file-viewer [aria-label="Zoom in"]');
  await evaluate(`document.querySelector('[data-testid="pdf-viewport"]').scrollLeft=0`);
  const beforePan = await evaluate(`document.querySelector('[data-testid="pdf-viewport"]').scrollLeft`);
  await drag('[data-testid="pdf-viewport"]', -100, -40);
  assert.ok(await evaluate(`document.querySelector('[data-testid="pdf-viewport"]').scrollLeft`) > beforePan);
  await screenshot("pdf-zoom.png");
  const pdfWheelZoom = await zoom();
  const pdfPointer = await evaluate(`(()=>{const r=document.querySelector('[data-testid="pdf-viewport"]').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await command("Input.dispatchMouseEvent", { type: "mouseWheel", ...pdfPointer, deltaX: 0, deltaY: -100, modifiers: 2 });
  await waitFor(`Number(document.querySelector('[aria-label="Zoom percentage"]').textContent.replace('%',''))>${pdfWheelZoom}`, "Ctrl+wheel PDF zoom");
  await button("Fit Width");
  await key("PageDown");
  await waitFor(`document.querySelector('[aria-label="PDF page number"]').value==='13'`, "PageDown");
  await evaluate(`document.querySelector('[data-testid="pdf-viewport"]').scrollTop=0`);
  await waitFor(`document.querySelector('[aria-label="PDF page number"]').value==='1'`, "scroll page indicator");
  await close();
  await open("Single_Drawing.pdf");
  await waitFor(`document.querySelector('[data-page="1"] canvas')?.dataset.rendered==='true'`, "single-page render");
  assert.ok(await evaluate(`(()=>{const p=document.querySelector('[data-page="1"]').getBoundingClientRect(),v=document.querySelector('[data-testid="pdf-viewport"]').getBoundingClientRect();return p.width<=v.width && p.height<=v.height})()`));
  await button("Fit Page"); await button("Fit Width");
  await command("Emulation.setDeviceMetricsOverride", { width: 480, height: 800, deviceScaleFactor: 2, mobile: false });
  await waitFor(`document.querySelector('.project-file-viewer').getBoundingClientRect().width<480`, "narrow viewer resize");
  assert.ok(await evaluate(`(()=>{const s=document.querySelector('.project-file-viewer').getBoundingClientRect(),t=document.querySelector('.project-viewer-toolbar').getBoundingClientRect();return t.width<=s.width && t.bottom<=s.bottom})()`), "toolbar remains within narrow shell");
  await command("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 2, mobile: false });
  const pdfBytes = Buffer.from(samples[1].data, "base64");
  await button("Download Original File");
  await waitFor(`true`, "download");
  let downloaded;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { downloaded = await readFile(join(output, "Single_Drawing.pdf")); break; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  assert.deepEqual(downloaded, pdfBytes, "PDF download byte integrity");
  await close();
  await open("Locked.pdf");
  await waitFor(`document.querySelector('[aria-label="PDF password"]')`, "password request");
  await evaluate(`(()=>{const e=document.querySelector('[aria-label="PDF password"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'viewer-test');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await evaluate(`document.querySelector('.project-viewer-password').requestSubmit()`);
  await waitFor(`document.querySelector('[data-page="1"] canvas')?.dataset.rendered==='true'`, "password PDF rendered");
  await close();
  await open("Invalid.pdf");
  await waitFor(`document.querySelector('[data-testid="pdf-viewport"] [role="alert"]')?.textContent.includes('Unable to preview this PDF')`, "invalid PDF actionable error");
  await close();
  await waitFor(`urls.created.every(url=>urls.revoked.includes(url))`, "object URL cleanup");
  assert.equal(await evaluate("previewWrites"), 0, "preview never autosaves");
  assert.equal(await evaluate(`document.body.style.overflow`), "", "body scroll restored");
  assert.ok(requests.some((url) => /pdf.worker.min-.*\.mjs/.test(url)), "local production worker loaded");
  assert.ok(requests.every((url) => url.startsWith("http://127.0.0.1:5181") || url.startsWith("blob:") || url.startsWith("data:")), "no external preview requests");
  assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({ result: "passed", pdfPages: 20, image: "5000x3500", devicePixelRatio: 2, previewAutosaves: 0, exceptions }, null, 2));
} finally {
  for (const operation of pending.values()) clearTimeout(operation.timer);
  socket.close();
  await fetch(`${endpoint}/json/close/${target.id}`).catch(() => undefined);
}
