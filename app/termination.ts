import {
  CABLE_KINDS,
  CONNECTOR_KINDS,
  normalizeWireTermination,
  type HarnessProject,
  type TerminationPart,
  type TopologyLink,
  type WireTermination,
} from "./model.ts";
import { additionalComponentToWireViz } from "./additional-components.ts";

const PART_FIELDS = [
  "type",
  "subtype",
  "pn",
  "manufacturer",
  "mpn",
  "supplier",
  "spn",
] as const satisfies ReadonlyArray<keyof TerminationPart>;

export type TerminationPartField = (typeof PART_FIELDS)[number];
export type TerminationField = "stripLength" | "tooling" | "notes";
export type WireVizAdditionalComponent = Record<string, string | number>;

function trimmedPart(
  part: TerminationPart | undefined,
  defaultType: string,
): TerminationPart | undefined {
  if (!part) return undefined;
  const normalized = Object.fromEntries(
    PART_FIELDS.flatMap((field) => {
      const value = part[field]?.trim();
      return value ? [[field, value]] : [];
    }),
  ) as TerminationPart;
  if (!Object.keys(normalized).length) return undefined;
  return { ...normalized, type: normalized.type || defaultType };
}

export function compactWireTermination(
  termination: WireTermination | undefined,
): WireTermination | undefined {
  return normalizeWireTermination(termination);
}

export function hasWireTerminationData(
  termination: WireTermination | undefined,
) {
  return Boolean(compactWireTermination(termination));
}

export function getTerminationPartLabel(part: TerminationPart | undefined) {
  if (!part) return "";
  const identifier = part.mpn?.trim() || part.pn?.trim();
  const manufacturer = part.manufacturer?.trim();
  if (manufacturer && identifier) return `${manufacturer} ${identifier}`;
  return (
    identifier ||
    part.subtype?.trim() ||
    part.type?.trim() ||
    manufacturer ||
    ""
  );
}

export function findConnectorPinLink(
  project: HarnessProject,
  connectorId: string,
  pin: number,
) {
  const portId = `pin:${pin}`;
  return project.links.find((link) =>
    [link.from, link.to].some(
      (port) => port.nodeId === connectorId && port.portId === portId,
    ),
  );
}

export function applyContactToConnectedPins(
  project: HarnessProject,
  connectorId: string,
  sourceLinkId: string,
) {
  const sourceTermination = structuredClone(
    project.links.find((link) => link.id === sourceLinkId)?.termination,
  );
  if (!sourceTermination?.contact) return 0;

  let applied = 0;
  for (const link of project.links) {
    const attached = [link.from, link.to].some(
      (port) =>
        port.nodeId === connectorId && port.portId.startsWith("pin:"),
    );
    if (!attached) continue;
    link.termination = compactWireTermination({
      ...(link.termination ?? {}),
      contact: structuredClone(sourceTermination.contact),
      stripLength: sourceTermination.stripLength,
    });
    applied += 1;
  }
  return applied;
}

function endpointKinds(project: HarnessProject, link: TopologyLink) {
  const fromNode = project.components.find(
    (component) => component.id === link.from.nodeId,
  );
  const toNode = project.components.find(
    (component) => component.id === link.to.nodeId,
  );
  return { fromNode, toNode };
}

export function isPhysicalTerminationLink(
  project: HarnessProject,
  link: TopologyLink,
) {
  const { fromNode, toNode } = endpointKinds(project, link);
  if (!fromNode || !toNode) return false;
  const fromConnector =
    CONNECTOR_KINDS.includes(fromNode.kind) && link.from.portId.startsWith("pin:");
  const toConnector =
    CONNECTOR_KINDS.includes(toNode.kind) && link.to.portId.startsWith("pin:");
  const fromConductor =
    CABLE_KINDS.includes(fromNode.kind) &&
    (link.from.portId.startsWith("wire:") || link.from.portId === "shield");
  const toConductor =
    CABLE_KINDS.includes(toNode.kind) &&
    (link.to.portId.startsWith("wire:") || link.to.portId === "shield");
  return (fromConnector && toConductor) || (toConnector && fromConductor);
}

export function isValidStripLength(value: string) {
  const match = /^(\d+(?:[.,]\d+)?)\s*(mm|cm|m|in|inch|inches|")$/i.exec(
    value.trim(),
  );
  return Boolean(match && Number(match[1].replace(",", ".")) > 0);
}

export function validateTerminationMetadata(project: HarnessProject) {
  const warnings: string[] = [];
  for (const link of project.links) {
    const termination = compactWireTermination(link.termination);
    if (!termination) continue;
    if (!isPhysicalTerminationLink(project, link)) {
      warnings.push(
        `Connection ${link.id} has termination metadata but is not a connector-pin to conductor-end link.`,
      );
    }
    if (
      termination.stripLength &&
      !isValidStripLength(termination.stripLength)
    ) {
      warnings.push(
        `Connection ${link.id} has an invalid strip length; use a positive value with a unit such as "5 mm".`,
      );
    }
  }
  return warnings;
}

function partKey(part: TerminationPart) {
  return JSON.stringify(PART_FIELDS.map((field) => part[field] ?? ""));
}

function partToWireViz(
  part: TerminationPart,
  quantity: number,
): WireVizAdditionalComponent {
  return {
    type: part.type as string,
    ...Object.fromEntries(
      PART_FIELDS.filter((field) => field !== "type").flatMap((field) =>
        part[field] ? [[field, part[field]]] : [],
      ),
    ),
    qty: quantity,
  };
}

export function collectConnectorAdditionalComponents(
  project: HarnessProject,
  connectorId: string,
) {
  const connector = project.components.find(
    (component) => component.id === connectorId,
  );
  if (!connector || !CONNECTOR_KINDS.includes(connector.kind)) return [];

  const output = (connector.additionalComponents ?? []).flatMap((component) => {
    const serialized = additionalComponentToWireViz(connector, component);
    return serialized ? [serialized] : [];
  });
  const grouped = new Map<string, { part: TerminationPart; quantity: number }>();

  for (const link of project.links) {
    if (!isPhysicalTerminationLink(project, link)) continue;
    const touchesConnectorPin = [link.from, link.to].some(
      (port) =>
        port.nodeId === connectorId && port.portId.startsWith("pin:"),
    );
    if (!touchesConnectorPin) continue;
    const contact = trimmedPart(link.termination?.contact, "Crimp contact");
    const seal = trimmedPart(link.termination?.seal, "Wire seal");
    for (const part of [contact, seal]) {
      if (!part) continue;
      const key = partKey(part);
      const existing = grouped.get(key);
      if (existing) existing.quantity += 1;
      else grouped.set(key, { part, quantity: 1 });
    }
  }

  const aggregates = [...grouped.values()].sort((a, b) => {
    const left = partKey(a.part);
    const right = partKey(b.part);
    return left < right ? -1 : left > right ? 1 : 0;
  });

  for (const aggregate of aggregates) {
    const aggregateKey = partKey(aggregate.part);
    const matchingManual = output.findIndex((item) => {
      if (item.qty_multiplier || item.unit || item.bgcolor) return false;
      const manualPart = trimmedPart(item, String(item.type || ""));
      return Boolean(manualPart && partKey(manualPart) === aggregateKey);
    });
    if (matchingManual >= 0) {
      const existingQuantity = Number(output[matchingManual].qty ?? 1);
      output[matchingManual] = {
        ...output[matchingManual],
        qty: existingQuantity + aggregate.quantity,
      };
    } else {
      output.push(partToWireViz(aggregate.part, aggregate.quantity));
    }
  }

  return output;
}
