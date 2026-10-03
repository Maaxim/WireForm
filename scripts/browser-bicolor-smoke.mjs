import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const endpoint = process.argv[2] ?? "http://127.0.0.1:9223";
const downloadPath = process.argv[3];
const fixturePath = process.argv[4];
const screenshotPath = process.argv[5];

if (!downloadPath || !fixturePath || !screenshotPath) {
  throw new Error(
    "Usage: browser-bicolor-smoke.mjs <cdp endpoint> <downloads> <fixture> <screenshot>",
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

async function clickByText(selector, text) {
  const clicked = await evaluate(`(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((candidate) => candidate.textContent.trim().includes(${JSON.stringify(text)}));
    if (!element) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Element not found: ${selector} containing ${text}`);
}

async function waitForDownload(filenameSuffix, previousCount, timeoutMs = 210_000) {
  return waitFor(
    () => {
      const completed = [...downloads.values()].filter(
        (download) =>
          download.state === "completed" && download.filename.endsWith(filenameSuffix),
      );
      return completed.length > previousCount ? completed.at(-1) : undefined;
    },
    timeoutMs,
    `${filenameSuffix} download`,
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
  width: 1800,
  height: 1200,
  deviceScaleFactor: 1,
  mobile: false,
});

await waitFor(
  () => evaluate('document.readyState === "complete" && !!document.querySelector(\'[aria-label="Open WireForm project"]\')'),
  30_000,
  "WireForm application",
);

const documentNode = await command("DOM.getDocument", { depth: -1, pierce: true });
const fileInput = await command("DOM.querySelector", {
  nodeId: documentNode.root.nodeId,
  selector: 'input[accept=".json,.wireform.json"]',
});
if (!fileInput.nodeId) throw new Error("Project file input not found.");
await command("DOM.setFileInputFiles", {
  nodeId: fileInput.nodeId,
  files: [fixturePath],
});

await waitFor(
  () => evaluate('!!document.querySelector(\'[data-testid="node-W4"]\')'),
  30_000,
  "bi-color fixture",
);
await new Promise((resolve) => setTimeout(resolve, 1_000));

await click('[data-testid="node-W2"]');
const editorW2 = await evaluate(`({
  primary: document.querySelector('[aria-label="Primary wire color"]')?.value,
  secondary: document.querySelector('[aria-label="Secondary wire color"]')?.value,
  preview: document.querySelector('.wire-color-preview [role="img"]')?.getAttribute('aria-label'),
  code: document.querySelector('.wire-color-preview code')?.textContent,
})`);

await click('[data-testid="node-W3"]');
const editorW3 = await evaluate(`({
  primary: document.querySelector('[aria-label="Primary wire color"]')?.value,
  secondary: document.querySelector('[aria-label="Secondary wire color"]')?.value,
  preview: document.querySelector('.wire-color-preview [role="img"]')?.getAttribute('aria-label'),
  code: document.querySelector('.wire-color-preview code')?.textContent,
})`);

const canvasState = await evaluate(`({
  stripePaths: document.querySelectorAll('.connection-stripe').length,
  w1: document.querySelector('[data-testid="node-W1"] .row-swatch')?.style.background,
  w2: document.querySelector('[data-testid="node-W2"] .row-swatch')?.style.background,
  w3: document.querySelector('[data-testid="node-W3"] .row-swatch')?.style.background,
  w4: document.querySelector('[data-testid="node-W4"] .row-swatch')?.style.background,
  pairBadge: document.querySelector('[data-testid="node-W2"] .twisted-pair-badge')?.textContent.trim(),
})`);

await click('[data-testid="node-W1"]');
await evaluate(`(() => {
  const select = document.querySelector('[aria-label="Secondary wire color"]');
  select.value = 'WH';
  select.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await waitFor(
  () => evaluate('document.querySelector(\'.wire-color-preview code\')?.textContent === "BUWH"'),
  5_000,
  "solid-to-bicolor edit",
);
await click('[aria-label="Undo"]');
await waitFor(
  () => evaluate('document.querySelector(\'.wire-color-preview code\')?.textContent === "BU"'),
  5_000,
  "wire color undo",
);
await click('[aria-label="Redo"]');
await waitFor(
  () => evaluate('document.querySelector(\'.wire-color-preview code\')?.textContent === "BUWH"'),
  5_000,
  "wire color redo",
);
await click('[aria-label="Undo"]');

await click('[data-testid="node-W2"]');
await click('[aria-label="Copy selected components"]');
await click('[aria-label="Paste copied components"]');
const copiedWire = await waitFor(
  () => evaluate('document.querySelectorAll(".harness-node.node-wire").length === 5'),
  5_000,
  "copied wire",
);
await click('[aria-label="Undo"]');

await click('[data-testid="node-W2"]');
await clickByText('.library-actions button', 'Add selected');
await clickByText('.library-actions button', 'Manage');
const libraryState = await waitFor(
  () => evaluate(`(() => {
    const swatch = document.querySelector('.template-card .wire-color-swatch');
    return swatch ? {
      label: swatch.getAttribute('aria-label'),
      background: swatch.style.background,
      templateCount: document.querySelectorAll('.template-card').length,
    } : null;
  })()`),
  5_000,
  "library wire swatch",
);
await click('[aria-label="Close library manager"]');

const screenshot = await command("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: false,
});
await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

let count = [...downloads.values()].filter((download) => download.state === "completed" && download.filename.endsWith(".wireform.json")).length;
await click('[aria-label="Save WireForm project"]');
const projectDownload = await waitForDownload('.wireform.json', count);

count = [...downloads.values()].filter((download) => download.state === "completed" && download.filename.endsWith(".yml")).length;
await clickByText('.primary-button', 'Download YAML');
const yamlDownload = await waitForDownload('.yml', count);

count = [...downloads.values()].filter((download) => download.state === "completed" && download.filename.endsWith(".html")).length;
await click('[aria-label="Export HTML report"]');
const htmlDownload = await waitForDownload('.html', count);

count = [...downloads.values()].filter((download) => download.state === "completed" && download.filename.endsWith(".pdf")).length;
await click('[aria-label="Export PDF report"]');
const pdfDownload = await waitForDownload('.pdf', count);

const finalState = await evaluate(`({
  notice: document.querySelector('.notice')?.textContent?.trim() ?? '',
  issues: document.querySelector('.validation-summary')?.textContent?.trim() ?? '',
  pdfDisabled: document.querySelector('[aria-label="Export PDF report"]')?.disabled ?? false,
  externalResources: performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((url) => !url.startsWith(location.origin) && !url.startsWith('blob:') && !url.startsWith('data:')),
})`);

if (finalState.externalResources.length) {
  throw new Error(`External resources were requested: ${finalState.externalResources.join(", ")}`);
}

await command("Page.navigate", {
  url: pathToFileURL(join(downloadPath, htmlDownload.filename)).href,
});
await waitFor(
  () => evaluate('document.readyState === "complete" && !!document.querySelector("#cables")'),
  30_000,
  "offline HTML report",
);
const offlineHtmlState = await evaluate(`({
  title: document.title,
  hasInlineSvg: !!document.querySelector('#diagram svg'),
  colorText: [...document.querySelectorAll('.wire-color-value')]
    .map((element) => element.textContent.trim())
    .filter((value, index, values) => values.indexOf(value) === index),
  swatchBackgrounds: [...document.querySelectorAll('.wire-color-swatch')]
    .map((element) => getComputedStyle(element).backgroundImage || getComputedStyle(element).backgroundColor)
    .filter((value, index, values) => values.indexOf(value) === index),
  externalResources: performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((url) => !url.startsWith('file:') && !url.startsWith('data:') && !url.startsWith('blob:')),
})`);

if (!offlineHtmlState.hasInlineSvg || offlineHtmlState.externalResources.length) {
  throw new Error("The downloaded HTML report was not fully self-contained.");
}

socket.close();
process.stdout.write(
  JSON.stringify(
    {
      editorW2,
      editorW3,
      canvasState,
      copiedWire,
      libraryState,
      downloads: { projectDownload, yamlDownload, htmlDownload, pdfDownload },
      finalState,
      offlineHtmlState,
      consoleErrors,
      screenshotPath,
    },
    null,
    2,
  ),
);
