import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
  cloneProject,
  createConductorId,
  createConductorUuidMap,
  createEmptyProject,
  isUuidV4,
  makeComponent,
  normalizeProject,
  parseProjectFile,
  repairProjectConductorUuids,
  serializeProjectFile,
  validateProjectConductorUuids,
} from "../app/model.ts";
import {
  componentToTemplate,
  instantiateTemplate,
} from "../app/library.ts";
import {
  buildOnshapeCableWireExport,
  serializeOnshapeCableWireCsv,
} from "../app/onshape-export.ts";

function uuidList(component) {
  return component.conductorIds.map((id) => component.conductorUuids[id]);
}

function connectedProject(kind, count) {
  const project = createEmptyProject("Conductor UUID fixture");
  const left = makeComponent("connector", 1, "j1");
  const right = makeComponent("connector", 2, "j2");
  left.designator = "J1";
  right.designator = "J2";
  left.pinCount = right.pinCount = count;
  const conductor = makeComponent(kind, 1, `${kind}-1`);
  conductor.designator = kind === "bundle" ? "B1" : kind === "cable" ? "C1" : "W1";
  conductor.wireCount = count;
  conductor.conductorIds = Array.from({ length: count }, (_, index) => `${conductor.id}-c${index + 1}`);
  conductor.conductorUuids = createConductorUuidMap(conductor.conductorIds);
  conductor.colors = Array.from({ length: count }, () => "BK");
  conductor.wireLabels = Array.from({ length: count }, () => "");
  conductor.gauge = "18 AWG";
  project.components.push(left, conductor, right);
  for (let index = 0; index < count; index += 1) {
    const number = index + 1;
    project.links.push(
      {
        id: `left-${number}`,
        from: { nodeId: left.id, portId: `pin:${number}`, side: "right" },
        to: { nodeId: conductor.id, portId: `wire:${number}`, side: "left" },
      },
      {
        id: `right-${number}`,
        from: { nodeId: conductor.id, portId: `wire:${number}`, side: "right" },
        to: { nodeId: right.id, portId: `pin:${number}`, side: "left" },
      },
    );
  }
  return { project, conductor, left, right };
}

test("new standalone, bundle, and multicore conductors receive unique UUID v4 identities", () => {
  const all = [];
  for (const [kind, count] of [["wire", 1], ["bundle", 3], ["cable", 4]]) {
    const component = makeComponent(kind, 1, kind);
    component.wireCount = count;
    component.conductorIds = Array.from({ length: count }, () => createConductorId());
    component.conductorUuids = createConductorUuidMap(component.conductorIds, new Set(all));
    const uuids = uuidList(component);
    assert.ok(uuids.every(isUuidV4));
    assert.ok(uuids.every((uuid) => uuid.length === 36));
    assert.ok(uuids.every((uuid) =>
      !uuid.includes("WF-") &&
      !uuid.includes("conductor") &&
      !uuid.includes(kind),
    ));
    all.push(...uuids);
  }
  assert.equal(new Set(all).size, all.length);
});

test("UUIDs survive edits, rerouting, reordering, repeated export, save/load, and whole-project clones", () => {
  const { project, conductor, left, right } = connectedProject("bundle", 3);
  const original = new Map(conductor.conductorIds.map((id) => [id, conductor.conductorUuids[id]]));
  const firstCsv = serializeOnshapeCableWireCsv(buildOnshapeCableWireExport(project).rows);

  conductor.colors[0] = "RD";
  conductor.gauge = "20 AWG";
  conductor.insulationThicknessMm = 0.4826;
  conductor.length = "2 m";
  conductor.notes = "Edited";
  left.mpn = "LEFT-NEW";
  right.mpn = "RIGHT-NEW";
  project.links[0].from.portId = "pin:3";
  conductor.conductorIds.reverse();
  conductor.colors.reverse();
  conductor.wireLabels.reverse();

  for (const id of conductor.conductorIds) assert.equal(conductor.conductorUuids[id], original.get(id));
  const repeated = buildOnshapeCableWireExport(project);
  assert.deepEqual(new Set(repeated.rows.map((row) => row.wireId)), new Set(original.values()));
  assert.equal(
    serializeOnshapeCableWireCsv(repeated.rows),
    serializeOnshapeCableWireCsv(buildOnshapeCableWireExport(project).rows),
  );
  assert.notEqual(serializeOnshapeCableWireCsv(repeated.rows), firstCsv, "edited non-ID columns may change");

  const reopened = parseProjectFile(serializeProjectFile(project)).project;
  const cloned = cloneProject(project);
  const saveAs = parseProjectFile(serializeProjectFile(cloned)).project;
  assert.deepEqual(uuidList(reopened.components.find((item) => item.id === conductor.id)), uuidList(conductor));
  assert.deepEqual(uuidList(cloned.components.find((item) => item.id === conductor.id)), uuidList(conductor));
  assert.deepEqual(uuidList(saveAs.components.find((item) => item.id === conductor.id)), uuidList(conductor));
});

test("library templates omit instance UUIDs and every instantiation gets fresh identities", () => {
  for (const kind of ["wire", "bundle", "cable"]) {
    const source = makeComponent(kind, 1, `${kind}-source`);
    const sourceUuids = uuidList(source);
    const template = componentToTemplate(source, `${kind} template`);
    assert.equal(Object.hasOwn(template.component, "conductorUuids"), false);
    const first = instantiateTemplate(template, 2);
    const second = instantiateTemplate(template, 3);
    assert.ok(uuidList(first).every(isUuidV4));
    assert.ok(uuidList(second).every(isUuidV4));
    assert.equal(new Set([...sourceUuids, ...uuidList(first), ...uuidList(second)]).size, sourceUuids.length * 3);
  }
});

test("adding and deleting conductors changes only the affected identities", () => {
  const component = makeComponent("bundle", 1, "bundle");
  const before = new Map(component.conductorIds.map((id) => [id, component.conductorUuids[id]]));
  const addedId = createConductorId();
  component.conductorIds.push(addedId);
  component.wireCount += 1;
  component.conductorUuids = {
    ...component.conductorUuids,
    ...createConductorUuidMap([addedId], new Set(uuidList(component).filter(Boolean))),
  };
  assert.ok(isUuidV4(component.conductorUuids[addedId]));
  for (const [id, uuid] of before) assert.equal(component.conductorUuids[id], uuid);

  const removedId = component.conductorIds[1];
  component.conductorIds.splice(1, 1);
  component.wireCount -= 1;
  repairProjectConductorUuids({ ...createEmptyProject(), components: [component] });
  assert.equal(component.conductorUuids[removedId], undefined);
  for (const [id, uuid] of before) {
    if (id !== removedId) assert.equal(component.conductorUuids[id], uuid);
  }
});

test("legacy missing, invalid, and duplicate UUID data is repaired once and persists", () => {
  const { project, conductor } = connectedProject("cable", 4);
  const ids = [...conductor.conductorIds];
  const preserved = conductor.conductorUuids[ids[0]];
  delete conductor.conductorUuids[ids[1]];
  conductor.conductorUuids[ids[2]] = "not-a-uuid";
  conductor.conductorUuids[ids[3]] = preserved;
  project.schemaVersion = 4;

  const migrated = normalizeProject(project);
  const repaired = migrated.project.components.find((item) => item.id === conductor.id);
  assert.equal(migrated.migratedFrom, 4);
  assert.equal(migrated.repairedConductorUuids, 3);
  assert.equal(repaired.conductorUuids[ids[0]], preserved);
  assert.equal(validateProjectConductorUuids(migrated.project).length, 0);
  assert.equal(new Set(uuidList(repaired)).size, 4);

  const reopened = parseProjectFile(serializeProjectFile(migrated.project));
  assert.equal(reopened.repairedConductorUuids, undefined);
  assert.deepEqual(uuidList(reopened.project.components.find((item) => item.id === conductor.id)), uuidList(repaired));
});

test("export reports malformed in-memory UUID state and never invents IDs while rendering", () => {
  const { project, conductor } = connectedProject("wire", 1);
  const id = conductor.conductorIds[0];
  conductor.conductorUuids[id] = "WF-component-conductor-1";
  const before = JSON.stringify(project);
  const result = buildOnshapeCableWireExport(project);
  assert.equal(result.rows.length, 0);
  assert.ok(result.issues.some((issue) => issue.code === "INVALID_CONDUCTOR_UUID"));
  assert.equal(JSON.stringify(project), before);
});

test("conductor UUID generation uses crypto.randomUUID and not Math.random", async () => {
  const source = await fs.readFile(new URL("../app/model.ts", import.meta.url), "utf8");
  const start = source.indexOf("export function createConductorUuid()");
  const end = source.indexOf("function freshConductorUuid", start);
  const generator = source.slice(start, end);
  assert.match(generator, /crypto\?\.randomUUID/);
  assert.doesNotMatch(generator, /Math\.random/);
});

test("component copy/paste regenerates every copied conductor UUID", async () => {
  const source = await fs.readFile(new URL("../app/HarnessStudio.tsx", import.meta.url), "utf8");
  const paste = source.slice(
    source.indexOf("const pasteSelection = useCallback"),
    source.indexOf("const replaceProject = useCallback"),
  );
  assert.match(paste, /conductorIds = component\.conductorIds\.map/);
  assert.match(paste, /conductorUuids: createConductorUuidMap\(conductorIds\)/);
  assert.doesNotMatch(paste, /conductorUuids:\s*component\.conductorUuids/);
});

