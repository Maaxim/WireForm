import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Box,
  Cable,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  ClipboardPaste,
  Combine,
  Copy,
  Database,
  Download,
  Eye,
  FileCode2,
  FileDown,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  FileUp,
  FolderOpen,
  GitBranch,
  ImagePlus,
  Images,
  Library,
  Link2,
  LoaderCircle,
  Minus,
  Network,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Shield,
  Trash2,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import YAML from "yaml";
import {
  bomFilenameForTitle,
  buildBomRows,
  serializeBomCsv,
} from "./bom";
import {
  CABLE_QUANTITY_MODES,
  CONNECTOR_QUANTITY_MODES,
  additionalComponentModeLabel,
  additionalComponentQuantity,
  additionalComponentToWireViz,
  cloneAdditionalComponentsWithNewIds,
  createAdditionalComponentPreset,
  validateAdditionalComponents,
  type AdditionalComponentPreset,
} from "./additional-components";
import {
  cloneApprovedAlternativesWithNewIds,
  createApprovedPartAlternative,
  supportsApprovedAlternatives,
  validateApprovedAlternatives,
} from "./approved-alternatives";
import {
  buildHarnessReportModel,
  htmlReportFilenameForTitle,
  renderHarnessReportHtml,
} from "./html-report";
import {
  approximateDataUrlBytes,
  prepareConnectorPhoto,
  prepareHarnessImage,
  validateHarnessImages,
} from "./images";
import {
  componentToTemplate,
  createLibrary,
  createLibraryCollection,
  instantiateTemplate,
  mergeTemplates,
  normalizeLibraryCollection,
  parseLibraryFile,
  serializeLibrary,
  serializeLibraryBackup,
  serializeTemplateSelection,
  type ComponentTemplate,
  type DuplicateMode,
  type LibraryCollection,
} from "./library";
import {
  CABLE_KINDS,
  CONNECTOR_KINDS,
  PROJECT_SCHEMA_VERSION,
  cloneProject,
  componentGroup,
  createEmptyProject,
  makeComponent,
  parseProjectFile,
  remapTopologyLink,
  serializeProjectFile,
  type AdditionalComponent,
  type AdditionalComponentPlacement,
  type ApprovedPartAlternative,
  type ComponentKind,
  type HarnessComponent,
  type HarnessImage,
  type HarnessProject,
  type PortRef,
  type TerminationPart,
  type TopologyLink,
  type TwistedPair,
} from "./model";
import {
  AUTOSAVE_KEY,
  LIBRARIES_KEY,
  readLocalDocument,
  writeLocalDocument,
} from "./storage";
import { WIREVIZ_VERSION } from "./vendor";
import {
  applyContactToConnectedPins,
  collectConnectorAdditionalComponents,
  compactWireTermination,
  findConnectorPinLink,
  getTerminationPartLabel,
  hasWireTerminationData,
  validateTerminationMetadata,
  type TerminationField,
  type TerminationPartField,
} from "./termination";
import {
  importWireVizYaml,
  type WireVizImportCandidate,
} from "./wireviz-import";
import {
  cloneTwistedPairsForPaste,
  createTwistedPair,
  findTwistedPairForWire,
  twistedPairCreationIssue,
  validateTwistedPairs,
  withoutTwistedPairsForMembers,
} from "./twisted-pair";
import {
  WIRE_COLOR_OPTIONS,
  formatWireColor,
  getWireColorCssBackground,
  getWireColorDisplay,
  getWireColorHex,
  getWireColorStripeHex,
  parseWireColor,
  validateWireColors,
} from "./wire-colors";

interface ValidationResult {
  errors: string[];
  warnings: string[];
}

interface DragState {
  ids: string[];
  startX: number;
  startY: number;
  origins: Record<string, { x: number; y: number }>;
  before: HarnessProject;
}

interface MarqueeState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  initialIds: string[];
}

interface ComponentClipboard {
  components: HarnessComponent[];
  links: TopologyLink[];
  twistedPairs: TwistedPair[];
}

interface PreviewMessage {
  type: "ready" | "result" | "failure";
  requestId?: string;
  svg?: string;
  dot?: string;
  versions?: {
    wireviz: string;
    pyodide: string;
    graphviz: string;
  };
  message?: string;
}

interface PendingReportRender {
  resolve: (svg: string) => void;
  reject: (error: Error) => void;
  timeout: number;
}

const NODE_WIDTH = 224;
const NODE_HEADER = 62;
const ROW_HEIGHT = 32;
const NODE_PHOTO_HEIGHT = 118;
const CANVAS_WIDTH = 1480;
const CANVAS_HEIGHT = 820;

const KIND_META: Record<
  ComponentKind,
  {
    label: string;
    singular: string;
    icon: typeof Box;
    description: string;
  }
> = {
  connector: {
    label: "Connector",
    singular: "Connector",
    icon: Box,
    description: "Housing with numbered pins",
  },
  cable: {
    label: "Cable",
    singular: "Cable",
    icon: Cable,
    description: "Multi-conductor jacketed cable",
  },
  wire: {
    label: "Wire",
    singular: "Wire",
    icon: CircleDot,
    description: "Single conductor",
  },
  bundle: {
    label: "Bundle",
    singular: "Bundle",
    icon: Combine,
    description: "Grouped loose conductors",
  },
  splice: {
    label: "Splice",
    singular: "Splice",
    icon: GitBranch,
    description: "Inline electrical join",
  },
  junction: {
    label: "Junction",
    singular: "Junction",
    icon: Network,
    description: "Multi-way branch point",
  },
};

function createStarterProject(): HarnessProject {
  const components: HarnessComponent[] = [
    {
      id: "connector-controller",
      kind: "connector",
      designator: "J1",
      name: "Controller",
      x: 90,
      y: 145,
      pinCount: 3,
      wireCount: 0,
      pinLabels: ["V+", "CAN_H", "CAN_L"],
      wireLabels: [],
      colors: [],
      gauge: "",
      length: "",
      shield: false,
      loops: "",
      manufacturer: "",
      mpn: "",
      supplier: "",
      spn: "",
      notes: "Main controller interface",
    },
    {
      id: "cable-main",
      kind: "cable",
      designator: "W1",
      name: "Main trunk",
      x: 470,
      y: 145,
      pinCount: 0,
      wireCount: 3,
      pinLabels: [],
      wireLabels: ["POWER", "CAN_H", "CAN_L"],
      colors: ["RD", "WHGN", "WHBU"],
      gauge: "22 AWG",
      length: "0.8 m",
      shield: true,
      loops: "",
      manufacturer: "",
      mpn: "",
      supplier: "",
      spn: "",
      notes: "Shielded CAN and power cable",
    },
    {
      id: "connector-sensor",
      kind: "connector",
      designator: "J2",
      name: "Sensor",
      x: 850,
      y: 145,
      pinCount: 3,
      wireCount: 0,
      pinLabels: ["V+", "CAN_H", "CAN_L"],
      wireLabels: [],
      colors: [],
      gauge: "",
      length: "",
      shield: false,
      loops: "",
      manufacturer: "",
      mpn: "",
      supplier: "",
      spn: "",
      notes: "Remote sensor connector",
    },
  ];

  const links: TopologyLink[] = [];
  for (let index = 1; index <= 3; index += 1) {
    links.push(
      {
        id: `link-j1-w1-${index}`,
        from: {
          nodeId: "connector-controller",
          portId: `pin:${index}`,
          side: "right",
        },
        to: {
          nodeId: "cable-main",
          portId: `wire:${index}`,
          side: "left",
        },
      },
      {
        id: `link-w1-j2-${index}`,
        from: {
          nodeId: "cable-main",
          portId: `wire:${index}`,
          side: "right",
        },
        to: {
          nodeId: "connector-sensor",
          portId: `pin:${index}`,
          side: "left",
        },
      },
    );
  }

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: "project-starter",
    title: "CAN Sensor Harness",
    revision: "A",
    company: "",
    notes: "",
    harnessImages: [],
    components,
    links,
    twistedPairs: [],
  };
}

function listForCount(values: string[], count: number, fallback: string) {
  return Array.from({ length: count }, (_, index) => values[index] ?? fallback);
}

function WireColorSwatch({
  code,
  className = "",
}: {
  code: string;
  className?: string;
}) {
  const parsed = parseWireColor(code);
  return (
    <span
      className={`wire-color-swatch ${parsed.secondary ? "bicolor" : "solid"} ${className}`.trim()}
      style={{ background: getWireColorCssBackground(code) }}
      role="img"
      aria-label={getWireColorDisplay(code)}
      title={getWireColorDisplay(code)}
    />
  );
}

function naturalSort(a: string, b: string) {
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function storageSizeLabel(bytes: number) {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function getNodeRows(node: HarnessComponent) {
  if (CONNECTOR_KINDS.includes(node.kind)) return node.pinCount;
  return node.wireCount + (node.shield ? 1 : 0);
}

function getNodeHeight(node: HarnessComponent) {
  return (
    NODE_HEADER +
    (node.photo ? NODE_PHOTO_HEIGHT : 0) +
    Math.max(getNodeRows(node), 1) * ROW_HEIGHT +
    12
  );
}

function parsePortNumber(portId: string) {
  const [, value] = portId.split(":");
  return Number(value);
}

function canonicalEndpoint(port: PortRef) {
  const nodePort = port.portId.startsWith("pin:")
    ? port.portId
    : `${port.portId}:${port.side}`;
  return `${port.nodeId}/${nodePort}`;
}

function nodePoint(node: HarnessComponent, port: PortRef) {
  const isShield = port.portId === "shield";
  const index = isShield ? node.wireCount : parsePortNumber(port.portId) - 1;
  return {
    x: node.x + (port.side === "right" ? NODE_WIDTH : 0),
    y:
      node.y +
      NODE_HEADER +
      (node.photo ? NODE_PHOTO_HEIGHT : 0) +
      index * ROW_HEIGHT +
      ROW_HEIGHT / 2,
  };
}

function oppositePort(link: TopologyLink, nodeId: string) {
  return link.from.nodeId === nodeId ? link.to : link.from;
}

function isPortUsed(project: HarnessProject, port: PortRef) {
  const canonical = canonicalEndpoint(port);
  return project.links.some(
    (link) =>
      canonicalEndpoint(link.from) === canonical ||
      canonicalEndpoint(link.to) === canonical,
  );
}

function parseLoops(value: string, pinCount: number) {
  return value
    .split(",")
    .map((pair) =>
      pair
        .trim()
        .split("-")
        .map((pin) => Number(pin.trim())),
    )
    .filter(
      (pair) =>
        pair.length === 2 &&
        pair.every((pin) => Number.isInteger(pin) && pin > 0 && pin <= pinCount),
    );
}

export function buildWireVizDocument(project: HarnessProject) {
  const connectorNodes = project.components
    .filter((node) => CONNECTOR_KINDS.includes(node.kind))
    .sort((a, b) => naturalSort(a.designator, b.designator));
  const cableNodes = project.components
    .filter((node) => CABLE_KINDS.includes(node.kind))
    .sort((a, b) => naturalSort(a.designator, b.designator));

  const connectors: Record<string, Record<string, unknown>> = {};
  for (const node of connectorNodes) {
    const connector: Record<string, unknown> = {
      type:
        node.kind === "splice"
          ? node.name || "Splice"
          : node.kind === "junction"
            ? node.name || "Junction"
            : node.name || "Connector",
      pincount: node.pinCount,
    };
    const labels = listForCount(node.pinLabels, node.pinCount, "");
    if (labels.some(Boolean)) connector.pinlabels = labels;

    const explicitLoops = parseLoops(node.loops, node.pinCount);
    const commonLoops =
      node.kind === "splice" || node.kind === "junction"
        ? Array.from({ length: Math.max(node.pinCount - 1, 0) }, (_, index) => [
            index + 1,
            index + 2,
          ])
        : [];
    const loops = explicitLoops.length ? explicitLoops : commonLoops;
    if (loops.length) connector.loops = loops;
    if (node.kind !== "connector") {
      connector.style = "simple";
      connector.show_name = true;
      connector.show_pincount = false;
    }
    if (node.manufacturer) connector.manufacturer = node.manufacturer;
    if (node.mpn) connector.mpn = node.mpn;
    if (node.supplier) connector.supplier = node.supplier;
    if (node.spn) connector.spn = node.spn;
    if (node.notes) connector.notes = node.notes;
    const additionalComponents = collectConnectorAdditionalComponents(
      project,
      node.id,
    );
    if (additionalComponents.length) {
      connector.additional_components = additionalComponents;
    }
    connectors[node.designator] = connector;
  }

  const cables: Record<string, Record<string, unknown>> = {};
  for (const node of cableNodes) {
    const cable: Record<string, unknown> = {
      wirecount: node.wireCount,
    };
    if (node.kind === "bundle") cable.category = "bundle";
    if (node.name) cable.type = node.name;
    if (node.gauge) cable.gauge = node.gauge;
    if (node.length) cable.length = node.length;
    const colors = listForCount(node.colors, node.wireCount, "BK");
    if (colors.length) cable.colors = colors;
    const labels = listForCount(node.wireLabels, node.wireCount, "");
    if (labels.some(Boolean)) cable.wirelabels = labels;
    if (node.shield) cable.shield = true;
    if (node.manufacturer) cable.manufacturer = node.manufacturer;
    if (node.mpn) cable.mpn = node.mpn;
    if (node.supplier) cable.supplier = node.supplier;
    if (node.spn) cable.spn = node.spn;
    if (node.notes) cable.notes = node.notes;
    const additionalComponents = (node.additionalComponents ?? []).flatMap(
      (component) => {
        const serialized = additionalComponentToWireViz(node, component);
        return serialized ? [serialized] : [];
      },
    );
    if (additionalComponents.length) {
      cable.additional_components = additionalComponents;
    }
    cables[node.designator] = cable;
  }

  const connections: Array<Array<Record<string, string | number>>> = [];
  for (const cable of cableNodes) {
    for (let conductor = 1; conductor <= cable.wireCount; conductor += 1) {
      const path: Array<Record<string, string | number>> = [];
      const left = project.links.find(
        (link) =>
          [link.from, link.to].some(
            (port) =>
              port.nodeId === cable.id &&
              port.portId === `wire:${conductor}` &&
              port.side === "left",
          ),
      );
      const right = project.links.find(
        (link) =>
          [link.from, link.to].some(
            (port) =>
              port.nodeId === cable.id &&
              port.portId === `wire:${conductor}` &&
              port.side === "right",
          ),
      );

      if (left) {
        const other = oppositePort(left, cable.id);
        const node = project.components.find(
          (component) => component.id === other.nodeId,
        );
        if (node) path.push({ [node.designator]: parsePortNumber(other.portId) });
      }
      if (left || right) path.push({ [cable.designator]: conductor });
      if (right) {
        const other = oppositePort(right, cable.id);
        const node = project.components.find(
          (component) => component.id === other.nodeId,
        );
        if (node) path.push({ [node.designator]: parsePortNumber(other.portId) });
      }
      if (path.length >= 2) connections.push(path);
    }

    if (cable.shield) {
      const shieldLinks = project.links.filter((link) =>
        [link.from, link.to].some(
          (port) => port.nodeId === cable.id && port.portId === "shield",
        ),
      );
      for (const link of shieldLinks) {
        const other = oppositePort(link, cable.id);
        const node = project.components.find(
          (component) => component.id === other.nodeId,
        );
        if (node) {
          const shieldEntry = { [cable.designator]: "s" };
          const connectorEntry = {
            [node.designator]: parsePortNumber(other.portId),
          };
          connections.push(
            other.side === "left"
              ? [connectorEntry, shieldEntry]
              : [shieldEntry, connectorEntry],
          );
        }
      }
    }
  }

  return {
    metadata: {
      title: project.title,
      ...(project.company ? { company: project.company } : {}),
      ...(project.revision ? { revision: project.revision } : {}),
    },
    options: {
      mini_bom_mode: true,
    },
    connectors,
    cables,
    connections,
  };
}

function validateProject(project: HarnessProject): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const designators = new Map<string, number>();

  for (const node of project.components) {
    const designator = node.designator.trim();
    designators.set(designator, (designators.get(designator) ?? 0) + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(designator)) {
      errors.push(`${node.name || node.kind} has an invalid designator.`);
    }
    if (CONNECTOR_KINDS.includes(node.kind) && node.pinCount < 1) {
      errors.push(`${node.designator} needs at least one pin.`);
    }
    if (CABLE_KINDS.includes(node.kind) && node.wireCount < 1) {
      errors.push(`${node.designator} needs at least one conductor.`);
    }
  }

  for (const [designator, count] of designators) {
    if (count > 1) errors.push(`Designator ${designator} is used more than once.`);
  }

  if (!project.title.trim()) errors.push("Harness title is required.");
  if (project.components.length === 0) warnings.push("The canvas is empty.");
  if (project.links.length === 0) warnings.push("The harness has no connections.");

  warnings.push(...validateTerminationMetadata(project));
  const additionalComponentIssues = validateAdditionalComponents(project);
  errors.push(...additionalComponentIssues.errors);
  warnings.push(...additionalComponentIssues.warnings);
  const approvedAlternativeIssues = validateApprovedAlternatives(project);
  errors.push(...approvedAlternativeIssues.errors);
  warnings.push(...approvedAlternativeIssues.warnings);
  const twistedPairIssues = validateTwistedPairs(project);
  errors.push(...twistedPairIssues.errors);
  warnings.push(...twistedPairIssues.warnings);
  const harnessImageIssues = validateHarnessImages(project);
  errors.push(...harnessImageIssues.errors);
  warnings.push(...harnessImageIssues.warnings);
  warnings.push(...validateWireColors(project));

  for (const link of project.links) {
    for (const endpoint of [link.from, link.to]) {
      const node = project.components.find(
        (component) => component.id === endpoint.nodeId,
      );
      const ordinal = parsePortNumber(endpoint.portId);
      const valid =
        node &&
        ((endpoint.portId.startsWith("pin:") &&
          CONNECTOR_KINDS.includes(node.kind) &&
          ordinal >= 1 &&
          ordinal <= node.pinCount) ||
          (endpoint.portId.startsWith("wire:") &&
            CABLE_KINDS.includes(node.kind) &&
            ordinal >= 1 &&
            ordinal <= node.wireCount) ||
          (endpoint.portId === "shield" &&
            CABLE_KINDS.includes(node.kind) &&
            node.shield));
      if (!valid) {
        errors.push(`Connection ${link.id} has a dangling or invalid endpoint.`);
        break;
      }
    }
  }

  for (const node of project.components.filter((component) =>
    CABLE_KINDS.includes(component.kind),
  )) {
    for (let conductor = 1; conductor <= node.wireCount; conductor += 1) {
      const connectedSides = ["left", "right"].filter((side) =>
        project.links.some((link) =>
          [link.from, link.to].some(
            (port) =>
              port.nodeId === node.id &&
              port.portId === `wire:${conductor}` &&
              port.side === side,
          ),
        ),
      );
      if (connectedSides.length === 1) {
        warnings.push(`${node.designator} conductor ${conductor} has an open end.`);
      }
    }
  }

  return { errors, warnings };
}

function makeNode(kind: ComponentKind, index: number): HarnessComponent {
  const node = makeComponent(kind, index);
  return { ...node, name: KIND_META[kind].singular };
}

function csvValues(value: string) {
  return value.split(",").map((part) => part.trim());
}

function filenameFor(title: string) {
  const clean = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return clean || "wireviz-harness";
}

function copiedDesignator(designator: string, used: Set<string>) {
  const base = `${designator || "COMP"}_COPY`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

export function HarnessStudio() {
  const [project, setProject] = useState<HarnessProject>(() =>
    createStarterProject(),
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    "connector-controller",
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([
    "connector-controller",
  ]);
  const [pendingPort, setPendingPort] = useState<PortRef | null>(null);
  const [zoom, setZoom] = useState(0.9);
  const [activeOutput, setActiveOutput] = useState<"preview" | "yaml">(
    "preview",
  );
  const [previewSvg, setPreviewSvg] = useState("");
  const [previewStatus, setPreviewStatus] = useState<
    "loading" | "rendering" | "ready" | "error"
  >("loading");
  const [previewMessage, setPreviewMessage] = useState(
    "Starting the local WireViz runtime…",
  );
  const [runtimeVersions, setRuntimeVersions] = useState<
    PreviewMessage["versions"]
  >();
  const [notice, setNotice] = useState(
    "Select any component to edit its properties.",
  );
  const [historyState, setHistoryState] = useState({
    canUndo: false,
    canRedo: false,
  });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [hasClipboard, setHasClipboard] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<
    "loading" | "saving" | "saved" | "error"
  >("loading");
  const [dirty, setDirty] = useState(false);
  const [reportExporting, setReportExporting] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [libraries, setLibraries] = useState<LibraryCollection>(() =>
    createLibraryCollection(),
  );
  const [librariesReady, setLibrariesReady] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [harnessView, setHarnessView] = useState<"notes" | "images">("notes");
  const [newLibraryName, setNewLibraryName] = useState("");
  const [duplicateMode, setDuplicateMode] =
    useState<DuplicateMode>("keep");
  const [importCandidate, setImportCandidate] =
    useState<WireVizImportCandidate | null>(null);
  const pastRef = useRef<HarnessProject[]>([]);
  const futureRef = useRef<HarnessProject[]>([]);
  const workerRef = useRef<Worker | null>(null);
  const previewRequestRef = useRef(0);
  const reportRequestRef = useRef(0);
  const pendingReportRendersRef = useRef(
    new Map<string, PendingReportRender>(),
  );
  const libraryInputRef = useRef<HTMLInputElement | null>(null);
  const projectInputRef = useRef<HTMLInputElement | null>(null);
  const yamlInputRef = useRef<HTMLInputElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const harnessImagesInputRef = useRef<HTMLInputElement | null>(null);
  const harnessImageReplaceInputRef = useRef<HTMLInputElement | null>(null);
  const harnessImageReplaceIdRef = useRef<string | null>(null);
  const clipboardRef = useRef<ComponentClipboard | null>(null);
  const pasteSequenceRef = useRef(0);
  const dragDidMoveRef = useRef(false);

  const selected = project.components.find(
    (component) => component.id === selectedId,
  );
  const activeLibrary =
    libraries.libraries.find(
      (library) => library.id === libraries.activeLibraryId,
    ) ?? libraries.libraries[0];
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedTwistedPair = selected
    ? findTwistedPairForWire(project, selected.id)
    : undefined;
  const pairCreationIssue = twistedPairCreationIssue(project, selectedIds);
  const validation = useMemo(() => validateProject(project), [project]);
  const wirevizDocument = useMemo(() => buildWireVizDocument(project), [project]);
  const yaml = useMemo(
    () =>
      `# Generated by WireForm for WireViz ${WIREVIZ_VERSION}\n${YAML.stringify(
        wirevizDocument,
        {
          lineWidth: 0,
          indent: 2,
        },
      )}`,
    [wirevizDocument],
  );
  const previewImages = useMemo(
    () =>
      project.components.flatMap((component) =>
        component.kind === "connector" && component.photo
          ? [
              {
                designator: component.designator,
                dataUrl: component.photo.dataUrl,
                mimeType: component.photo.mimeType,
                width: component.photo.width,
                height: component.photo.height,
                caption: component.photo.alt,
              },
            ]
          : [],
      ),
    [project.components],
  );
  const harnessImageStorageBytes = useMemo(
    () =>
      project.harnessImages.reduce(
        (total, image) => total + approximateDataUrlBytes(image.dataUrl),
        0,
      ),
    [project.harnessImages],
  );

  const commitProject = useCallback(
    (next: HarnessProject, message?: string) => {
      pastRef.current.push(cloneProject(project));
      if (pastRef.current.length > 80) pastRef.current.shift();
      futureRef.current = [];
      setHistoryState({ canUndo: true, canRedo: false });
      setProject(next);
      setDirty(true);
      if (message) setNotice(message);
    },
    [project],
  );

  const updateProject = useCallback(
    (mutate: (draft: HarnessProject) => void, message?: string) => {
      const next = cloneProject(project);
      mutate(next);
      commitProject(next, message);
    },
    [commitProject, project],
  );

  const undo = useCallback(() => {
    const previous = pastRef.current.pop();
    if (!previous) return;
    futureRef.current.push(cloneProject(project));
    setProject(previous);
    setDirty(true);
    setHistoryState({
      canUndo: pastRef.current.length > 0,
      canRedo: true,
    });
    setPendingPort(null);
    setNotice("Undid the last change.");
  }, [project]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(cloneProject(project));
    setProject(next);
    setDirty(true);
    setHistoryState({
      canUndo: true,
      canRedo: futureRef.current.length > 0,
    });
    setPendingPort(null);
    setNotice("Restored the change.");
  }, [project]);

  const selectOnly = useCallback((id: string | null) => {
    setSelectedId(id);
    setSelectedIds(id ? [id] : []);
  }, []);

  const copySelection = useCallback(() => {
    if (selectedIds.length === 0) return;
    const ids = new Set(selectedIds);
    const snapshot = cloneProject(project);
    clipboardRef.current = {
      components: snapshot.components.filter((component) => ids.has(component.id)),
      links: snapshot.links.filter(
        (link) => ids.has(link.from.nodeId) && ids.has(link.to.nodeId),
      ),
      twistedPairs: snapshot.twistedPairs.filter((pair) =>
        pair.members.every((member) => ids.has(member)),
      ),
    };
    pasteSequenceRef.current = 0;
    setHasClipboard(true);
    setNotice(
      `Copied ${selectedIds.length} component${
        selectedIds.length === 1 ? "" : "s"
      } and their internal connections.`,
    );
  }, [project, selectedIds]);

  const pasteSelection = useCallback(() => {
    const clipboard = clipboardRef.current;
    if (!clipboard || clipboard.components.length === 0) return;

    pasteSequenceRef.current += 1;
    const offset = 30 + ((pasteSequenceRef.current - 1) % 5) * 14;
    const idPrefix = `copy-${Date.now().toString(36)}-${pasteSequenceRef.current}`;
    const idMap = new Map<string, string>();
    clipboard.components.forEach((component, index) => {
      idMap.set(component.id, `${idPrefix}-${index}`);
    });

    const minX = Math.min(...clipboard.components.map((component) => component.x));
    const minY = Math.min(...clipboard.components.map((component) => component.y));
    const maxX = Math.max(
      ...clipboard.components.map((component) => component.x + NODE_WIDTH),
    );
    const maxY = Math.max(
      ...clipboard.components.map(
        (component) => component.y + getNodeHeight(component),
      ),
    );
    const dx = Math.min(
      CANVAS_WIDTH - 12 - maxX,
      Math.max(12 - minX, offset),
    );
    const dy = Math.min(
      CANVAS_HEIGHT - 12 - maxY,
      Math.max(12 - minY, offset),
    );
    const usedDesignators = new Set(
      project.components.map((component) => component.designator),
    );
    const pastedComponents = clipboard.components.map((component) => ({
      ...component,
      id: idMap.get(component.id) as string,
      designator: copiedDesignator(component.designator, usedDesignators),
      x: component.x + dx,
      y: component.y + dy,
      pinLabels: [...component.pinLabels],
      wireLabels: [...component.wireLabels],
      colors: [...component.colors],
      additionalComponents: cloneAdditionalComponentsWithNewIds(
        component.additionalComponents,
      ),
      approvedAlternatives: cloneApprovedAlternativesWithNewIds(
        component.approvedAlternatives,
      ),
    }));
    const pastedLinks = clipboard.links.map((link, index) =>
      remapTopologyLink(link, `${idPrefix}-link-${index}`, idMap),
    );
    const pastedPairs = cloneTwistedPairsForPaste(
      clipboard.twistedPairs,
      idMap,
      project.twistedPairs,
    );
    const next = cloneProject(project);
    next.components.push(...pastedComponents);
    next.links.push(...pastedLinks);
    next.twistedPairs.push(...pastedPairs);
    commitProject(
      next,
      `Pasted ${pastedComponents.length} component${
        pastedComponents.length === 1 ? "" : "s"
      }.`,
    );
    const pastedIds = pastedComponents.map((component) => component.id);
    setSelectedIds(pastedIds);
    setSelectedId(pastedIds[0] ?? null);
    setPendingPort(null);
  }, [commitProject, project]);

  const replaceProject = useCallback(
    (next: HarnessProject, message: string, markDirty = false) => {
      pastRef.current = [];
      futureRef.current = [];
      setHistoryState({ canUndo: false, canRedo: false });
      setProject(next);
      const firstId = next.components[0]?.id ?? null;
      setSelectedId(firstId);
      setSelectedIds(firstId ? [firstId] : []);
      setHarnessView("notes");
      setPendingPort(null);
      setDirty(markDirty);
      setNotice(message);
    },
    [],
  );

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      readLocalDocument<string>(AUTOSAVE_KEY),
      readLocalDocument<unknown>(LIBRARIES_KEY),
    ]).then(([autosave, storedLibraries]) => {
      if (!mounted) return;
      if (autosave) {
        try {
          const restored = parseProjectFile(autosave);
          replaceProject(
            restored.project,
            restored.migratedFrom
              ? `Recovered the local autosave and migrated it from schema ${restored.migratedFrom}.`
              : "Recovered the most recent local autosave.",
          );
        } catch {
          setNotice(
            "The local autosave could not be restored; the example harness was loaded.",
          );
        }
      }
      setLibraries(normalizeLibraryCollection(storedLibraries));
      setStorageReady(true);
      setLibrariesReady(true);
      setAutosaveStatus("saved");
    });
    return () => {
      mounted = false;
    };
  }, [replaceProject]);

  useEffect(() => {
    if (!storageReady) return;
    setAutosaveStatus("saving");
    const timer = window.setTimeout(() => {
      void writeLocalDocument(AUTOSAVE_KEY, serializeProjectFile(project))
        .then(() => setAutosaveStatus("saved"))
        .catch(() => setAutosaveStatus("error"));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [project, storageReady]);

  useEffect(() => {
    if (!librariesReady) return;
    const timer = window.setTimeout(() => {
      void writeLocalDocument(LIBRARIES_KEY, libraries).catch(() => {
        setNotice("The user libraries could not be saved locally.");
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [libraries, librariesReady]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT";
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if (
        !isEditing &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "c"
      ) {
        event.preventDefault();
        copySelection();
      }
      if (
        !isEditing &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "v"
      ) {
        event.preventDefault();
        pasteSelection();
      }
      if (
        !isEditing &&
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedIds.length > 0
      ) {
        event.preventDefault();
        const ids = new Set(selectedIds);
        updateProject(
          (draft) => {
            draft.components = draft.components.filter(
              (component) => !ids.has(component.id),
            );
            draft.links = draft.links.filter(
              (link) =>
                !ids.has(link.from.nodeId) && !ids.has(link.to.nodeId),
            );
            draft.twistedPairs = withoutTwistedPairsForMembers(
              draft.twistedPairs,
              ids,
            );
          },
          `Removed ${selectedIds.length} selected component${
            selectedIds.length === 1 ? "" : "s"
          } and their connections.`,
        );
        selectOnly(null);
      }
      if (event.key === "Escape") {
        setPendingPort(null);
        setMarquee(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    copySelection,
    pasteSelection,
    redo,
    selectOnly,
    selectedIds,
    undo,
    updateProject,
  ]);

  useEffect(() => {
    const worker = new Worker(new URL("./preview.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<PreviewMessage>) => {
      const message = event.data;
      if (message.type === "ready") {
        setRuntimeVersions(message.versions);
        return;
      }
      const pendingReport = message.requestId
        ? pendingReportRendersRef.current.get(message.requestId)
        : undefined;
      if (pendingReport) {
        window.clearTimeout(pendingReport.timeout);
        pendingReportRendersRef.current.delete(message.requestId!);
        if (message.type === "result" && message.svg) {
          pendingReport.resolve(message.svg);
        } else {
          pendingReport.reject(
            new Error(message.message || "WireViz could not render this harness."),
          );
        }
        return;
      }
      if (
        message.requestId !==
        `preview-${previewRequestRef.current.toString()}`
      ) {
        return;
      }
      if (message.type === "result" && message.svg) {
        setPreviewSvg(message.svg);
        setPreviewStatus("ready");
        setPreviewMessage("Preview rendered locally from WireViz DOT.");
      } else if (message.type === "failure") {
        setPreviewStatus("error");
        setPreviewMessage(message.message || "WireViz could not render this harness.");
      }
    };
    worker.onerror = () => {
      setPreviewStatus("error");
      setPreviewMessage("The local rendering worker stopped unexpectedly.");
      for (const pending of pendingReportRendersRef.current.values()) {
        window.clearTimeout(pending.timeout);
        pending.reject(new Error("The local rendering worker stopped unexpectedly."));
      }
      pendingReportRendersRef.current.clear();
    };
    return () => {
      for (const pending of pendingReportRendersRef.current.values()) {
        window.clearTimeout(pending.timeout);
        pending.reject(new Error("The local rendering worker was stopped."));
      }
      pendingReportRendersRef.current.clear();
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const worker = workerRef.current;
      if (!worker) return;
      previewRequestRef.current += 1;
      const requestId = `preview-${previewRequestRef.current.toString()}`;
      setPreviewStatus((status) => {
        setPreviewMessage(
          status === "loading"
            ? "Starting the local WireViz runtime…"
            : "Refreshing the WireViz preview…",
        );
        return status === "loading" ? "loading" : "rendering";
      });
      worker.postMessage({
        type: "render",
        requestId,
        assetBase: new URL(".", document.baseURI).href,
        document: wirevizDocument,
        images: previewImages,
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [previewImages, wirevizDocument]);

  const updateSelected = (
    patch: Partial<HarnessComponent>,
    message?: string,
  ) => {
    if (!selectedId) return;
    updateProject(
      (draft) => {
        const node = draft.components.find(
          (component) => component.id === selectedId,
        );
        if (!node) return;
        Object.assign(node, patch);
      },
      message,
    );
  };

  const createPairFromSelection = () => {
    const issue = twistedPairCreationIssue(project, selectedIds);
    if (issue) {
      setNotice(issue);
      return;
    }
    const pair = createTwistedPair(project, selectedIds);
    updateProject(
      (draft) => {
        draft.twistedPairs.push(pair);
      },
      `${pair.designator} created from the two selected wires.`,
    );
  };

  const updateTwistedPair = (pairId: string, patch: Partial<TwistedPair>) => {
    updateProject((draft) => {
      const pair = draft.twistedPairs.find((candidate) => candidate.id === pairId);
      if (pair) Object.assign(pair, patch);
    });
  };

  const removeTwistedPair = (pairId: string) => {
    updateProject(
      (draft) => {
        draft.twistedPairs = draft.twistedPairs.filter(
          (pair) => pair.id !== pairId,
        );
      },
      "Twisted-pair relationship removed. Member wires were kept.",
    );
  };

  const addAdditionalComponent = (preset: AdditionalComponentPreset) => {
    if (!selectedId) return;
    const component = createAdditionalComponentPreset(preset);
    updateProject(
      (draft) => {
        const node = draft.components.find((item) => item.id === selectedId);
        if (!node) return;
        node.additionalComponents = [
          ...(node.additionalComponents ?? []),
          component,
        ];
      },
      `${component.type || "Additional component"} added.`,
    );
  };

  const updateAdditionalComponent = (
    componentId: string,
    patch: Partial<AdditionalComponent>,
  ) => {
    if (!selectedId) return;
    updateProject((draft) => {
      const node = draft.components.find((item) => item.id === selectedId);
      const component = node?.additionalComponents?.find(
        (item) => item.id === componentId,
      );
      if (component) Object.assign(component, patch);
    });
  };

  const updateCableAdditionalPlacement = (
    componentId: string,
    patch: Partial<AdditionalComponentPlacement>,
  ) => {
    if (!selectedId) return;
    updateProject((draft) => {
      const node = draft.components.find((item) => item.id === selectedId);
      const component = node?.additionalComponents?.find(
        (item) => item.id === componentId,
      );
      if (!component) return;
      const placement = { ...(component.placement ?? {}), ...patch };
      component.placement = Object.values(placement).some(
        (value) => value !== undefined && value !== "",
      )
        ? placement
        : undefined;
    });
  };

  const duplicateAdditionalComponent = (componentId: string) => {
    if (!selectedId) return;
    updateProject(
      (draft) => {
        const node = draft.components.find((item) => item.id === selectedId);
        const source = node?.additionalComponents?.find(
          (item) => item.id === componentId,
        );
        if (!node || !source) return;
        const [copy] = cloneAdditionalComponentsWithNewIds([source]) ?? [];
        if (copy) node.additionalComponents = [...(node.additionalComponents ?? []), copy];
      },
      "Additional component duplicated.",
    );
  };

  const deleteAdditionalComponent = (componentId: string) => {
    if (!selectedId) return;
    updateProject(
      (draft) => {
        const node = draft.components.find((item) => item.id === selectedId);
        if (!node) return;
        const remaining = (node.additionalComponents ?? []).filter(
          (item) => item.id !== componentId,
        );
        node.additionalComponents = remaining.length ? remaining : undefined;
      },
      "Additional component removed.",
    );
  };

  const addApprovedAlternative = () => {
    if (!selectedId) return;
    const alternative = createApprovedPartAlternative();
    updateProject(
      (draft) => {
        const node = draft.components.find((item) => item.id === selectedId);
        if (!node || !supportsApprovedAlternatives(node.kind)) return;
        node.approvedAlternatives = [
          ...(node.approvedAlternatives ?? []),
          alternative,
        ];
      },
      "Approved alternative added.",
    );
  };

  const updateApprovedAlternative = (
    alternativeId: string,
    patch: Partial<ApprovedPartAlternative>,
  ) => {
    if (!selectedId) return;
    updateProject((draft) => {
      const node = draft.components.find((item) => item.id === selectedId);
      const alternative = node?.approvedAlternatives?.find(
        (item) => item.id === alternativeId,
      );
      if (alternative) Object.assign(alternative, patch);
    });
  };

  const duplicateApprovedAlternative = (alternativeId: string) => {
    if (!selectedId) return;
    updateProject(
      (draft) => {
        const node = draft.components.find((item) => item.id === selectedId);
        const source = node?.approvedAlternatives?.find(
          (item) => item.id === alternativeId,
        );
        if (!node || !source) return;
        const [copy] = cloneApprovedAlternativesWithNewIds([source]) ?? [];
        if (copy) {
          node.approvedAlternatives = [
            ...(node.approvedAlternatives ?? []),
            copy,
          ];
        }
      },
      "Approved alternative duplicated.",
    );
  };

  const deleteApprovedAlternative = (alternativeId: string) => {
    if (!selectedId) return;
    updateProject(
      (draft) => {
        const node = draft.components.find((item) => item.id === selectedId);
        if (!node) return;
        const remaining = (node.approvedAlternatives ?? []).filter(
          (item) => item.id !== alternativeId,
        );
        node.approvedAlternatives = remaining.length ? remaining : undefined;
      },
      "Approved alternative removed.",
    );
  };

  const updateTerminationPart = (
    linkId: string,
    partName: "contact" | "seal",
    field: TerminationPartField,
    value: string,
  ) => {
    updateProject((draft) => {
      const link = draft.links.find((candidate) => candidate.id === linkId);
      if (!link) return;
      const termination = structuredClone(link.termination ?? {});
      termination[partName] = {
        ...(termination[partName] ?? {}),
        [field]: value,
      };
      link.termination = compactWireTermination(termination);
    });
  };

  const updateTerminationField = (
    linkId: string,
    field: TerminationField,
    value: string,
  ) => {
    updateProject((draft) => {
      const link = draft.links.find((candidate) => candidate.id === linkId);
      if (!link) return;
      link.termination = compactWireTermination({
        ...(link.termination ?? {}),
        [field]: value,
      });
    });
  };

  const clearTermination = (linkId: string) => {
    updateProject(
      (draft) => {
        const link = draft.links.find((candidate) => candidate.id === linkId);
        if (link) delete link.termination;
      },
      "Termination data removed from the connection.",
    );
  };

  const applyContactToConnector = (connectorId: string, sourceLinkId: string) => {
    const sourceContact = project.links.find(
      (link) => link.id === sourceLinkId,
    )?.termination?.contact;
    if (!sourceContact) {
      setNotice("Enter contact information before applying it to other pins.");
      return;
    }
    let applied = 0;
    updateProject(
      (draft) => {
        applied = applyContactToConnectedPins(draft, connectorId, sourceLinkId);
      },
      "Contact and strip length copied to all connected pins.",
    );
    if (applied === 0) {
      setNotice("This connector has no connected pins.");
    }
  };

  const updateCount = (count: number) => {
    if (!selected) return;
    const nextCount = Math.max(1, Math.min(64, Number.isFinite(count) ? count : 1));
    updateProject((draft) => {
      const node = draft.components.find(
        (component) => component.id === selected.id,
      );
      if (!node) return;
      const isConnector = CONNECTOR_KINDS.includes(node.kind);
      if (isConnector) {
        node.pinCount = nextCount;
        node.pinLabels = listForCount(node.pinLabels, nextCount, "");
      } else {
        node.wireCount = nextCount;
        node.wireLabels = listForCount(node.wireLabels, nextCount, "");
        node.colors = listForCount(node.colors, nextCount, "BK");
      }
      draft.links = draft.links.filter((link) =>
        [link.from, link.to].every((port) => {
          if (port.nodeId !== node.id) return true;
          const expectedPrefix = isConnector ? "pin:" : "wire:";
          return (
            !port.portId.startsWith(expectedPrefix) ||
            parsePortNumber(port.portId) <= nextCount
          );
        }),
      );
    });
  };

  const addComponent = (kind: ComponentKind) => {
    const index = project.components.length + 1;
    let node = makeNode(kind, index);
    const used = new Set(project.components.map((component) => component.designator));
    let suffix = 1;
    const prefix = node.designator.replace(/\d+$/, "");
    while (used.has(node.designator)) {
      suffix += 1;
      node = { ...node, designator: `${prefix}${suffix}` };
    }
    updateProject(
      (draft) => {
        draft.components.push(node);
      },
      `${KIND_META[kind].singular} added. Connect its ports to continue.`,
    );
    selectOnly(node.id);
    setPendingPort(null);
  };

  const removeSelected = () => {
    if (selectedIds.length === 0) return;
    const ids = new Set(selectedIds);
    updateProject(
      (draft) => {
        draft.components = draft.components.filter(
          (component) => !ids.has(component.id),
        );
        draft.links = draft.links.filter(
          (link) => !ids.has(link.from.nodeId) && !ids.has(link.to.nodeId),
        );
        draft.twistedPairs = withoutTwistedPairsForMembers(
          draft.twistedPairs,
          ids,
        );
      },
      `Removed ${selectedIds.length} selected component${
        selectedIds.length === 1 ? "" : "s"
      } and their connections.`,
    );
    selectOnly(null);
    setPendingPort(null);
  };

  const connectPort = (port: PortRef) => {
    if (isPortUsed(project, port)) {
      setNotice("That port is already connected. Remove its link before reconnecting.");
      return;
    }
    if (!pendingPort) {
      setPendingPort(port);
      setNotice("Choose a compatible port to complete the connection.");
      return;
    }
    if (canonicalEndpoint(pendingPort) === canonicalEndpoint(port)) {
      setPendingPort(null);
      setNotice("Connection cancelled.");
      return;
    }
    const firstNode = project.components.find(
      (node) => node.id === pendingPort.nodeId,
    );
    const secondNode = project.components.find((node) => node.id === port.nodeId);
    if (!firstNode || !secondNode) return;
    if (componentGroup(firstNode.kind) === componentGroup(secondNode.kind)) {
      setNotice("Connect a connector, splice, or junction to a cable conductor.");
      return;
    }

    updateProject(
      (draft) => {
        draft.links.push({
          id: `link-${Date.now().toString(36)}`,
          from: pendingPort,
          to: port,
        });
      },
      "Connection added.",
    );
    setPendingPort(null);
  };

  const removeLink = (linkId: string) => {
    updateProject(
      (draft) => {
        draft.links = draft.links.filter((link) => link.id !== linkId);
      },
      "Connection removed.",
    );
    setPendingPort(null);
  };

  const onDragStart = (
    event: React.PointerEvent<HTMLDivElement>,
    node: HarnessComponent,
  ) => {
    if (event.button !== 0 || event.shiftKey) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const ids = selectedIdSet.has(node.id) ? selectedIds : [node.id];
    if (!selectedIdSet.has(node.id)) selectOnly(node.id);
    const origins = Object.fromEntries(
      project.components
        .filter((component) => ids.includes(component.id))
        .map((component) => [
          component.id,
          { x: component.x, y: component.y },
        ]),
    );
    dragDidMoveRef.current = false;
    setDrag({
      ids,
      startX: event.clientX,
      startY: event.clientY,
      origins,
      before: cloneProject(project),
    });
  };

  const onDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const rawDx = (event.clientX - drag.startX) / zoom;
    const rawDy = (event.clientY - drag.startY) / zoom;
    if (Math.abs(rawDx) > 2 || Math.abs(rawDy) > 2) {
      dragDidMoveRef.current = true;
    }
    const draggedNodes = drag.before.components.filter((component) =>
      drag.ids.includes(component.id),
    );
    const minX = Math.min(...draggedNodes.map((component) => component.x));
    const minY = Math.min(...draggedNodes.map((component) => component.y));
    const maxX = Math.max(
      ...draggedNodes.map((component) => component.x + NODE_WIDTH),
    );
    const maxY = Math.max(
      ...draggedNodes.map(
        (component) => component.y + getNodeHeight(component),
      ),
    );
    const dx = Math.min(
      CANVAS_WIDTH - 12 - maxX,
      Math.max(12 - minX, rawDx),
    );
    const dy = Math.min(
      CANVAS_HEIGHT - 12 - maxY,
      Math.max(12 - minY, rawDy),
    );
    setProject((current) => ({
      ...current,
      components: current.components.map((component) =>
        drag.origins[component.id]
          ? {
              ...component,
              x: drag.origins[component.id].x + dx,
              y: drag.origins[component.id].y + dy,
            }
          : component,
      ),
    }));
  };

  const onDragEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (dragDidMoveRef.current) {
      pastRef.current.push(drag.before);
      futureRef.current = [];
      setHistoryState({ canUndo: true, canRedo: false });
      setDirty(true);
      setNotice(
        `Moved ${drag.ids.length} component${drag.ids.length === 1 ? "" : "s"}.`,
      );
      window.setTimeout(() => {
        dragDidMoveRef.current = false;
      }, 0);
    }
    setDrag(null);
  };

  const canvasPoint = (
    event: React.PointerEvent<HTMLDivElement>,
  ): { x: number; y: number } => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) / zoom,
      y: (event.clientY - bounds.top) / zoom,
    };
  };

  const onCanvasPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as Element;
    if (
      target.closest(".harness-node") ||
      target.closest(".connection-line")
    ) {
      return;
    }
    const point = canvasPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setMarquee({
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
      initialIds: event.shiftKey ? selectedIds : [],
    });
    if (!event.shiftKey) selectOnly(null);
    setPendingPort(null);
  };

  const onCanvasPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!marquee) return;
    const point = canvasPoint(event);
    const left = Math.min(marquee.startX, point.x);
    const right = Math.max(marquee.startX, point.x);
    const top = Math.min(marquee.startY, point.y);
    const bottom = Math.max(marquee.startY, point.y);
    const hitIds = project.components
      .filter((component) => {
        const componentRight = component.x + NODE_WIDTH;
        const componentBottom = component.y + getNodeHeight(component);
        return (
          component.x < right &&
          componentRight > left &&
          component.y < bottom &&
          componentBottom > top
        );
      })
      .map((component) => component.id);
    const nextIds = Array.from(new Set([...marquee.initialIds, ...hitIds]));
    setSelectedIds(nextIds);
    setSelectedId((current) =>
      current && nextIds.includes(current) ? current : (nextIds[0] ?? null),
    );
    setMarquee({ ...marquee, currentX: point.x, currentY: point.y });
  };

  const onCanvasPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!marquee) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const distance = Math.hypot(
      marquee.currentX - marquee.startX,
      marquee.currentY - marquee.startY,
    );
    if (distance >= 3) {
      setNotice(
        `${selectedIds.length} component${
          selectedIds.length === 1 ? "" : "s"
        } selected. Drag any selected header to move the group.`,
      );
    } else if (marquee.initialIds.length === 0) {
      setNotice("Selection cleared.");
    }
    setMarquee(null);
  };

  const downloadText = (content: string, name: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const downloadProject = () => {
    downloadText(
      serializeProjectFile(project),
      `${filenameFor(project.title)}.wireform.json`,
      "application/json;charset=utf-8",
    );
    setDirty(false);
    setNotice("Editable WireForm project downloaded.");
  };

  const downloadBom = () => {
    const rows = buildBomRows(project);
    downloadText(
      serializeBomCsv(rows),
      bomFilenameForTitle(project.title),
      "text/csv;charset=utf-8",
    );
    setNotice(
      rows.length
        ? `BOM CSV downloaded with ${rows.length} line item${rows.length === 1 ? "" : "s"}.`
        : "Header-only BOM CSV downloaded; this harness has no BOM items.",
    );
  };

  const requestReportDiagram = () => {
    const worker = workerRef.current;
    if (!worker) {
      return Promise.reject(
        new Error("The local WireViz renderer is not available yet."),
      );
    }
    reportRequestRef.current += 1;
    const requestId = `report-${reportRequestRef.current.toString()}`;
    return new Promise<string>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pendingReportRendersRef.current.delete(requestId);
        reject(new Error("The harness diagram did not finish rendering."));
      }, 180_000);
      pendingReportRendersRef.current.set(requestId, {
        resolve,
        reject,
        timeout,
      });
      worker.postMessage({
        type: "render",
        requestId,
        assetBase: new URL(".", document.baseURI).href,
        document: wirevizDocument,
        images: previewImages,
      });
    });
  };

  const downloadHtmlReport = async () => {
    if (validation.errors.length) {
      setNotice("Resolve validation errors before exporting an HTML report.");
      return;
    }
    setReportExporting(true);
    setNotice("Rendering the self-contained HTML harness report…");
    try {
      const diagramSvg = await requestReportDiagram();
      const report = buildHarnessReportModel(project, diagramSvg);
      downloadText(
        renderHarnessReportHtml(report),
        htmlReportFilenameForTitle(project.title),
        "text/html;charset=utf-8",
      );
      setNotice("Self-contained HTML harness report downloaded.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `HTML report export failed: ${error.message}`
          : "The HTML report could not be generated.",
      );
    } finally {
      setReportExporting(false);
    }
  };

  const downloadPdfReport = async () => {
    if (validation.errors.length) {
      setNotice("Resolve validation errors before exporting a PDF report.");
      return;
    }
    setPdfExporting(true);
    setNotice("Rendering the native PDF harness report…");
    try {
      const diagramSvg = await requestReportDiagram();
      const report = buildHarnessReportModel(project, diagramSvg);
      const { downloadHarnessPdf, pdfReportFilenameForTitle } = await import(
        "./pdf-report"
      );
      const result = await downloadHarnessPdf(
        report,
        pdfReportFilenameForTitle(project.title),
      );
      setNotice(
        result.warnings.length
          ? `PDF report downloaded. ${result.warnings.join(" ")}`
          : "Native PDF harness report downloaded.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `PDF report export failed: ${error.message}`
          : "The PDF report could not be generated.",
      );
    } finally {
      setPdfExporting(false);
    }
  };

  const openProjectFile = async (file: File) => {
    try {
      const parsed = parseProjectFile(await file.text());
      if (
        dirty &&
        !window.confirm(
          "Open this project and replace the current canvas? The current state remains in local autosave until the new project is applied.",
        )
      ) {
        return;
      }
      replaceProject(
        parsed.project,
        parsed.migratedFrom
          ? `Project opened and migrated from schema ${parsed.migratedFrom}.`
          : "Editable WireForm project opened.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "The project could not be opened.",
      );
    } finally {
      if (projectInputRef.current) projectInputRef.current.value = "";
    }
  };

  const openWireVizYaml = async (file: File) => {
    try {
      const candidate = importWireVizYaml(await file.text(), file.name);
      setImportCandidate(candidate);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "The YAML import failed.",
      );
    } finally {
      if (yamlInputRef.current) yamlInputRef.current.value = "";
    }
  };

  const applyWireVizImport = () => {
    if (!importCandidate) return;
    if (
      dirty &&
      !window.confirm(
        "Import this YAML and replace the current canvas? Download the current WireForm project first if you need a portable backup.",
      )
    ) {
      return;
    }
    replaceProject(
      importCandidate.project,
      `Imported ${importCandidate.report.components} components and ${importCandidate.report.links} connections from WireViz YAML.`,
      true,
    );
    setImportCandidate(null);
  };

  const downloadYaml = () => {
    if (validation.errors.length) {
      setNotice("Resolve validation errors before downloading YAML.");
      return;
    }
    downloadText(
      yaml,
      `${filenameFor(project.title)}.yml`,
      "application/yaml;charset=utf-8",
    );
    setNotice("WireViz YAML downloaded.");
  };

  const addSelectionToLibrary = () => {
    if (!activeLibrary || selectedIds.length === 0) return;
    const selectedSet = new Set(selectedIds);
    const templates = project.components
      .filter((component) => selectedSet.has(component.id))
      .map((component) => componentToTemplate(component));
    const next = structuredClone(libraries);
    const library = next.libraries.find(
      (candidate) => candidate.id === next.activeLibraryId,
    );
    const result = library
      ? mergeTemplates(library, templates, duplicateMode)
      : { added: 0, replaced: 0, skipped: templates.length };
    setLibraries(next);
    setNotice(
      `Library updated: ${result.added} added, ${result.replaced} replaced, ${result.skipped} skipped.`,
    );
  };

  const downloadSelectedTemplates = () => {
    if (selectedIds.length === 0) return;
    const selectedSet = new Set(selectedIds);
    const components = project.components.filter((component) =>
      selectedSet.has(component.id),
    );
    downloadText(
      serializeTemplateSelection(`${project.title} selection`, components),
      `${filenameFor(project.title)}-selection.wireviz-library.json`,
      "application/json;charset=utf-8",
    );
    setNotice("Selected component templates downloaded.");
  };

  const exportActiveLibrary = () => {
    if (!activeLibrary) return;
    downloadText(
      serializeLibrary(activeLibrary),
      `${filenameFor(activeLibrary.name)}.wireviz-library.json`,
      "application/json;charset=utf-8",
    );
    setNotice(`Library "${activeLibrary.name}" downloaded.`);
  };

  const backupLibraries = () => {
    downloadText(
      serializeLibraryBackup(libraries),
      "wireform-library-backup.json",
      "application/json;charset=utf-8",
    );
    setNotice("All user libraries downloaded as a backup.");
  };

  const importLibraryFile = async (file: File) => {
    try {
      const parsed = parseLibraryFile(await file.text());
      if (parsed.kind === "backup") {
        if (
          !window.confirm(
            "Restore this backup and replace all user libraries currently stored in this browser?",
          )
        ) {
          return;
        }
        setLibraries(parsed.collection);
        setNotice(
          `Restored ${parsed.collection.libraries.length} user libraries from backup.`,
        );
        return;
      }
      const next = structuredClone(libraries);
      let library = next.libraries.find(
        (candidate) => candidate.id === next.activeLibraryId,
      );
      if (!library) {
        library = createLibrary(parsed.library.name);
        next.libraries.push(library);
        next.activeLibraryId = library.id;
      }
      const result = mergeTemplates(
        library,
        parsed.library.templates,
        duplicateMode,
      );
      setLibraries(next);
      setNotice(
        `Library import complete: ${result.added} added, ${result.replaced} replaced, ${result.skipped} skipped.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Library import failed.");
    } finally {
      if (libraryInputRef.current) libraryInputRef.current.value = "";
    }
  };

  const createNamedLibrary = () => {
    const name = newLibraryName.trim();
    if (!name) {
      setNotice("Enter a name for the new user library.");
      return;
    }
    if (libraries.libraries.length >= 50) {
      setNotice("A browser profile may contain at most 50 user libraries.");
      return;
    }
    const library = createLibrary(name);
    setLibraries((current) => ({
      ...current,
      activeLibraryId: library.id,
      libraries: [...current.libraries, library],
    }));
    setNewLibraryName("");
    setNotice(`Created user library "${library.name}".`);
  };

  const renameActiveLibrary = (name: string) => {
    setLibraries((current) => {
      const next = structuredClone(current);
      const library = next.libraries.find(
        (candidate) => candidate.id === next.activeLibraryId,
      );
      if (library) {
        library.name = name.slice(0, 240);
        library.updatedAt = new Date().toISOString();
      }
      return next;
    });
  };

  const deleteActiveLibrary = () => {
    if (!activeLibrary) return;
    if (
      !window.confirm(
        `Delete "${activeLibrary.name}" and its ${activeLibrary.templates.length} templates from this browser?`,
      )
    ) {
      return;
    }
    setLibraries((current) => {
      const remaining = current.libraries.filter(
        (library) => library.id !== current.activeLibraryId,
      );
      if (remaining.length === 0) remaining.push(createLibrary());
      return {
        ...current,
        activeLibraryId: remaining[0].id,
        libraries: remaining,
      };
    });
    setNotice("User library deleted.");
  };

  const updateTemplateName = (templateId: string, name: string) => {
    setLibraries((current) => {
      const next = structuredClone(current);
      const library = next.libraries.find(
        (candidate) => candidate.id === next.activeLibraryId,
      );
      const template = library?.templates.find(
        (candidate) => candidate.id === templateId,
      );
      if (template) {
        template.name = name.slice(0, 240);
        template.updatedAt = new Date().toISOString();
      }
      return next;
    });
  };

  const removeTemplate = (templateId: string) => {
    setLibraries((current) => {
      const next = structuredClone(current);
      const library = next.libraries.find(
        (candidate) => candidate.id === next.activeLibraryId,
      );
      if (library) {
        library.templates = library.templates.filter(
          (template) => template.id !== templateId,
        );
        library.updatedAt = new Date().toISOString();
      }
      return next;
    });
    setNotice("Template removed from the user library.");
  };

  const addTemplateToCanvas = (template: ComponentTemplate) => {
    const node = instantiateTemplate(template, project.components.length + 1);
    const used = new Set(
      project.components.map((component) => component.designator),
    );
    const base = node.designator || KIND_META[node.kind].label.charAt(0);
    let designator = base;
    let suffix = 2;
    while (used.has(designator)) {
      designator = `${base}_${suffix}`;
      suffix += 1;
    }
    node.designator = designator;
    updateProject(
      (draft) => {
        draft.components.push(node);
      },
      `Added "${template.name}" from ${activeLibrary?.name ?? "the user library"}.`,
    );
    selectOnly(node.id);
    setLibraryOpen(false);
  };

  const uploadConnectorPhoto = async (file: File) => {
    if (!selected || selected.kind !== "connector") return;
    try {
      const photo = await prepareConnectorPhoto(
        file,
        `${selected.designator} ${selected.name}`.trim(),
      );
      updateSelected({ photo }, "Connector photo added to the canvas and preview.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "The photo could not be added.",
      );
    } finally {
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  };

  const uploadHarnessImages = async (files: FileList | File[]) => {
    const successful: HarnessImage[] = [];
    const failures: string[] = [];
    for (const file of Array.from(files)) {
      try {
        successful.push(await prepareHarnessImage(file));
      } catch (error) {
        failures.push(
          `${file.name}: ${
            error instanceof Error ? error.message : "The image could not be added."
          }`,
        );
      }
    }
    if (successful.length) {
      updateProject(
        (draft) => {
          draft.harnessImages.push(...successful);
        },
        `${successful.length} harness image${successful.length === 1 ? "" : "s"} added.${
          failures.length ? ` ${failures.join(" ")}` : ""
        }`,
      );
    } else if (failures.length) {
      setNotice(failures.join(" "));
    }
    if (harnessImagesInputRef.current) harnessImagesInputRef.current.value = "";
  };

  const replaceHarnessImage = async (imageId: string, file: File) => {
    try {
      const replacement = await prepareHarnessImage(file);
      updateProject(
        (draft) => {
          const index = draft.harnessImages.findIndex((image) => image.id === imageId);
          if (index < 0) return;
          const current = draft.harnessImages[index];
          draft.harnessImages[index] = {
            ...current,
            dataUrl: replacement.dataUrl,
            mimeType: replacement.mimeType,
            originalFilename: replacement.originalFilename,
            width: replacement.width,
            height: replacement.height,
          };
        },
        "Harness image replaced.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "The image could not be replaced.",
      );
    } finally {
      harnessImageReplaceIdRef.current = null;
      if (harnessImageReplaceInputRef.current) {
        harnessImageReplaceInputRef.current.value = "";
      }
    }
  };

  const updateHarnessImage = (
    imageId: string,
    values: Partial<Pick<HarnessImage, "title" | "caption">>,
  ) => {
    updateProject((draft) => {
      const image = draft.harnessImages.find((candidate) => candidate.id === imageId);
      if (image) Object.assign(image, values);
    });
  };

  const removeHarnessImage = (imageId: string) => {
    updateProject(
      (draft) => {
        draft.harnessImages = draft.harnessImages.filter(
          (image) => image.id !== imageId,
        );
      },
      "Harness image removed. Undo is available.",
    );
  };

  const moveHarnessImage = (imageId: string, direction: -1 | 1) => {
    updateProject(
      (draft) => {
        const index = draft.harnessImages.findIndex((image) => image.id === imageId);
        const nextIndex = index + direction;
        if (index < 0 || nextIndex < 0 || nextIndex >= draft.harnessImages.length) {
          return;
        }
        const [image] = draft.harnessImages.splice(index, 1);
        draft.harnessImages.splice(nextIndex, 0, image);
      },
      "Harness image order updated.",
    );
  };

  const newProject = () => {
    if (
      dirty &&
      !window.confirm(
        "Start a new harness? The current project remains in local autosave, but unsaved file changes will not be downloaded.",
      )
    ) {
      return;
    }
    replaceProject(createEmptyProject(), "New empty harness created.", true);
  };

  const resetProject = () => {
    if (
      dirty &&
      !window.confirm(
        "Restore the example harness and replace the current canvas?",
      )
    ) {
      return;
    }
    const next = createStarterProject();
    replaceProject(next, "Example harness restored.", true);
  };

  const previewDataUri = previewSvg
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(previewSvg)}`
    : "";

  return (
    <main className="studio">
      <header className="topbar">
        <div className="brand" aria-label="WireForm home">
          <span className="brand-mark" aria-hidden="true">
            <Link2 size={19} strokeWidth={2.4} />
          </span>
          <div>
            <strong>WireForm</strong>
            <span>for WireViz</span>
          </div>
        </div>

        <div className="project-heading">
          <label>
            <span className="sr-only">Harness title</span>
            <input
              value={project.title}
              onChange={(event) =>
                updateProject((draft) => {
                  draft.title = event.target.value;
                })
              }
              className="title-input"
            />
          </label>
          <span className="revision-chip">REV {project.revision || "—"}</span>
          <span
            className={`autosave-chip autosave-${autosaveStatus}`}
            title="Projects are autosaved in this browser"
          >
            <Database size={11} />
            {autosaveStatus === "loading"
              ? "Loading"
              : autosaveStatus === "saving"
                ? "Saving"
                : autosaveStatus === "error"
                  ? "Autosave error"
                  : "Saved locally"}
          </span>
        </div>

        <div className="top-actions">
          <button
            className="icon-button"
            onClick={newProject}
            aria-label="New empty project"
            title="New empty project"
          >
            <FilePlus2 size={16} />
          </button>
          <button
            className="icon-button"
            onClick={() => projectInputRef.current?.click()}
            aria-label="Open WireForm project"
            title="Open editable WireForm project"
          >
            <FolderOpen size={16} />
          </button>
          <button
            className="icon-button"
            onClick={downloadProject}
            aria-label="Save WireForm project"
            title="Download editable WireForm project"
          >
            <Save size={16} />
          </button>
          <button
            className="icon-button"
            onClick={downloadBom}
            aria-label="Export BOM CSV"
            title="Export native BOM CSV"
          >
            <FileSpreadsheet size={16} />
          </button>
          <button
            className="icon-button"
            onClick={() => void downloadHtmlReport()}
            disabled={reportExporting || pdfExporting}
            aria-label={reportExporting ? "Generating HTML report" : "Export HTML report"}
            title="Export self-contained HTML harness report"
          >
            {reportExporting ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <FileText size={16} />
            )}
          </button>
          <button
            className="icon-button"
            onClick={() => void downloadPdfReport()}
            disabled={pdfExporting || reportExporting}
            aria-label={pdfExporting ? "Generating PDF report" : "Export PDF report"}
            title="Export native PDF harness report"
          >
            {pdfExporting ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <FileDown size={16} />
            )}
          </button>
          <button
            className="icon-button"
            onClick={() => yamlInputRef.current?.click()}
            aria-label="Import WireViz YAML"
            title="Import existing WireViz YAML"
          >
            <FileUp size={16} />
          </button>
          <button
            className="icon-button"
            onClick={undo}
            disabled={!historyState.canUndo}
            aria-label="Undo"
            title="Undo"
          >
            <Undo2 size={17} />
          </button>
          <button
            className="icon-button"
            onClick={redo}
            disabled={!historyState.canRedo}
            aria-label="Redo"
            title="Redo"
          >
            <Redo2 size={17} />
          </button>
          <button
            className="icon-button"
            onClick={copySelection}
            disabled={selectedIds.length === 0}
            aria-label="Copy selected components"
            title="Copy selected components (⌘/Ctrl+C)"
          >
            <Copy size={16} />
          </button>
          <button
            className="icon-button"
            onClick={pasteSelection}
            disabled={!hasClipboard}
            aria-label="Paste copied components"
            title="Paste copied components (⌘/Ctrl+V)"
          >
            <ClipboardPaste size={16} />
          </button>
          <span className="toolbar-divider" />
          <div
            className={`validation-pill ${
              validation.errors.length ? "has-errors" : ""
            }`}
          >
            {validation.errors.length ? (
              <AlertTriangle size={15} />
            ) : (
              <CheckCircle2 size={15} />
            )}
            <span>
              {validation.errors.length
                ? `${validation.errors.length} issue${
                    validation.errors.length === 1 ? "" : "s"
                  }`
                : "Harness valid"}
            </span>
          </div>
          <button
            className="primary-button"
            onClick={downloadYaml}
            disabled={validation.errors.length > 0}
          >
            <Download size={16} />
            Download YAML
          </button>
          <input
            ref={projectInputRef}
            type="file"
            accept=".json,.wireform.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void openProjectFile(file);
            }}
          />
          <input
            ref={yamlInputRef}
            type="file"
            accept=".yaml,.yml,application/yaml,text/yaml"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void openWireVizYaml(file);
            }}
          />
        </div>
      </header>

      <div className="workspace">
        <aside className="palette-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Build</span>
              <h2>Components</h2>
            </div>
            <Plus size={17} />
          </div>
          <p className="panel-intro">
            Add an object, then click two compatible ports to connect them.
          </p>

          <button
            className={`harness-notes-button ${
              !selected && harnessView === "notes" ? "active" : ""
            }`}
            onClick={() => {
              setHarnessView("notes");
              selectOnly(null);
            }}
            data-testid="open-harness-notes"
          >
            <FileText size={17} />
            <span>
              <strong>Harness notes</strong>
              <small>Project-wide documentation</small>
            </span>
          </button>
          <button
            className={`harness-notes-button ${
              !selected && harnessView === "images" ? "active" : ""
            }`}
            onClick={() => {
              setHarnessView("images");
              selectOnly(null);
            }}
            data-testid="open-harness-images"
          >
            <Images size={17} />
            <span>
              <strong>Harness images</strong>
              <small>Project documentation photos</small>
            </span>
          </button>

          <div className="component-palette">
            {(Object.keys(KIND_META) as ComponentKind[]).map((kind) => {
              const meta = KIND_META[kind];
              const Icon = meta.icon;
              return (
                <button
                  key={kind}
                  className="palette-item"
                  onClick={() => addComponent(kind)}
                  data-testid={`add-${kind}`}
                >
                  <span className={`palette-icon kind-${kind}`}>
                    <Icon size={17} />
                  </span>
                  <span>
                    <strong>{meta.label}</strong>
                    <small>{meta.description}</small>
                  </span>
                  <Plus size={15} className="palette-plus" />
                </button>
              );
            })}
          </div>

          <div className="library-card">
            <div className="library-title">
              <Library size={16} />
              <strong>User libraries</strong>
            </div>
            <p>
              {activeLibrary?.name ?? "My Components"} ·{" "}
              {activeLibrary?.templates.length ?? 0} templates
            </p>
            <div className="library-actions">
              <button onClick={() => setLibraryOpen(true)}>
                <Library size={14} />
                Manage
              </button>
              <button
                onClick={addSelectionToLibrary}
                disabled={selectedIds.length === 0}
              >
                <Plus size={14} />
                Add selected
              </button>
            </div>
          </div>

          <button className="reset-link" onClick={resetProject}>
            <RotateCcw size={14} />
            Restore example harness
          </button>
        </aside>

        <section className="canvas-section">
          <div className="canvas-toolbar">
            <div className="canvas-context">
              <span className="status-dot" />
              <strong>Harness topology</strong>
              <span>
                {project.components.length} components · {project.links.length}{" "}
                terminations
              </span>
            </div>
            <div className="canvas-actions">
              {pendingPort && (
                <button
                  className="connection-mode"
                  onClick={() => setPendingPort(null)}
                >
                  <span />
                  Connecting
                  <X size={13} />
                </button>
              )}
              <button
                className="icon-button light"
                onClick={() => setZoom((value) => Math.max(0.55, value - 0.1))}
                aria-label="Zoom out"
              >
                <ZoomOut size={16} />
              </button>
              <span className="zoom-value">{Math.round(zoom * 100)}%</span>
              <button
                className="icon-button light"
                onClick={() => setZoom((value) => Math.min(1.25, value + 0.1))}
                aria-label="Zoom in"
              >
                <ZoomIn size={16} />
              </button>
            </div>
          </div>

          <div className="canvas-scroll">
            <div
              className="canvas-zoom"
              style={{
                width: CANVAS_WIDTH * zoom,
                height: CANVAS_HEIGHT * zoom,
              }}
            >
              <div
                className="canvas"
                style={{
                  width: CANVAS_WIDTH,
                  height: CANVAS_HEIGHT,
                  transform: `scale(${zoom})`,
                }}
                onPointerDown={onCanvasPointerDown}
                onPointerMove={onCanvasPointerMove}
                onPointerUp={onCanvasPointerUp}
                onPointerCancel={onCanvasPointerUp}
              >
                <svg
                  className="link-layer"
                  width={CANVAS_WIDTH}
                  height={CANVAS_HEIGHT}
                  aria-label="Harness connections"
                >
                  {project.links.map((link) => {
                    const fromNode = project.components.find(
                      (node) => node.id === link.from.nodeId,
                    );
                    const toNode = project.components.find(
                      (node) => node.id === link.to.nodeId,
                    );
                    if (!fromNode || !toNode) return null;
                    const from = nodePoint(fromNode, link.from);
                    const to = nodePoint(toNode, link.to);
                    const bend = Math.max(60, Math.abs(to.x - from.x) * 0.44);
                    const direction = to.x >= from.x ? 1 : -1;
                    const cableNode = CABLE_KINDS.includes(fromNode.kind)
                      ? fromNode
                      : CABLE_KINDS.includes(toNode.kind)
                        ? toNode
                        : undefined;
                    const cablePort = cableNode
                      ? link.from.nodeId === cableNode.id
                        ? link.from
                        : link.to
                      : undefined;
                    const wireCode =
                      cableNode && cablePort?.portId.startsWith("wire:")
                        ? (cableNode.colors[
                            parsePortNumber(cablePort.portId) - 1
                          ] ?? "BK")
                        : undefined;
                    const color = wireCode
                      ? getWireColorHex(wireCode)
                      : "#667a86";
                    const stripeColor = wireCode
                      ? getWireColorStripeHex(wireCode)
                      : undefined;
                    const path = `M ${from.x} ${from.y} C ${
                      from.x + bend * direction
                    } ${from.y}, ${to.x - bend * direction} ${to.y}, ${
                      to.x
                    } ${to.y}`;
                    return (
                      <g key={link.id} className="connection-line">
                        <path
                          d={path}
                          className="connection-hit"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeLink(link.id);
                          }}
                        />
                        <path
                          d={path}
                          className="connection-outline"
                        />
                        <path
                          d={path}
                          stroke={color}
                          className="connection-visible"
                        />
                        {stripeColor && (
                          <path
                            d={path}
                            stroke={stripeColor}
                            className="connection-stripe"
                          />
                        )}
                      </g>
                    );
                  })}
                </svg>

                {project.components.map((node) => {
                  const meta = KIND_META[node.kind];
                  const Icon = meta.icon;
                  const isSelected = selectedIdSet.has(node.id);
                  const rows = getNodeRows(node);
                  const twistedPair = findTwistedPairForWire(project, node.id);
                  const pairedWire = twistedPair
                    ? project.components.find(
                        (component) =>
                          component.id ===
                          twistedPair.members.find((member) => member !== node.id),
                      )
                    : undefined;
                  return (
                    <article
                      key={node.id}
                      className={`harness-node node-${node.kind} ${
                        isSelected ? "selected" : ""
                      }`}
                      style={{
                        left: node.x,
                        top: node.y,
                        width: NODE_WIDTH,
                        height: getNodeHeight(node),
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (dragDidMoveRef.current) {
                          dragDidMoveRef.current = false;
                          return;
                        }
                        if (event.shiftKey) {
                          const nextIds = isSelected
                            ? selectedIds.filter((id) => id !== node.id)
                            : [...selectedIds, node.id];
                          setSelectedIds(nextIds);
                          setSelectedId((current) => {
                            if (!isSelected) return node.id;
                            return current === node.id
                              ? (nextIds[0] ?? null)
                              : current;
                          });
                          setNotice(
                            `${nextIds.length} component${
                              nextIds.length === 1 ? "" : "s"
                            } selected.`,
                          );
                        } else {
                          selectOnly(node.id);
                        }
                      }}
                      data-testid={`node-${node.designator}`}
                    >
                      <div
                        className="node-header"
                        onPointerDown={(event) => onDragStart(event, node)}
                        onPointerMove={onDragMove}
                        onPointerUp={onDragEnd}
                        onPointerCancel={onDragEnd}
                      >
                        <span className={`node-kind-icon kind-${node.kind}`}>
                          <Icon size={15} />
                        </span>
                        <div>
                          <strong>{node.designator}</strong>
                          <span>{node.name || meta.singular}</span>
                        </div>
                        <span className="node-kind-label">{meta.label}</span>
                        {twistedPair && (
                          <span
                            className="twisted-pair-badge"
                            title={`Paired with ${pairedWire?.designator ?? "missing wire"}`}
                          >
                            <Combine size={10} />
                            {twistedPair.designator || "Twisted pair"}
                            {twistedPair.twistPitchMm !== undefined
                              ? ` · ${twistedPair.twistPitchMm} mm`
                              : ""}
                          </span>
                        )}
                      </div>
                      {node.photo && (
                        <div className="node-photo">
                          <img
                            src={node.photo.dataUrl}
                            alt={node.photo.alt}
                            draggable={false}
                          />
                        </div>
                      )}
                      <div className="node-rows">
                        {Array.from({ length: Math.max(rows, 1) }, (_, index) => {
                          const isShield =
                            CABLE_KINDS.includes(node.kind) &&
                            node.shield &&
                            index === node.wireCount;
                          const number = index + 1;
                          const portId = isShield
                            ? "shield"
                            : CONNECTOR_KINDS.includes(node.kind)
                              ? `pin:${number}`
                              : `wire:${number}`;
                          const label = isShield
                            ? "Shield"
                            : CONNECTOR_KINDS.includes(node.kind)
                              ? node.pinLabels[index] || `Pin ${number}`
                              : node.wireLabels[index] || `Conductor ${number}`;
                          const colorCode =
                            !isShield && CABLE_KINDS.includes(node.kind)
                              ? (node.colors[index] ?? "BK")
                              : undefined;
                           const terminationLink = CONNECTOR_KINDS.includes(
                             node.kind,
                           )
                             ? findConnectorPinLink(project, node.id, number)
                             : undefined;
                           const terminationLabel =
                             getTerminationPartLabel(
                               terminationLink?.termination?.contact,
                             ) ||
                             getTerminationPartLabel(
                               terminationLink?.termination?.seal,
                             ) ||
                             "Termination manufacturing data";
                          return (
                            <div className="node-row" key={`${node.id}-${portId}`}>
                              <button
                                className={`port left ${
                                  pendingPort &&
                                  canonicalEndpoint(pendingPort) ===
                                    canonicalEndpoint({
                                      nodeId: node.id,
                                      portId,
                                      side: "left",
                                    })
                                    ? "pending"
                                    : ""
                                } ${
                                  isPortUsed(project, {
                                    nodeId: node.id,
                                    portId,
                                    side: "left",
                                  })
                                    ? "used"
                                    : ""
                                }`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  connectPort({
                                    nodeId: node.id,
                                    portId,
                                    side: "left",
                                  });
                                }}
                                aria-label={`Connect ${node.designator} ${label} left`}
                              />
                              <span
                                className={`row-swatch ${colorCode ? "wire-color" : ""}`}
                                style={
                                  colorCode
                                    ? {
                                        background:
                                          getWireColorCssBackground(colorCode),
                                      }
                                    : undefined
                                }
                                title={
                                  colorCode
                                    ? getWireColorDisplay(colorCode)
                                    : undefined
                                }
                              >
                                {isShield ? <Shield size={11} /> : number}
                              </span>
                              <span className="row-label">{label}</span>
                               {hasWireTerminationData(
                                 terminationLink?.termination,
                               ) && (
                                 <span
                                   className="termination-badge"
                                   title={terminationLabel}
                                   aria-label={`Termination: ${terminationLabel}`}
                                 >
                                   T
                                 </span>
                               )}
                              {!isShield && CABLE_KINDS.includes(node.kind) && (
                                <small>{node.colors[index] || "BK"}</small>
                              )}
                              <button
                                className={`port right ${
                                  pendingPort &&
                                  canonicalEndpoint(pendingPort) ===
                                    canonicalEndpoint({
                                      nodeId: node.id,
                                      portId,
                                      side: "right",
                                    })
                                    ? "pending"
                                    : ""
                                } ${
                                  isPortUsed(project, {
                                    nodeId: node.id,
                                    portId,
                                    side: "right",
                                  })
                                    ? "used"
                                    : ""
                                }`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  connectPort({
                                    nodeId: node.id,
                                    portId,
                                    side: "right",
                                  });
                                }}
                                aria-label={`Connect ${node.designator} ${label} right`}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}

                {marquee && (
                  <div
                    className="selection-marquee"
                    style={{
                      left: Math.min(marquee.startX, marquee.currentX),
                      top: Math.min(marquee.startY, marquee.currentY),
                      width: Math.abs(marquee.currentX - marquee.startX),
                      height: Math.abs(marquee.currentY - marquee.startY),
                    }}
                    aria-hidden="true"
                  />
                )}
              </div>
            </div>
          </div>

          <div className="canvas-footer">
            <div className="notice-bar" role="status">
              <CircleDot size={14} />
              <span>{notice}</span>
              <span className="selection-help">
                Drag empty space to select · Shift-click to add · ⌘/Ctrl+C/V
              </span>
              {validation.warnings.length > 0 && (
                <span className="warning-count">
                  {validation.warnings.length} warning
                  {validation.warnings.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
            {(validation.errors.length > 0 ||
              validation.warnings.length > 0) && (
              <div
                className="topology-issues"
                aria-label="Current topology validation issues"
                aria-live="polite"
              >
                {validation.errors.length > 0 && (
                  <section className="topology-issue-group topology-errors">
                    <strong>
                      {validation.errors.length} blocking issue
                      {validation.errors.length === 1 ? "" : "s"}
                    </strong>
                    <ul>
                      {validation.errors.map((issue, index) => (
                        <li key={`error-${index}-${issue}`}>{issue}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {validation.warnings.length > 0 && (
                  <section className="topology-issue-group topology-warnings">
                    <strong>
                      {validation.warnings.length} warning
                      {validation.warnings.length === 1 ? "" : "s"}
                    </strong>
                    <ul>
                      {validation.warnings.map((warning, index) => (
                        <li key={`warning-${index}-${warning}`}>{warning}</li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}
          </div>
        </section>

        <aside className="inspector-panel">
          <div className="panel-heading inspector-heading">
            <div>
              <span className="eyebrow">Inspect</span>
              <h2>
                {selectedIds.length > 1
                  ? `${selectedIds.length} selected`
                  : selected
                    ? selected.designator
                    : "Harness"}
              </h2>
            </div>
            {selected && (
              <button
                className="delete-button"
                onClick={removeSelected}
                aria-label="Delete selected component"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>

          <div className="inspector-scroll">
            {!selected ? (
              <div className="property-section">
                {harnessView === "images" ? (
                  <div
                    className="harness-images-editor"
                    data-testid="harness-images-editor"
                  >
                    <div className="harness-images-heading">
                      <div>
                        <h3>Harness Images</h3>
                        <p>Project-level assembly and installation documentation.</p>
                      </div>
                      <span>{storageSizeLabel(harnessImageStorageBytes)}</span>
                    </div>
                    <button
                      type="button"
                      className="photo-upload harness-images-upload"
                      onClick={() => harnessImagesInputRef.current?.click()}
                    >
                      <ImagePlus size={20} />
                      <strong>Add images</strong>
                      <span>JPEG or PNG · multiple files supported</span>
                    </button>
                    <input
                      ref={harnessImagesInputRef}
                      type="file"
                      accept="image/jpeg,image/png"
                      multiple
                      hidden
                      onChange={(event) => {
                        const files = event.target.files;
                        if (files?.length) void uploadHarnessImages(files);
                      }}
                    />
                    <input
                      ref={harnessImageReplaceInputRef}
                      type="file"
                      accept="image/jpeg,image/png"
                      hidden
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        const imageId = harnessImageReplaceIdRef.current;
                        if (file && imageId) void replaceHarnessImage(imageId, file);
                      }}
                    />
                    {project.harnessImages.length ? (
                      <div className="harness-image-list">
                        {project.harnessImages.map((image, index) => (
                          <article
                            className="harness-image-card"
                            key={image.id}
                            data-testid={`harness-image-${index + 1}`}
                          >
                            <img
                              src={image.dataUrl}
                              alt={
                                image.title ||
                                image.caption ||
                                image.originalFilename ||
                                `Harness image ${index + 1}`
                              }
                            />
                            <div className="harness-image-file">
                              <strong>
                                {image.originalFilename || `Image ${index + 1}`}
                              </strong>
                              <span>
                                {image.width} × {image.height} px · {image.mimeType}
                              </span>
                            </div>
                            <Field label="Title" hint="optional">
                              <input
                                aria-label={`Harness image ${index + 1} title`}
                                value={image.title ?? ""}
                                onChange={(event) =>
                                  updateHarnessImage(image.id, {
                                    title: event.target.value || undefined,
                                  })
                                }
                                placeholder="Harness routing"
                              />
                            </Field>
                            <Field label="Caption" hint="optional">
                              <textarea
                                rows={4}
                                aria-label={`Harness image ${index + 1} caption`}
                                value={image.caption ?? ""}
                                onChange={(event) =>
                                  updateHarnessImage(image.id, {
                                    caption: event.target.value || undefined,
                                  })
                                }
                                placeholder="Assembly or installation details"
                              />
                            </Field>
                            <div className="harness-image-actions">
                              <button
                                type="button"
                                onClick={() => moveHarnessImage(image.id, -1)}
                                disabled={index === 0}
                                aria-label={`Move harness image ${index + 1} up`}
                              >
                                <ArrowUp size={14} /> Up
                              </button>
                              <button
                                type="button"
                                onClick={() => moveHarnessImage(image.id, 1)}
                                disabled={index === project.harnessImages.length - 1}
                                aria-label={`Move harness image ${index + 1} down`}
                              >
                                <ArrowDown size={14} /> Down
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  harnessImageReplaceIdRef.current = image.id;
                                  harnessImageReplaceInputRef.current?.click();
                                }}
                              >
                                <Upload size={14} /> Replace
                              </button>
                              <button
                                type="button"
                                className="danger"
                                onClick={() => removeHarnessImage(image.id)}
                                aria-label={`Delete harness image ${index + 1}`}
                              >
                                <Trash2 size={14} /> Delete
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-selection harness-images-empty">
                        <Images size={22} />
                        <p>No harness images have been added.</p>
                      </div>
                    )}
                    <p className="photo-note">
                      Images are resized, re-encoded, and embedded in this project.
                      Their displayed order is also the HTML and PDF report order.
                    </p>
                  </div>
                ) : (
                  <>
                    <h3>Harness details</h3>
                    <Field label="Title">
                      <input
                        value={project.title}
                        onChange={(event) =>
                          updateProject((draft) => {
                            draft.title = event.target.value;
                          })
                        }
                      />
                    </Field>
                    <div className="field-row">
                      <Field label="Revision">
                        <input
                          value={project.revision}
                          onChange={(event) =>
                            updateProject((draft) => {
                              draft.revision = event.target.value;
                            })
                          }
                        />
                      </Field>
                      <Field label="Company">
                        <input
                          value={project.company}
                          onChange={(event) =>
                            updateProject((draft) => {
                              draft.company = event.target.value;
                            })
                          }
                        />
                      </Field>
                    </div>
                    <div className="harness-notes-editor">
                      <Field label="Harness notes" hint="Plain text">
                        <textarea
                          rows={16}
                          value={project.notes}
                          onChange={(event) =>
                            updateProject((draft) => {
                              draft.notes = event.target.value;
                            })
                          }
                          placeholder={
                            "Assembly notes\n\n- Route wires away from power rails.\n\nRevision notes"
                          }
                        />
                      </Field>
                      <p>
                        Saved with this project and included in HTML and PDF reports.
                        Validation issues remain separate editor checks.
                      </p>
                    </div>
                    <div className="empty-selection">
                      <CircleDot size={20} />
                      <p>Select a component on the canvas to edit its construction.</p>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="selection-summary">
                  <span className={`summary-icon kind-${selected.kind}`}>
                    {(() => {
                      const Icon = KIND_META[selected.kind].icon;
                      return <Icon size={18} />;
                    })()}
                  </span>
                  <div>
                    <strong>
                      {selectedIds.length > 1
                        ? `Editing ${selected.designator}`
                        : KIND_META[selected.kind].label}
                    </strong>
                    <span>
                      {selectedIds.length > 1
                        ? `${selectedIds.length} components in selection`
                        : CONNECTOR_KINDS.includes(selected.kind)
                          ? `${selected.pinCount} pins`
                          : `${selected.wireCount} conductor${
                              selected.wireCount === 1 ? "" : "s"
                            }`}
                    </span>
                  </div>
                </div>

                {selectedIds.length === 2 && !selectedTwistedPair && (
                  <div className="property-section twisted-pair-section">
                    <h3>Twisted pair</h3>
                    <p className="section-note">
                      Group two independent single wires without merging their data.
                    </p>
                    <button
                      type="button"
                      className="twisted-pair-create"
                      onClick={createPairFromSelection}
                      disabled={Boolean(pairCreationIssue)}
                    >
                      <Combine size={14} /> Create twisted pair
                    </button>
                    {pairCreationIssue && (
                      <p className="twisted-pair-hint">{pairCreationIssue}</p>
                    )}
                  </div>
                )}

                {selectedTwistedPair && (
                  <div className="property-section twisted-pair-section">
                    <h3>Twisted pair</h3>
                    <p className="section-note">
                      Paired with {project.components.find((component) =>
                        component.id === selectedTwistedPair.members.find(
                          (member) => member !== selected.id,
                        ),
                      )?.designator ?? "missing wire"}. Member wires remain independent.
                    </p>
                    <Field label="Pair designator">
                      <input
                        value={selectedTwistedPair.designator}
                        onChange={(event) =>
                          updateTwistedPair(selectedTwistedPair.id, {
                            designator: event.target.value,
                          })
                        }
                      />
                    </Field>
                    <div className="field-row">
                      {selectedTwistedPair.members.slice(0, 2).map((memberId, index) => {
                        const member = project.components.find(
                          (component) => component.id === memberId,
                        );
                        return (
                          <Field key={`${selectedTwistedPair.id}-${index}`} label={`Wire ${index === 0 ? "A" : "B"}`}>
                            <div className="paired-wire-color">
                              {member && (
                                <WireColorSwatch code={member.colors[0] || "BK"} />
                              )}
                              <span>
                                {member
                                  ? `${member.designator} · ${getWireColorDisplay(member.colors[0] || "BK")}`
                                  : "Missing wire"}
                              </span>
                            </div>
                          </Field>
                        );
                      })}
                    </div>
                    <div className="field-row">
                      <Field label="Twist pitch" hint="mm">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={selectedTwistedPair.twistPitchMm ?? ""}
                          onChange={(event) =>
                            updateTwistedPair(selectedTwistedPair.id, {
                              twistPitchMm: optionalNumber(event.target.value),
                            })
                          }
                          placeholder="Optional"
                        />
                      </Field>
                      <Field label="Direction">
                        <div className="select-wrap">
                          <select
                            value={selectedTwistedPair.twistDirection}
                            onChange={(event) =>
                              updateTwistedPair(selectedTwistedPair.id, {
                                twistDirection: event.target.value as TwistedPair["twistDirection"],
                              })
                            }
                          >
                            <option value="unspecified">Unspecified</option>
                            <option value="S">S</option>
                            <option value="Z">Z</option>
                          </select>
                          <ChevronDown size={13} />
                        </div>
                      </Field>
                    </div>
                    <Field label="Pair notes">
                      <textarea
                        rows={2}
                        value={selectedTwistedPair.note ?? ""}
                        onChange={(event) =>
                          updateTwistedPair(selectedTwistedPair.id, {
                            note: event.target.value,
                          })
                        }
                        placeholder="Optional manufacturing notes"
                      />
                    </Field>
                    <button
                      type="button"
                      className="twisted-pair-remove"
                      onClick={() => removeTwistedPair(selectedTwistedPair.id)}
                    >
                      <Trash2 size={13} /> Remove twisted pair
                    </button>
                  </div>
                )}

                <div className="property-section">
                  <h3>Identity</h3>
                  <div className="field-row designator-row">
                    <Field label="Designator">
                      <input
                        value={selected.designator}
                        onChange={(event) =>
                          updateSelected({ designator: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Type">
                      <div className="select-wrap">
                        <select
                          value={selected.kind}
                          onChange={(event) => {
                            const kind = event.target.value as ComponentKind;
                            const changingGroup =
                              componentGroup(kind) !==
                              componentGroup(selected.kind);
                            const patch: Partial<HarnessComponent> = {
                              kind,
                              photo:
                                kind === "connector"
                                  ? selected.photo
                                  : undefined,
                              additionalComponents: changingGroup
                                ? undefined
                                : selected.additionalComponents,
                              pinCount: CONNECTOR_KINDS.includes(kind)
                                ? changingGroup
                                  ? 4
                                  : selected.pinCount
                                : 0,
                              wireCount: CABLE_KINDS.includes(kind)
                                ? changingGroup
                                  ? kind === "wire"
                                    ? 1
                                    : 4
                                  : selected.wireCount
                                : 0,
                            };
                            if (changingGroup) {
                              updateProject((draft) => {
                                const node = draft.components.find(
                                  (component) => component.id === selected.id,
                                );
                                if (node) Object.assign(node, patch);
                                draft.links = draft.links.filter(
                                  (link) =>
                                    link.from.nodeId !== selected.id &&
                                    link.to.nodeId !== selected.id,
                                );
                              });
                            } else {
                              updateSelected(patch);
                            }
                          }}
                        >
                          {(Object.keys(KIND_META) as ComponentKind[]).map(
                            (kind) => (
                              <option key={kind} value={kind}>
                                {KIND_META[kind].label}
                              </option>
                            ),
                          )}
                        </select>
                        <ChevronDown size={13} />
                      </div>
                    </Field>
                  </div>
                  <Field label="Description">
                    <input
                      value={selected.name}
                      onChange={(event) =>
                        updateSelected({ name: event.target.value })
                      }
                    />
                  </Field>
                </div>

                {selected.kind === "connector" && (
                  <div className="property-section">
                    <h3>Connector photo</h3>
                    {selected.photo ? (
                      <div className="photo-editor">
                        <img
                          src={selected.photo.dataUrl}
                          alt={selected.photo.alt}
                        />
                        <Field label="Alternative text">
                          <input
                            value={selected.photo.alt}
                            onChange={(event) =>
                              updateSelected({
                                photo: {
                                  ...selected.photo!,
                                  alt: event.target.value,
                                },
                              })
                            }
                          />
                        </Field>
                        <div className="photo-actions">
                          <button onClick={() => photoInputRef.current?.click()}>
                            <ImagePlus size={14} />
                            Replace
                          </button>
                          <button
                            className="danger"
                            onClick={() =>
                              updateSelected(
                                { photo: undefined },
                                "Connector photo removed.",
                              )
                            }
                          >
                            <Trash2 size={14} />
                            Remove
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="photo-upload"
                        onClick={() => photoInputRef.current?.click()}
                      >
                        <ImagePlus size={20} />
                        <strong>Upload connector photo</strong>
                        <span>JPEG, PNG, or WebP · resized locally</span>
                      </button>
                    )}
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      hidden
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadConnectorPhoto(file);
                      }}
                    />
                    <p className="photo-note">
                      Embedded in WireForm projects, libraries, the topology
                      canvas, and the local WireViz preview. YAML downloads do
                      not include binary image data.
                    </p>
                  </div>
                )}

                <div className="property-section">
                  <h3>
                    {CONNECTOR_KINDS.includes(selected.kind)
                      ? "Pins"
                      : "Conductors"}
                  </h3>
                  <Field
                    label={
                      CONNECTOR_KINDS.includes(selected.kind)
                        ? "Pin count"
                        : "Wire count"
                    }
                  >
                    <div className="stepper">
                      <button
                        onClick={() =>
                          updateCount(
                            (CONNECTOR_KINDS.includes(selected.kind)
                              ? selected.pinCount
                              : selected.wireCount) - 1,
                          )
                        }
                        aria-label="Decrease count"
                      >
                        <Minus size={14} />
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={64}
                        value={
                          CONNECTOR_KINDS.includes(selected.kind)
                            ? selected.pinCount
                            : selected.wireCount
                        }
                        onChange={(event) => updateCount(Number(event.target.value))}
                      />
                      <button
                        onClick={() =>
                          updateCount(
                            (CONNECTOR_KINDS.includes(selected.kind)
                              ? selected.pinCount
                              : selected.wireCount) + 1,
                          )
                        }
                        aria-label="Increase count"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </Field>
                  <Field
                    label={
                      CONNECTOR_KINDS.includes(selected.kind)
                        ? "Pin labels"
                        : "Wire labels"
                    }
                    hint="Comma separated, in order"
                  >
                    <textarea
                      rows={2}
                      value={
                        CONNECTOR_KINDS.includes(selected.kind)
                          ? selected.pinLabels.join(", ")
                          : selected.wireLabels.join(", ")
                      }
                      onChange={(event) =>
                        updateSelected(
                          CONNECTOR_KINDS.includes(selected.kind)
                            ? {
                                pinLabels: listForCount(
                                  csvValues(event.target.value),
                                  selected.pinCount,
                                  "",
                                ),
                              }
                            : {
                                wireLabels: listForCount(
                                  csvValues(event.target.value),
                                  selected.wireCount,
                                  "",
                                ),
                              },
                        )
                      }
                    />
                  </Field>

                  {CONNECTOR_KINDS.includes(selected.kind) ? (
                    <Field label="Loops / jumpers" hint="Example: 1-2, 3-4">
                      <input
                        value={selected.loops}
                        onChange={(event) =>
                          updateSelected({ loops: event.target.value })
                        }
                        placeholder={
                          selected.kind === "connector"
                            ? "Optional"
                            : "All ports are common by default"
                        }
                      />
                    </Field>
                  ) : (
                    <>
                      {selected.kind === "wire" ? (
                        (() => {
                          const code = selected.colors[0] || "BK";
                          const parsed = parseWireColor(code);
                          const primaryValue = parsed.primary?.code ?? "__unknown";
                          const secondaryValue = parsed.secondary
                            ? parsed.secondary.code
                            : parsed.supported
                              ? ""
                              : "__unknown";
                          return (
                            <div className="wire-color-editor">
                              <div className="field-row">
                                <Field label="Primary color">
                                  <div className="select-wrap">
                                    <select
                                      aria-label="Primary wire color"
                                      value={primaryValue}
                                      onChange={(event) =>
                                        updateSelected({
                                          colors: [
                                            formatWireColor(
                                              event.target.value,
                                              parsed.secondary?.code,
                                            ),
                                          ],
                                        })
                                      }
                                    >
                                      {!parsed.primary && (
                                        <option value="__unknown" disabled>
                                          Unsupported ({parsed.code || "empty"})
                                        </option>
                                      )}
                                      {WIRE_COLOR_OPTIONS.map((option) => (
                                        <option key={option.code} value={option.code}>
                                          {option.name} ({option.code})
                                        </option>
                                      ))}
                                    </select>
                                    <ChevronDown size={13} />
                                  </div>
                                </Field>
                                <Field label="Secondary color" hint="optional stripe">
                                  <div className="select-wrap">
                                    <select
                                      aria-label="Secondary wire color"
                                      value={secondaryValue}
                                      disabled={!parsed.primary}
                                      onChange={(event) =>
                                        updateSelected({
                                          colors: [
                                            formatWireColor(
                                              parsed.primary?.code ?? "BK",
                                              event.target.value || undefined,
                                            ),
                                          ],
                                        })
                                      }
                                    >
                                      <option value="">None</option>
                                      {!parsed.supported && parsed.secondaryCode && (
                                        <option value="__unknown" disabled>
                                          Unsupported ({parsed.secondaryCode})
                                        </option>
                                      )}
                                      {WIRE_COLOR_OPTIONS.map((option) => (
                                        <option key={option.code} value={option.code}>
                                          {option.name} ({option.code})
                                        </option>
                                      ))}
                                    </select>
                                    <ChevronDown size={13} />
                                  </div>
                                </Field>
                              </div>
                              <div className="wire-color-preview">
                                <WireColorSwatch code={code} className="large" />
                                <span>{getWireColorDisplay(code)}</span>
                                <small>WireViz code</small>
                                <code>{code}</code>
                              </div>
                            </div>
                          );
                        })()
                      ) : (
                        <>
                          <Field label="Wire colors" hint="WireViz codes, comma separated">
                            <input
                              value={selected.colors.join(", ")}
                              onChange={(event) =>
                                updateSelected({
                                  colors: listForCount(
                                    csvValues(event.target.value).map((value) =>
                                      value.toUpperCase(),
                                    ),
                                    selected.wireCount,
                                    "BK",
                                  ),
                                })
                              }
                            />
                          </Field>
                          <div className="color-strip">
                            {selected.colors.slice(0, 12).map((color, index) => (
                              <WireColorSwatch
                                key={`${selected.id}-${index}`}
                                code={color}
                              />
                            ))}
                          </div>
                        </>
                      )}
                      <div className="field-row">
                        <Field label="Gauge">
                          <input
                            value={selected.gauge}
                            onChange={(event) =>
                              updateSelected({ gauge: event.target.value })
                            }
                            placeholder="22 AWG"
                          />
                        </Field>
                        <Field label="Length">
                          <input
                            value={selected.length}
                            onChange={(event) =>
                              updateSelected({ length: event.target.value })
                            }
                            placeholder="1 m"
                          />
                        </Field>
                      </div>
                      <label className="switch-row">
                        <span>
                          <Shield size={15} />
                          Cable shield
                        </span>
                        <input
                          type="checkbox"
                          checked={selected.shield}
                          onChange={(event) => {
                            const shield = event.target.checked;
                            updateProject((draft) => {
                              const node = draft.components.find(
                                (component) => component.id === selected.id,
                              );
                              if (node) node.shield = shield;
                              if (!shield) {
                                draft.links = draft.links.filter(
                                  (link) =>
                                    ![link.from, link.to].some(
                                      (port) =>
                                        port.nodeId === selected.id &&
                                        port.portId === "shield",
                                    ),
                                );
                              }
                            });
                          }}
                        />
                        <span className="switch" />
                      </label>
                    </>
                  )}
                </div>

                {CABLE_KINDS.includes(selected.kind) && (
                  <CableAdditionalComponentsSection
                    project={project}
                    cable={selected}
                    onAdd={addAdditionalComponent}
                    onChange={updateAdditionalComponent}
                    onPlacementChange={updateCableAdditionalPlacement}
                    onDuplicate={duplicateAdditionalComponent}
                    onDelete={deleteAdditionalComponent}
                  />
                )}

                {CONNECTOR_KINDS.includes(selected.kind) && (
                  <>
                    <PinTerminationsSection
                      project={project}
                      connector={selected}
                      onPartChange={updateTerminationPart}
                      onFieldChange={updateTerminationField}
                      onClear={clearTermination}
                      onApplyContact={applyContactToConnector}
                    />
                    <ConnectorAdditionalComponentsSection
                      project={project}
                      connector={selected}
                      onAdd={addAdditionalComponent}
                      onChange={updateAdditionalComponent}
                      onDuplicate={duplicateAdditionalComponent}
                      onDelete={deleteAdditionalComponent}
                    />
                  </>
                )}

                <details className="property-section collapsible" open>
                  <summary>
                    <span>BOM & sourcing</span>
                    <ChevronDown size={14} />
                  </summary>
                  <div className="details-content">
                    <Field label="Manufacturer">
                      <input
                        value={selected.manufacturer}
                        onChange={(event) =>
                          updateSelected({ manufacturer: event.target.value })
                        }
                        placeholder="Optional"
                      />
                    </Field>
                    <Field label="Manufacturer part number">
                      <input
                        value={selected.mpn}
                        onChange={(event) =>
                          updateSelected({ mpn: event.target.value })
                        }
                        placeholder="Optional"
                      />
                    </Field>
                    <div className="field-row">
                      <Field label="Supplier">
                        <input
                          value={selected.supplier}
                          onChange={(event) =>
                            updateSelected({ supplier: event.target.value })
                          }
                          placeholder="Optional"
                        />
                      </Field>
                      <Field label="Supplier P/N">
                        <input
                          value={selected.spn}
                          onChange={(event) =>
                            updateSelected({ spn: event.target.value })
                          }
                          placeholder="Optional"
                        />
                      </Field>
                    </div>
                    {supportsApprovedAlternatives(selected.kind) && (
                      <ApprovedAlternativesSection
                        component={selected}
                        onAdd={addApprovedAlternative}
                        onChange={updateApprovedAlternative}
                        onDuplicate={duplicateApprovedAlternative}
                        onDelete={deleteApprovedAlternative}
                      />
                    )}
                  </div>
                </details>

                <div className="property-section">
                  <Field label="Notes">
                    <textarea
                      rows={3}
                      value={selected.notes}
                      onChange={(event) =>
                        updateSelected({ notes: event.target.value })
                      }
                      placeholder="Assembly or construction notes"
                    />
                  </Field>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      <section className="output-drawer">
        <div className="output-tabs">
          <button
            className={activeOutput === "preview" ? "active" : ""}
            onClick={() => setActiveOutput("preview")}
          >
            <Eye size={15} />
            WireViz preview
          </button>
          <button
            className={activeOutput === "yaml" ? "active" : ""}
            onClick={() => setActiveOutput("yaml")}
          >
            <FileCode2 size={15} />
            Generated YAML
          </button>
        </div>
        <div className="runtime-status">
          {previewStatus === "ready" ? (
            <Check size={14} />
          ) : previewStatus === "error" ? (
            <AlertTriangle size={14} />
          ) : (
            <LoaderCircle size={14} className="spin" />
          )}
          <span>{previewMessage}</span>
          {runtimeVersions && (
            <small>
              WireViz {runtimeVersions.wireviz} · GraphViz WASM
            </small>
          )}
          <a
            className="license-link"
            href="./third-party-notices.txt"
            target="_blank"
            rel="noreferrer"
          >
            Licenses
          </a>
        </div>

        {activeOutput === "preview" ? (
          <div className="preview-surface">
            {previewDataUri ? (
              // The SVG is emitted by the local WireViz worker and isolated as
              // an image data URL rather than injected into the document DOM.
              <img
                src={previewDataUri}
                alt={`WireViz preview of ${project.title}`}
              />
            ) : (
              <div className="preview-placeholder">
                {previewStatus === "error" ? (
                  <AlertTriangle size={26} />
                ) : (
                  <LoaderCircle size={28} className="spin" />
                )}
                <strong>
                  {previewStatus === "error"
                    ? "Preview unavailable"
                    : "Preparing WireViz"}
                </strong>
                <span>{previewMessage}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="yaml-surface">
            <div className="yaml-header">
              <span>{filenameFor(project.title)}.yml</span>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(yaml);
                  setNotice("YAML copied to the clipboard.");
                }}
              >
                Copy YAML
              </button>
            </div>
            <pre>
              <code>{yaml}</code>
            </pre>
          </div>
        )}
      </section>

      {importCandidate && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setImportCandidate(null);
          }}
        >
          <section
            className="modal import-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="yaml-import-title"
          >
            <div className="modal-header">
              <div>
                <span className="eyebrow">Compatibility report</span>
                <h2 id="yaml-import-title">Import WireViz YAML</h2>
              </div>
              <button
                className="modal-close"
                onClick={() => setImportCandidate(null)}
                aria-label="Close import report"
              >
                <X size={17} />
              </button>
            </div>
            <div className="import-summary">
              <div>
                <strong>{importCandidate.report.components}</strong>
                <span>components</span>
              </div>
              <div>
                <strong>{importCandidate.report.links}</strong>
                <span>connections</span>
              </div>
              <div>
                <strong>{importCandidate.report.warnings.length}</strong>
                <span>warnings</span>
              </div>
              <div>
                <strong>{importCandidate.report.unsupported.length}</strong>
                <span>unsupported</span>
              </div>
            </div>
            <div className="modal-body import-report">
              <p>
                This creates a new editable WireForm project. YAML comments,
                aliases, formatting, and unsupported fields are not preserved.
              </p>
              {importCandidate.report.warnings.length > 0 && (
                <section>
                  <h3>Warnings</h3>
                  <ul>
                    {importCandidate.report.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </section>
              )}
              {importCandidate.report.unsupported.length > 0 && (
                <section className="unsupported-report">
                  <h3>Not represented in the visual editor</h3>
                  <ul>
                    {importCandidate.report.unsupported.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
            <div className="modal-footer">
              <button
                className="secondary-button"
                onClick={() => setImportCandidate(null)}
              >
                Cancel
              </button>
              <button className="primary-button" onClick={applyWireVizImport}>
                <FileUp size={15} />
                Import project
              </button>
            </div>
          </section>
        </div>
      )}

      {libraryOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLibraryOpen(false);
          }}
        >
          <section
            className="modal library-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="library-manager-title"
          >
            <div className="modal-header">
              <div>
                <span className="eyebrow">Stored in this browser</span>
                <h2 id="library-manager-title">User library manager</h2>
              </div>
              <button
                className="modal-close"
                onClick={() => setLibraryOpen(false)}
                aria-label="Close library manager"
              >
                <X size={17} />
              </button>
            </div>
            <div className="library-manager-toolbar">
              <label>
                <span>Active library</span>
                <select
                  value={libraries.activeLibraryId}
                  onChange={(event) =>
                    setLibraries((current) => ({
                      ...current,
                      activeLibraryId: event.target.value,
                    }))
                  }
                >
                  {libraries.libraries.map((library) => (
                    <option key={library.id} value={library.id}>
                      {library.name} ({library.templates.length})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Duplicate handling</span>
                <select
                  value={duplicateMode}
                  onChange={(event) =>
                    setDuplicateMode(event.target.value as DuplicateMode)
                  }
                >
                  <option value="keep">Keep both</option>
                  <option value="replace">Replace existing</option>
                  <option value="skip">Skip duplicate</option>
                </select>
              </label>
              <div className="new-library">
                <label>
                  <span>New library</span>
                  <input
                    value={newLibraryName}
                    onChange={(event) => setNewLibraryName(event.target.value)}
                    placeholder="Library name"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") createNamedLibrary();
                    }}
                  />
                </label>
                <button onClick={createNamedLibrary} aria-label="Create library">
                  <Plus size={16} />
                </button>
              </div>
            </div>
            <div className="library-file-actions">
              <button
                onClick={addSelectionToLibrary}
                disabled={selectedIds.length === 0}
              >
                <Plus size={14} />
                Save selection
              </button>
              <button
                onClick={downloadSelectedTemplates}
                disabled={selectedIds.length === 0}
              >
                <Download size={14} />
                Download selection
              </button>
              <button onClick={() => libraryInputRef.current?.click()}>
                <Upload size={14} />
                Import / restore
              </button>
              <button onClick={exportActiveLibrary}>
                <Download size={14} />
                Export library
              </button>
              <button onClick={backupLibraries}>
                <Database size={14} />
                Backup all
              </button>
              <input
                ref={libraryInputRef}
                type="file"
                accept=".json,.wireviz-library.json"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importLibraryFile(file);
                }}
              />
            </div>
            <div className="active-library-heading">
              <label>
                <span>Library name</span>
                <input
                  value={activeLibrary?.name ?? ""}
                  onChange={(event) => renameActiveLibrary(event.target.value)}
                />
              </label>
              <button
                className="danger-button"
                onClick={deleteActiveLibrary}
                title="Delete active library"
              >
                <Trash2 size={14} />
                Delete library
              </button>
            </div>
            <div className="template-list">
              {activeLibrary && activeLibrary.templates.length > 0 ? (
                activeLibrary.templates.map((template) => (
                  <article className="template-card" key={template.id}>
                    <div className="template-thumbnail">
                      {template.component.photo ? (
                        <img
                          src={template.component.photo.dataUrl}
                          alt={template.component.photo.alt}
                        />
                      ) : template.component.kind === "wire" ? (
                        <WireColorSwatch
                          code={template.component.colors[0] || "BK"}
                          className="large"
                        />
                      ) : (
                        (() => {
                          const Icon = KIND_META[template.component.kind].icon;
                          return <Icon size={20} />;
                        })()
                      )}
                    </div>
                    <div className="template-details">
                      <input
                        value={template.name}
                        onChange={(event) =>
                          updateTemplateName(template.id, event.target.value)
                        }
                        aria-label="Template name"
                      />
                      <span>
                        {KIND_META[template.component.kind].label} ·{" "}
                        {template.component.manufacturer || "Generic"}
                        {template.component.mpn
                          ? ` · ${template.component.mpn}`
                          : ""}
                      </span>
                    </div>
                    <button
                      className="template-add"
                      onClick={() => addTemplateToCanvas(template)}
                    >
                      <Plus size={14} />
                      Add
                    </button>
                    <button
                      className="template-delete"
                      onClick={() => removeTemplate(template.id)}
                      aria-label={`Delete ${template.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </article>
                ))
              ) : (
                <div className="library-empty">
                  <Library size={26} />
                  <strong>This library is empty</strong>
                  <span>
                    Select components on the canvas and choose Save selection.
                  </span>
                </div>
              )}
            </div>
            <div className="modal-footer library-footer">
              <span>
                {activeLibrary?.templates.length ?? 0} templates · photos are
                embedded in exports
              </span>
              <button
                className="secondary-button"
                onClick={() => setLibraryOpen(false)}
              >
                Done
              </button>
            </div>
          </section>
        </div>
      )}

      <div className="desktop-notice">
        <Cable size={28} />
        <strong>WireForm is designed for desktop</strong>
        <span>Open this editor in a wider browser window to build a harness.</span>
      </div>
    </main>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      {children}
    </label>
  );
}

function optionalNumber(value: string) {
  if (value.trim() === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function ApprovedAlternativesSection({
  component,
  onAdd,
  onChange,
  onDuplicate,
  onDelete,
}: {
  component: HarnessComponent;
  onAdd: () => void;
  onChange: (id: string, patch: Partial<ApprovedPartAlternative>) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const alternatives = component.approvedAlternatives ?? [];
  return (
    <div className="approved-alternatives-section">
      <div className="approved-alternatives-heading">
        <h4>Approved alternatives</h4>
        <button type="button" onClick={onAdd}>
          <Plus size={12} /> Add alternative
        </button>
      </div>
      <p className="section-note">
        Acceptable substitutes for the primary part above. They do not add BOM
        quantity.
      </p>
      {!alternatives.length ? (
        <p className="additional-empty">No approved alternatives.</p>
      ) : (
        <div className="additional-component-list">
          {alternatives.map((alternative, index) => {
            const manufacturer = alternative.manufacturer?.trim() ?? "";
            const mpn = alternative.mpn?.trim() ?? "";
            return (
              <details
                className="additional-component-row approved-alternative-row"
                key={alternative.id}
              >
                <summary>
                  <div>
                    <strong>
                      {[manufacturer, mpn].filter(Boolean).join(" / ") ||
                        `Alternative ${index + 1}`}
                    </strong>
                    <span>{alternative.note?.trim() || "Approved substitute"}</span>
                  </div>
                  <ChevronDown size={13} />
                </summary>
                <div className="additional-component-editor">
                  <div className="field-row">
                    <Field label="Alternative manufacturer">
                      <input
                        value={alternative.manufacturer ?? ""}
                        onChange={(event) =>
                          onChange(alternative.id, {
                            manufacturer: event.target.value,
                          })
                        }
                        placeholder="Optional when MPN is sufficient"
                      />
                    </Field>
                    <Field label="Alternative MPN">
                      <input
                        value={alternative.mpn ?? ""}
                        onChange={(event) =>
                          onChange(alternative.id, { mpn: event.target.value })
                        }
                        placeholder="Approved substitute"
                      />
                    </Field>
                  </div>
                  <Field label="Alternative note">
                    <textarea
                      rows={2}
                      value={alternative.note ?? ""}
                      onChange={(event) =>
                        onChange(alternative.id, { note: event.target.value })
                      }
                      placeholder="Drop-in, revision restriction, color, toolingâ€¦"
                    />
                  </Field>
                  <div className="additional-component-actions">
                    <button
                      type="button"
                      onClick={() => onDuplicate(alternative.id)}
                    >
                      <Copy size={13} /> Duplicate
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => onDelete(alternative.id)}
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConnectorAdditionalComponentsSection({
  project,
  connector,
  onAdd,
  onChange,
  onDuplicate,
  onDelete,
}: {
  project: HarnessProject;
  connector: HarnessComponent;
  onAdd: (preset: AdditionalComponentPreset) => void;
  onChange: (id: string, patch: Partial<AdditionalComponent>) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const components = connector.additionalComponents ?? [];
  return (
    <div className="property-section additional-components-section connector-additional-components">
      <h3>Additional components</h3>
      <p className="section-note">
        User-authored connector accessories. Pin contacts and seals remain
        termination data.
      </p>
      <div className="additional-preset-grid connector-preset-grid">
        <button type="button" onClick={() => onAdd("secondary-lock-tpa")}>
          <Plus size={12} /> Secondary Lock / TPA
        </button>
        <button type="button" onClick={() => onAdd("connector-generic")}>
          <Plus size={12} /> Generic component
        </button>
      </div>
      {!components.length ? (
        <p className="additional-empty">No connector accessories assigned.</p>
      ) : (
        <div className="additional-component-list">
          {components.map((component, index) => {
            const effective = additionalComponentQuantity(
              project,
              connector,
              component,
            );
            const mode = additionalComponentModeLabel(component.qtyMultiplier);
            const unit = component.unit?.trim() || "pcs";
            const unknownMode =
              component.qtyMultiplier &&
              !CONNECTOR_QUANTITY_MODES.some(
                (option) => option.value === component.qtyMultiplier,
              );
            return (
              <details className="additional-component-row" key={component.id}>
                <summary>
                  <div>
                    <strong>
                      {component.type?.trim() || `Component ${index + 1}`}
                    </strong>
                    <span>
                      {component.manufacturer?.trim() || "Generic"}
                      {component.mpn?.trim() ? ` · ${component.mpn}` : ""} · {mode}
                      {" · "}Calculated {effective ?? "—"} {unit}
                    </span>
                  </div>
                  <ChevronDown size={13} />
                </summary>
                <div className="additional-component-editor">
                  <div className="field-row">
                    <Field label="Type">
                      <input
                        value={component.type ?? ""}
                        onChange={(event) =>
                          onChange(component.id, { type: event.target.value })
                        }
                        placeholder="Required for WireViz"
                      />
                    </Field>
                    <Field label="Subtype / description">
                      <input
                        value={component.subtype ?? ""}
                        onChange={(event) =>
                          onChange(component.id, { subtype: event.target.value })
                        }
                        placeholder="Optional"
                      />
                    </Field>
                  </div>
                  <div className="field-row">
                    <Field label="Manufacturer">
                      <input
                        value={component.manufacturer ?? ""}
                        onChange={(event) =>
                          onChange(component.id, {
                            manufacturer: event.target.value,
                          })
                        }
                        placeholder="Optional"
                      />
                    </Field>
                    <Field label="Manufacturer P/N">
                      <input
                        value={component.mpn ?? ""}
                        onChange={(event) =>
                          onChange(component.id, { mpn: event.target.value })
                        }
                        placeholder="5051520400"
                      />
                    </Field>
                  </div>
                  <div className="field-row">
                    <Field label="Quantity">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={component.qty ?? ""}
                        onChange={(event) =>
                          onChange(component.id, {
                            qty: optionalNumber(event.target.value),
                          })
                        }
                        placeholder="1"
                      />
                    </Field>
                    <Field label="Unit">
                      <input
                        value={component.unit ?? ""}
                        onChange={(event) =>
                          onChange(component.id, { unit: event.target.value })
                        }
                        placeholder="pcs"
                      />
                    </Field>
                  </div>
                  <Field label="Quantity mode">
                    <div className="select-wrap">
                      <select
                        value={component.qtyMultiplier ?? ""}
                        onChange={(event) =>
                          onChange(component.id, {
                            qtyMultiplier: event.target.value || undefined,
                          })
                        }
                      >
                        {unknownMode && (
                          <option value={component.qtyMultiplier}>
                            Unknown: {component.qtyMultiplier}
                          </option>
                        )}
                        {CONNECTOR_QUANTITY_MODES.map((option) => (
                          <option key={option.value || "fixed"} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={13} />
                    </div>
                  </Field>
                  <p className="calculated-quantity">
                    Calculated quantity: <strong>{effective ?? "Unavailable"}</strong>{" "}
                    {effective !== undefined ? unit : ""}
                  </p>
                  <Field label="Accessory notes" hint="WireForm only">
                    <textarea
                      rows={2}
                      value={component.notes ?? ""}
                      onChange={(event) =>
                        onChange(component.id, { notes: event.target.value })
                      }
                      placeholder="Assembly or purchasing notes"
                    />
                  </Field>
                  <details className="additional-advanced">
                    <summary>Part details</summary>
                    <Field label="Internal part number">
                      <input
                        value={component.pn ?? ""}
                        onChange={(event) =>
                          onChange(component.id, { pn: event.target.value })
                        }
                        placeholder="Optional"
                      />
                    </Field>
                    <div className="field-row">
                      <Field label="Supplier">
                        <input
                          value={component.supplier ?? ""}
                          onChange={(event) =>
                            onChange(component.id, {
                              supplier: event.target.value,
                            })
                          }
                          placeholder="Optional"
                        />
                      </Field>
                      <Field label="Supplier P/N">
                        <input
                          value={component.spn ?? ""}
                          onChange={(event) =>
                            onChange(component.id, { spn: event.target.value })
                          }
                          placeholder="Optional"
                        />
                      </Field>
                    </div>
                    <Field label="WireViz background color">
                      <input
                        value={component.bgcolor ?? ""}
                        onChange={(event) =>
                          onChange(component.id, { bgcolor: event.target.value })
                        }
                        placeholder="Optional"
                      />
                    </Field>
                  </details>
                  <div className="additional-component-actions">
                    <button type="button" onClick={() => onDuplicate(component.id)}>
                      <Copy size={13} /> Duplicate
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => onDelete(component.id)}
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CableAdditionalComponentsSection({
  project,
  cable,
  onAdd,
  onChange,
  onPlacementChange,
  onDuplicate,
  onDelete,
}: {
  project: HarnessProject;
  cable: HarnessComponent;
  onAdd: (preset: AdditionalComponentPreset) => void;
  onChange: (id: string, patch: Partial<AdditionalComponent>) => void;
  onPlacementChange: (
    id: string,
    patch: Partial<AdditionalComponentPlacement>,
  ) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const components = cable.additionalComponents ?? [];
  return (
    <div className="property-section additional-components-section">
      <h3>Additional components</h3>
      <p className="section-note">
        Physical cable accessories. Conductor labels above remain signal text.
      </p>
      <div className="additional-preset-grid">
        <button type="button" onClick={() => onAdd("heat-shrink")}>
          <Plus size={12} /> Heat shrink
        </button>
        <button type="button" onClick={() => onAdd("wire-label")}>
          <Plus size={12} /> Wire label
        </button>
        <button type="button" onClick={() => onAdd("ferrite")}>
          <Plus size={12} /> Ferrite
        </button>
        <button type="button" onClick={() => onAdd("generic")}>
          <Plus size={12} /> Generic
        </button>
      </div>
      {!components.length ? (
        <p className="additional-empty">No cable accessories assigned.</p>
      ) : (
        <div className="additional-component-list">
          {components.map((component, index) => {
            const effective = additionalComponentQuantity(
              project,
              cable,
              component,
            );
            const mode = additionalComponentModeLabel(component.qtyMultiplier);
            const unit = component.unit?.trim() || "pcs";
            const placement = component.placement;
            const unknownMode =
              component.qtyMultiplier &&
              !CABLE_QUANTITY_MODES.some(
                (option) => option.value === component.qtyMultiplier,
              );
            return (
              <details className="additional-component-row" key={component.id}>
                <summary>
                  <div>
                    <strong>{component.type?.trim() || `Component ${index + 1}`}</strong>
                    <span>
                      {mode} · Base {component.qty ?? 1} · Calculated {effective ?? "—"} {unit}
                    </span>
                  </div>
                  <ChevronDown size={13} />
                </summary>
                <div className="additional-component-editor">
                  <div className="field-row">
                    <Field label="Type">
                      <input
                        value={component.type ?? ""}
                        onChange={(event) =>
                          onChange(component.id, { type: event.target.value })
                        }
                        placeholder="Required for WireViz"
                      />
                    </Field>
                    <Field label="Subtype / description">
                      <input
                        value={component.subtype ?? ""}
                        onChange={(event) =>
                          onChange(component.id, { subtype: event.target.value })
                        }
                        placeholder="Optional"
                      />
                    </Field>
                  </div>
                  <div className="field-row">
                    <Field label="Manufacturer">
                      <input
                        value={component.manufacturer ?? ""}
                        onChange={(event) =>
                          onChange(component.id, {
                            manufacturer: event.target.value,
                          })
                        }
                        placeholder="Optional"
                      />
                    </Field>
                    <Field label="Manufacturer P/N">
                      <input
                        value={component.mpn ?? ""}
                        onChange={(event) =>
                          onChange(component.id, { mpn: event.target.value })
                        }
                        placeholder="Optional"
                      />
                    </Field>
                  </div>
                  <div className="field-row">
                    <Field label="Base quantity">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={component.qty ?? ""}
                        onChange={(event) =>
                          onChange(component.id, {
                            qty: optionalNumber(event.target.value),
                          })
                        }
                        placeholder="1"
                      />
                    </Field>
                    <Field label="Unit">
                      <input
                        value={component.unit ?? ""}
                        onChange={(event) =>
                          onChange(component.id, { unit: event.target.value })
                        }
                        placeholder="pcs"
                      />
                    </Field>
                  </div>
                  <Field label="Quantity mode">
                    <div className="select-wrap">
                      <select
                        value={component.qtyMultiplier ?? ""}
                        onChange={(event) =>
                          onChange(component.id, {
                            qtyMultiplier: event.target.value || undefined,
                          })
                        }
                      >
                        {unknownMode && (
                          <option value={component.qtyMultiplier}>
                            Unknown: {component.qtyMultiplier}
                          </option>
                        )}
                        {CABLE_QUANTITY_MODES.map((option) => (
                          <option key={option.value || "fixed"} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={13} />
                    </div>
                  </Field>
                  <p className="calculated-quantity">
                    Calculated quantity: <strong>{effective ?? "Unavailable"}</strong>{" "}
                    {effective !== undefined ? unit : ""}
                  </p>
                  <details className="additional-advanced">
                    <summary>Part details</summary>
                    <Field label="Internal part number">
                      <input
                        value={component.pn ?? ""}
                        onChange={(event) =>
                          onChange(component.id, { pn: event.target.value })
                        }
                        placeholder="Optional"
                      />
                    </Field>
                    <div className="field-row">
                      <Field label="Supplier">
                        <input
                          value={component.supplier ?? ""}
                          onChange={(event) =>
                            onChange(component.id, {
                              supplier: event.target.value,
                            })
                          }
                          placeholder="Optional"
                        />
                      </Field>
                      <Field label="Supplier P/N">
                        <input
                          value={component.spn ?? ""}
                          onChange={(event) =>
                            onChange(component.id, { spn: event.target.value })
                          }
                          placeholder="Optional"
                        />
                      </Field>
                    </div>
                    <Field label="WireViz background color">
                      <input
                        value={component.bgcolor ?? ""}
                        onChange={(event) =>
                          onChange(component.id, {
                            bgcolor: event.target.value,
                          })
                        }
                        placeholder="Optional"
                      />
                    </Field>
                  </details>
                  <details className="additional-advanced" open={Boolean(placement)}>
                    <summary>Placement (WireForm only)</summary>
                    <div className="field-row">
                      <Field label="Scope">
                        <div className="select-wrap">
                          <select
                            value={placement?.scope ?? ""}
                            onChange={(event) =>
                              onPlacementChange(component.id, {
                                scope:
                                  (event.target.value as AdditionalComponentPlacement["scope"]) ||
                                  undefined,
                              })
                            }
                          >
                            <option value="">Not specified</option>
                            <option value="cable">Cable</option>
                            <option value="wire">Selected conductors</option>
                            <option value="termination">Termination</option>
                          </select>
                          <ChevronDown size={13} />
                        </div>
                      </Field>
                      <Field label="End">
                        <div className="select-wrap">
                          <select
                            value={placement?.end ?? ""}
                            onChange={(event) =>
                              onPlacementChange(component.id, {
                                end:
                                  (event.target.value as AdditionalComponentPlacement["end"]) ||
                                  undefined,
                              })
                            }
                          >
                            <option value="">Not specified</option>
                            <option value="from">From</option>
                            <option value="to">To</option>
                            <option value="both">Both ends</option>
                          </select>
                          <ChevronDown size={13} />
                        </div>
                      </Field>
                    </div>
                    <div className="field-row">
                      <Field label="Offset from end" hint="mm">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={placement?.offsetMm ?? ""}
                          onChange={(event) =>
                            onPlacementChange(component.id, {
                              offsetMm: optionalNumber(event.target.value),
                            })
                          }
                          placeholder="Optional"
                        />
                      </Field>
                      <Field label="Piece length" hint="mm">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={placement?.pieceLengthMm ?? ""}
                          onChange={(event) =>
                            onPlacementChange(component.id, {
                              pieceLengthMm: optionalNumber(event.target.value),
                            })
                          }
                          placeholder="Optional"
                        />
                      </Field>
                    </div>
                    {(placement?.scope === "wire" ||
                      placement?.scope === "termination" ||
                      placement?.wireIds?.length) && (
                      <Field label="Selected conductors" hint="Comma separated">
                        <input
                          value={placement?.wireIds?.join(", ") ?? ""}
                          onChange={(event) =>
                            onPlacementChange(component.id, {
                              wireIds: csvValues(event.target.value).flatMap(
                                (wireId) => {
                                  if (!wireId) return [];
                                  const number = Number(wireId);
                                  return [
                                    Number.isInteger(number) ? number : wireId,
                                  ];
                                },
                              ),
                            })
                          }
                          placeholder="1, 2, DATA"
                        />
                      </Field>
                    )}
                    <Field label="Placement note">
                      <textarea
                        rows={2}
                        value={placement?.note ?? ""}
                        onChange={(event) =>
                          onPlacementChange(component.id, {
                            note: event.target.value,
                          })
                        }
                        placeholder="Assembly placement details"
                      />
                    </Field>
                  </details>
                  <div className="additional-component-actions">
                    <button type="button" onClick={() => onDuplicate(component.id)}>
                      <Copy size={13} /> Duplicate
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => onDelete(component.id)}
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}

function connectedEndpointLabel(
  project: HarnessProject,
  connectorId: string,
  link: TopologyLink,
) {
  const endpoint = oppositePort(link, connectorId);
  const component = project.components.find(
    (candidate) => candidate.id === endpoint.nodeId,
  );
  if (!component) return "Invalid connection";
  const port = endpoint.portId === "shield" ? "shield" : parsePortNumber(endpoint.portId);
  return `${component.designator}:${port}`;
}

function PinTerminationsSection({
  project,
  connector,
  onPartChange,
  onFieldChange,
  onClear,
  onApplyContact,
}: {
  project: HarnessProject;
  connector: HarnessComponent;
  onPartChange: (
    linkId: string,
    partName: "contact" | "seal",
    field: TerminationPartField,
    value: string,
  ) => void;
  onFieldChange: (
    linkId: string,
    field: TerminationField,
    value: string,
  ) => void;
  onClear: (linkId: string) => void;
  onApplyContact: (connectorId: string, linkId: string) => void;
}) {
  return (
    <div className="property-section termination-section">
      <h3>Pin terminations</h3>
      <p className="section-note">
        Contact data belongs to the physical pin-to-conductor connection.
      </p>
      <div className="termination-list">
        {Array.from({ length: connector.pinCount }, (_, index) => {
          const pin = index + 1;
          const link = findConnectorPinLink(project, connector.id, pin);
          const label = connector.pinLabels[index] || "â€”";
          if (!link) {
            return (
              <div className="termination-empty-row" key={`${connector.id}-${pin}`}>
                <strong>{pin}</strong>
                <span>{label}</span>
                <small>Unconnected</small>
              </div>
            );
          }
          const contactLabel =
            getTerminationPartLabel(link.termination?.contact) || "Add contact";
          return (
            <details className="termination-row" key={link.id}>
              <summary>
                <strong>{pin}</strong>
                <span className="termination-pin-label">{label}</span>
                <small>{connectedEndpointLabel(project, connector.id, link)}</small>
                <span
                  className={
                    link.termination?.contact
                      ? "termination-contact assigned"
                      : "termination-contact"
                  }
                  title={contactLabel}
                >
                  {contactLabel}
                </span>
                <ChevronDown size={13} />
              </summary>
              <div className="termination-editor">
                <TerminationPartEditor
                  title="Contact"
                  defaultType="Crimp contact"
                  part={link.termination?.contact}
                  onChange={(field, value) =>
                    onPartChange(link.id, "contact", field, value)
                  }
                />

                <details className="termination-seal">
                  <summary>
                    Optional wire seal
                    <ChevronDown size={12} />
                  </summary>
                  <TerminationPartEditor
                    title="Seal"
                    defaultType="Wire seal"
                    part={link.termination?.seal}
                    onChange={(field, value) =>
                      onPartChange(link.id, "seal", field, value)
                    }
                  />
                </details>

                <div className="field-row">
                  <Field label="Strip length" hint="Include unit">
                    <input
                      value={link.termination?.stripLength ?? ""}
                      onChange={(event) =>
                        onFieldChange(link.id, "stripLength", event.target.value)
                      }
                      placeholder="5 mm"
                    />
                  </Field>
                  <Field label="Tooling / applicator">
                    <input
                      value={link.termination?.tooling ?? ""}
                      onChange={(event) =>
                        onFieldChange(link.id, "tooling", event.target.value)
                      }
                      placeholder="Optional"
                    />
                  </Field>
                </div>
                <Field label="Termination notes">
                  <textarea
                    rows={2}
                    value={link.termination?.notes ?? ""}
                    onChange={(event) =>
                      onFieldChange(link.id, "notes", event.target.value)
                    }
                    placeholder="Optional assembly notes"
                  />
                </Field>
                <div className="termination-actions">
                  <button
                    type="button"
                    onClick={() => onApplyContact(connector.id, link.id)}
                    disabled={!link.termination?.contact}
                  >
                    <Copy size={13} />
                    Apply contact to connected pins
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => onClear(link.id)}
                    disabled={!hasWireTerminationData(link.termination)}
                  >
                    <Trash2 size={13} />
                    Clear termination
                  </button>
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function TerminationPartEditor({
  title,
  defaultType,
  part,
  onChange,
}: {
  title: string;
  defaultType: string;
  part: TerminationPart | undefined;
  onChange: (field: TerminationPartField, value: string) => void;
}) {
  return (
    <div className="termination-part-editor">
      <strong>{title}</strong>
      <div className="field-row">
        <Field label="Type">
          <input
            value={part?.type ?? ""}
            onChange={(event) => onChange("type", event.target.value)}
            placeholder={defaultType}
          />
        </Field>
        <Field label="Description / subtype">
          <input
            value={part?.subtype ?? ""}
            onChange={(event) => onChange("subtype", event.target.value)}
            placeholder="Optional"
          />
        </Field>
      </div>
      <Field label="Internal part number">
        <input
          value={part?.pn ?? ""}
          onChange={(event) => onChange("pn", event.target.value)}
          placeholder="Optional"
        />
      </Field>
      <div className="field-row">
        <Field label="Manufacturer">
          <input
            value={part?.manufacturer ?? ""}
            onChange={(event) => onChange("manufacturer", event.target.value)}
            placeholder="Optional"
          />
        </Field>
        <Field label="Manufacturer P/N">
          <input
            value={part?.mpn ?? ""}
            onChange={(event) => onChange("mpn", event.target.value)}
            placeholder="Optional"
          />
        </Field>
      </div>
      <div className="field-row">
        <Field label="Supplier">
          <input
            value={part?.supplier ?? ""}
            onChange={(event) => onChange("supplier", event.target.value)}
            placeholder="Optional"
          />
        </Field>
        <Field label="Supplier P/N">
          <input
            value={part?.spn ?? ""}
            onChange={(event) => onChange("spn", event.target.value)}
            placeholder="Optional"
          />
        </Field>
      </div>
    </div>
  );
}
