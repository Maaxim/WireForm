import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir, access } from "node:fs/promises";
import { fitImageViewport, zoomImageAt, boundImagePan, fitViewerScale, pdfRenderResolution, clampZoom } from "../app/project-file-viewport.ts";
import { prepareProjectAttachment, createProjectFilePreview, projectAttachmentDownloadBlob } from "../app/project-files.ts";

test("large images initially fit and center without changing intrinsic dimensions", () => {
  const image = { width: 6000, height: 4000 }, viewport = { width: 1500, height: 900 };
  const original = structuredClone(image);
  const fit = fitImageViewport(image, viewport);
  assert.ok(image.width * fit.scale <= viewport.width - 32);
  assert.ok(image.height * fit.scale <= viewport.height - 32);
  assert.equal(fit.x * 2 + image.width * fit.scale, viewport.width);
  assert.equal(fit.y * 2 + image.height * fit.scale, viewport.height);
  assert.deepEqual(image, original);
  assert.deepEqual(fitImageViewport(image, viewport), fit);
});

test("cursor-centered zoom keeps the same content coordinate under the cursor", () => {
  const point = { x: 432, y: 123 }, current = { scale: 0.5, x: -70, y: 23 };
  for (const scale of [0.1, 0.75, 1, 2, 10]) {
    const next = zoomImageAt(current, point, scale);
    assert.ok(Math.abs((point.x - next.x) / next.scale - (point.x - current.x) / current.scale) < 1e-9);
    assert.ok(Math.abs((point.y - next.y) / next.scale - (point.y - current.y) / current.scale) < 1e-9);
  }
});

test("repeated zoom cycles have no cumulative image-coordinate drift", () => {
  const point = { x: 120, y: 200 }, original = { scale: 1, x: -50, y: -100 };
  let view = original;
  for (let index = 0; index < 100; index++) {
    view = zoomImageAt(view, point, 2); view = zoomImageAt(view, point, 1);
  }
  assert.deepEqual(view, original);
  assert.equal(clampZoom(0.001), 0.1); assert.equal(clampZoom(100), 10);
});

test("100 percent means native pixel scale and reset reproduces initial fit", () => {
  const image = { width: 4000, height: 3000 }, viewport = { width: 1000, height: 700 };
  const fit = fitImageViewport(image, viewport);
  const native = zoomImageAt(fit, { x: 500, y: 350 }, 1);
  assert.equal(native.scale, 1);
  assert.deepEqual(fitImageViewport(image, viewport), fit);
});

test("pan permits edge inspection but cannot lose the entire image", () => {
  const image = { width: 4000, height: 3000 }, viewport = { width: 1000, height: 800 };
  assert.deepEqual(boundImagePan({ scale: 1, x: 5000, y: -9999 }, image, viewport), { scale: 1, x: 952, y: -2952 });
  assert.deepEqual(boundImagePan({ scale: 0.1, x: 5000, y: -9999 }, image, viewport), { scale: 0.1, x: 300, y: 250 });
});

test("fit modes recalculate from viewport geometry without distorting PDF aspect ratio", () => {
  const page = { width: 600, height: 900 }, viewport = { width: 1200, height: 800 };
  assert.equal(fitViewerScale(page, viewport), 768 / 900);
  assert.equal(fitViewerScale(page, viewport, true), 1168 / 600);
  assert.ok(fitViewerScale(page, { width: 600, height: 400 }) < fitViewerScale(page, viewport));
});

test("PDF backing canvases gain high-DPI detail and bound extreme memory", () => {
  assert.deepEqual(pdfRenderResolution({ width: 800, height: 1000 }, 2), { ratio: 2, width: 1600, height: 2000 });
  for (const size of [{ width: 8000, height: 12000 }, { width: 50000, height: 1000 }]) {
    const resolution = pdfRenderResolution(size, 3);
    assert.ok(resolution.width * resolution.height <= 12_000_000);
    assert.ok(resolution.width <= 8192 && resolution.height <= 8192);
  }
});

test("PDF preview exposes original bytes to PDF.js without a browser iframe URL", async () => {
  const bytes = Buffer.from("%PDF-1.7\noriginal bytes\x00\xff", "latin1");
  const file = await prepareProjectAttachment(new File([bytes], "original.pdf", { type: "application/pdf" }));
  const original = structuredClone(file);
  const preview = createProjectFilePreview(file);
  assert.equal(preview.kind, "pdf"); assert.equal(preview.url, undefined);
  assert.deepEqual(Buffer.from(preview.bytes), bytes);
  preview.dispose(); preview.dispose();
  assert.deepEqual(Buffer.from(await (await projectAttachmentDownloadBlob(file)).arrayBuffer()), bytes);
  assert.deepEqual(file, original);
});

test("viewer isolates transient interactions, traps focus, and releases resources", async () => {
  const read = (name) => readFile(new URL(`../app/${name}`, import.meta.url), "utf8");
  const [shell, image, pdf, css] = await Promise.all([read("ProjectFileViewer.tsx"), read("ProjectFileImageViewer.tsx"), read("ProjectFilePdfViewer.tsx"), read("globals.css")]);
  assert.match(css, /width: 97vw; height: 97vh/);
  assert.match(shell, /document.body.style.overflow = "hidden"/);
  assert.match(shell, /event.stopPropagation\(\)/);
  assert.match(shell, /event.key === "Escape"/);
  assert.match(shell, /event.key === "Tab"/);
  assert.match(shell, /result.dispose\(\)/);
  assert.match(image, /setPointerCapture/); assert.match(image, /releasePointerCapture/);
  assert.match(pdf, /task\?\.cancel\(\)/); assert.match(pdf, /task.destroy\(\)/);
  assert.match(pdf, /canvas.width = 0; canvas.height = 0/);
  assert.match(pdf, /data: bytes.slice\(\)/);
  assert.match(pdf, /IntersectionObserver/);
  assert.match(pdf, /Math.abs\(index \+ 1 - currentPage\) <= 2/);
  assert.doesNotMatch(shell + image + pdf, /onChange:.*ProjectAttachment|writeLocalDocument|updateProject\(|serializeProject|<iframe|dangerouslySetInnerHTML/);
});

test("production PDF worker and auxiliary assets are local and retain existing CSP", async () => {
  const assets = await readdir(new URL("../dist/assets/", import.meta.url));
  assert.ok(assets.some((file) => /^pdf.worker.min-.*\.mjs$/.test(file)));
  const chunk = assets.find((file) => /^ProjectFilePdfViewer-.*\.js$/.test(file));
  const source = await readFile(new URL(`../dist/assets/${chunk}`, import.meta.url), "utf8");
  assert.match(source, /pdf.worker.min-/);
  await access(new URL("../dist/vendor/pdfjs/standard_fonts/FoxitSerif.pfb", import.meta.url));
  await access(new URL("../dist/vendor/pdfjs/wasm/openjpeg.wasm", import.meta.url));
  await access(new URL("../dist/vendor/pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap", import.meta.url));
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, /worker-src 'self' blob:/);
  assert.doesNotMatch(html, /https:\/\/.*(?:cdn|pdfjs)|'unsafe-eval'/);
});
