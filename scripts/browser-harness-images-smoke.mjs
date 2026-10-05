import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const endpoint = process.argv[2] ?? "http://127.0.0.1:9224";
const downloadPath = process.argv[3];
const landscapePath = process.argv[4];
const portraitPath = process.argv[5];
const pngPath = process.argv[6];
const unsupportedPath = process.argv[7];
const screenshotPath = process.argv[8];

if (
  !downloadPath ||
  !landscapePath ||
  !portraitPath ||
  !pngPath ||
  !unsupportedPath ||
  !screenshotPath
) {
  throw new Error(
    "Usage: browser-harness-images-smoke.mjs <cdp> <downloads> <landscape.jpg> <portrait.jpg> <image.png> <unsupported.gif> <screenshot.png>",
  );
}

await mkdir(downloadPath, { recursive: true });
const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const target = targets.find((candidate) => candidate.type === "page");
if (!target?.webSocketDebuggerUrl) throw new Error("Chrome page target not found.");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const consoleErrors = [];
const downloads = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    consoleErrors.push(message.params.exceptionDetails.text);
  }
  if (
    message.method === "Runtime.consoleAPICalled" &&
    ["error", "warning"].includes(message.params.type)
  ) {
    consoleErrors.push(
      message.params.args.map((argument) => argument.value ?? argument.description).join(" "),
    );
  }
  if (message.method === "Browser.downloadWillBegin") {
    downloads.set(message.params.guid, {
      guid: message.params.guid,
      filename: message.params.suggestedFilename,
      state: "inProgress",
    });
  }
  if (message.method === "Browser.downloadProgress") {
    const download = downloads.get(message.params.guid);
    if (download) {
      download.state = message.params.state;
      download.bytes = message.params.receivedBytes;
    }
  }
});

function command(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function click(selector) {
  const clicked = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Element not found: ${selector}`);
}

async function setField(label, value) {
  const changed = await evaluate(`(() => {
    const element = document.querySelector('[aria-label=${JSON.stringify(label)}]');
    if (!element) return false;
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(element),
      'value',
    );
    descriptor.set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error(`Field not found: ${label}`);
}

async function setFiles(selector, files) {
  const documentNode = await command("DOM.getDocument", { depth: -1, pierce: true });
  const input = await command("DOM.querySelector", {
    nodeId: documentNode.root.nodeId,
    selector,
  });
  if (!input.nodeId) throw new Error(`File input not found: ${selector}`);
  await command("DOM.setFileInputFiles", { nodeId: input.nodeId, files });
}

async function waitForDownload(suffix, previousCount, timeoutMs = 210_000) {
  return waitFor(
    () => {
      const completed = [...downloads.values()].filter(
        (download) => download.state === "completed" && download.filename.endsWith(suffix),
      );
      return completed.length > previousCount ? completed.at(-1) : undefined;
    },
    timeoutMs,
    `${suffix} download`,
  );
}

await command("Runtime.enable");
await command("Page.enable");
await command("DOM.enable");
await command("Browser.setDownloadBehavior", {
  behavior: "allow",
  downloadPath,
  eventsEnabled: true,
});
await command("Emulation.setDeviceMetricsOverride", {
  width: 1900,
  height: 1200,
  deviceScaleFactor: 1,
  mobile: false,
});

await waitFor(
  () =>
    evaluate(
      'document.readyState === "complete" && !!document.querySelector(\'[aria-label="Save WireForm project"]\')',
    ),
  30_000,
  "WireForm application",
);
await new Promise((resolve) => setTimeout(resolve, 5_000));

// Connector images remain an independent component-level facility.
await setFiles('input[accept="image/jpeg,image/png,image/webp"]', [pngPath]);
await waitFor(
  () => evaluate('!!document.querySelector(".photo-editor img")'),
  15_000,
  "connector photo",
);

await click('[data-testid="open-harness-images"]');
await setFiles('input[accept="image/jpeg,image/png"][multiple]', [
  landscapePath,
  portraitPath,
  pngPath,
  unsupportedPath,
]);
await waitFor(
  () => evaluate('document.querySelectorAll(".harness-image-card").length === 3'),
  30_000,
  "three valid harness images",
);

const uploadState = await evaluate(`({
  notice: document.querySelector('.notice-bar > span')?.textContent?.trim() ?? '',
  files: [...document.querySelectorAll('.harness-image-file strong')].map((node) => node.textContent.trim()),
  dimensions: [...document.querySelectorAll('.harness-image-file span')].map((node) => node.textContent.trim()),
  imageSources: [...document.querySelectorAll('.harness-image-card img')].map((node) => node.src.slice(0, 32)),
})`);

await setField("Harness image 1 title", "Harness routing");
await setField(
  "Harness image 1 caption",
  "Route W12 behind the support bracket.\n<script>alert(1)</script>",
);
await setField("Harness image 2 title", "Connector installation");
await setField("Harness image 2 caption", "X4 after final assembly.");

// Make the portrait image first, then verify the generic history integration.
await click('[aria-label="Move harness image 2 up"]');
await waitFor(
  () => evaluate('document.querySelector(".harness-image-file strong")?.textContent.includes("portrait")'),
  5_000,
  "image reorder",
);
await click('[aria-label="Undo"]');
await waitFor(
  () => evaluate('document.querySelector(".harness-image-file strong")?.textContent.includes("landscape")'),
  5_000,
  "image reorder undo",
);
await click('[aria-label="Redo"]');
await waitFor(
  () => evaluate('document.querySelector(".harness-image-file strong")?.textContent.includes("portrait")'),
  5_000,
  "image reorder redo",
);

// Exercise replacement, deletion, and their undo path without changing final count.
await evaluate(`(() => {
  const button = [...document.querySelectorAll('.harness-image-card button')]
    .find((candidate) => candidate.textContent.includes('Replace'));
  button.click();
})()`);
await setFiles('input[accept="image/jpeg,image/png"]:not([multiple])', [pngPath]);
await waitFor(
  () => evaluate('document.querySelector(".harness-image-file strong")?.textContent.includes(".png")'),
  15_000,
  "image replacement",
);
await click('[aria-label="Undo"]');
await waitFor(
  () => evaluate('document.querySelector(".harness-image-file strong")?.textContent.includes("portrait")'),
  5_000,
  "image replacement undo",
);
await click('[aria-label="Delete harness image 3"]');
await waitFor(
  () => evaluate('document.querySelectorAll(".harness-image-card").length === 2'),
  5_000,
  "image deletion",
);
await click('[aria-label="Undo"]');
await waitFor(
  () => evaluate('document.querySelectorAll(".harness-image-card").length === 3'),
  5_000,
  "image deletion undo",
);

await new Promise((resolve) => setTimeout(resolve, 1_500));
const finalUiState = await evaluate(`({
  files: [...document.querySelectorAll('.harness-image-file strong')].map((node) => node.textContent.trim()),
  titles: [...document.querySelectorAll('.harness-image-card input')].map((node) => node.value),
  captions: [...document.querySelectorAll('.harness-image-card textarea')].map((node) => node.value),
  storage: document.querySelector('.harness-images-heading span')?.textContent,
  connectorPhotoIndependent: !!document.querySelector('.harness-node img'),
  autosave: document.querySelector('.autosave-chip')?.textContent?.trim() ?? '',
  issues: document.querySelector('.validation-summary')?.textContent?.trim() ?? '',
})`);

const screenshot = await command("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: false,
});
await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

let count = [...downloads.values()].filter((item) => item.state === "completed" && item.filename.endsWith(".wireform.json")).length;
await click('[aria-label="Save WireForm project"]');
const projectDownload = await waitForDownload(".wireform.json", count);

count = [...downloads.values()].filter((item) => item.state === "completed" && item.filename.endsWith(".yml")).length;
await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')]
    .find((candidate) => candidate.textContent.trim() === 'Download YAML');
  button.click();
})()`);
const yamlDownload = await waitForDownload(".yml", count);

count = [...downloads.values()].filter((item) => item.state === "completed" && item.filename.endsWith(".html")).length;
await click('[aria-label="Export HTML report"]');
const htmlDownload = await waitForDownload(".html", count);

count = [...downloads.values()].filter((item) => item.state === "completed" && item.filename.endsWith(".pdf")).length;
await click('[aria-label="Export PDF report"]');
const pdfDownload = await waitForDownload(".pdf", count);

await command("Page.navigate", { url: "http://127.0.0.1:4180" });
await waitFor(
  () =>
    evaluate(
      'document.readyState === "complete" && document.querySelector(\'.autosave-chip\')?.textContent.includes("Saved locally")',
    ),
  30_000,
  "autosaved project reload",
);
await click('[data-testid="open-harness-images"]');
const reloadState = await waitFor(
  () =>
    evaluate(`(() => {
      const cards = [...document.querySelectorAll('.harness-image-card')];
      if (cards.length !== 3) return null;
      return {
        files: [...document.querySelectorAll('.harness-image-file strong')].map((node) => node.textContent.trim()),
        titles: [...document.querySelectorAll('.harness-image-card input')].map((node) => node.value),
        captions: [...document.querySelectorAll('.harness-image-card textarea')].map((node) => node.value),
        autosave: document.querySelector('.autosave-chip')?.textContent.trim(),
        connectorPhotoIndependent: !!document.querySelector('.harness-node img'),
      };
    })()`),
  30_000,
  "reloaded harness images",
);

await command("Page.navigate", {
  url: pathToFileURL(join(downloadPath, htmlDownload.filename)).href,
});
await waitFor(
  () => evaluate('document.readyState === "complete" && !!document.querySelector("#additional-images")'),
  30_000,
  "offline HTML image report",
);
const offlineHtmlState = await evaluate(`({
  imageCount: document.querySelectorAll('#additional-images img').length,
  titles: [...document.querySelectorAll('#additional-images h3')].map((node) => node.textContent),
  captions: [...document.querySelectorAll('#additional-images figcaption')].map((node) => node.textContent),
  dataImages: [...document.querySelectorAll('#additional-images img')].every((node) => node.src.startsWith('data:image/')),
  rawScriptExecuted: typeof window.__harnessImageAttack !== 'undefined',
  rawScriptNode: !!document.querySelector('#additional-images script'),
  sectionAfterNotes: !document.querySelector('#notes') ||
    !!(document.querySelector('#notes').compareDocumentPosition(document.querySelector('#additional-images')) & Node.DOCUMENT_POSITION_FOLLOWING),
  sectionAtBottom: document.querySelector('#additional-images').nextElementSibling?.classList.contains('report-footer'),
  externalResources: performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((url) => !url.startsWith('file:') && !url.startsWith('data:') && !url.startsWith('blob:')),
})`);

socket.close();
process.stdout.write(
  JSON.stringify(
    {
      uploadState,
      finalUiState,
      reloadState,
      downloads: { projectDownload, yamlDownload, htmlDownload, pdfDownload },
      offlineHtmlState,
      consoleErrors,
      screenshotPath,
    },
    null,
    2,
  ),
);
