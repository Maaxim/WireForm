import {
  CABLE_KINDS,
  CONNECTOR_KINDS,
  connectorShieldTerminationIdFromPort,
  type HarnessComponent,
  type HarnessProject,
  type PortRef,
} from "./model.ts";
import { connectorShieldLabel } from "./connector-shields.ts";
import { getShieldColorCode } from "./wire-colors.ts";

export interface ResolvedShieldTermination {
  side: "left" | "right";
  connectorDesignator: string;
  endpoint:
    | { kind: "pin"; physicalPin: number }
    | { kind: "shield"; shieldTerminationId: string; label: string };
}

export interface ConnectorShieldDiagramRoute {
  cableDesignator: string;
  cableSide: "left" | "right";
  connectorDesignator: string;
  shieldTerminationId: string;
  shieldLabel: string;
}

export interface ShieldDiagramStyle {
  cableDesignator: string;
  colorCode: string;
}

/** WireForm-native visual metadata, kept out of standards-compatible YAML. */
export function buildShieldDiagramStyles(
  project: HarnessProject,
): ShieldDiagramStyle[] {
  return project.components
    .filter(
      (component) => CABLE_KINDS.includes(component.kind) && component.shield,
    )
    .map((component) => ({
      cableDesignator: component.designator,
      colorCode: getShieldColorCode(component.shieldColor),
    }));
}

function pinNumber(port: PortRef) {
  const match = /^pin:([1-9][0-9]*)$/.exec(port.portId);
  return match ? Number(match[1]) : undefined;
}

/** Resolves shield attachment side from the cable endpoint, never the connector. */
export function resolveShieldTerminations(
  project: HarnessProject,
  cable: HarnessComponent,
): ResolvedShieldTermination[] {
  if (!cable.shield) return [];
  const components = new Map(
    project.components.map((component) => [component.id, component]),
  );
  return project.links.flatMap((link) => {
    const cableIsFrom =
      link.from.nodeId === cable.id && link.from.portId === "shield";
    const cableIsTo = link.to.nodeId === cable.id && link.to.portId === "shield";
    if (!cableIsFrom && !cableIsTo) return [];
    const cablePort = cableIsFrom ? link.from : link.to;
    const connectorPort = cableIsFrom ? link.to : link.from;
    const connector = components.get(connectorPort.nodeId);
    const physicalPin = pinNumber(connectorPort);
    const shieldTerminationId =
      connectorShieldTerminationIdFromPort(connectorPort.portId);
    const shieldTermination = shieldTerminationId
      ? connector?.shieldTerminations?.find(
          (termination) => termination.id === shieldTerminationId,
        )
      : undefined;
    if (
      !connector ||
      !CONNECTOR_KINDS.includes(connector.kind) ||
      (!physicalPin && !shieldTermination) ||
      (physicalPin !== undefined && physicalPin > connector.pinCount)
    ) {
      return [];
    }
    return [
      {
        side: cablePort.side,
        connectorDesignator: connector.designator,
        endpoint: physicalPin
          ? { kind: "pin", physicalPin }
          : {
              kind: "shield",
              shieldTerminationId: shieldTermination!.id,
              label: connectorShieldLabel(shieldTermination),
            },
      },
    ];
  });
}

/** Produces standard WireViz connections while preserving cable-side direction. */
export function buildWireVizShieldConnections(
  project: HarnessProject,
  cable: HarnessComponent,
): Array<Array<Record<string, string | number>>> {
  return resolveShieldTerminations(project, cable).flatMap((termination) => {
    if (termination.endpoint.kind !== "pin") return [];
    const shield = { [cable.designator]: "s" };
    const connector = {
      [termination.connectorDesignator]: termination.endpoint.physicalPin,
    };
    return [termination.side === "left"
      ? [connector, shield]
      : [shield, connector]];
  });
}

/** Native connector-shield links are passed beside standard WireViz YAML. */
export function buildConnectorShieldDiagramRoutes(
  project: HarnessProject,
): ConnectorShieldDiagramRoute[] {
  return project.components
    .filter(
      (component) =>
        CABLE_KINDS.includes(component.kind) &&
        component.shield &&
        component.wireCount > 0,
    )
    .flatMap((cable) =>
      resolveShieldTerminations(project, cable).flatMap((termination) =>
        termination.endpoint.kind === "shield"
          ? [{
              cableDesignator: cable.designator,
              cableSide: termination.side,
              connectorDesignator: termination.connectorDesignator,
              shieldTerminationId: termination.endpoint.shieldTerminationId,
              shieldLabel: termination.endpoint.label,
            }]
          : [],
      ),
    );
}
