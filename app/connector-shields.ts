import {
  CONNECTOR_KINDS,
  connectorShieldPortId,
  connectorShieldTerminationIdFromPort,
  createConnectorShieldTerminationId,
  type ConnectorShieldTermination,
  type HarnessComponent,
  type HarnessProject,
  type PortRef,
} from "./model.ts";

export function connectorShieldLabel(
  termination: ConnectorShieldTermination | undefined,
) {
  return termination?.label?.trim() || "Shield";
}

export function findConnectorShieldTermination(
  connector: HarnessComponent | undefined,
  portId: string,
) {
  const id = connectorShieldTerminationIdFromPort(portId);
  return id
    ? connector?.shieldTerminations?.find((termination) => termination.id === id)
    : undefined;
}

export function isConnectorShieldPort(port: PortRef | { portId: string }) {
  return Boolean(connectorShieldTerminationIdFromPort(port.portId));
}

export function createConnectorShieldTermination(
  label = "Shield",
): ConnectorShieldTermination {
  return { id: createConnectorShieldTerminationId(), label };
}

export function cloneConnectorShieldTerminationsWithNewIds(
  values: readonly ConnectorShieldTermination[] | undefined,
) {
  const portIds = new Map<string, string>();
  const terminations = (values ?? []).map((termination) => {
    const id = createConnectorShieldTerminationId();
    portIds.set(
      connectorShieldPortId(termination.id),
      connectorShieldPortId(id),
    );
    return { ...structuredClone(termination), id };
  });
  return { terminations, portIds };
}

export function connectorShieldEndpointDisplay(
  connector: HarnessComponent,
  portId: string,
) {
  return `${connector.designator}:${connectorShieldLabel(
    findConnectorShieldTermination(connector, portId),
  )}`;
}

export function validateConnectorShieldTerminations(project: HarnessProject) {
  const errors: string[] = [];
  for (const connector of project.components.filter((component) =>
    CONNECTOR_KINDS.includes(component.kind),
  )) {
    const ids = new Set<string>();
    for (const termination of connector.shieldTerminations ?? []) {
      if (!termination.id.trim() || ids.has(termination.id)) {
        errors.push(
          `${connector.designator} has a duplicate or missing shield termination ID.`,
        );
      }
      ids.add(termination.id);
      if (
        termination.stripLength?.trim() &&
        (() => {
          const match = /^(\d+(?:[.,]\d+)?)\s*(mm|cm|m|in|inch|inches|")$/i.exec(
            termination.stripLength.trim(),
          );
          return !match || Number(match[1].replace(",", ".")) <= 0;
        })()
      ) {
        errors.push(
          `${connector.designator}:${connectorShieldLabel(termination)} has an invalid strip length; use a positive value with a unit such as "5 mm".`,
        );
      }
    }
  }
  return errors;
}
