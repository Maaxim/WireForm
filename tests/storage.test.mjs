import assert from "node:assert/strict";
import test from "node:test";
import { AUTOSAVE_KEY, readLocalDocument, writeLocalDocument } from "../app/storage.ts";
import { createEmptyProject, normalizeProject, parseProjectFile, serializeProjectFile } from "../app/model.ts";
import { prepareProjectAttachment } from "../app/project-files.ts";

function storageEnvironment() {
  const previousDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const previousLocal = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const records = new Map();
  const fallback = new Map();
  const options = { abortNext: 0, failOpen: false, localQuota: false };
  const puts = [];
  const database = {
    objectStoreNames: { contains: () => true },
    close() {},
    transaction() {
      const transaction = {
        error: null,
        objectStore: () => ({
          get(key) {
            const request = {};
            queueMicrotask(() => { request.result = records.get(key); request.onsuccess?.(); });
            return request;
          },
          put(value, key) {
            puts.push(value);
            queueMicrotask(() => {
              if (options.abortNext) {
                options.abortNext -= 1;
                transaction.error = new DOMException("Storage quota exceeded", "QuotaExceededError");
                transaction.onabort?.();
              } else {
                records.set(key, structuredClone(value));
                transaction.oncomplete?.();
              }
            });
          },
        }),
      };
      return transaction;
    },
  };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: {
    open() {
      const request = {};
      queueMicrotask(() => {
        if (options.failOpen) { request.error = new Error("IndexedDB unavailable"); request.onerror?.(); }
        else { request.result = database; request.onsuccess?.(); }
      });
      return request;
    },
  } });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key) => fallback.get(key) ?? null,
    removeItem: (key) => fallback.delete(key),
    setItem(key, value) {
      if (options.localQuota) throw new DOMException("localStorage full", "QuotaExceededError");
      fallback.set(key, value);
    },
  } });
  return { records, fallback, options, puts, restore() {
    if (previousDb) Object.defineProperty(globalThis, "indexedDB", previousDb);
    else delete globalThis.indexedDB;
    if (previousLocal) Object.defineProperty(globalThis, "localStorage", previousLocal);
    else delete globalThis.localStorage;
  } };
}

test("IndexedDB autosave round-trips the attachment-bearing model without a duplicate localStorage copy", async () => {
  const environment = storageEnvironment();
  try {
    const project = createEmptyProject();
    project.attachments = [await prepareProjectAttachment(new File([new Uint8Array([0, 255, 12])], "exact.bin"))];
    environment.fallback.set(`wireform:${AUTOSAVE_KEY}`, "stale");
    await writeLocalDocument(AUTOSAVE_KEY, project, { indexedDbOnly: true });
    assert.deepEqual(normalizeProject(await readLocalDocument(AUTOSAVE_KEY)).project.attachments, project.attachments);
    assert.equal(environment.fallback.has(`wireform:${AUTOSAVE_KEY}`), false);
    assert.equal(typeof environment.records.get(AUTOSAVE_KEY), "object");
  } finally { environment.restore(); }
});

test("attachment quota failure rejects, preserves the prior autosave, and does not spill Base64 to localStorage", async () => {
  const environment = storageEnvironment();
  try {
    const old = { title: "Previous good save" };
    environment.records.set(AUTOSAVE_KEY, old);
    environment.options.abortNext = 1;
    const project = createEmptyProject();
    project.attachments = [await prepareProjectAttachment(new File(["data"], "reference.txt"))];
    await assert.rejects(writeLocalDocument(AUTOSAVE_KEY, project, { indexedDbOnly: true }), /quota/);
    assert.deepEqual(environment.records.get(AUTOSAVE_KEY), old);
    assert.equal(environment.fallback.size, 0);
    assert.equal(project.attachments[0].data, btoa("data"));
  } finally { environment.restore(); }
});

test("older string autosaves and small-project localStorage fallback remain recoverable", async () => {
  const environment = storageEnvironment();
  try {
    const project = createEmptyProject("Legacy saved project");
    const legacy = serializeProjectFile(project);
    environment.records.set(AUTOSAVE_KEY, legacy);
    assert.equal(parseProjectFile(await readLocalDocument(AUTOSAVE_KEY)).project.title, project.title);
    environment.records.clear();
    environment.options.failOpen = true;
    await writeLocalDocument(AUTOSAVE_KEY, legacy);
    assert.equal(await readLocalDocument(AUTOSAVE_KEY), legacy);
    environment.options.failOpen = false;
    assert.equal(await readLocalDocument(AUTOSAVE_KEY), legacy);
    environment.options.failOpen = true;
    environment.options.localQuota = true;
    await assert.rejects(writeLocalDocument(AUTOSAVE_KEY, legacy), /localStorage full/);
  } finally { environment.restore(); }
});

test("writes retain order and a failed transaction does not prevent the next good save", async () => {
  const environment = storageEnvironment();
  try {
    environment.options.abortNext = 1;
    const first = writeLocalDocument(AUTOSAVE_KEY, { title: "First" }, { indexedDbOnly: true });
    const second = writeLocalDocument(AUTOSAVE_KEY, { title: "Second" }, { indexedDbOnly: true });
    const third = writeLocalDocument(AUTOSAVE_KEY, { title: "Third" }, { indexedDbOnly: true });
    const outcomes = await Promise.allSettled([first, second, third]);
    assert.equal(outcomes[0].status, "rejected");
    assert.equal(outcomes[1].status, "fulfilled");
    assert.equal(outcomes[2].status, "fulfilled");
    assert.deepEqual(environment.puts.map((record) => record.title), ["First", "Second", "Third"]);
    assert.equal((await readLocalDocument(AUTOSAVE_KEY)).title, "Third");
  } finally { environment.restore(); }
});

test("a failed recovery read is reported rather than mistaken for an empty project", async () => {
  const environment = storageEnvironment();
  try {
    environment.options.failOpen = true;
    await assert.rejects(readLocalDocument(AUTOSAVE_KEY), /IndexedDB unavailable/);
    environment.options.failOpen = false;
    environment.fallback.set(`wireform:${AUTOSAVE_KEY}`, "{corrupt json");
    await assert.rejects(readLocalDocument(AUTOSAVE_KEY), /JSON/);
    assert.equal(environment.fallback.get(`wireform:${AUTOSAVE_KEY}`), "{corrupt json");
  } finally { environment.restore(); }
});

test("a newer small-project fallback is restored before an older IndexedDB record", async () => {
  const environment = storageEnvironment();
  try {
    environment.records.set(AUTOSAVE_KEY, { title: "Old IndexedDB save" });
    environment.options.abortNext = 1;
    await writeLocalDocument(AUTOSAVE_KEY, { title: "New fallback save" });
    assert.equal((await readLocalDocument(AUTOSAVE_KEY)).title, "New fallback save");
    await writeLocalDocument(AUTOSAVE_KEY, { title: "Recovered IndexedDB save" });
    assert.equal((await readLocalDocument(AUTOSAVE_KEY)).title, "Recovered IndexedDB save");
    assert.equal(environment.fallback.size, 0);
  } finally { environment.restore(); }
});
