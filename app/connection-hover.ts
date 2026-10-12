import {
  physicalConnectionMemberKey,
  resolvePhysicalConnections,
  type ConnectionEndpointStatus,
  type ResolvedConnectionEndpoint,
  type ResolvedPhysicalConnection,
} from "./connection-topology.ts";
import type { HarnessProject } from "./model.ts";

export interface ConnectionHoverInfo {
  memberKey: string;
  from: ResolvedConnectionEndpoint;
  to: ResolvedConnectionEndpoint;
  conductorLabel?: string;
  twistedPairDesignator?: string;
  state: ConnectionEndpointStatus;
  primaryText: string;
  secondaryText?: string;
}

function endpointText(endpoint: ResolvedConnectionEndpoint) {
  if (endpoint.status === "connected") {
    return `${endpoint.connectorDesignator}:${endpoint.pinDisplay}`;
  }
  return endpoint.connectorDesignator;
}

function connectionState(connection: ResolvedPhysicalConnection) {
  if (connection.to.status === "multidrop") return "multidrop" as const;
  if (
    connection.from.status === "unresolved" ||
    connection.to.status === "unresolved"
  ) {
    return "unresolved" as const;
  }
  if (connection.from.status === "open" || connection.to.status === "open") {
    return "open" as const;
  }
  return "connected" as const;
}

export function buildConnectionHoverInfo(
  connection: ResolvedPhysicalConnection,
): ConnectionHoverInfo {
  const conductorLabel = connection.conductor.label.trim();
  const twistedPairDesignator = connection.twistedPair?.designator.trim() ?? "";
  const metadata = [conductorLabel, twistedPairDesignator].filter(
    (value, index, values) =>
      value &&
      values.findIndex(
        (candidate) => candidate.toLocaleLowerCase() === value.toLocaleLowerCase(),
      ) === index,
  );
  const primaryText =
    connection.to.status === "multidrop"
      ? `${endpointText(connection.from)} → ${connection.to.pinDisplay || "UNRESOLVED"}`
      : `${endpointText(connection.from)} – ${endpointText(connection.to)}`;
  return {
    memberKey: physicalConnectionMemberKey(connection.conductor),
    from: connection.from,
    to: connection.to,
    ...(conductorLabel ? { conductorLabel } : {}),
    ...(twistedPairDesignator ? { twistedPairDesignator } : {}),
    state: connectionState(connection),
    primaryText,
    ...(metadata.length ? { secondaryText: metadata.join(" · ") } : {}),
  };
}

/** Builds a stable member-key lookup for the interactive diagram only. */
export function buildConnectionHoverInfoIndex(project: HarnessProject) {
  return new Map(
    resolvePhysicalConnections(project).map((connection) => {
      const info = buildConnectionHoverInfo(connection);
      return [info.memberKey, info] as const;
    }),
  );
}
