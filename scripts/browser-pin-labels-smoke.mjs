import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const endpoint = process.argv[2] ?? "http://127.0.0.1:9231";
const downloadPath = process.argv[3];
const fixturePath = process.argv[4];
if (!downloadPath || !fixturePath) {
  throw new Error(
    "Usage: browser-pin-labels-smoke.mjs <cdp endpoint> <downloads> <fixture>",
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
const downloads = new Map();
const consoleErrors = [];
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

async function setLabel(pin, value) {
  const changed = await evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(`[aria-label="Pin ${pin} label"]`)});
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error(`Could not edit pin ${pin}.`);
}

async function labels() {
  return evaluate(`
    [...document.querySelectorAll('.pin-label-table input')].map((input) => input.value)
  `);
}

async function waitForDownload(suffix, previousCount, timeoutMs = 210_000) {
  return waitFor(
    () => {
      const complete = [...downloads.values()].filter(
        (item) => item.state === "completed" && item.filename.endsWith(suffix),
      );
      return complete.length > previousCount ? complete.at(-1) : undefined;
    },
    timeoutMs,
    `${suffix} download`,
  );
}

async function download(selector, suffix) {
  const before = [...downloads.values()].filter(
    (item) => item.state === "completed" && item.filename.endsWith(suffix),
  ).length;
  await click(selector);
  return waitForDownload(suffix, before);
}

await command("Runtime.enable");
await command("Page.enable");
await command("DOM.enable");
await command("Browser.setDownloadBehavior", {
  behavior: "allow",
  downloadPath,
  eventsEnabled: true,
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
  () => evaluate('!!document.querySelector(\'[data-testid="node-X1"]\')'),
  30_000,
  "pin-label fixture",
);
await click('[data-testid="node-X1"]');
await waitFor(() => evaluate('document.querySelectorAll(".pin-label-table input").length === 4'), 5_000, "pin label editor");

const initial = {
  labels: await labels(),
  canvasRows: await evaluate(`
    [...document.querySelectorAll('[data-testid="node-X1"] .row-label')]
      .map((item) => item.textContent.trim())
  `),
  tooltips: await evaluate(`
    [...document.querySelectorAll('[data-testid="node-X1"] .node-row')]
      .map((item) => item.title)
  `),
  terminationRows: await evaluate('document.querySelectorAll(".termination-row").length'),
};

await setLabel(3, " B01 ");
await waitFor(async () => (await labels())[2] === "B01", 5_000, "trimmed B01 label");
const editedTooltip = await evaluate(
  'document.querySelectorAll(\'[data-testid="node-X1"] .node-row\')[2].title',
);
await click('[aria-label="Undo"]');
const undoLabels = await waitFor(async () => ((await labels())[2] === "B1" ? labels() : undefined), 5_000, "pin label undo");
await new Promise((resolve) => setTimeout(resolve, 300));
await click('[aria-label="Redo"]');
const redoLabels = await waitFor(async () => ((await labels())[2] === "B01" ? labels() : undefined), 5_000, "pin label redo");

await setLabel(4, "B01");
const duplicateWarning = await waitFor(
  () => evaluate(`
    [...document.querySelectorAll('.topology-issues li')]
      .map((item) => item.textContent.trim())
      .find((text) => text.includes('pin label "B01" is assigned to pins 3 and 4'))
  `),
  5_000,
  "duplicate pin-label warning",
);
await click('[aria-label="Undo"]');
await waitFor(async () => (await labels())[3] === "B2", 5_000, "duplicate warning undo");

await clickByText('.library-actions button', 'Add selected');
await clickByText('.library-actions button', 'Manage');
const libraryTemplateCount = await waitFor(
  () => evaluate('document.querySelectorAll(".template-card").length'),
  5_000,
  "connector library template",
);
await click('.template-card:last-of-type .template-add');
const libraryInsertedLabels = await waitFor(
  async () => {
    const values = await labels();
    return values[2] === "B01" ? values : undefined;
  },
  5_000,
  "library-inserted pin labels",
);
await click('[aria-label="Undo"]');
await click('[data-testid="node-X1"]');

await click('[aria-label="Copy selected components"]');
await click('[aria-label="Paste copied components"]');
const copiedLabels = await waitFor(
  async () => {
    const values = await labels();
    return values[2] === "B01" ? values : undefined;
  },
  5_000,
  "copied connector pin labels",
);
await click('[aria-label="Undo"]');
await click('[data-testid="node-X1"]');

await setLabel(2, "");
const partialLabels = await waitFor(async () => ((await labels())[1] === "" ? labels() : undefined), 5_000, "partial labels");
await waitFor(
  () => evaluate('document.querySelector(".autosave-chip")?.textContent.includes("Saved locally")'),
  10_000,
  "autosave",
);

const projectDownload = await download('[aria-label="Save WireForm project"]', ".wireform.json");
const bomDownload = await download('[aria-label="Export BOM CSV"]', ".bom.csv");
const yamlDownload = await download('button.primary-button', ".yml");
const htmlDownload = await download('[aria-label="Export HTML report"]', ".html");
const pdfDownload = await download('[aria-label="Export PDF report"]', ".pdf");

const saved = JSON.parse(await readFile(join(downloadPath, projectDownload.filename), "utf8"));
const original = JSON.parse(await readFile(fixturePath, "utf8"));
const savedX1 = saved.project.components.find((item) => item.id === "connector-x1");
const bomCsv = await readFile(join(downloadPath, bomDownload.filename), "utf8");
const yaml = await readFile(join(downloadPath, yamlDownload.filename), "utf8");

await command("Page.navigate", { url: "http://127.0.0.1:4181" });
await waitFor(
  () => evaluate('document.readyState === "complete" && !!document.querySelector(\'[data-testid="node-X1"]\')'),
  30_000,
  "autosaved project reload",
);
await click('[data-testid="node-X1"]');
const reloadedLabels = await waitFor(async () => ((await labels())[2] === "B01" ? labels() : undefined), 5_000, "autosaved pin labels");

await command("Page.navigate", {
  url: pathToFileURL(join(downloadPath, htmlDownload.filename)).href,
});
await waitFor(
  () => evaluate('document.readyState === "complete" && !!document.querySelector("#connectors")'),
  30_000,
  "offline HTML report",
);
const htmlState = await evaluate(`({
  hasPinHeader: [...document.querySelectorAll('#connectors th')].some((item) => item.textContent.trim() === 'Pin'),
  hasLabelHeader: [...document.querySelectorAll('#connectors th')].some((item) => item.textContent.trim() === 'Label'),
  containsB01: document.querySelector('#connectors').textContent.includes('B01'),
  containsStrip: document.querySelector('#terminations').textContent.includes('6 mm'),
})`);

socket.close();
process.stdout.write(
  JSON.stringify(
    {
      initial,
      editedTooltip,
      undoLabels,
      redoLabels,
      duplicateWarning,
      libraryTemplateCount,
      libraryInsertedLabels,
      copiedLabels,
      partialLabels,
      savedPinLabels: savedX1.pinLabels,
      linksUnchanged: JSON.stringify(saved.project.links) === JSON.stringify(original.project.links),
      bomHasExpectedHousing: bomCsv.includes("SOURCE-4"),
      bomContainsNoDisplayLabel: !bomCsv.includes("B01"),
      yamlHasPositionalLabels: /pinlabels:\s*\n(?:\s*-.*\n){4}/.test(yaml),
      yamlHasNumericConnection: /X1:\s*3/.test(yaml),
      reloadedLabels,
      htmlState,
      downloads: { projectDownload, bomDownload, yamlDownload, htmlDownload, pdfDownload },
      consoleErrors,
    },
    null,
    2,
  ),
);
