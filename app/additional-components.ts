import {
  CABLE_KINDS,
  CONNECTOR_KINDS,
  createAdditionalComponentId,
  type AdditionalComponent,
  type AdditionalComponentPlacement,
  type HarnessComponent,
  type HarnessProject,
  type TerminationPart,
} from "./model.ts";

export type AdditionalComponentPreset =
  | "heat-shrink"
  | "wire-label"
  | "ferrite"
  | "generic";

export const CABLE_QUANTITY_MODES = [
  { value: "", label: "Fixed quantity" },
  { value: "wirecount", label: "Per conductor" },
  { value: "terminations", label: "Per termination" },
  { value: "length", label: "Per cable length" },
  { value: "total_length", label: "Per total conductor length" },
] as const;

export const CABLE_QTY_MULTIPLIERS = new Set(
  CABLE_QUANTITY_MODES.map((mode) => mode.value).filter(Boolean),
);
export const CONNECTOR_QTY_MULTIPLIERS = new Set([
  "pincount",
  "populated",
  "unpopulated",
]);

const STANDARD_PART_FIELDS = [
  "type",
  "subtype",
  "pn",
  "manufacturer",
  "mpn",
  "supplier",
  "spn",
] as const satisfies ReadonlyArray<keyof TerminationPart>;
const QUANTITY_PRECISION = 9;

function clean(value: string | undefined) {
  return value?.trim() ?? "";
}

export function roundedAdditionalQuantity(value: number) {
  return Number(value.toFixed(QUANTITY_PRECISION));
}

const LENGTH_FACTORS_TO_METERS: Record<string, number> = {
  m: 1,
  meter: 1,
  meters: 1,
  metre: 1,
  metres: 1,
  cm: 0.01,
  mm: 0.001,
  km: 1_000,
  in: 0.0254,
  inch: 0.0254,
  inches: 0.0254,
  '"': 0.0254,
  ft: 0.3048,
  foot: 0.3048,
  feet: 0.3048,
  yd: 0.9144,
  yard: 0.9144,
  yards: 0.9144,
};

export function parseLengthMeters(value: string) {
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*([A-Za-z"]+)\s*$/.exec(value);
  if (!match) return undefined;
  const quantity = Number(match[1].replace(",", "."));
  const factor = LENGTH_FACTORS_TO_METERS[match[2].toLowerCase()];
  if (!Number.isFinite(quantity) || quantity <= 0 || factor === undefined) {
    return undefined;
  }
  return roundedAdditionalQuantity(quantity * factor);
}

export function createAdditionalComponentPreset(
  preset: AdditionalComponentPreset,
): AdditionalComponent {
  const base: AdditionalComponent = {
    id: createAdditionalComponentId(),
    qty: 1,
  };
  if (preset === "heat-shrink") {
    return { ...base, type: "Heat shrink", unit: "pcs" };
  }
  if (preset === "wire-label") {
    return {
      ...base,
      type: "Wire label",
      unit: "pcs",
      qtyMultiplier: "terminations",
      placement: { scope: "termination" },
    };
  }
  if (preset === "ferrite") {
    return {
      ...base,
      type: "Ferrite",
      unit: "pcs",
      placement: { scope: "cable" },
    };
  }
  return base;
}

export function cloneAdditionalComponentsWithNewIds(
  components: readonly AdditionalComponent[] | undefined,
) {
  return components?.map((component) => ({
    ...structuredClone(component),
    id: createAdditionalComponentId(),
  }));
}

function populatedPinCount(project: HarnessProject, componentId: string) {
  return new Set(
    project.links.flatMap((link) =>
      [link.from, link.to].flatMap((port) =>
        port.nodeId === componentId && port.portId.startsWith("pin:")
          ? [port.portId]
          : [],
      ),
    ),
  ).size;
}

// WireViz 0.4.1 multiplies `terminations` by Cable.connections. WireForm emits
// one such connection per conductor that has at least one modeled end, plus
// one for every modeled shield connection.
export function wireVizCableConnectionCount(
  project: HarnessProject,
  component: HarnessComponent,
) {
  const conductors = new Set<string>();
  let shieldConnections = 0;
  for (const link of project.links) {
    for (const port of [link.from, link.to]) {
      if (port.nodeId !== component.id) continue;
      if (port.portId.startsWith("wire:")) conductors.add(port.portId);
      else if (port.portId === "shield") shieldConnections += 1;
    }
  }
  return conductors.size + shieldConnections;
}

export function additionalComponentQuantity(
  project: HarnessProject,
  owner: HarnessComponent,
  component: AdditionalComponent,
) {
  const baseQuantity = component.qty ?? 1;
  if (!Number.isFinite(baseQuantity)) return undefined;
  const multiplier = component.qtyMultiplier;
  if (!multiplier) return roundedAdditionalQuantity(baseQuantity);

  let factor: number | undefined;
  if (CONNECTOR_KINDS.includes(owner.kind)) {
    const populated = populatedPinCount(project, owner.id);
    if (multiplier === "pincount") factor = owner.pinCount;
    else if (multiplier === "populated") factor = populated;
    else if (multiplier === "unpopulated") {
      factor = Math.max(owner.pinCount - populated, 0);
    }
  } else if (CABLE_KINDS.includes(owner.kind)) {
    if (multiplier === "wirecount") factor = owner.wireCount;
    else if (multiplier === "terminations") {
      factor = wireVizCableConnectionCount(project, owner);
    } else if (multiplier === "length") {
      factor = parseLengthMeters(owner.length);
    } else if (multiplier === "total_length") {
      const length = parseLengthMeters(owner.length);
      if (length !== undefined) factor = length * owner.wireCount;
    }
  }
  return factor === undefined
    ? undefined
    : roundedAdditionalQuantity(baseQuantity * factor);
}

export function additionalComponentModeLabel(multiplier: string | undefined) {
  return (
    CABLE_QUANTITY_MODES.find((mode) => mode.value === (multiplier ?? ""))
      ?.label ?? `Unknown (${multiplier})`
  );
}

export function additionalComponentToWireViz(
  owner: HarnessComponent,
  component: AdditionalComponent,
): Record<string, string | number> | undefined {
  const type = clean(component.type);
  if (!type) return undefined;
  const output: Record<string, string | number> = { type };
  for (const field of STANDARD_PART_FIELDS) {
    if (field === "type") continue;
    const value = clean(component[field]);
    if (value) output[field] = value;
  }
  if (component.qty !== undefined && Number.isFinite(component.qty)) {
    output.qty = component.qty;
  }
  if (clean(component.unit)) output.unit = clean(component.unit);
  if (clean(component.bgcolor)) output.bgcolor = clean(component.bgcolor);
  const validMultipliers = CABLE_KINDS.includes(owner.kind)
    ? CABLE_QTY_MULTIPLIERS
    : CONNECTOR_QTY_MULTIPLIERS;
  if (
    component.qtyMultiplier &&
    validMultipliers.has(component.qtyMultiplier as never)
  ) {
    output.qty_multiplier = component.qtyMultiplier;
  }
  return output;
}

export function placementConductorText(
  placement: AdditionalComponentPlacement | undefined,
) {
  return placement?.wireIds?.length
    ? `Conductors ${placement.wireIds.join(", ")}`
    : "";
}

export function validateAdditionalComponents(project: HarnessProject) {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const owner of project.components) {
    for (const [index, component] of (
      owner.additionalComponents ?? []
    ).entries()) {
      const label = `${owner.designator || owner.kind} additional component ${
        index + 1
      }`;
      if (!clean(component.type)) warnings.push(`${label} is missing its type.`);
      if (
        component.qty !== undefined &&
        (!Number.isFinite(component.qty) || component.qty < 0)
      ) {
        errors.push(`${label} has an invalid quantity; use zero or a positive number.`);
      }
      const validMultipliers = CABLE_KINDS.includes(owner.kind)
        ? CABLE_QTY_MULTIPLIERS
        : CONNECTOR_QTY_MULTIPLIERS;
      if (
        component.qtyMultiplier &&
        !validMultipliers.has(component.qtyMultiplier as never)
      ) {
        warnings.push(
          `${label} has unknown quantity multiplier "${component.qtyMultiplier}" and will be exported without it.`,
        );
      }
      const placement = component.placement;
      if (!placement) continue;
      if (
        placement.offsetMm !== undefined &&
        (!Number.isFinite(placement.offsetMm) || placement.offsetMm < 0)
      ) {
        errors.push(`${label} has an invalid offset from end.`);
      }
      if (
        placement.pieceLengthMm !== undefined &&
        (!Number.isFinite(placement.pieceLengthMm) ||
          placement.pieceLengthMm < 0)
      ) {
        errors.push(`${label} has an invalid piece length.`);
      }
      for (const wireId of placement.wireIds ?? []) {
        const numeric = Number(wireId);
        const matchesOrdinal =
          Number.isInteger(numeric) && numeric >= 1 && numeric <= owner.wireCount;
        const matchesLabel = owner.wireLabels.includes(String(wireId));
        if (!matchesOrdinal && !matchesLabel) {
          errors.push(`${label} selects missing conductor "${wireId}".`);
        }
      }
      if (
        CABLE_KINDS.includes(owner.kind) &&
        (placement.end === "from" || placement.end === "to")
      ) {
        const side = placement.end === "from" ? "left" : "right";
        const resolvable = project.links.some((link) =>
          [link.from, link.to].some(
            (port) => port.nodeId === owner.id && port.side === side,
          ),
        );
        if (!resolvable) {
          warnings.push(
            `${label} is placed at the ${placement.end} end, but that cable endpoint is not connected.`,
          );
        }
      }
    }
  }
  return { errors, warnings };
}
