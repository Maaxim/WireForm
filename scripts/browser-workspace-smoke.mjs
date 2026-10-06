const endpoint = process.argv[2] ?? "http://127.0.0.1:9233";
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
      result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
    );
  }
  return result.result.value;
}

async function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function drag(selector, dx, dy) {
  const start = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + Math.min(10, rect.height / 2) };
  })()`);
  if (!start) throw new Error(`Drag target not found: ${selector}`);
  await command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: start.x,
    y: start.y,
  });
  await command("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: start.x,
    y: start.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  for (let step = 1; step <= 12; step += 1) {
    await command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: start.x + (dx * step) / 12,
      y: start.y + (dy * step) / 12,
      button: "left",
      buttons: 1,
    });
  }
  await command("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: start.x + dx,
    y: start.y + dy,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}

async function state() {
  return evaluate(`(() => {
    const canvas = document.querySelector('.canvas');
    const viewport = document.querySelector('.canvas-scroll');
    const bounds = {
      minX: Number(canvas.dataset.workspaceMinX),
      minY: Number(canvas.dataset.workspaceMinY),
      maxX: Number(canvas.dataset.workspaceMaxX),
      maxY: Number(canvas.dataset.workspaceMaxY),
    };
    const node = (selector) => {
      const element = document.querySelector(selector);
      return {
        x: parseFloat(element.style.left) + bounds.minX,
        y: parseFloat(element.style.top) + bounds.minY,
        rect: element.getBoundingClientRect().toJSON(),
      };
    };
    return {
      bounds,
      zoom: document.querySelector('.zoom-value')?.textContent.trim(),
      viewport: {
        clientWidth: viewport.clientWidth,
        clientHeight: viewport.clientHeight,
        scrollWidth: viewport.scrollWidth,
        scrollHeight: viewport.scrollHeight,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      },
      j1: node('[data-testid="node-J1"]'),
      j2: node('[data-testid="node-J2"]'),
      w1: node('[data-testid="node-W1"]'),
      linkWidth: Number(document.querySelector('.link-layer')?.getAttribute('width')),
      linkHeight: Number(document.querySelector('.link-layer')?.getAttribute('height')),
    };
  })()`);
}

await command("Runtime.enable");
await command("Page.enable");
await waitFor(
  () =>
    evaluate(
      'document.readyState === "complete" && !!document.querySelector(\'[data-testid="node-J1"]\')',
    ),
  30_000,
  "WireForm starter project",
);

for (let index = 0; index < 7; index += 1) {
  await evaluate('document.querySelector(\'[aria-label="Zoom out"]\').click()');
}
await waitFor(
  () => evaluate('document.querySelector(".zoom-value")?.textContent.trim() === "25%"'),
  5_000,
  "25% zoom",
);
const initial = await state();

await drag('[data-testid="node-J2"] .node-header', 700, 80);
const movedRight = await waitFor(async () => {
  const current = await state();
  return current.j2.x > 3000 ? current : undefined;
}, 10_000, "right workspace expansion");

await evaluate('document.querySelector(\'[aria-label="Zoom to fit harness"]\').click()');
await new Promise((resolve) => setTimeout(resolve, 300));
const fitted = await state();

await drag('[data-testid="node-J1"] .node-header', -180, -60);
const movedLeft = await waitFor(async () => {
  const current = await state();
  return current.j1.x < 0 && current.j1.y < 0 ? current : undefined;
}, 10_000, "left/top workspace expansion");

await evaluate('document.querySelector(\'[aria-label="Undo"]\').click()');
const undone = await waitFor(async () => {
  const current = await state();
  return current.j1.x >= 0 ? current : undefined;
}, 5_000, "movement undo");
await evaluate('document.querySelector(\'[aria-label="Redo"]\').click()');
const redone = await waitFor(async () => {
  const current = await state();
  return current.j1.x < 0 ? current : undefined;
}, 5_000, "movement redo");

await evaluate('document.querySelector(".canvas-scroll").scrollLeft = 0');
await evaluate(`document.querySelector('[data-testid="node-W1"]')
  .dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))`);
await waitFor(
  () => evaluate('document.querySelectorAll(".harness-node.selected").length === 2'),
  5_000,
  "two-node selection",
);
const beforeGroupMove = await state();
await drag('[data-testid="node-J1"] .node-header', 0, 350);
await new Promise((resolve) => setTimeout(resolve, 500));
const movedGroup = await state();

if (movedRight.bounds.maxX <= initial.bounds.maxX) {
  throw new Error("Workspace did not expand to the right.");
}
if (movedLeft.bounds.minX >= fitted.bounds.minX) {
  throw new Error("Workspace did not expand to the left.");
}
if (movedRight.linkWidth !== movedRight.bounds.maxX - movedRight.bounds.minX) {
  throw new Error("Link layer width does not match dynamic workspace.");
}
if (movedLeft.viewport.scrollWidth <= movedLeft.viewport.clientWidth) {
  throw new Error("Expanded workspace is not pannable.");
}
const j1GroupDelta = movedGroup.j1.y - beforeGroupMove.j1.y;
const w1GroupDelta = movedGroup.w1.y - beforeGroupMove.w1.y;
if (j1GroupDelta < 1000 || w1GroupDelta < 1000) {
  throw new Error(
    `Multi-selection did not move beyond the old bottom boundary: ${JSON.stringify({
      beforeGroupMove,
      movedGroup,
    })}`,
  );
}
if (Math.abs(j1GroupDelta - w1GroupDelta) > 0.01) {
  throw new Error("Multi-selection members did not retain a common world delta.");
}
if (movedGroup.bounds.maxY <= beforeGroupMove.bounds.maxY) {
  throw new Error("Workspace did not expand for the multi-selection move.");
}
if (consoleErrors.length) {
  throw new Error(`Browser console errors: ${consoleErrors.join(" | ")}`);
}

process.stdout.write(
  `${JSON.stringify({
    initial,
    movedRight,
    fitted,
    movedLeft,
    undone,
    redone,
    beforeGroupMove,
    movedGroup,
  }, null, 2)}\n`,
);
socket.close();
