import {
  CABLE_KINDS,
  CONNECTOR_KINDS,
  type ConnectorAdditionalComponent,
  type HarnessComponent,
  type HarnessProject,
  type TerminationPart,
} from "./model.ts";
import { isPhysicalTerminationLink } from "./termination.ts";

export interface BomRow {
  category: string;
  manufacturer: string;
  mpn: string;
  description: string;
  quantity: number;
  unit: string;
  designators: string[];
  notes: string;
}

interface BomContribution extends BomRow {
  identityDescription: string;
}

interface AggregatedContribution {
  category: string;
  manufacturer: string;
  mpn: string;
  unit: string;
  quantity: number;
  descriptions: Set<string>;
  designators: Set<string>;
  notes: Set<string>;
}

const CSV_COLUMNS = [
  "Item",
  "Category",
  "Manufacturer",
  "MPN",
  "Description",
  "Qty",
  "Unit",
  "Designators",
  "Notes",
] as const;
const QUANTITY_PRECISION = 9;

function clean(value: string | undefined) {
  return value?.trim() ?? "";
}

function compareText(left: string, right: string) {
  const leftFolded = left.toLowerCase();
  const rightFolded = right.toLowerCase();
  if (leftFolded < rightFolded) return -1;
  if (leftFolded > rightFolded) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNumericTokens(left: string, right: string) {
  const normalizedLeft = left.replace(/^0+(?=\d)/, "");
  const normalizedRight = right.replace(/^0+(?=\d)/, "");
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length - normalizedRight.length;
  }
  const comparison = compareText(normalizedLeft, normalizedRight);
  return comparison || left.length - right.length;
}

export function naturalCompare(left: string, right: string) {
  const leftTokens = left.match(/\d+|\D+/g) ?? [left];
  const rightTokens = right.match(/\d+|\D+/g) ?? [right];
  const length = Math.max(leftTokens.length, rightTokens.length);
  for (let index = 0; index < length; index += 1) {
    const leftToken = leftTokens[index];
    const rightToken = rightTokens[index];
    if (leftToken === undefined) return -1;
    if (rightToken === undefined) return 1;
    const bothNumeric = /^\d+$/.test(leftToken) && /^\d+$/.test(rightToken);
    const comparison = bothNumeric
      ? compareNumericTokens(leftToken, rightToken)
      : compareText(leftToken, rightToken);
    if (comparison) return comparison;
  }
  return 0;
}

function roundedQuantity(value: number) {
  return Number(value.toFixed(QUANTITY_PRECISION));
}

function componentCategory(component: HarnessComponent) {
  const categories: Record<HarnessComponent["kind"], string> = {
    connector: "Connector",
    splice: "Splice",
    junction: "Junction",
    cable: "Cable",
    wire: "Wire",
    bundle: "Bundle wire",
  };
  return categories[component.kind];
}

function componentDescription(component: HarnessComponent) {
  const name = clean(component.name) || componentCategory(component);
  const gauge = CABLE_KINDS.includes(component.kind)
    ? clean(component.gauge)
    : "";
  return gauge ? `${name} (${gauge})` : name;
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
  return roundedQuantity(quantity * factor);
}

function baseComponentContribution(
  component: HarnessComponent,
): BomContribution {
  const description = componentDescription(component);
  return {
    category: componentCategory(component),
    manufacturer: clean(component.manufacturer),
    mpn: clean(component.mpn),
    description,
    identityDescription: description,
    quantity: 1,
    unit: "pcs",
    designators: clean(component.designator) ? [clean(component.designator)] : [],
    notes: clean(component.notes),
  };
}

function cableContribution(component: HarnessComponent): BomContribution {
  const base = baseComponentContribution(component);
  const meters = parseLengthMeters(component.length);
  if (meters === undefined) {
    const rawLength = clean(component.length);
    return {
      ...base,
      notes: [
        base.notes,
        rawLength
          ? `Unrecognized modeled length: ${rawLength}`
          : "Modeled length is missing",
      ]
        .filter(Boolean)
        .join("; "),
    };
  }
  const multiplier = component.kind === "bundle" ? component.wireCount : 1;
  return {
    ...base,
    quantity: roundedQuantity(meters * Math.max(multiplier, 1)),
    unit: "m",
  };
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

function additionalQuantity(
  project: HarnessProject,
  component: HarnessComponent,
  additional: ConnectorAdditionalComponent,
) {
  const quantity = additional.qty ?? 1;
  if (!additional.qtyMultiplier) return quantity;
  const populated = populatedPinCount(project, component.id);
  const multiplier =
    additional.qtyMultiplier === "pincount"
      ? component.pinCount
      : additional.qtyMultiplier === "populated"
        ? populated
        : Math.max(component.pinCount - populated, 0);
  return quantity * multiplier;
}

function partContribution(
  part: TerminationPart,
  defaultCategory: string,
  quantity: number,
  designators: string[],
): BomContribution {
  const category = clean(part.type) || defaultCategory;
  const description = clean(part.subtype) || category;
  return {
    category,
    manufacturer: clean(part.manufacturer),
    mpn: clean(part.mpn) || clean(part.pn),
    description,
    identityDescription: description,
    quantity,
    unit: "pcs",
    designators,
    notes: "",
  };
}

function additionalContribution(
  project: HarnessProject,
  component: HarnessComponent,
  additional: ConnectorAdditionalComponent,
): BomContribution {
  const contribution = partContribution(
    additional,
    "Additional component",
    additionalQuantity(project, component, additional),
    clean(component.designator) ? [clean(component.designator)] : [],
  );
  return {
    ...contribution,
    unit: clean(additional.unit) || "pcs",
  };
}

function terminationReference(
  project: HarnessProject,
  link: HarnessProject["links"][number],
) {
  const port = [link.from, link.to].find((endpoint) => {
    const component = project.components.find(
      (candidate) => candidate.id === endpoint.nodeId,
    );
    return Boolean(
      component &&
        CONNECTOR_KINDS.includes(component.kind) &&
        endpoint.portId.startsWith("pin:"),
    );
  });
  if (!port) return "";
  const connector = project.components.find(
    (component) => component.id === port.nodeId,
  );
  return connector
    ? `${clean(connector.designator)}:${port.portId.slice("pin:".length)}`
    : "";
}

function groupingKey(contribution: BomContribution) {
  const identity = contribution.mpn
    ? ["part", contribution.manufacturer, contribution.mpn]
    : [
        "description",
        contribution.manufacturer,
        contribution.identityDescription,
      ];
  return JSON.stringify([
    contribution.category,
    ...identity,
    contribution.unit,
  ]);
}

function aggregateContributions(contributions: BomContribution[]) {
  const grouped = new Map<string, AggregatedContribution>();
  for (const contribution of contributions) {
    if (!Number.isFinite(contribution.quantity) || contribution.quantity <= 0) {
      continue;
    }
    const key = groupingKey(contribution);
    const existing = grouped.get(key);
    if (existing) {
      existing.quantity = roundedQuantity(
        existing.quantity + contribution.quantity,
      );
      if (contribution.description) {
        existing.descriptions.add(contribution.description);
      }
      contribution.designators.forEach((value) =>
        existing.designators.add(value),
      );
      if (contribution.notes) existing.notes.add(contribution.notes);
      continue;
    }
    grouped.set(key, {
      category: contribution.category,
      manufacturer: contribution.manufacturer,
      mpn: contribution.mpn,
      unit: contribution.unit,
      quantity: roundedQuantity(contribution.quantity),
      descriptions: new Set(
        contribution.description ? [contribution.description] : [],
      ),
      designators: new Set(contribution.designators.filter(Boolean)),
      notes: new Set(contribution.notes ? [contribution.notes] : []),
    });
  }
  return [...grouped.values()].map<BomRow>((group) => ({
    category: group.category,
    manufacturer: group.manufacturer,
    mpn: group.mpn,
    description: [...group.descriptions].sort(naturalCompare).join(" / "),
    quantity: group.quantity,
    unit: group.unit,
    designators: [...group.designators].sort(naturalCompare),
    notes: [...group.notes].sort(naturalCompare).join("; "),
  }));
}

export function sortBomRows(rows: BomRow[]) {
  return [...rows].sort((left, right) => {
    for (const [leftValue, rightValue] of [
      [left.category, right.category],
      [left.manufacturer, right.manufacturer],
      [left.mpn, right.mpn],
      [left.description, right.description],
      [left.unit, right.unit],
      [left.designators.join("\0"), right.designators.join("\0")],
    ]) {
      const comparison = naturalCompare(leftValue, rightValue);
      if (comparison) return comparison;
    }
    return 0;
  });
}

export function buildBomRows(project: HarnessProject) {
  const contributions: BomContribution[] = [];
  for (const component of project.components) {
    contributions.push(
      CABLE_KINDS.includes(component.kind)
        ? cableContribution(component)
        : baseComponentContribution(component),
    );
    for (const additional of component.additionalComponents ?? []) {
      contributions.push(
        additionalContribution(project, component, additional),
      );
    }
  }

  for (const link of project.links) {
    if (!isPhysicalTerminationLink(project, link)) continue;
    const reference = terminationReference(project, link);
    const designators = reference ? [reference] : [];
    if (link.termination?.contact) {
      contributions.push(
        partContribution(
          link.termination.contact,
          "Crimp contact",
          1,
          designators,
        ),
      );
    }
    if (link.termination?.seal) {
      contributions.push(
        partContribution(
          link.termination.seal,
          "Wire seal",
          1,
          designators,
        ),
      );
    }
  }

  return sortBomRows(aggregateContributions(contributions));
}

function formatQuantity(quantity: number) {
  return roundedQuantity(quantity).toString();
}

function escapeCsvField(value: string | number) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function serializeBomCsv(rows: BomRow[]) {
  const lines = [CSV_COLUMNS.join(",")];
  sortBomRows(rows).forEach((row, index) => {
    lines.push(
      [
        index + 1,
        row.category,
        row.manufacturer,
        row.mpn,
        row.description,
        formatQuantity(row.quantity),
        row.unit,
        [...row.designators].sort(naturalCompare).join(", "),
        row.notes,
      ]
        .map(escapeCsvField)
        .join(","),
    );
  });
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function bomFilenameForTitle(title: string) {
  const cleanTitle = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${cleanTitle || "wireform-harness"}.bom.csv`;
}
