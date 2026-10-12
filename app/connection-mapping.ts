import {
  resolvePhysicalConnections,
  type ConnectionEndpointStatus,
  type ResolvedConnectionEndpoint,
  type ResolvedPhysicalConductor,
} from "./connection-topology.ts";
import type { HarnessProject } from "./model.ts";

export type ConnectionMappingEndpointStatus = ConnectionEndpointStatus;
export type ReportConnectionMappingEndpoint = ResolvedConnectionEndpoint;

export interface ReportConnectionMappingConductor
  extends ResolvedPhysicalConductor {
  display: string;
}

export interface ReportConnectionMappingRow {
  from: ReportConnectionMappingEndpoint;
  conductor: ReportConnectionMappingConductor;
  twistedPair?: { id: string; designator: string };
  to: ReportConnectionMappingEndpoint;
}

/** Adds report display text to the shared resolved physical connections. */
export function buildConnectionMappingRows(
  project: HarnessProject,
): ReportConnectionMappingRow[] {
  return resolvePhysicalConnections(project).map((connection) => {
    const identity =
      connection.conductor.kind === "wire"
        ? connection.conductor.designator
        : `${connection.conductor.designator} / cond. ${connection.conductor.conductorNumber}`;
    return {
      ...connection,
      conductor: {
        ...connection.conductor,
        display: [
          identity,
          connection.conductor.label,
          connection.conductor.colorCode,
        ]
          .filter(Boolean)
          .join(" · "),
      },
    };
  });
}
