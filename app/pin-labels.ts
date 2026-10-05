import {
  CABLE_KINDS,
  CONNECTOR_KINDS,
  type HarnessComponent,
  type HarnessProject,
} from "./model.ts";

export function normalizePinLabel(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim().slice(0, 300)
    : "";
}

export function pinLabelsForCount(
  labels: readonly string[],
  pinCount: number,
) {
  return Array.from({ length: pinCount }, (_, index) =>
    normalizePinLabel(labels[index]),
  );
}

export function setConnectorPinLabel(
  connector: HarnessComponent,
  pin: number,
  label: string,
) {
  const labels = pinLabelsForCount(connector.pinLabels, connector.pinCount);
  if (Number.isInteger(pin) && pin >= 1 && pin <= connector.pinCount) {
    labels[pin - 1] = normalizePinLabel(label);
  }
  return labels;
}

export function getConnectorPinLabel(
  connector: HarnessComponent,
  pin: number,
) {
  if (!CONNECTOR_KINDS.includes(connector.kind)) return "";
  return normalizePinLabel(connector.pinLabels[pin - 1]);
}

export function getPinDisplayName(connector: HarnessComponent, pin: number) {
  return getConnectorPinLabel(connector, pin) || `Pin ${pin}`;
}

export function getPinTraceLabel(connector: HarnessComponent, pin: number) {
  const label = getConnectorPinLabel(connector, pin);
  return label ? `${label} (pin ${pin})` : `Pin ${pin}`;
}

function portOrdinal(portId: string) {
  const match = /^(?:pin|wire):(\d+)$/.exec(portId);
  return match ? Number(match[1]) : undefined;
}

export function getConductorSignal(
  component: HarnessComponent,
  portId: string,
) {
  if (!CABLE_KINDS.includes(component.kind)) return "";
  const conductor = portOrdinal(portId);
  return conductor ? (component.wireLabels[conductor - 1]?.trim() ?? "") : "";
}

export function getConnectedPinSignal(
  project: HarnessProject,
  connectorId: string,
  pin: number,
) {
  const portId = `pin:${pin}`;
  const link = project.links.find((candidate) =>
    [candidate.from, candidate.to].some(
      (port) => port.nodeId === connectorId && port.portId === portId,
    ),
  );
  if (!link) return "";
  const endpoint =
    link.from.nodeId === connectorId && link.from.portId === portId
      ? link.to
      : link.from;
  const component = project.components.find((item) => item.id === endpoint.nodeId);
  return component ? getConductorSignal(component, endpoint.portId) : "";
}

export function validateConnectorPinLabels(project: HarnessProject) {
  const warnings: string[] = [];
  for (const connector of project.components) {
    if (!CONNECTOR_KINDS.includes(connector.kind)) continue;
    const pinsByLabel = new Map<string, { label: string; pins: number[] }>();
    for (let pin = 1; pin <= connector.pinCount; pin += 1) {
      const label = getConnectorPinLabel(connector, pin);
      if (!label) continue;
      const key = label.toLowerCase();
      const existing = pinsByLabel.get(key);
      if (existing) existing.pins.push(pin);
      else pinsByLabel.set(key, { label, pins: [pin] });
    }
    for (const { label, pins } of pinsByLabel.values()) {
      if (pins.length < 2) continue;
      warnings.push(
        `${connector.designator}: pin label "${label}" is assigned to pins ${pins.join(
          " and ",
        )}.`,
      );
    }
  }
  return warnings;
}
