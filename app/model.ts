export const PROJECT_SCHEMA_VERSION = 3 as const;
export const PROJECT_FILE_FORMAT = "wireform-project";

export type ComponentKind =
  | "connector"
  | "cable"
  | "wire"
  | "bundle"
  | "splice"
  | "junction";

export type PortSide = "left" | "right";

export interface ConnectorPhoto {
  dataUrl: string;
  fileName: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  alt: string;
}

export type HarnessImageMimeType = "image/jpeg" | "image/png";

export interface HarnessImage {
  id: string;
  dataUrl: string;
  mimeType: HarnessImageMimeType;
  originalFilename?: string;
  title?: string;
  caption?: string;
  width: number;
  height: number;
}

export interface TerminationPart {
  type?: string;
  subtype?: string;
  pn?: string;
  manufacturer?: string;
  mpn?: string;
  supplier?: string;
  spn?: string;
}

export interface WireTermination {
  contact?: TerminationPart;
  seal?: TerminationPart;
  stripLength?: string;
  tooling?: string;
  notes?: string;
}

export type AdditionalComponentScope = "cable" | "wire" | "termination";
export type AdditionalComponentEnd = "from" | "to" | "both";

export interface AdditionalComponentPlacement {
  scope?: AdditionalComponentScope;
  end?: AdditionalComponentEnd;
  wireIds?: Array<string | number>;
  offsetMm?: number;
  pieceLengthMm?: number;
  note?: string;
}

export interface AdditionalComponent extends TerminationPart {
  id: string;
  qty?: number;
  unit?: string;
  qtyMultiplier?: string;
  bgcolor?: string;
  notes?: string;
  placement?: AdditionalComponentPlacement;
}

export interface ApprovedPartAlternative {
  id: string;
  manufacturer?: string;
  mpn?: string;
  note?: string;
}

// Kept as an alias for callers that describe connector-specific WireViz data.
export type ConnectorAdditionalComponent = AdditionalComponent;

export interface HarnessComponent {
  id: string;
  kind: ComponentKind;
  designator: string;
  name: string;
  x: number;
  y: number;
  pinCount: number;
  wireCount: number;
  pinLabels: string[];
  wireLabels: string[];
  colors: string[];
  gauge: string;
  length: string;
  shield: boolean;
  loops: string;
  manufacturer: string;
  mpn: string;
  supplier: string;
  spn: string;
  notes: string;
  photo?: ConnectorPhoto;
  additionalComponents?: ConnectorAdditionalComponent[];
  approvedAlternatives?: ApprovedPartAlternative[];
}

export interface PortRef {
  nodeId: string;
  portId: string;
  side: PortSide;
}

export interface TopologyLink {
  id: string;
  from: PortRef;
  to: PortRef;
  termination?: WireTermination;
}

export type TwistDirection = "S" | "Z" | "unspecified";

export interface TwistedPair {
  id: string;
  designator: string;
  members: string[];
  twistPitchMm?: number;
  twistDirection: TwistDirection;
  note?: string;
}

export interface HarnessProject {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  projectId: string;
  title: string;
  revision: string;
  company: string;
  notes: string;
  harnessImages: HarnessImage[];
  components: HarnessComponent[];
  links: TopologyLink[];
  twistedPairs: TwistedPair[];
}

export interface ProjectFile {
  format: typeof PROJECT_FILE_FORMAT;
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  savedAt: string;
  project: HarnessProject;
}

export interface ParsedProjectFile {
  project: HarnessProject;
  migratedFrom?: number;
}

export const CONNECTOR_KINDS: ComponentKind[] = [
  "connector",
  "splice",
  "junction",
];
export const CABLE_KINDS: ComponentKind[] = ["cable", "wire", "bundle"];

const COMPONENT_KINDS = new Set<ComponentKind>([
  ...CONNECTOR_KINDS,
  ...CABLE_KINDS,
]);
const MAX_COMPONENTS = 500;
const MAX_LINKS = 4_000;
const MAX_ROWS = 64;
const MAX_TEXT = 4_000;
const MAX_PHOTO_DATA_LENGTH = 4_000_000;
const MAX_HARNESS_IMAGES = 40;
const MAX_HARNESS_IMAGE_DATA_LENGTH = 16_000_000;
const MAX_HARNESS_IMAGE_TOTAL_DATA_LENGTH = 60_000_000;
const MAX_LAYOUT_COORDINATE = 1_000_000;

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function textValue(value: unknown, fallback = "", max = MAX_TEXT) {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

function numberValue(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function stringList(value: unknown, maximum = MAX_ROWS) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maximum)
    .map((entry) =>
      typeof entry === "string" || typeof entry === "number"
        ? String(entry).slice(0, 300)
        : "",
    );
}

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export function createAdditionalComponentId() {
  return createId("additional");
}

export function createApprovedPartAlternativeId() {
  return createId("alternative");
}

export function createTwistedPairId() {
  return createId("twisted-pair");
}

export function createHarnessImageId() {
  return createId("harness-image");
}

export function harnessImageMimeTypeFromDataUrl(
  value: string,
): HarnessImageMimeType | undefined {
  const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=\s]+)$/.exec(
    value,
  );
  if (!match) return undefined;
  const payload = match[2].replace(/\s/g, "");
  if (match[1] === "image/png" && !payload.startsWith("iVBORw0KGgo")) {
    return undefined;
  }
  if (match[1] === "image/jpeg" && !payload.startsWith("/9j/")) {
    return undefined;
  }
  return match[1] as HarnessImageMimeType;
}

export function isHarnessImageDataUrl(value: string) {
  return Boolean(harnessImageMimeTypeFromDataUrl(value));
}

function normalizedPhoto(value: unknown): ConnectorPhoto | undefined {
  const photo = recordValue(value);
  if (!photo) return undefined;
  if (
    typeof photo.dataUrl !== "string" ||
    photo.dataUrl.length > MAX_PHOTO_DATA_LENGTH
  ) {
    return undefined;
  }
  const dataUrl = photo.dataUrl;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,[A-Za-z0-9+/=\s]+$/.exec(
    dataUrl,
  );
  if (!match) return undefined;
  return {
    dataUrl,
    fileName: textValue(photo.fileName, "connector-photo", 240),
    mimeType: match[1] as ConnectorPhoto["mimeType"],
    width: Math.round(numberValue(photo.width, 320, 1, 4_096)),
    height: Math.round(numberValue(photo.height, 240, 1, 4_096)),
    alt: textValue(photo.alt, "Connector photo", 500),
  };
}

function normalizeHarnessImages(value: unknown): HarnessImage[] {
  if (!Array.isArray(value)) return [];
  const usedIds = new Set<string>();
  let totalDataLength = 0;
  return value.slice(0, MAX_HARNESS_IMAGES).flatMap((entry) => {
    const source = recordValue(entry);
    if (!source || typeof source.dataUrl !== "string") return [];
    const dataUrl = source.dataUrl;
    const mimeType = harnessImageMimeTypeFromDataUrl(dataUrl);
    if (
      !mimeType ||
      dataUrl.length > MAX_HARNESS_IMAGE_DATA_LENGTH ||
      totalDataLength + dataUrl.length > MAX_HARNESS_IMAGE_TOTAL_DATA_LENGTH
    ) {
      return [];
    }
    totalDataLength += dataUrl.length;
    let id = textValue(source.id, "", 240);
    if (!id || usedIds.has(id)) id = createHarnessImageId();
    usedIds.add(id);
    const originalFilename = nonEmptyText(source.originalFilename, 240);
    const title = nonEmptyText(source.title, 500);
    const caption = nonEmptyText(source.caption, MAX_TEXT);
    return [
      {
        id,
        dataUrl,
        mimeType,
        ...(originalFilename ? { originalFilename } : {}),
        ...(title ? { title } : {}),
        ...(caption ? { caption } : {}),
        width: Math.round(numberValue(source.width, 1, 1, 8_192)),
        height: Math.round(numberValue(source.height, 1, 1, 8_192)),
      },
    ];
  });
}

function nonEmptyText(value: unknown, max = MAX_TEXT) {
  const text = textValue(value, "", max);
  return text.trim() ? text : undefined;
}

export function normalizeTerminationPart(
  value: unknown,
): TerminationPart | undefined {
  const source = recordValue(value);
  if (!source) return undefined;
  const values: Array<[keyof TerminationPart, string | undefined]> = [
    ["type", nonEmptyText(source.type, 500)],
    ["subtype", nonEmptyText(source.subtype, 1_000)],
    ["pn", nonEmptyText(source.pn, 500)],
    ["manufacturer", nonEmptyText(source.manufacturer, 500)],
    ["mpn", nonEmptyText(source.mpn, 500)],
    ["supplier", nonEmptyText(source.supplier, 500)],
    ["spn", nonEmptyText(source.spn, 500)],
  ];
  const part = Object.fromEntries(
    values.filter((entry): entry is [keyof TerminationPart, string] =>
      Boolean(entry[1]),
    ),
  ) as TerminationPart;
  return Object.values(part).some(Boolean) ? part : undefined;
}

export function normalizeWireTermination(
  value: unknown,
): WireTermination | undefined {
  const source = recordValue(value);
  if (!source) return undefined;
  const contact = normalizeTerminationPart(source.contact);
  const seal = normalizeTerminationPart(source.seal);
  const stripLength = nonEmptyText(source.stripLength, 160);
  const tooling = nonEmptyText(source.tooling, 1_000);
  const notes = nonEmptyText(source.notes, MAX_TEXT);
  const termination: WireTermination = {
    ...(contact ? { contact } : {}),
    ...(seal ? { seal } : {}),
    ...(stripLength ? { stripLength } : {}),
    ...(tooling ? { tooling } : {}),
    ...(notes ? { notes } : {}),
  };
  return Object.values(termination).some(Boolean) ? termination : undefined;
}

function finiteOptionalNumber(value: unknown) {
  if (value === "" || value === null || value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.min(1_000_000, Math.max(-1_000_000, number));
}

function normalizeAdditionalComponentPlacement(
  value: unknown,
): AdditionalComponentPlacement | undefined {
  const source = recordValue(value);
  if (!source) return undefined;
  const scope = ["cable", "wire", "termination"].includes(String(source.scope))
    ? (String(source.scope) as AdditionalComponentScope)
    : undefined;
  const end = ["from", "to", "both"].includes(String(source.end))
    ? (String(source.end) as AdditionalComponentEnd)
    : undefined;
  const wireIds = Array.isArray(source.wireIds)
    ? source.wireIds.slice(0, MAX_ROWS).flatMap((wireId) =>
        typeof wireId === "string" || typeof wireId === "number"
          ? [wireId]
          : [],
      )
    : undefined;
  const offsetMm = finiteOptionalNumber(source.offsetMm);
  const pieceLengthMm = finiteOptionalNumber(source.pieceLengthMm);
  const note = nonEmptyText(source.note, MAX_TEXT);
  const placement: AdditionalComponentPlacement = {
    ...(scope ? { scope } : {}),
    ...(end ? { end } : {}),
    ...(wireIds?.length ? { wireIds } : {}),
    ...(offsetMm !== undefined ? { offsetMm } : {}),
    ...(pieceLengthMm !== undefined ? { pieceLengthMm } : {}),
    ...(note ? { note } : {}),
  };
  return Object.keys(placement).length ? placement : undefined;
}

export function normalizeAdditionalComponents(
  value: unknown,
): AdditionalComponent[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const usedIds = new Set<string>();
  const components = value.slice(0, 256).flatMap((entry) => {
    const source = recordValue(entry);
    const part = normalizeTerminationPart(entry);
    if (!source) return [];
    let id = textValue(source.id, "", 240);
    if (!id || usedIds.has(id)) id = createAdditionalComponentId();
    usedIds.add(id);
    const quantity = finiteOptionalNumber(source.qty);
    const multiplier = source.qtyMultiplier ?? source.qty_multiplier;
    const qtyMultiplier = nonEmptyText(multiplier, 80);
    const placement = normalizeAdditionalComponentPlacement(source.placement);
    const unit = nonEmptyText(source.unit, 80);
    const bgcolor = nonEmptyText(source.bgcolor, 80);
    const notes = nonEmptyText(source.notes, MAX_TEXT);
    if (
      !part &&
      quantity === undefined &&
      !qtyMultiplier &&
      !unit &&
      !bgcolor &&
      !notes &&
      !placement
    ) {
      return [];
    }
    return [
      {
        id,
        ...(part ?? {}),
        ...(quantity !== undefined ? { qty: quantity } : {}),
        ...(unit ? { unit } : {}),
        ...(qtyMultiplier ? { qtyMultiplier } : {}),
        ...(bgcolor ? { bgcolor } : {}),
        ...(notes ? { notes } : {}),
        ...(placement ? { placement } : {}),
      },
    ];
  });
  return components.length ? components : undefined;
}

export const normalizeConnectorAdditionalComponents =
  normalizeAdditionalComponents;

export function normalizeApprovedPartAlternatives(
  value: unknown,
): ApprovedPartAlternative[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const usedIds = new Set<string>();
  const alternatives = value.slice(0, MAX_ROWS).flatMap((entry) => {
    const source = recordValue(entry);
    if (!source) return [];
    let id = textValue(source.id, "", 240);
    if (!id || usedIds.has(id)) id = createApprovedPartAlternativeId();
    usedIds.add(id);
    const manufacturer = nonEmptyText(source.manufacturer, 500);
    const mpn = nonEmptyText(source.mpn, 500);
    const note = nonEmptyText(source.note, MAX_TEXT);
    return [
      {
        id,
        ...(manufacturer ? { manufacturer } : {}),
        ...(mpn ? { mpn } : {}),
        ...(note ? { note } : {}),
      },
    ];
  });
  return alternatives.length ? alternatives : undefined;
}

export function componentGroup(kind: ComponentKind): "connector" | "cable" {
  return CONNECTOR_KINDS.includes(kind) ? "connector" : "cable";
}

export function makeComponent(
  kind: ComponentKind,
  index: number,
  id = createId("component"),
): HarnessComponent {
  const counts: Record<ComponentKind, number> = {
    connector: 4,
    cable: 4,
    wire: 1,
    bundle: 4,
    splice: 3,
    junction: 4,
  };
  const prefixes: Record<ComponentKind, string> = {
    connector: "J",
    cable: "W",
    wire: "W",
    bundle: "W",
    splice: "S",
    junction: "N",
  };
  const count = counts[kind];
  return {
    id,
    kind,
    designator: `${prefixes[kind]}${index}`,
    name: kind.charAt(0).toUpperCase() + kind.slice(1),
    x: 260 + ((index * 53) % 540),
    y: 110 + ((index * 47) % 390),
    pinCount: CONNECTOR_KINDS.includes(kind) ? count : 0,
    wireCount: CABLE_KINDS.includes(kind) ? count : 0,
    pinLabels: CONNECTOR_KINDS.includes(kind)
      ? Array.from({ length: count }, () => "")
      : [],
    wireLabels: CABLE_KINDS.includes(kind)
      ? Array.from({ length: count }, () => "")
      : [],
    colors: CABLE_KINDS.includes(kind)
      ? Array.from(
          { length: count },
          (_, colorIndex) => ["RD", "BK", "WH", "GN"][colorIndex % 4],
        )
      : [],
    gauge: CABLE_KINDS.includes(kind) ? "22 AWG" : "",
    length: CABLE_KINDS.includes(kind) ? "1 m" : "",
    shield: false,
    loops: "",
    manufacturer: "",
    mpn: "",
    supplier: "",
    spn: "",
    notes: "",
  };
}

export function createEmptyProject(title = "Untitled Harness"): HarnessProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: createId("project"),
    title,
    revision: "A",
    company: "",
    notes: "",
    harnessImages: [],
    components: [],
    links: [],
    twistedPairs: [],
  };
}

function normalizeComponent(
  value: unknown,
  index: number,
  usedIds: Set<string>,
): HarnessComponent | undefined {
  const source = recordValue(value);
  if (!source || !COMPONENT_KINDS.has(source.kind as ComponentKind)) {
    return undefined;
  }
  const kind = source.kind as ComponentKind;
  const base = makeComponent(kind, index + 1);
  let id = textValue(source.id, base.id, 240);
  if (!id || usedIds.has(id)) id = createId("component");
  usedIds.add(id);
  const pinCount = CONNECTOR_KINDS.includes(kind)
    ? Math.round(numberValue(source.pinCount, base.pinCount, 1, MAX_ROWS))
    : 0;
  const wireCount = CABLE_KINDS.includes(kind)
    ? Math.round(numberValue(source.wireCount, base.wireCount, 1, MAX_ROWS))
    : 0;
  const photo = kind === "connector" ? normalizedPhoto(source.photo) : undefined;
  const additionalComponents = normalizeAdditionalComponents(
    source.additionalComponents,
  );
  const approvedAlternatives = normalizeApprovedPartAlternatives(
    source.approvedAlternatives,
  );
  return {
    ...base,
    id,
    designator: textValue(source.designator, base.designator, 160),
    name: textValue(source.name, base.name, 500),
    x: numberValue(
      source.x,
      base.x,
      -MAX_LAYOUT_COORDINATE,
      MAX_LAYOUT_COORDINATE,
    ),
    y: numberValue(
      source.y,
      base.y,
      -MAX_LAYOUT_COORDINATE,
      MAX_LAYOUT_COORDINATE,
    ),
    pinCount,
    wireCount,
    pinLabels: stringList(source.pinLabels).slice(0, pinCount),
    wireLabels: stringList(source.wireLabels).slice(0, wireCount),
    colors: stringList(source.colors)
      .slice(0, wireCount)
      .map((color) => color.toUpperCase()),
    gauge: textValue(source.gauge, base.gauge, 160),
    length: textValue(source.length, base.length, 160),
    shield: Boolean(source.shield),
    loops: textValue(source.loops, "", 1_000),
    manufacturer: textValue(source.manufacturer, "", 500),
    mpn: textValue(source.mpn, "", 500),
    supplier: textValue(source.supplier, "", 500),
    spn: textValue(source.spn, "", 500),
    notes: textValue(source.notes, "", MAX_TEXT),
    ...(photo ? { photo } : {}),
    ...(additionalComponents ? { additionalComponents } : {}),
    ...(approvedAlternatives ? { approvedAlternatives } : {}),
  };
}

function normalizePort(
  value: unknown,
  nodes: Map<string, HarnessComponent>,
): PortRef | undefined {
  const source = recordValue(value);
  const nodeId = textValue(source?.nodeId, "", 240);
  const portId = textValue(source?.portId, "", 120);
  const side = source?.side;
  if (
    !nodes.has(nodeId) ||
    !/^(?:pin|wire):[1-9][0-9]*$|^shield$/.test(portId) ||
    (side !== "left" && side !== "right")
  ) {
    return undefined;
  }
  const node = nodes.get(nodeId)!;
  if (portId.startsWith("pin:")) {
    if (!CONNECTOR_KINDS.includes(node.kind)) return undefined;
    const ordinal = Number(portId.slice("pin:".length));
    if (ordinal > node.pinCount) return undefined;
  } else if (portId.startsWith("wire:")) {
    if (!CABLE_KINDS.includes(node.kind)) return undefined;
    const ordinal = Number(portId.slice("wire:".length));
    if (ordinal > node.wireCount) return undefined;
  } else if (!CABLE_KINDS.includes(node.kind) || !node.shield) {
    return undefined;
  }
  return { nodeId, portId, side };
}

export function normalizeProject(value: unknown): ParsedProjectFile {
  const outer = recordValue(value);
  if (!outer) throw new Error("The project file must contain a JSON object.");

  const wrapped = outer.format === PROJECT_FILE_FORMAT;
  const rawProject = wrapped ? recordValue(outer.project) : outer;
  if (!rawProject) throw new Error("The project file does not contain a project.");

  const originalVersion = numberValue(rawProject.schemaVersion, 1, 1, 10_000);
  if (originalVersion > PROJECT_SCHEMA_VERSION) {
    throw new Error(
      `This project uses schema ${originalVersion}, but this WireForm release supports schema ${PROJECT_SCHEMA_VERSION}.`,
    );
  }
  if (!Array.isArray(rawProject.components) || !Array.isArray(rawProject.links)) {
    throw new Error("The project is missing its components or links.");
  }
  if (rawProject.components.length > MAX_COMPONENTS) {
    throw new Error(`Projects may contain at most ${MAX_COMPONENTS} components.`);
  }
  if (rawProject.links.length > MAX_LINKS) {
    throw new Error(`Projects may contain at most ${MAX_LINKS} links.`);
  }

  const usedIds = new Set<string>();
  const components = rawProject.components
    .map((component, index) => normalizeComponent(component, index, usedIds))
    .filter((component): component is HarnessComponent => Boolean(component));
  if (components.length !== rawProject.components.length) {
    throw new Error("The project contains an unsupported component type.");
  }
  const nodes = new Map(
    components.map((component) => [component.id, component]),
  );
  const usedLinkIds = new Set<string>();
  const links = rawProject.links.flatMap((value, index) => {
    const source = recordValue(value);
    const from = normalizePort(source?.from, nodes);
    const to = normalizePort(source?.to, nodes);
    if (!from || !to) return [];
    let id = textValue(source?.id, `link-${index + 1}`, 240);
    if (!id || usedLinkIds.has(id)) id = createId("link");
    usedLinkIds.add(id);
    const termination = normalizeWireTermination(source?.termination);
    return [{ id, from, to, ...(termination ? { termination } : {}) }];
  });

  const usedPairIds = new Set<string>();
  const twistedPairs = (Array.isArray(rawProject.twistedPairs)
    ? rawProject.twistedPairs
    : []
  ).slice(0, MAX_COMPONENTS).flatMap((value, index) => {
    const source = recordValue(value);
    if (!source) return [];
    let id = textValue(source.id, `twisted-pair-${index + 1}`, 240);
    if (!id || usedPairIds.has(id)) id = createId("twisted-pair");
    usedPairIds.add(id);
    const members = stringList(source.members, 16);
    const rawPitch = source.twistPitchMm;
    const parsedPitch =
      rawPitch === undefined || rawPitch === "" ? undefined : Number(rawPitch);
    const direction: TwistDirection =
      source.twistDirection === "S" || source.twistDirection === "Z"
        ? source.twistDirection
        : "unspecified";
    return [{
      id,
      designator: textValue(source.designator, `TP${index + 1}`, 160),
      members,
      ...(parsedPitch !== undefined ? { twistPitchMm: parsedPitch } : {}),
      twistDirection: direction,
      ...(textValue(source.note) ? { note: textValue(source.note) } : {}),
    }];
  });

  const project: HarnessProject = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: textValue(rawProject.projectId, createId("project"), 240),
    title: textValue(rawProject.title, "Untitled Harness", 500),
    revision: textValue(rawProject.revision, "", 160),
    company: textValue(rawProject.company, "", 500),
    notes: textValue(rawProject.notes, "", MAX_TEXT),
    harnessImages: normalizeHarnessImages(rawProject.harnessImages),
    components,
    links,
    twistedPairs,
  };
  return {
    project,
    ...(originalVersion < PROJECT_SCHEMA_VERSION
      ? { migratedFrom: originalVersion }
      : {}),
  };
}

export function parseProjectFile(text: string): ParsedProjectFile {
  if (text.length > 90_000_000) {
    throw new Error("Project files must be smaller than 90 MB.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The selected project file is not valid JSON.");
  }
  return normalizeProject(value);
}

export function serializeProjectFile(project: HarnessProject) {
  const file: ProjectFile = {
    format: PROJECT_FILE_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    project,
  };
  return JSON.stringify(file, null, 2);
}

export function cloneProject(project: HarnessProject): HarnessProject {
  return structuredClone(project);
}

export function remapTopologyLink(
  link: TopologyLink,
  id: string,
  nodeIds: ReadonlyMap<string, string>,
): TopologyLink {
  return {
    id,
    from: {
      ...link.from,
      nodeId: nodeIds.get(link.from.nodeId) ?? link.from.nodeId,
    },
    to: {
      ...link.to,
      nodeId: nodeIds.get(link.to.nodeId) ?? link.to.nodeId,
    },
    ...(link.termination
      ? { termination: structuredClone(link.termination) }
      : {}),
  };
}
