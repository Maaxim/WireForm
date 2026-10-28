import { naturalCompare } from "./bom.ts";
import {
  resolvePhysicalConnections,
  type ResolvedConnectionEndpoint,
  type ResolvedPhysicalConnection,
} from "./connection-topology.ts";
import {
  CABLE_KINDS,
  type HarnessComponent,
  type HarnessProject,
} from "./model.ts";
import { parseWireColor } from "./wire-colors.ts";

export const ONSHAPE_CSV_HEADERS = [
  "Wire ID",
  "From Ref",
  "To Ref",
  "From Pin",
  "To Pin",
  "Gauge",
  "Color",
] as const;

/**
 * Conservative legacy profile evidenced by the public Cable/Wire Routing
 * documentation. A live import against the current FeatureScript is still
 * required before this profile can be called fully compatibility-verified.
 */
export const ONSHAPE_CSV_PROFILE = {
  name: "Neil Cooke Cable/Wire Routing legacy seven-column CSV",
  liveImportVerified: false,
  bicolorEncodingVerified: true,
} as const;

export type OnshapeExportIssueSeverity = "error" | "warning" | "info";

export interface OnshapeExportIssue {
  severity: OnshapeExportIssueSeverity;
  code: string;
  message: string;
  designator?: string;
  memberId?: string;
}

export interface OnshapeCsvRow {
  wireId: string;
  fromRef: string;
  toRef: string;
  fromPin: string;
  toPin: string;
  gauge: string;
  color: string;
}

export type OnshapeConductorKind = ResolvedPhysicalConnection["conductor"]["kind"];

export interface OnshapeExportKindCounts {
  candidates: number;
  exported: number;
  excluded: number;
}

export interface OnshapeExportTotals {
  candidates: number;
  exported: number;
  excluded: number;
  omittedShields: number;
  byKind: Record<OnshapeConductorKind, OnshapeExportKindCounts>;
}

export interface OnshapeExportResult {
  rows: OnshapeCsvRow[];
  issues: OnshapeExportIssue[];
  totals: OnshapeExportTotals;
}

interface CandidateRow {
  row: OnshapeCsvRow;
  connection: ResolvedPhysicalConnection;
}

const EMPTY_KIND_COUNTS = (): Record<OnshapeConductorKind, OnshapeExportKindCounts> => ({
  wire: { candidates: 0, exported: 0, excluded: 0 },
  "cable-conductor": { candidates: 0, exported: 0, excluded: 0 },
  "bundle-conductor": { candidates: 0, exported: 0, excluded: 0 },
});

function issue(
  severity: OnshapeExportIssueSeverity,
  code: string,
  message: string,
  connection?: ResolvedPhysicalConnection,
): OnshapeExportIssue {
  return {
    severity,
    code,
    message,
    ...(connection?.conductor.designator
      ? { designator: connection.conductor.designator }
      : {}),
    ...(connection?.conductor.conductorId
      ? { memberId: connection.conductor.conductorId }
      : {}),
  };
}

function componentMemberLabel(connection: ResolvedPhysicalConnection) {
  return connection.conductor.kind === "wire"
    ? connection.conductor.designator
    : `${connection.conductor.designator} conductor ${connection.conductor.conductorNumber}`;
}

function stableIdentityPart(value: string) {
  if (/^[A-Za-z0-9._-]+$/.test(value)) {
    return `s${value.length}-${value}`;
  }
  const bytes = new TextEncoder().encode(value);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `h${hex.length}-${hex}`;
}

/** Creates an Onshape-safe ID from persistent model IDs, never array indexes. */
export function onshapeWireId(
  componentId: string,
  conductorId: string,
) {
  return `WF-${stableIdentityPart(componentId)}-${stableIdentityPart(conductorId)}`;
}

export interface OnshapeValueConversion {
  value?: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Normalizes the AWG forms WireForm accepts to the bare AWG designation used
 * by the legacy Gauge column. Metric area/diameter values are intentionally not
 * inferred because this profile has no geometry column.
 */
export function convertGaugeForOnshape(rawGauge: string): OnshapeValueConversion {
  const raw = rawGauge.trim();
  if (!raw) {
    return {
      errorCode: "MISSING_GAUGE",
      errorMessage: "has no wire gauge",
    };
  }
  const match = /^(?:AWG\s*)?(4\/0|3\/0|2\/0|1\/0|\d{1,2})(?:\s*AWG)?$/i.exec(
    raw,
  );
  if (!match) {
    return {
      errorCode: "UNSUPPORTED_GAUGE",
      errorMessage: `uses gauge "${raw}", which cannot be safely represented as AWG`,
    };
  }
  const designation = match[1].toUpperCase();
  if (/^\d+$/.test(designation)) {
    const numeric = Number(designation);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 40) {
      return {
        errorCode: "UNSUPPORTED_GAUGE",
        errorMessage: `uses AWG designation "${raw}" outside the supported 0-40 range`,
      };
    }
    return { value: String(numeric) };
  }
  return { value: designation };
}

/**
 * Uses the full English names resolved by WireForm's authoritative parser.
 * Onshape 1.217 accepts slash-separated names for ordered two-color CSV values;
 * names avoid differences between Onshape and WireViz color abbreviations.
 */
export function convertColorForOnshape(rawColor: string): OnshapeValueConversion {
  const parsed = parseWireColor(rawColor);
  if (!parsed.code) {
    return {
      errorCode: "MISSING_COLOR",
      errorMessage: "has no wire color",
    };
  }
  if (!parsed.supported || !parsed.primary) {
    return {
      errorCode: "UNSUPPORTED_COLOR",
      errorMessage: `uses unsupported color code "${parsed.code}"`,
    };
  }
  const names = parsed.secondary
    ? [parsed.primary.name, parsed.secondary.name]
    : [parsed.primary.name];
  return { value: names.map((name) => name.toLowerCase()).join("/") };
}

function endpointProblem(
  endpoint: ResolvedConnectionEndpoint,
  side: "from" | "to",
  connection: ResolvedPhysicalConnection,
): OnshapeExportIssue | undefined {
  const label = componentMemberLabel(connection);
  if (endpoint.status === "open") {
    return issue(
      "error",
      "OPEN_ENDPOINT",
      `${label} has an open ${side} endpoint; the Onshape routing row requires two physical connector pins.`,
      connection,
    );
  }
  if (endpoint.status === "unresolved") {
    return issue(
      "error",
      "UNRESOLVED_ENDPOINT",
      `${label} has an unresolved ${side} endpoint.`,
      connection,
    );
  }
  if (endpoint.status === "multidrop") {
    return issue(
      "error",
      "MULTIDROP_UNSUPPORTED",
      `${label} is multi-drop; Phase 1 exports exactly one From and one To pin per conductor.`,
      connection,
    );
  }
  if (!endpoint.connectorDesignator.trim() || endpoint.physicalPin === undefined) {
    return issue(
      "error",
      "NON_PIN_ENDPOINT",
      `${label} terminates at ${endpoint.connectorDesignator || "an endpoint"}:${endpoint.pinDisplay || "unknown"}, which is not a numbered physical connector pin supported by this CSV profile.`,
      connection,
    );
  }
  return undefined;
}

function compareExportConnections(
  left: ResolvedPhysicalConnection,
  right: ResolvedPhysicalConnection,
) {
  return (
    naturalCompare(left.conductor.designator, right.conductor.designator) ||
    naturalCompare(left.conductor.conductorId ?? "", right.conductor.conductorId ?? "") ||
    left.conductor.conductorNumber - right.conductor.conductorNumber
  );
}

function shieldTerminationCount(project: HarnessProject, component: HarnessComponent) {
  const shieldPort = `${component.id}:shield`;
  return project.links.filter((link) => {
    const endpoints = [link.from, link.to];
    return endpoints.some(
      (endpoint) =>
        endpoint.nodeId === component.id &&
        (endpoint.portId === "shield" || `${endpoint.nodeId}:${endpoint.portId}` === shieldPort),
    );
  }).length;
}

export function buildOnshapeCableWireExport(
  project: HarnessProject,
): OnshapeExportResult {
  const issues: OnshapeExportIssue[] = [
    {
      severity: "warning",
      code: "LIVE_IMPORT_NOT_VERIFIED",
      message:
        "This legacy seven-column profile and bare AWG Gauge encoding have not been verified by importing into the current Onshape FeatureScript in this environment.",
    },
  ];
  const components = new Map(
    project.components.map((component) => [component.id, component]),
  );
  const connections = [...resolvePhysicalConnections(project)].sort(
    compareExportConnections,
  );
  const byKind = EMPTY_KIND_COUNTS();
  for (const connection of connections) {
    byKind[connection.conductor.kind].candidates += 1;
  }

  const pairIds = new Set<string>();
  const candidates: CandidateRow[] = [];
  for (const connection of connections) {
    const label = componentMemberLabel(connection);
    const rowIssues: OnshapeExportIssue[] = [];
    const component = components.get(connection.conductor.componentId);
    const conductorId = connection.conductor.conductorId?.trim();
    if (!component || !CABLE_KINDS.includes(component.kind)) {
      rowIssues.push(
        issue(
          "error",
          "MISSING_COMPONENT",
          `${label} no longer resolves to a physical wire/cable component.`,
          connection,
        ),
      );
    }
    if (!conductorId) {
      rowIssues.push(
        issue(
          "error",
          "MISSING_STABLE_CONDUCTOR_ID",
          `${label} has no persistent conductor identity; array position is not a safe export ID.`,
          connection,
        ),
      );
    }

    const fromProblem = endpointProblem(connection.from, "from", connection);
    const toProblem = endpointProblem(connection.to, "to", connection);
    if (fromProblem) rowIssues.push(fromProblem);
    if (toProblem) rowIssues.push(toProblem);

    const gauge = convertGaugeForOnshape(component?.gauge ?? "");
    if (!gauge.value) {
      rowIssues.push(
        issue(
          "error",
          gauge.errorCode ?? "UNSUPPORTED_GAUGE",
          `${label} ${gauge.errorMessage ?? "has an unsupported gauge"}.`,
          connection,
        ),
      );
    }
    const color = convertColorForOnshape(connection.conductor.colorCode);
    if (!color.value) {
      rowIssues.push(
        issue(
          "error",
          color.errorCode ?? "UNSUPPORTED_COLOR",
          `${label} ${color.errorMessage ?? "has an unsupported color"}.`,
          connection,
        ),
      );
    }

    if (connection.twistedPair && !pairIds.has(connection.twistedPair.id)) {
      pairIds.add(connection.twistedPair.id);
      issues.push({
        severity: "info",
        code: "TWISTED_PAIR_METADATA_OMITTED",
        message: `${connection.twistedPair.designator} membership is not represented by the Phase 1 CSV columns; its member conductors remain independent rows.`,
      });
    }

    issues.push(...rowIssues);
    if (
      rowIssues.length ||
      !component ||
      !conductorId ||
      !gauge.value ||
      !color.value ||
      connection.from.physicalPin === undefined ||
      connection.to.physicalPin === undefined
    ) {
      continue;
    }
    candidates.push({
      connection,
      row: {
        wireId: onshapeWireId(component.id, conductorId),
        fromRef: connection.from.connectorDesignator,
        toRef: connection.to.connectorDesignator,
        fromPin: String(connection.from.physicalPin),
        toPin: String(connection.to.physicalPin),
        gauge: gauge.value,
        color: color.value,
      },
    });
  }

  const wireIdCounts = new Map<string, number>();
  for (const candidate of candidates) {
    wireIdCounts.set(
      candidate.row.wireId,
      (wireIdCounts.get(candidate.row.wireId) ?? 0) + 1,
    );
  }
  const uniqueCandidates = candidates.filter((candidate) => {
    if ((wireIdCounts.get(candidate.row.wireId) ?? 0) === 1) return true;
    issues.push(
      issue(
        "error",
        "DUPLICATE_WIRE_ID",
        `${componentMemberLabel(candidate.connection)} resolves to duplicate Wire ID "${candidate.row.wireId}".`,
        candidate.connection,
      ),
    );
    return false;
  });

  let omittedShields = 0;
  for (const component of project.components) {
    if (!CABLE_KINDS.includes(component.kind) || !component.shield) continue;
    omittedShields += 1;
    const terminations = shieldTerminationCount(project, component);
    issues.push({
      severity: "warning",
      code: "SHIELD_OMITTED",
      designator: component.designator,
      message: `${component.designator} shield is omitted because the Phase 1 CSV profile has no shield row semantics${
        terminations
          ? ` (${terminations} shield termination${terminations === 1 ? "" : "s"} present)`
          : ""
      }.`,
    });
  }

  if (!connections.length) {
    issues.push({
      severity: "error",
      code: "NO_PHYSICAL_CONDUCTORS",
      message: "The project has no physical conductors to export.",
    });
  }

  const rows = uniqueCandidates.map((candidate) => candidate.row);
  for (const candidate of uniqueCandidates) {
    byKind[candidate.connection.conductor.kind].exported += 1;
  }
  for (const counts of Object.values(byKind)) {
    counts.excluded = counts.candidates - counts.exported;
  }

  return {
    rows,
    issues,
    totals: {
      candidates: connections.length,
      exported: rows.length,
      excluded: connections.length - rows.length,
      omittedShields,
      byKind,
    },
  };
}

function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function serializeOnshapeCableWireCsv(rows: readonly OnshapeCsvRow[]) {
  const lines = [
    ONSHAPE_CSV_HEADERS.map(csvCell).join(","),
    ...rows.map((row) =>
      [
        row.wireId,
        row.fromRef,
        row.toRef,
        row.fromPin,
        row.toPin,
        row.gauge,
        row.color,
      ]
        .map(csvCell)
        .join(","),
    ),
  ];
  return `${lines.join("\r\n")}\r\n`;
}

function safeFilenamePart(value: string) {
  return (
    Array.from(value, (character) =>
      character.charCodeAt(0) < 32 ? "-" : character,
    )
      .join("")
      .trim()
      .replace(/[<>:"/\\|?*]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[.-]+|[.-]+$/g, "")
      .slice(0, 100) || "wireform-harness"
  );
}

export function onshapeCsvFilenameForTitle(title: string) {
  return `${safeFilenamePart(title)}.onshape-cable-wire.csv`;
}

export function onshapeExportHasErrors(result: OnshapeExportResult) {
  return result.issues.some((candidate) => candidate.severity === "error");
}

export function onshapeExportHasWarnings(result: OnshapeExportResult) {
  return result.issues.some((candidate) => candidate.severity === "warning");
}
