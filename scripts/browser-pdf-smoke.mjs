const endpoint = process.argv[2] ?? "http://127.0.0.1:9222";
const downloadPath = process.argv[3];
const mode = process.argv[4] ?? "ui";

if (!downloadPath) throw new Error("A download directory is required.");

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
let download;

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
    download = { guid: message.params.guid, filename: message.params.suggestedFilename };
  }
  if (
    message.method === "Browser.downloadProgress" &&
    download?.guid === message.params.guid
  ) {
    download.state = message.params.state;
    download.bytes = message.params.receivedBytes;
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
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text,
    );
  }
  return result.result.value;
}

async function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

await command("Runtime.enable");
await command("Page.enable");
await command("Browser.setDownloadBehavior", {
  behavior: "allow",
  downloadPath,
  eventsEnabled: true,
});

await waitFor(
  () => evaluate('document.querySelector(\'[aria-label="Export PDF report"]\') && document.readyState === "complete"'),
  30_000,
  "WireForm PDF action",
);
await new Promise((resolve) => setTimeout(resolve, 5_000));

const initialState = await evaluate(`({
  title: document.title,
  buttonDisabled: document.querySelector('[aria-label="Export PDF report"]').disabled,
  notice: document.querySelector('.notice')?.textContent?.trim() ?? '',
  issues: document.querySelector('.validation-summary')?.textContent?.trim() ?? ''
})`);

if (initialState.buttonDisabled) throw new Error("PDF export action is disabled.");
if (mode === "large") {
  await evaluate(`(async () => {
    const model = await import('/app/model.ts');
    const reportModule = await import('/app/html-report.ts');
    const pdfModule = await import('/app/pdf-report.ts');
    const project = model.createEmptyProject('Production Prüfstand µ Ω Harness');
    project.revision = 'D';
    project.company = 'Müller & Söhne';
    project.notes = 'Assembly notes\\n\\n- Verify ±0.2 mm strip tolerance.\\n- Torque shield clamp to 2 N·m.\\n- Keep twisted pairs away from 48 V wiring.';
    const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const connectors = Array.from({ length: 6 }, (_, index) => {
      const connector = model.makeComponent('connector', index + 1, 'fixture-x' + (index + 1));
      connector.designator = 'X' + (index + 1);
      connector.name = 'Production connector ' + (index + 1);
      connector.pinCount = 4;
      connector.pinLabels = ['SIG_A', 'SIG_B', 'SIG_C', 'SIG_D'];
      connector.manufacturer = 'Molex';
      connector.mpn = 'HOUSING-' + (index + 1);
      connector.notes = 'Inspect keying and latch before mating.';
      connector.photo = { dataUrl: pixel, fileName: 'connector.png', mimeType: 'image/png', width: 1, height: 1, alt: index === 0 ? 'Panel-side receptacle, keyed version\\nAußenmontage – 90° / µ-version' : connector.designator + ' connector image' };
      connector.approvedAlternatives = [{ id: 'alt-x-' + index, manufacturer: 'TE Connectivity', mpn: 'ALT-HOUSING-' + (index + 1), note: 'Approved substitute' }];
      connector.additionalComponents = [{ id: 'acc-x-' + index, type: 'Secondary Lock / TPA', manufacturer: 'Molex', mpn: '5051520400', qty: 1, unit: 'pcs' }];
      return connector;
    });
    const wires = Array.from({ length: 12 }, (_, index) => {
      const wire = model.makeComponent('wire', index + 1, 'fixture-w' + (index + 1));
      wire.designator = 'W' + (index + 1);
      wire.name = 'Signal wire ' + (index + 1);
      wire.wireCount = 1;
      wire.wireLabels = ['SIGNAL_' + (index + 1)];
      wire.colors = [index % 2 ? 'BU' : 'WH'];
      wire.gauge = '24 AWG';
      wire.length = (0.3 + index / 100).toFixed(2) + ' m';
      wire.manufacturer = 'Alpha Wire';
      wire.mpn = 'WIRE-' + (index + 1);
      wire.approvedAlternatives = [{ id: 'alt-w-' + index, manufacturer: 'Wire GmbH', mpn: 'ALT-W-' + (index + 1), note: 'Same gauge and insulation' }];
      wire.additionalComponents = [{ id: 'acc-w-' + index, type: 'Wire label', manufacturer: 'Brady', mpn: 'B-342', qty: 1, qtyMultiplier: 'terminations', unit: 'pcs', placement: { scope: 'termination', end: 'both' } }];
      return wire;
    });
    const cable = model.makeComponent('cable', 1, 'fixture-cable');
    cable.designator = 'C1';
    cable.name = '12-core auxiliary cable';
    cable.wireCount = 12;
    cable.wireLabels = Array.from({ length: 12 }, (_, index) => 'AUX_' + (index + 1));
    cable.colors = Array.from({ length: 12 }, (_, index) => index % 2 ? 'BK' : 'RD');
    cable.manufacturer = 'LAPP';
    cable.mpn = 'UNITRONIC-12';
    cable.length = '2.4 m';
    cable.approvedAlternatives = [{ id: 'alt-cable', manufacturer: 'Helukabel', mpn: 'HELUKABEL-12', note: 'Equivalent flex rating' }];
    cable.additionalComponents = [
      { id: 'heatshrink', type: 'Heat shrink', manufacturer: 'TE', mpn: 'HS-30', qty: 2, unit: 'pcs', placement: { scope: 'cable', end: 'both', pieceLengthMm: 30 } },
      { id: 'ferrite', type: 'Ferrite', manufacturer: 'TDK', mpn: 'ZCAT2035-0930', qty: 1, unit: 'pcs', placement: { scope: 'cable', end: 'from', offsetMm: 30 } }
    ];
    project.components = [...connectors, ...wires, cable];
    project.links = wires.flatMap((wire, index) => {
      const source = connectors[Math.floor(index / 4)];
      const target = connectors[3 + Math.floor(index / 4)];
      const pin = index % 4 + 1;
      return [
        { id: 'from-' + index, from: { nodeId: source.id, portId: 'pin:' + pin, side: 'right' }, to: { nodeId: wire.id, portId: 'wire:1', side: 'left' }, termination: { contact: { manufacturer: 'TE', mpn: 'CONTACT-' + (index % 3 + 1) }, seal: { manufacturer: 'TE', mpn: 'SEAL-' + (index % 2 + 1) }, stripLength: '5 mm', tooling: 'Applicator ' + (index % 3 + 1), notes: 'Inspect crimp height' } },
        { id: 'to-' + index, from: { nodeId: wire.id, portId: 'wire:1', side: 'right' }, to: { nodeId: target.id, portId: 'pin:' + pin, side: 'left' }, termination: { contact: { manufacturer: 'TE', mpn: 'CONTACT-' + (index % 3 + 1) }, seal: { manufacturer: 'TE', mpn: 'SEAL-' + (index % 2 + 1) }, stripLength: '5 mm', tooling: 'Hand tool ' + (index % 3 + 1) } }
      ];
    });
    project.twistedPairs = Array.from({ length: 6 }, (_, index) => ({ id: 'tp-' + (index + 1), designator: 'TP' + (index + 1), members: [wires[index * 2].id, wires[index * 2 + 1].id], twistPitchMm: 25 + index, twistDirection: index % 2 ? 'S' : 'Z', note: 'Differential pair ' + (index + 1) }));
    const svg = '<svg width="1000pt" height="360pt" viewBox="0 0 1000 360" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="996" height="356" fill="white" stroke="#17212b"/><text x="500" y="45" text-anchor="middle" font-family="Roboto" font-size="24">Production Harness µ Ω ± ×</text>' + wires.map((wire, index) => '<line x1="100" y1="' + (75 + index * 20) + '" x2="900" y2="' + (75 + index * 20) + '" stroke="' + (index % 2 ? '#2574a9' : '#1f6f78') + '" stroke-width="2"/><text x="70" y="' + (79 + index * 20) + '" font-size="11">' + wire.designator + '</text>').join('') + '</svg>';
    const report = reportModule.buildHarnessReportModel(project, svg);
    const html = reportModule.renderHarnessReportHtml(report);
    window.__wireformAlternativeTextHtml = {
      firstConnectorAlternativeText: report.connectors[0].photo.alt,
      containsFirstLine: html.includes('Panel-side receptacle, keyed version'),
      containsUnicodeLine: html.includes('Außenmontage – 90° / µ-version'),
    };
    return pdfModule.downloadHarnessPdf(report, 'production-prufstand-large.pdf');
  })()`);
} else {
  await evaluate('document.querySelector(\'[aria-label="Export PDF report"]\').click()');
}

await waitFor(
  () => download?.state === "completed" && download,
  210_000,
  "PDF download",
);

const finalState = await evaluate(`({
  notice: document.querySelector('.notice')?.textContent?.trim() ?? '',
  buttonDisabled: document.querySelector('[aria-label="Export PDF report"]').disabled,
  externalResources: performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((url) => !url.startsWith(location.origin) && !url.startsWith('blob:') && !url.startsWith('data:')),
  alternativeTextHtml: window.__wireformAlternativeTextHtml ?? null
})`);

if (finalState.externalResources.length) {
  throw new Error(`External resources were requested: ${finalState.externalResources.join(", ")}`);
}

socket.close();
process.stdout.write(
  JSON.stringify({ initialState, finalState, download, consoleErrors }, null, 2),
);
