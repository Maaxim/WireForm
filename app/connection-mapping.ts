import { naturalCompare } from "./bom.ts";
import {
  CABLE_KINDS,
  CONNECTOR_KINDS,
  type HarnessComponent,
  type HarnessProject,
  type PortRef,
  type TopologyLink,
} from "./model.ts";
import { getConnectorPinLabel, getPinReportLabel } from "./pin-labels.ts";
import {
  findTwistedPairForBundleConductor,
  findTwistedPairForWire,
} from "./twisted-pair.ts";

export type ConnectionMappingEndpointStatus =
  | "connected"
  | "open"
  | "unresolved"
  | "multidrop";

export interface ReportConnectionMappingEndpoint {
  status: ConnectionMappingEndpointStatus;
  connectorId?: string;
  connectorDesignator: string;
  physicalPin?: number;
  pinLabel: string;
  pinDisplay: string;
}

export interface ReportConnectionMappingConductor {
  kind: "wire" | "cable-conductor" | "bundle-conductor";
  componentId: string;
  designator: string;
  conductorNumber: number;
  conductorId?: string;
  label: string;
  colorCode: string;
  display: string;
}

export interface ReportConnectionMappingRow {
  from: ReportConnectionMappingEndpoint;
  conductor: ReportConnectionMappingConductor;
  twistedPair?: {
    id: string;
    designator: string;
  };
  to: ReportConnectionMappingEndpoint;
}

const OPEN_ENDPOINT: ReportConnectionMappingEndpoint = {
  status: "open",
  connectorDesignator: "OPEN",
  pinLabel: "",
  pinDisplay: "",
};

function portOrdinal(portId: string, prefix: "pin" | "wire") {
  const match = new RegExp(`^${prefix}:(\\d+)$`).exec(portId);
  return match ? Number(match[1]) : undefined;
}

function unresolvedEndpoint(): ReportConnectionMappingEndpoint {
  return {
    status: "unresolved",
    connectorDesignator: "UNRESOLVED",
    pinLabel: "",
    pinDisplay: "",
  };
}

function resolveConnectorEndpoint(
  components: ReadonlyMap<string, HarnessComponent>,
  port: PortRef,
): ReportConnectionMappingEndpoint {
  const connector = components.get(port.nodeId);
  const pin = portOrdinal(port.portId, "pin");
  if (
    !connector ||
    !CONNECTOR_KINDS.includes(connector.kind) ||
    !pin ||
    pin > connector.pinCount
  ) {
    return unresolvedEndpoint();
  }
  return {
    status: "connected",
    connectorId: connector.id,
    connectorDesignator: connector.designator,
    physicalPin: pin,
    pinLabel: getConnectorPinLabel(connector, pin),
    pinDisplay: getPinReportLabel(connector, pin),
  };
}

function endpointStatusOrder(status: ConnectionMappingEndpointStatus) {
  if (status === "connected") return 0;
  if (status === "multidrop") return 1;
  if (status === "unresolved") return 2;
  return 3;
}

function compareEndpoints(
  left: ReportConnectionMappingEndpoint,
  right: ReportConnectionMappingEndpoint,
) {
  return (
    endpointStatusOrder(left.status) - endpointStatusOrder(right.status) ||
    naturalCompare(left.connectorDesignator, right.connectorDesignator) ||
    naturalCompare(String(left.physicalPin ?? ""), String(right.physicalPin ?? "")) ||
    naturalCompare(left.pinLabel, right.pinLabel)
  );
}

function endpointTrace(endpoint: ReportConnectionMappingEndpoint) {
  if (endpoint.status !== "connected") return endpoint.connectorDesignator;
  return `${endpoint.connectorDesignator}:${endpoint.pinDisplay}`;
}

function normalizedEndpoints(
  endpoints: ReportConnectionMappingEndpoint[],
): [ReportConnectionMappingEndpoint, ReportConnectionMappingEndpoint] {
  const sorted = [...endpoints].sort(compareEndpoints);
  if (!sorted.length) return [{ ...OPEN_ENDPOINT }, { ...OPEN_ENDPOINT }];
  if (sorted.length === 1) return [sorted[0], { ...OPEN_ENDPOINT }];
  if (sorted.length === 2) return [sorted[0], sorted[1]];
  return [
    sorted[0],
    {
      status: "multidrop",
      connectorDesignator: "MULTI-DROP",
      pinLabel: "",
      pinDisplay: sorted.slice(1).map(endpointTrace).join(", "),
    },
  ];
}

function conductorKind(component: HarnessComponent) {
  if (component.kind === "wire") return "wire" as const;
  return component.kind === "bundle"
    ? ("bundle-conductor" as const)
    : ("cable-conductor" as const);
}

function conductorModel(
  component: HarnessComponent,
  conductorIndex: number,
): ReportConnectionMappingConductor {
  const conductorNumber = conductorIndex + 1;
  const label = component.wireLabels[conductorIndex]?.trim() ?? "";
  const colorCode = component.colors[conductorIndex]?.trim() ?? "";
  const identity =
    component.kind === "wire"
      ? component.designator
      : `${component.designator} / cond. ${conductorNumber}`;
  return {
    kind: conductorKind(component),
    componentId: component.id,
    designator: component.designator,
    conductorNumber,
    ...(component.conductorIds[conductorIndex]
      ? { conductorId: component.conductorIds[conductorIndex] }
      : {}),
    label,
    colorCode,
    display: [identity, label, colorCode].filter(Boolean).join(" · "),
  };
}

function twistedPairForConductor(
  project: HarnessProject,
  component: HarnessComponent,
  conductorIndex: number,
) {
  if (component.kind === "wire") {
    return findTwistedPairForWire(project, component.id);
  }
  if (component.kind !== "bundle") return undefined;
  const conductorId = component.conductorIds[conductorIndex];
  return conductorId
    ? findTwistedPairForBundleConductor(project, component.id, conductorId)
    : undefined;
}

function conductorEndpoints(
  project: HarnessProject,
  components: ReadonlyMap<string, HarnessComponent>,
  component: HarnessComponent,
  conductorNumber: number,
) {
  const portId = `wire:${conductorNumber}`;
  return project.links.flatMap((link: TopologyLink) => {
    const ownIsFrom =
      link.from.nodeId === component.id && link.from.portId === portId;
    const ownIsTo = link.to.nodeId === component.id && link.to.portId === portId;
    if (!ownIsFrom && !ownIsTo) return [];
    return [
      resolveConnectorEndpoint(components, ownIsFrom ? link.to : link.from),
    ];
  });
}

function compareRows(
  left: ReportConnectionMappingRow,
  right: ReportConnectionMappingRow,
) {
  return (
    compareEndpoints(left.from, right.from) ||
    naturalCompare(
      String(left.from.physicalPin ?? ""),
      String(right.from.physicalPin ?? ""),
    ) ||
    naturalCompare(left.conductor.designator, right.conductor.designator) ||
    left.conductor.conductorNumber - right.conductor.conductorNumber ||
    compareEndpoints(left.to, right.to)
  );
}

/** Builds one deterministic report row for every modeled physical conductor. */
export function buildConnectionMappingRows(
  project: HarnessProject,
): ReportConnectionMappingRow[] {
  const components = new Map(
    project.components.map((component) => [component.id, component]),
  );
  return project.components
    .filter((component) => CABLE_KINDS.includes(component.kind))
    .flatMap((component) =>
      Array.from({ length: component.wireCount }, (_, conductorIndex) => {
        const conductor = conductorModel(component, conductorIndex);
        const [from, to] = normalizedEndpoints(
          conductorEndpoints(
            project,
            components,
            component,
            conductor.conductorNumber,
          ),
        );
        const pair = twistedPairForConductor(project, component, conductorIndex);
        return {
          from,
          conductor,
          ...(pair
            ? {
                twistedPair: {
                  id: pair.id,
                  designator: pair.designator,
                },
              }
            : {}),
          to,
        };
      }),
    )
    .sort(compareRows);
}
