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

export type ConnectionEndpointStatus =
  | "connected"
  | "open"
  | "unresolved"
  | "multidrop";

export interface ResolvedConnectionEndpoint {
  status: ConnectionEndpointStatus;
  connectorId?: string;
  connectorDesignator: string;
  physicalPin?: number;
  pinLabel: string;
  pinDisplay: string;
}

export interface PhysicalConnectionMemberRef {
  componentId: string;
  conductorNumber: number;
}

export interface ResolvedPhysicalConductor extends PhysicalConnectionMemberRef {
  kind: "wire" | "cable-conductor" | "bundle-conductor";
  designator: string;
  conductorId?: string;
  label: string;
  colorCode: string;
}

export interface ResolvedPhysicalConnection {
  from: ResolvedConnectionEndpoint;
  conductor: ResolvedPhysicalConductor;
  twistedPair?: { id: string; designator: string };
  to: ResolvedConnectionEndpoint;
}

const OPEN_ENDPOINT: ResolvedConnectionEndpoint = {
  status: "open",
  connectorDesignator: "OPEN",
  pinLabel: "",
  pinDisplay: "",
};

function portOrdinal(portId: string, prefix: "pin" | "wire") {
  const match = new RegExp(`^${prefix}:(\\d+)$`).exec(portId);
  return match ? Number(match[1]) : undefined;
}

function unresolvedEndpoint(): ResolvedConnectionEndpoint {
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
): ResolvedConnectionEndpoint {
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

function endpointStatusOrder(status: ConnectionEndpointStatus) {
  if (status === "connected") return 0;
  if (status === "multidrop") return 1;
  if (status === "unresolved") return 2;
  return 3;
}

export function compareConnectionEndpoints(
  left: ResolvedConnectionEndpoint,
  right: ResolvedConnectionEndpoint,
) {
  return (
    endpointStatusOrder(left.status) - endpointStatusOrder(right.status) ||
    naturalCompare(left.connectorDesignator, right.connectorDesignator) ||
    naturalCompare(String(left.physicalPin ?? ""), String(right.physicalPin ?? "")) ||
    naturalCompare(left.pinLabel, right.pinLabel)
  );
}

function endpointTrace(endpoint: ResolvedConnectionEndpoint) {
  if (endpoint.status !== "connected") return endpoint.connectorDesignator;
  return `${endpoint.connectorDesignator}:${endpoint.pinDisplay}`;
}

function normalizedEndpoints(
  endpoints: ResolvedConnectionEndpoint[],
): [ResolvedConnectionEndpoint, ResolvedConnectionEndpoint] {
  const sorted = [...endpoints].sort(compareConnectionEndpoints);
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
): ResolvedPhysicalConductor {
  return {
    kind: conductorKind(component),
    componentId: component.id,
    designator: component.designator,
    conductorNumber: conductorIndex + 1,
    ...(component.conductorIds[conductorIndex]
      ? { conductorId: component.conductorIds[conductorIndex] }
      : {}),
    label: component.wireLabels[conductorIndex]?.trim() ?? "",
    colorCode: component.colors[conductorIndex]?.trim() ?? "",
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

function compareConnections(
  left: ResolvedPhysicalConnection,
  right: ResolvedPhysicalConnection,
) {
  return (
    compareConnectionEndpoints(left.from, right.from) ||
    naturalCompare(
      String(left.from.physicalPin ?? ""),
      String(right.from.physicalPin ?? ""),
    ) ||
    naturalCompare(left.conductor.designator, right.conductor.designator) ||
    left.conductor.conductorNumber - right.conductor.conductorNumber ||
    compareConnectionEndpoints(left.to, right.to)
  );
}

export function physicalConnectionMemberKey(ref: PhysicalConnectionMemberRef) {
  return `${ref.componentId}:wire:${ref.conductorNumber}`;
}

function physicalConnectionMemberForLink(
  components: ReadonlyMap<string, HarnessComponent>,
  link: TopologyLink,
): PhysicalConnectionMemberRef | undefined {
  for (const endpoint of [link.from, link.to]) {
    const component = components.get(endpoint.nodeId);
    const conductorNumber = portOrdinal(endpoint.portId, "wire");
    if (
      component &&
      CABLE_KINDS.includes(component.kind) &&
      conductorNumber &&
      conductorNumber <= component.wireCount
    ) {
      return { componentId: component.id, conductorNumber };
    }
  }
  return undefined;
}

/** Resolves a rendered topology link to its stable physical conductor identity. */
export function getPhysicalConnectionMemberForLink(
  project: HarnessProject,
  link: TopologyLink,
) {
  const components = new Map(
    project.components.map((component) => [component.id, component]),
  );
  return physicalConnectionMemberForLink(components, link);
}

/** Builds the interactive diagram's link-to-member lookup in one topology pass. */
export function buildPhysicalConnectionMemberLinkIndex(project: HarnessProject) {
  const components = new Map(
    project.components.map((component) => [component.id, component]),
  );
  return new Map(
    project.links.flatMap((link) => {
      const member = physicalConnectionMemberForLink(components, link);
      return member ? [[link.id, member] as const] : [];
    }),
  );
}

/** Resolves each physical conductor using the ordering shared with Connection Mapping. */
export function resolvePhysicalConnections(
  project: HarnessProject,
): ResolvedPhysicalConnection[] {
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
                twistedPair: { id: pair.id, designator: pair.designator },
              }
            : {}),
          to,
        };
      }),
    )
    .sort(compareConnections);
}
