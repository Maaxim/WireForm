import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const endpoint = process.argv[2] ?? "http://127.0.0.1:9228";
const downloadPath = process.argv[3];
if (!downloadPath) {
  throw new Error("Usage: browser-termination-copy-smoke.mjs <cdp> <downloads>");
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

async function setTerminationField(rowIndex, section, label, value) {
  const changed = await evaluate(`(() => {
    const row = document.querySelectorAll('.termination-row')[${rowIndex}];
    if (!row) return false;
    row.open = true;
    const root = ${JSON.stringify(section)} === 'contact'
      ? row.querySelector('.termination-editor > .termination-part-editor')
      : ${JSON.stringify(section)} === 'seal'
        ? row.querySelector('.termination-seal .termination-part-editor')
        : row.querySelector('.termination-editor');
    if (${JSON.stringify(section)} === 'seal') row.querySelector('.termination-seal').open = true;
    const field = [...root.querySelectorAll('label.field')]
      .find((candidate) => candidate.firstElementChild?.textContent.trim().startsWith(${JSON.stringify(label)}));
    const input = field?.querySelector('input, textarea');
    if (!input) return false;
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
    descriptor.set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error(`Could not set row ${rowIndex + 1} ${label}.`);
}

async function terminationState() {
  return evaluate(`(() => [...document.querySelectorAll('.termination-row')].map((row) => {
    row.open = true;
    const value = (root, label) => {
      const field = [...root.querySelectorAll('label.field')]
        .find((candidate) => candidate.firstElementChild?.textContent.trim().startsWith(label));
      return field?.querySelector('input, textarea')?.value ?? '';
    };
    const contact = row.querySelector('.termination-editor > .termination-part-editor');
    const editor = row.querySelector('.termination-editor');
    return {
      manufacturer: value(contact, 'Manufacturer'),
      mpn: value(contact, 'Manufacturer P/N'),
      stripLength: value(editor, 'Strip length'),
      tooling: value(editor, 'Tooling / applicator'),
    };
  }))()`);
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

await command("Runtime.enable");
await command("Page.enable");
await command("Browser.setDownloadBehavior", {
  behavior: "allow",
  downloadPath,
  eventsEnabled: true,
});
await waitFor(
  () => evaluate('document.readyState === "complete" && document.querySelectorAll(".termination-row").length === 3'),
  30_000,
  "three connected pin terminations",
);
await new Promise((resolve) => setTimeout(resolve, 5_000));

await setTerminationField(0, "contact", "Manufacturer", "Molex");
await setTerminationField(0, "contact", "Manufacturer P/N", "0430300001");
await setTerminationField(0, "termination", "Strip length", "5.5 mm");
await setTerminationField(0, "termination", "Tooling / applicator", "Source tool");
await setTerminationField(1, "contact", "Manufacturer", "Old");
await setTerminationField(1, "contact", "Manufacturer P/N", "OLD-1");
await setTerminationField(1, "termination", "Strip length", "8 mm");
await setTerminationField(1, "termination", "Tooling / applicator", "Target tool");

const before = await terminationState();
await evaluate(`(() => {
  const row = document.querySelectorAll('.termination-row')[0];
  const button = [...row.querySelectorAll('button')]
    .find((candidate) => candidate.textContent.includes('Apply contact to connected pins'));
  button.click();
})()`);
const applied = await waitFor(async () => {
  const state = await terminationState();
  return state.every((row) => row.stripLength === "5.5 mm") ? state : undefined;
}, 5_000, "propagated strip lengths");

await click('[aria-label="Undo"]');
const undone = await waitFor(async () => {
  const state = await terminationState();
  return state[1]?.stripLength === "8 mm" && state[2]?.stripLength === ""
    ? state
    : undefined;
}, 5_000, "termination propagation undo");
await click('[aria-label="Redo"]');
const redone = await waitFor(async () => {
  const state = await terminationState();
  return state.every((row) => row.stripLength === "5.5 mm") ? state : undefined;
}, 5_000, "termination propagation redo");

await waitFor(
  () => evaluate('document.querySelector(".autosave-chip")?.textContent.includes("Saved locally")'),
  10_000,
  "autosave",
);
let count = [...downloads.values()].filter((item) => item.state === "completed" && item.filename.endsWith(".wireform.json")).length;
await click('[aria-label="Save WireForm project"]');
const projectDownload = await waitForDownload(".wireform.json", count);
count = [...downloads.values()].filter((item) => item.state === "completed" && item.filename.endsWith(".html")).length;
await click('[aria-label="Export HTML report"]');
const htmlDownload = await waitForDownload(".html", count);
count = [...downloads.values()].filter((item) => item.state === "completed" && item.filename.endsWith(".pdf")).length;
await click('[aria-label="Export PDF report"]');
const pdfDownload = await waitForDownload(".pdf", count);

await command("Page.navigate", { url: "http://127.0.0.1:4181" });
await waitFor(
  () => evaluate('document.readyState === "complete" && document.querySelectorAll(".termination-row").length === 3'),
  30_000,
  "autosaved harness reload",
);
const reloaded = await terminationState();

await command("Page.navigate", {
  url: pathToFileURL(join(downloadPath, htmlDownload.filename)).href,
});
await waitFor(
  () => evaluate('document.readyState === "complete" && !!document.querySelector("#terminations")'),
  30_000,
  "offline HTML report",
);
const htmlStripLengths = await evaluate(`
  [...document.querySelectorAll('#terminations td')]
    .map((cell) => cell.textContent.trim())
    .filter((value) => value === '5.5 mm').length
`);

socket.close();
process.stdout.write(JSON.stringify({
  before,
  applied,
  undone,
  redone,
  reloaded,
  htmlStripLengths,
  downloads: { projectDownload, htmlDownload, pdfDownload },
  consoleErrors,
}, null, 2));
