import {
  buildBomRows,
  formatBomQuantity,
  naturalCompare,
  sortBomRows,
  type BomApprovedAlternative,
  type BomRow,
} from "./bom.ts";
import {
  additionalComponentModeLabel,
  additionalComponentQuantity,
  placementConductorText,
} from "./additional-components.ts";
import {
  componentApprovedAlternatives,
  formatApprovedAlternatives,
} from "./approved-alternatives.ts";
import {
  CABLE_KINDS,
  CONNECTOR_KINDS,
  isHarnessImageDataUrl,
  type HarnessComponent,
  type HarnessImage,
  type HarnessProject,
  type TerminationPart,
  type TopologyLink,
} from "./model.ts";
import {
  compactWireTermination,
  isPhysicalTerminationLink,
} from "./termination.ts";
import {
  getWireColorCssBackground,
  getWireColorDisplay,
} from "./wire-colors.ts";
import {
  getConnectorPinLabel,
  getConductorSignal,
} from "./pin-labels.ts";

export interface ReportProjectMetadata {
  title: string;
  revision: string;
  company: string;
  notes: string;
  schemaVersion: number;
}

export interface ReportPin {
  pin: string;
  label: string;
  signal: string;
  cable: string;
  conductor: string;
  color: string;
  gauge: string;
  contactManufacturer: string;
  contactMpn: string;
  sealPn: string;
}

export interface ReportConnector {
  designator: string;
  kind: string;
  name: string;
  manufacturer: string;
  mpn: string;
  supplier: string;
  supplierPn: string;
  pinCount: number;
  notes: string;
  photo?: {
    dataUrl: string;
    alt: string;
    width: number;
    height: number;
  };
  pins: ReportPin[];
  additionalComponents: ReportConnectorAdditionalComponent[];
  approvedAlternatives: BomApprovedAlternative[];
}

export interface ReportConnectorAdditionalComponent {
  type: string;
  manufacturer: string;
  mpn: string;
  description: string;
  baseQuantity: number;
  quantityMode: string;
  calculatedQuantity: number | string;
  unit: string;
  notes: string;
}

export interface ReportCable {
  designator: string;
  kind: string;
  manufacturer: string;
  mpn: string;
  description: string;
  length: string;
  conductorCount: number;
  gauge: string;
  color: string;
  from: string;
  to: string;
  notes: string;
  twistedPair: string;
  additionalComponents: ReportCableAdditionalComponent[];
  approvedAlternatives: BomApprovedAlternative[];
}

export interface ReportTwistedPair {
  designator: string;
  wireA: string;
  wireAColor: string;
  wireB: string;
  wireBColor: string;
  pitch: string;
  direction: string;
  notes: string;
}

export interface ReportCableAdditionalComponent {
  type: string;
  manufacturer: string;
  mpn: string;
  description: string;
  baseQuantity: number;
  quantityMode: string;
  calculatedQuantity: number | string;
  unit: string;
  placement: string;
}

export interface ReportTermination {
  connector: string;
  pin: string;
  pinLabel: string;
  cable: string;
  conductor: string;
  signal: string;
  contactManufacturer: string;
  contactMpn: string;
  sealPn: string;
  stripLength: string;
  tooling: string;
  notes: string;
}

export interface ReportHarnessImage {
  id: string;
  dataUrl: string;
  mimeType: HarnessImage["mimeType"];
  originalFilename: string;
  title: string;
  caption: string;
  width: number;
  height: number;
}

export interface HarnessReportModel {
  project: ReportProjectMetadata;
  diagramSvg: string;
  connectors: ReportConnector[];
  cables: ReportCable[];
  twistedPairs: ReportTwistedPair[];
  terminations: ReportTermination[];
  bomRows: BomRow[];
  harnessImages: ReportHarnessImage[];
}

interface PhysicalLinkContext {
  connector: HarnessComponent;
  connectorPortId: string;
  cable: HarnessComponent;
  cablePortId: string;
  link: TopologyLink;
}

const SAFE_IMAGE_DATA_URL =
  /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=\s]+$/;

function clean(value: string | undefined) {
  return value?.trim() ?? "";
}

function buildHarnessImages(project: HarnessProject): ReportHarnessImage[] {
  return (project.harnessImages ?? []).flatMap((image) => {
    if (!isHarnessImageDataUrl(image.dataUrl)) return [];
    return [
      {
        id: image.id,
        dataUrl: image.dataUrl,
        mimeType: image.mimeType,
        originalFilename: clean(image.originalFilename),
        title: clean(image.title),
        caption: clean(image.caption),
        width: image.width,
        height: image.height,
      },
    ];
  });
}

function portOrdinal(portId: string) {
  const match = /^(?:pin|wire):(\d+)$/.exec(portId);
  return match ? Number(match[1]) : undefined;
}

function partNumber(part: TerminationPart | undefined) {
  return clean(part?.mpn) || clean(part?.pn);
}

function physicalLinkContext(
  project: HarnessProject,
  link: TopologyLink,
): PhysicalLinkContext | undefined {
  if (!isPhysicalTerminationLink(project, link)) return undefined;
  const from = project.components.find((item) => item.id === link.from.nodeId);
  const to = project.components.find((item) => item.id === link.to.nodeId);
  if (!from || !to) return undefined;
  if (CONNECTOR_KINDS.includes(from.kind)) {
    return {
      connector: from,
      connectorPortId: link.from.portId,
      cable: to,
      cablePortId: link.to.portId,
      link,
    };
  }
  return {
    connector: to,
    connectorPortId: link.to.portId,
    cable: from,
    cablePortId: link.from.portId,
    link,
  };
}

function conductorLabel(cable: HarnessComponent, portId: string) {
  if (portId === "shield") return "Shield";
  const ordinal = portOrdinal(portId);
  if (!ordinal) return portId;
  const label = clean(cable.wireLabels[ordinal - 1]);
  return label ? `${ordinal} · ${label}` : String(ordinal);
}

function connectionLabel(
  component: HarnessComponent | undefined,
  portId: string,
) {
  if (!component) return "";
  if (portId === "shield") return `${component.designator}:shield`;
  const ordinal = portOrdinal(portId);
  return ordinal ? `${component.designator}:${ordinal}` : component.designator;
}

function uniqueNatural(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort(naturalCompare);
}

function pinRows(
  project: HarnessProject,
  connector: HarnessComponent,
): ReportPin[] {
  return Array.from({ length: connector.pinCount }, (_, index) => index + 1)
    .flatMap((pin) => {
      const contexts = project.links
        .map((link) => physicalLinkContext(project, link))
        .filter(
          (context): context is PhysicalLinkContext =>
            Boolean(
              context &&
                context.connector.id === connector.id &&
                context.connectorPortId === `pin:${pin}`,
            ),
        )
        .sort((left, right) => {
          const cableOrder = naturalCompare(
            left.cable.designator,
            right.cable.designator,
          );
          return (
            cableOrder ||
            naturalCompare(left.cablePortId, right.cablePortId) ||
            naturalCompare(left.link.id, right.link.id)
          );
        });
      const label = getConnectorPinLabel(connector, pin);
      if (!contexts.length) {
        return [
          {
            pin: String(pin),
            label,
            signal: "",
            cable: "",
            conductor: "",
            color: "",
            gauge: "",
            contactManufacturer: "",
            contactMpn: "",
            sealPn: "",
          },
        ];
      }
      return contexts.map(({ cable, cablePortId, link }) => {
        const conductor = portOrdinal(cablePortId);
        return {
          pin: String(pin),
          label,
          signal: getConductorSignal(cable, cablePortId),
          cable: cable.designator,
          conductor: conductorLabel(cable, cablePortId),
          color: conductor ? clean(cable.colors[conductor - 1]) : "",
          gauge: clean(cable.gauge),
          contactManufacturer: clean(link.termination?.contact?.manufacturer),
          contactMpn: partNumber(link.termination?.contact),
          sealPn: partNumber(link.termination?.seal),
        };
      });
    });
}

function safePhoto(component: HarnessComponent) {
  const photo = component.photo;
  if (!photo || !SAFE_IMAGE_DATA_URL.test(photo.dataUrl)) return undefined;
  return {
    dataUrl: photo.dataUrl,
    alt: clean(photo.alt),
    width: photo.width,
    height: photo.height,
  };
}

function buildConnectors(project: HarnessProject): ReportConnector[] {
  return project.components
    .filter((component) => CONNECTOR_KINDS.includes(component.kind))
    .sort((left, right) => naturalCompare(left.designator, right.designator))
    .map((component) => {
      const photo = safePhoto(component);
      return {
        designator: component.designator,
        kind: component.kind,
        name: component.name,
        manufacturer: component.manufacturer,
        mpn: component.mpn,
        supplier: component.supplier,
        supplierPn: component.spn,
        pinCount: component.pinCount,
        notes: component.notes,
        ...(photo ? { photo } : {}),
        pins: pinRows(project, component),
        additionalComponents: (component.additionalComponents ?? []).map(
          (additional) => ({
            type: additional.type ?? "",
            manufacturer: additional.manufacturer ?? "",
            mpn: additional.mpn ?? additional.pn ?? "",
            description: additional.subtype ?? "",
            baseQuantity: additional.qty ?? 1,
            quantityMode: additionalComponentModeLabel(
              additional.qtyMultiplier,
            ),
            calculatedQuantity:
              additionalComponentQuantity(project, component, additional) ??
              "Unavailable",
            unit: additional.unit ?? "pcs",
            notes: additional.notes ?? "",
          }),
        ),
        approvedAlternatives: componentApprovedAlternatives(component).map(
          ({ manufacturer, mpn, note }) => ({ manufacturer, mpn, note }),
        ),
      };
    });
}

function buildCables(project: HarnessProject): ReportCable[] {
  return project.components
    .filter((component) => CABLE_KINDS.includes(component.kind))
    .sort((left, right) => naturalCompare(left.designator, right.designator))
    .map((component) => {
      const ends: Record<"left" | "right", string[]> = {
        left: [],
        right: [],
      };
      for (const link of project.links) {
        const own =
          link.from.nodeId === component.id
            ? link.from
            : link.to.nodeId === component.id
              ? link.to
              : undefined;
        if (!own) continue;
        const other = own === link.from ? link.to : link.from;
        const otherComponent = project.components.find(
          (candidate) => candidate.id === other.nodeId,
        );
        ends[own.side].push(connectionLabel(otherComponent, other.portId));
      }
      const from = uniqueNatural(ends.left).join(", ");
      const to = uniqueNatural(ends.right).join(", ");
      const fromEnd = uniqueNatural(
        ends.left.map((value) => value.split(":", 1)[0]),
      ).join(", ");
      const toEnd = uniqueNatural(
        ends.right.map((value) => value.split(":", 1)[0]),
      ).join(", ");
      const pair = project.twistedPairs.find((candidate) =>
        candidate.members.includes(component.id),
      );
      const counterpart = pair
        ? project.components.find(
            (candidate) =>
              candidate.id === pair.members.find((member) => member !== component.id),
          )
        : undefined;
      return {
        designator: component.designator,
        kind: component.kind,
        manufacturer: component.manufacturer,
        mpn: component.mpn,
        description: component.name,
        length: component.length,
        conductorCount: component.wireCount,
        gauge: component.gauge,
        color: component.kind === "wire" ? clean(component.colors[0]) : "",
        from,
        to,
        notes: component.notes,
        twistedPair: pair
          ? `${pair.designator || "Twisted pair"}${counterpart ? ` / ${counterpart.designator}` : " / missing wire"}`
          : "",
        additionalComponents: (component.additionalComponents ?? []).map(
          (additional) => {
            const placement = additional.placement;
            const placementParts: string[] = [];
            if (placement?.end === "both") placementParts.push("Both ends");
            else if (placement?.end === "from") {
              placementParts.push(
                placement.offsetMm !== undefined
                  ? `${placement.offsetMm} mm from ${fromEnd || "from"} end`
                  : `At ${fromEnd || "from"} end`,
              );
            } else if (placement?.end === "to") {
              placementParts.push(
                placement.offsetMm !== undefined
                  ? `${placement.offsetMm} mm from ${toEnd || "to"} end`
                  : `At ${toEnd || "to"} end`,
              );
            } else if (placement?.scope) {
              placementParts.push(
                placement.scope === "termination"
                  ? "At terminations"
                  : placement.scope === "wire"
                    ? "On conductors"
                    : "On cable",
              );
            }
            if (
              placement?.offsetMm !== undefined &&
              placement.end !== "from" &&
              placement.end !== "to"
            ) {
              placementParts.push(`${placement.offsetMm} mm offset`);
            }
            if (placement?.pieceLengthMm !== undefined) {
              placementParts.push(`${placement.pieceLengthMm} mm piece(s)`);
            }
            const conductors = placementConductorText(placement);
            if (conductors) placementParts.push(conductors);
            if (placement?.note) placementParts.push(placement.note);
            return {
              type: additional.type ?? "",
              manufacturer: additional.manufacturer ?? "",
              mpn: additional.mpn ?? additional.pn ?? "",
              description: additional.subtype ?? "",
              baseQuantity: additional.qty ?? 1,
              quantityMode: additionalComponentModeLabel(
                additional.qtyMultiplier,
              ),
              calculatedQuantity:
                additionalComponentQuantity(project, component, additional) ??
                "Unavailable",
              unit: additional.unit ?? "pcs",
              placement: placementParts.join("; "),
            };
          },
        ),
        approvedAlternatives: componentApprovedAlternatives(component).map(
          ({ manufacturer, mpn, note }) => ({ manufacturer, mpn, note }),
        ),
      };
    });
}

function buildTwistedPairs(project: HarnessProject): ReportTwistedPair[] {
  return [...project.twistedPairs]
    .sort((left, right) => naturalCompare(left.designator, right.designator))
    .map((pair) => {
      const member = (index: number) => {
        const id = pair.members[index];
        return project.components.find((component) => component.id === id);
      };
      const wireA = member(0);
      const wireB = member(1);
      return {
        designator: pair.designator,
        wireA: wireA?.designator ?? pair.members[0] ?? "Missing wire",
        wireAColor: wireA?.colors[0] ?? "",
        wireB: wireB?.designator ?? pair.members[1] ?? "Missing wire",
        wireBColor: wireB?.colors[0] ?? "",
        pitch:
          pair.twistPitchMm === undefined ? "" : `${pair.twistPitchMm} mm`,
        direction:
          pair.twistDirection === "S" || pair.twistDirection === "Z"
            ? pair.twistDirection
            : "Unspecified",
        notes: pair.note ?? "",
      };
    });
}

function buildTerminations(project: HarnessProject): ReportTermination[] {
  return project.links
    .map((link) => physicalLinkContext(project, link))
    .filter((context): context is PhysicalLinkContext => Boolean(context))
    .flatMap((context) => {
      const termination = compactWireTermination(context.link.termination);
      if (!termination) return [];
      const pin = portOrdinal(context.connectorPortId);
      return [
        {
          connector: context.connector.designator,
          pin: pin ? String(pin) : context.connectorPortId,
          pinLabel: pin
            ? getConnectorPinLabel(context.connector, pin)
            : "",
          cable: context.cable.designator,
          conductor: conductorLabel(context.cable, context.cablePortId),
          signal: getConductorSignal(context.cable, context.cablePortId),
          contactManufacturer: clean(termination.contact?.manufacturer),
          contactMpn: partNumber(termination.contact),
          sealPn: partNumber(termination.seal),
          stripLength: clean(termination.stripLength),
          tooling: clean(termination.tooling),
          notes: clean(termination.notes),
        },
      ];
    })
    .sort((left, right) => {
      return (
        naturalCompare(left.connector, right.connector) ||
        naturalCompare(left.pin, right.pin) ||
        naturalCompare(left.cable, right.cable) ||
        naturalCompare(left.conductor, right.conductor)
      );
    });
}

function decodeXmlEntities(value: string) {
  const entity = /&(?:amp|lt|gt|quot|apos|#\d+|#x[\dA-Fa-f]+);/g;
  if (value.replace(entity, "").includes("&")) {
    throw new Error("The generated diagram contains an unsupported XML entity.");
  }
  return value.replace(entity, (match) => {
    if (match === "&amp;") return "&";
    if (match === "&lt;") return "<";
    if (match === "&gt;") return ">";
    if (match === "&quot;") return '"';
    if (match === "&apos;") return "'";
    const hexadecimal = match.startsWith("&#x");
    const number = Number.parseInt(
      match.slice(hexadecimal ? 3 : 2, -1),
      hexadecimal ? 16 : 10,
    );
    if (!Number.isInteger(number) || number <= 0 || number > 0x10ffff) {
      throw new Error("The generated diagram contains an invalid XML entity.");
    }
    return String.fromCodePoint(number);
  });
}

export function escapeHtml(value: string | number) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const SVG_ELEMENTS = new Map(
  [
    "svg",
    "g",
    "title",
    "desc",
    "polygon",
    "polyline",
    "path",
    "ellipse",
    "circle",
    "rect",
    "line",
    "text",
    "tspan",
    "image",
  ].map((name) => [name.toLowerCase(), name]),
);

const SVG_ATTRIBUTES = new Set([
  "xmlns",
  "xml:space",
  "width",
  "height",
  "viewbox",
  "preserveaspectratio",
  "id",
  "class",
  "transform",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linejoin",
  "stroke-linecap",
  "stroke-dasharray",
  "points",
  "d",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "rx",
  "ry",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "href",
]);

function safeSvgHref(value: string) {
  return value.startsWith("#") || SAFE_IMAGE_DATA_URL.test(value);
}

/**
 * Rebuilds generated Graphviz SVG from a small allowlist. Scriptable elements,
 * event handlers, style attributes, foreignObject, and non-data URLs are
 * rejected rather than copied into the standalone report.
 */
export function sanitizeDiagramSvg(svg: string) {
  let source = svg
    .trim()
    .replace(/^\s*<\?xml[\s\S]*?\?>\s*/i, "")
    .replace(/^\s*<!DOCTYPE[\s\S]*?>\s*/i, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  if (!source) throw new Error("The generated harness diagram is empty.");
  if (/<[!?]/.test(source)) {
    throw new Error("The generated diagram contains unsupported declarations.");
  }

  const output: string[] = [];
  const stack: string[] = [];
  const tagPattern = /<[^>]*>/g;
  let cursor = 0;
  let rootCount = 0;
  for (const match of source.matchAll(tagPattern)) {
    const index = match.index ?? 0;
    const text = source.slice(cursor, index);
    if (text) output.push(escapeHtml(decodeXmlEntities(text)));
    const token = match[0];
    const parsed = /^<\s*(\/?)\s*([A-Za-z][\w:-]*)([\s\S]*?)(\/?)\s*>$/.exec(
      token,
    );
    if (!parsed) throw new Error("The generated diagram contains invalid SVG.");
    const closing = Boolean(parsed[1]);
    const rawName = parsed[2].toLowerCase();
    const name = SVG_ELEMENTS.get(rawName);
    if (!name) {
      throw new Error(`The generated diagram contains unsafe <${parsed[2]}> content.`);
    }
    if (closing) {
      if (parsed[3].trim() || parsed[4] || stack.pop() !== rawName) {
        throw new Error("The generated diagram contains invalid SVG nesting.");
      }
      output.push(`</${name}>`);
      cursor = index + token.length;
      continue;
    }

    if (!stack.length) {
      rootCount += 1;
      if (rawName !== "svg" || rootCount !== 1) {
        throw new Error("The generated diagram must contain one SVG root.");
      }
    }
    const attributes: string[] = [];
    const attributeSource = parsed[3];
    const attributePattern = /\s*([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gy;
    let attributeCursor = 0;
    while (attributeCursor < attributeSource.length) {
      attributePattern.lastIndex = attributeCursor;
      const attribute = attributePattern.exec(attributeSource);
      if (!attribute) {
        if (!attributeSource.slice(attributeCursor).trim()) break;
        throw new Error("The generated diagram contains an invalid SVG attribute.");
      }
      attributeCursor = attributePattern.lastIndex;
      let attributeName = attribute[1].toLowerCase();
      if (attributeName === "xmlns:xlink") continue;
      if (attributeName === "xlink:href") attributeName = "href";
      if (
        attributeName.startsWith("on") ||
        attributeName === "style" ||
        !SVG_ATTRIBUTES.has(attributeName)
      ) {
        throw new Error(
          `The generated diagram contains an unsafe ${attribute[1]} attribute.`,
        );
      }
      const value = decodeXmlEntities(attribute[2] ?? attribute[3] ?? "");
      if (attributeName === "href" && !safeSvgHref(value)) {
        throw new Error("The generated diagram contains an external or unsafe URL.");
      }
      if (
        attributeName !== "href" &&
        /(?:url\s*\(|javascript:|data:text\/html)/i.test(value)
      ) {
        throw new Error("The generated diagram contains an unsafe attribute value.");
      }
      if (
        attributeName === "xmlns" &&
        value !== "http://www.w3.org/2000/svg"
      ) {
        throw new Error("The generated diagram has an unexpected SVG namespace.");
      }
      const renderedName =
        attributeName === "viewbox"
          ? "viewBox"
          : attributeName === "preserveaspectratio"
            ? "preserveAspectRatio"
            : attributeName;
      attributes.push(`${renderedName}="${escapeHtml(value)}"`);
    }
    const selfClosing = Boolean(parsed[4]);
    output.push(
      `<${name}${attributes.length ? ` ${attributes.join(" ")}` : ""}${
        selfClosing ? " />" : ">"
      }`,
    );
    if (!selfClosing) stack.push(rawName);
    cursor = index + token.length;
  }
  const trailing = source.slice(cursor);
  if (trailing) output.push(escapeHtml(decodeXmlEntities(trailing)));
  if (stack.length || rootCount !== 1 || !output.join("").startsWith("<svg")) {
    throw new Error("The generated diagram is not a complete SVG document.");
  }
  source = output.join("");
  return source;
}

export function buildHarnessReportModel(
  project: HarnessProject,
  diagramSvg: string,
): HarnessReportModel {
  return {
    project: {
      title: project.title,
      revision: project.revision,
      company: project.company,
      notes: project.notes ?? "",
      schemaVersion: project.schemaVersion,
    },
    diagramSvg: sanitizeDiagramSvg(diagramSvg),
    connectors: buildConnectors(project),
    cables: buildCables(project),
    twistedPairs: buildTwistedPairs(project),
    terminations: buildTerminations(project),
    bomRows: buildBomRows(project),
    harnessImages: buildHarnessImages(project),
  };
}

interface TableColumn<Row> {
  heading: string;
  value: (row: Row, index: number) => string | number;
  render?: (row: Row, index: number) => string;
  optional?: boolean;
  numeric?: boolean;
}

export function renderWireColorHtml(code: string) {
  if (!code) return "";
  return `<span class="wire-color-value"><span class="wire-color-swatch" style="background:${escapeHtml(
    getWireColorCssBackground(code),
  )}" aria-hidden="true"></span><span>${escapeHtml(
    getWireColorDisplay(code),
  )}</span></span>`;
}

function renderTable<Row>(
  rows: readonly Row[],
  columns: ReadonlyArray<TableColumn<Row>>,
  emptyMessage: string,
) {
  const visible = columns.filter(
    (column) =>
      !column.optional || rows.some((row, index) => column.value(row, index) !== ""),
  );
  if (!rows.length) return `<p class="empty">${escapeHtml(emptyMessage)}</p>`;
  return `<div class="table-wrap"><table><thead><tr>${visible
    .map(
      (column) =>
        `<th${column.numeric ? ' class="number"' : ""}>${escapeHtml(column.heading)}</th>`,
    )
    .join("")}</tr></thead><tbody>${rows
    .map(
      (row, index) =>
        `<tr>${visible
          .map((column) => {
            const value = column.value(row, index);
            return `<td${column.numeric ? ' class="number"' : ""}>${
              value === ""
                ? '<span class="muted">—</span>'
                : column.render?.(row, index) ?? escapeHtml(value)
            }</td>`;
          })
          .join("")}</tr>`,
    )
    .join("")}</tbody></table></div>`;
}

function metadataItem(label: string, value: string | number) {
  if (value === "") return "";
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function approvedAlternativesTable(
  alternatives: readonly BomApprovedAlternative[],
) {
  if (!alternatives.length) return "";
  const columns: Array<TableColumn<BomApprovedAlternative>> = [
    {
      heading: "Manufacturer",
      value: (row) => row.manufacturer ?? "",
      optional: true,
    },
    { heading: "MPN", value: (row) => row.mpn ?? "", optional: true },
    { heading: "Note", value: (row) => row.note ?? "", optional: true },
  ];
  return `<h4>Approved Alternatives</h4>${renderTable(
    alternatives,
    columns,
    "",
  )}`;
}

function connectorSection(connector: ReportConnector, index: number) {
  const pinColumns: Array<TableColumn<ReportPin>> = [
    { heading: "Pin", value: (row) => row.pin },
    { heading: "Label", value: (row) => row.label, optional: true },
    { heading: "Signal", value: (row) => row.signal, optional: true },
    { heading: "Cable / wire", value: (row) => row.cable, optional: true },
    { heading: "Conductor", value: (row) => row.conductor, optional: true },
    {
      heading: "Color",
      value: (row) => row.color,
      render: (row) => renderWireColorHtml(row.color),
      optional: true,
    },
    { heading: "Wire size", value: (row) => row.gauge, optional: true },
    {
      heading: "Contact manufacturer",
      value: (row) => row.contactManufacturer,
      optional: true,
    },
    { heading: "Contact MPN", value: (row) => row.contactMpn, optional: true },
    { heading: "Seal PN", value: (row) => row.sealPn, optional: true },
  ];
  const image = connector.photo
    ? `<figure><img src="${escapeHtml(connector.photo.dataUrl)}" alt="${escapeHtml(
        connector.photo.alt || `${connector.designator} connector image`,
      )}" width="${connector.photo.width}" height="${
        connector.photo.height
      }">${
        connector.photo.alt
          ? `<figcaption>${escapeHtml(connector.photo.alt)}</figcaption>`
          : ""
      }</figure>`
    : "";
  const additionalComponentColumns: Array<
    TableColumn<ReportConnectorAdditionalComponent>
  > = [
    { heading: "Type", value: (row) => row.type },
    { heading: "Manufacturer", value: (row) => row.manufacturer, optional: true },
    { heading: "MPN", value: (row) => row.mpn, optional: true },
    { heading: "Description", value: (row) => row.description, optional: true },
    { heading: "Base qty", value: (row) => row.baseQuantity, numeric: true },
    { heading: "Rule", value: (row) => row.quantityMode },
    {
      heading: "Calculated",
      value: (row) => row.calculatedQuantity,
      numeric: true,
    },
    { heading: "Unit", value: (row) => row.unit },
    { heading: "Notes", value: (row) => row.notes, optional: true },
  ];
  const additionalComponents = connector.additionalComponents.length
    ? `<h4>Additional Components</h4>${renderTable(
        connector.additionalComponents,
        additionalComponentColumns,
        "No connector accessories are assigned.",
      )}`
    : "";
  return `<article class="connector-card" id="connector-${index + 1}">
<h3>${escapeHtml(connector.designator)} <span>${escapeHtml(connector.name || connector.kind)}</span></h3>
<div class="connector-overview"><dl class="metadata compact">
${metadataItem("Kind", connector.kind)}
${metadataItem("Manufacturer", connector.manufacturer)}
${metadataItem("MPN", connector.mpn)}
${metadataItem("Supplier", connector.supplier)}
${metadataItem("Supplier PN", connector.supplierPn)}
${metadataItem("Pin count", connector.pinCount)}
</dl>${image}</div>
${connector.notes ? `<p class="notes"><strong>Notes:</strong> ${escapeHtml(connector.notes)}</p>` : ""}
${approvedAlternativesTable(connector.approvedAlternatives)}
<h4>Pinout</h4>
${renderTable(connector.pins, pinColumns, "No pins are defined.")}
${additionalComponents}
</article>`;
}

function cableAdditionalComponentsSection(cable: ReportCable) {
  if (!cable.additionalComponents.length) return "";
  const columns: Array<TableColumn<ReportCableAdditionalComponent>> = [
    { heading: "Type", value: (row) => row.type },
    { heading: "Manufacturer", value: (row) => row.manufacturer, optional: true },
    { heading: "MPN", value: (row) => row.mpn, optional: true },
    { heading: "Description", value: (row) => row.description, optional: true },
    { heading: "Base qty", value: (row) => row.baseQuantity, numeric: true },
    { heading: "Rule", value: (row) => row.quantityMode },
    {
      heading: "Calculated",
      value: (row) => row.calculatedQuantity,
      numeric: true,
    },
    { heading: "Unit", value: (row) => row.unit },
    { heading: "Placement", value: (row) => row.placement, optional: true },
  ];
  return `<article class="cable-components"><h3>${escapeHtml(
    cable.designator,
  )} <span>Additional Components</span></h3>${renderTable(
    cable.additionalComponents,
    columns,
    "No additional components are assigned.",
  )}</article>`;
}

function cableApprovedAlternativesSection(cable: ReportCable) {
  if (!cable.approvedAlternatives.length) return "";
  return `<article class="cable-components component-alternatives"><h3>${escapeHtml(
    cable.designator,
  )} <span>Approved Alternatives</span></h3>${renderTable(
    cable.approvedAlternatives,
    [
      {
        heading: "Manufacturer",
        value: (row) => row.manufacturer ?? "",
        optional: true,
      },
      { heading: "MPN", value: (row) => row.mpn ?? "", optional: true },
      { heading: "Note", value: (row) => row.note ?? "", optional: true },
    ],
    "",
  )}</article>`;
}

const REPORT_CSS = `
:root{color-scheme:light;font-family:Inter,Segoe UI,Arial,sans-serif;color:#17212b;background:#fff;font-size:14px}
*{box-sizing:border-box}body{margin:0;background:#eef1f3}header,main{width:min(1500px,calc(100% - 32px));margin:0 auto}header{padding:32px 0 20px}main{padding-bottom:48px}h1{font-size:2rem;margin:0 0 8px;letter-spacing:-.02em}h2{font-size:1.45rem;margin:0 0 16px;border-bottom:2px solid #1f6f78;padding-bottom:8px}h3{font-size:1.15rem;margin:0 0 14px}h3 span{font-weight:400;color:#62717d;margin-left:8px}h4{margin:18px 0 8px}.subtitle{color:#52616d;margin:0}.report-section,.connector-card{background:#fff;border:1px solid #ccd4d9;border-radius:8px;padding:20px;margin:0 0 20px;box-shadow:0 1px 3px #14212b12}.toc{background:#f7f9fa;border:1px solid #d8dfe3;border-radius:6px;padding:12px 16px;margin-top:20px}.toc strong{margin-right:12px}.toc a{color:#125d67;margin-right:14px}.metadata{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:18px 0}.metadata.compact{margin:0;align-content:start}.metadata div{border-left:3px solid #86a8ad;padding-left:9px}.metadata dt{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:#667783}.metadata dd{margin:2px 0 0;font-weight:600}.diagram{overflow:auto;text-align:center;background:#fff}.diagram svg{display:block;max-width:100%;height:auto;margin:0 auto}.connector-overview{display:grid;grid-template-columns:minmax(260px,1fr) auto;gap:20px;align-items:start}figure{margin:0}figure img{display:block;max-width:260px;max-height:180px;width:auto;height:auto;border:1px solid #d6dde1;border-radius:5px}figcaption{font-size:.75rem;color:#6c7880;margin-top:4px;max-width:260px}.cable-components{margin-top:18px;padding-top:16px;border-top:1px solid #dce3e6}.cable-components h3{margin-bottom:8px}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:.86rem}th,td{border:1px solid #d5dce0;padding:7px 8px;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#e9eff1;color:#253640;font-size:.76rem;text-transform:uppercase;letter-spacing:.035em}tbody tr:nth-child(even){background:#f8fafb}.number{text-align:right;font-variant-numeric:tabular-nums}.muted,.empty{color:#74818a}.notes,.harness-notes{white-space:pre-wrap;background:#f7f9fa;border-left:3px solid #89aeb3;padding:9px 11px}.harness-notes{margin:0;line-height:1.55}.wire-color-value{display:inline-flex;align-items:center;gap:6px;min-width:120px}.wire-color-swatch{display:inline-block;flex:0 0 auto;width:38px;height:12px;border:1px solid #66777e;border-radius:3px;box-shadow:0 0 0 1px #ffffffbf inset}.report-footer{font-size:.78rem;color:#64737d;text-align:center;margin-top:28px}
.harness-images{padding-bottom:8px}.harness-image{margin:0 0 28px;padding:0 0 24px;border-bottom:1px solid #dce3e6;text-align:center}.harness-image:last-child{border-bottom:0;margin-bottom:0}.harness-image h3{text-align:left}.harness-image img{display:block;width:auto;height:auto;max-width:100%;max-height:760px;object-fit:contain;margin:0 auto;border:1px solid #ccd4d9;border-radius:5px}.harness-image figcaption{max-width:none;margin:10px auto 0;text-align:left;white-space:pre-wrap;font-size:.9rem;color:#455661}
@page{size:auto;margin:12mm}
@media print{:root{font-size:10pt}body{background:#fff}header,main{width:100%}header{padding-top:0}.toc{display:none}.report-section,.connector-card{box-shadow:none;border-color:#aeb9bf;border-radius:0;padding:12px;margin-bottom:12px;break-inside:auto}h1,h2,h3,h4{break-after:avoid}.connector-overview,figure,.metadata,.notes{break-inside:avoid}thead{display:table-header-group}tr{break-inside:avoid}table{font-size:8pt}th,td{padding:4px 5px}.diagram{overflow:visible;break-inside:avoid}.diagram svg{max-width:100%;max-height:175mm}figure img{max-width:55mm;max-height:40mm}.connector-card{break-before:auto}.connector-card+ .connector-card{break-before:page}.report-footer{display:none}}
@media print{.harness-images{break-before:page}.harness-image{break-inside:avoid}.harness-image img{max-width:100%;max-height:220mm}}
@media(max-width:700px){header,main{width:min(100% - 16px,1500px)}.connector-overview{grid-template-columns:1fr}figure img{max-width:100%}}
`;

export function renderHarnessReportHtml(model: HarnessReportModel) {
  const cableColumns: Array<TableColumn<ReportCable>> = [
    { heading: "Designator", value: (row) => row.designator },
    { heading: "Type", value: (row) => row.kind },
    { heading: "Manufacturer", value: (row) => row.manufacturer, optional: true },
    { heading: "MPN", value: (row) => row.mpn, optional: true },
    { heading: "Description", value: (row) => row.description, optional: true },
    { heading: "Length", value: (row) => row.length, optional: true },
    { heading: "Conductors", value: (row) => row.conductorCount, numeric: true },
    { heading: "Wire size", value: (row) => row.gauge, optional: true },
    {
      heading: "Color",
      value: (row) => row.color,
      render: (row) => renderWireColorHtml(row.color),
      optional: true,
    },
    { heading: "Twisted pair", value: (row) => row.twistedPair, optional: true },
    { heading: "From", value: (row) => row.from, optional: true },
    { heading: "To", value: (row) => row.to, optional: true },
    { heading: "Notes", value: (row) => row.notes, optional: true },
    {
      heading: "Approved alternatives",
      value: (row) => formatApprovedAlternatives(row.approvedAlternatives),
      optional: true,
    },
  ];
  const terminationColumns: Array<TableColumn<ReportTermination>> = [
    { heading: "Connector", value: (row) => row.connector },
    { heading: "Pin / cavity", value: (row) => row.pin },
    { heading: "Pin label", value: (row) => row.pinLabel, optional: true },
    { heading: "Wire / cable", value: (row) => row.cable },
    { heading: "Conductor", value: (row) => row.conductor },
    { heading: "Signal", value: (row) => row.signal, optional: true },
    {
      heading: "Contact manufacturer",
      value: (row) => row.contactManufacturer,
      optional: true,
    },
    { heading: "Contact MPN", value: (row) => row.contactMpn, optional: true },
    { heading: "Seal PN", value: (row) => row.sealPn, optional: true },
    { heading: "Strip length", value: (row) => row.stripLength, optional: true },
    { heading: "Tooling", value: (row) => row.tooling, optional: true },
    { heading: "Notes", value: (row) => row.notes, optional: true },
  ];
  const twistedPairColumns: Array<TableColumn<ReportTwistedPair>> = [
    { heading: "Pair", value: (row) => row.designator },
    { heading: "Wire A", value: (row) => row.wireA },
    {
      heading: "Wire A color",
      value: (row) => row.wireAColor,
      render: (row) => renderWireColorHtml(row.wireAColor),
      optional: true,
    },
    { heading: "Wire B", value: (row) => row.wireB },
    {
      heading: "Wire B color",
      value: (row) => row.wireBColor,
      render: (row) => renderWireColorHtml(row.wireBColor),
      optional: true,
    },
    { heading: "Pitch", value: (row) => row.pitch, optional: true },
    { heading: "Direction", value: (row) => row.direction },
    { heading: "Notes", value: (row) => row.notes, optional: true },
  ];
  const bomColumns: Array<TableColumn<BomRow>> = [
    { heading: "Item", value: (_row, index) => index + 1, numeric: true },
    { heading: "Category", value: (row) => row.category },
    { heading: "Manufacturer", value: (row) => row.manufacturer, optional: true },
    { heading: "MPN", value: (row) => row.mpn, optional: true },
    { heading: "Description", value: (row) => row.description, optional: true },
    { heading: "Qty", value: (row) => formatBomQuantity(row.quantity), numeric: true },
    { heading: "Unit", value: (row) => row.unit },
    {
      heading: "Designators",
      value: (row) => [...row.designators].sort(naturalCompare).join(", "),
      optional: true,
    },
    {
      heading: "Approved alternatives",
      value: (row) => formatApprovedAlternatives(row.approvedAlternatives),
      optional: true,
    },
    { heading: "Notes", value: (row) => row.notes, optional: true },
  ];
  const harnessNotes = model.project.notes ?? "";
  const hasHarnessNotes = harnessNotes.trim().length > 0;
  const notesSection = hasHarnessNotes
    ? `<section class="report-section" id="notes"><h2>Notes</h2><p class="harness-notes">${escapeHtml(harnessNotes)}</p></section>`
    : "";
  const notesLink = hasHarnessNotes ? '<a href="#notes">Notes</a>' : "";
  const imagesSection = model.harnessImages.length
    ? `<section class="report-section harness-images" id="additional-images"><h2>Additional Images</h2>${model.harnessImages
        .map((image, index) => {
          const alt =
            image.title ||
            image.caption ||
            image.originalFilename ||
            `Harness image ${index + 1}`;
          return `<figure class="harness-image" data-image-id="${escapeHtml(
            image.id,
          )}">${image.title ? `<h3>${escapeHtml(image.title)}</h3>` : ""}<img src="${escapeHtml(
            image.dataUrl,
          )}" alt="${escapeHtml(alt)}" width="${image.width}" height="${
            image.height
          }">${
            image.caption
              ? `<figcaption>${escapeHtml(image.caption)}</figcaption>`
              : ""
          }</figure>`;
        })
        .join("\n")}</section>`
    : "";
  const imagesLink = model.harnessImages.length
    ? '<a href="#additional-images">Additional images</a>'
    : "";
  const title = clean(model.project.title) || "Untitled Harness";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(title)} — Harness Report</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<header>
<h1>${escapeHtml(title)}</h1>
<p class="subtitle">WireForm harness engineering report</p>
<dl class="metadata">
${metadataItem("Revision", model.project.revision)}
${metadataItem("Company", model.project.company)}
${metadataItem("WireForm schema", model.project.schemaVersion)}
</dl>
<nav class="toc" aria-label="Report contents"><strong>Contents</strong><a href="#diagram">Diagram</a><a href="#connectors">Connectors</a><a href="#cables">Cables / wires</a><a href="#twisted-pairs">Twisted pairs</a><a href="#terminations">Terminations</a><a href="#bom">BOM</a>${notesLink}${imagesLink}</nav>
</header>
<main>
<section class="report-section" id="diagram"><h2>Harness Diagram</h2><div class="diagram">${model.diagramSvg}</div></section>
<section id="connectors"><h2>Connectors</h2>${
    model.connectors.length
      ? model.connectors.map(connectorSection).join("\n")
      : '<div class="report-section"><p class="empty">No connectors are defined.</p></div>'
  }</section>
<section class="report-section" id="cables"><h2>Cables / Wires</h2>${renderTable(model.cables, cableColumns, "No cables or wires are defined.")}${model.cables.map(cableApprovedAlternativesSection).join("")}${model.cables.map(cableAdditionalComponentsSection).join("")}</section>
<section class="report-section" id="twisted-pairs"><h2>Twisted Pairs</h2>${renderTable(model.twistedPairs, twistedPairColumns, "No twisted-pair relationships are defined.")}</section>
<section class="report-section" id="terminations"><h2>Terminations</h2>${renderTable(model.terminations, terminationColumns, "No explicit termination metadata is assigned.")}</section>
<section class="report-section" id="bom"><h2>Bill of Materials</h2>${renderTable(sortBomRows(model.bomRows), bomColumns, "No BOM items are defined.")}</section>
${notesSection}
${imagesSection}
<p class="report-footer">Generated by WireForm · self-contained offline report</p>
</main>
</body>
</html>
`;
}

export function htmlReportFilenameForTitle(title: string) {
  const cleanTitle = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${cleanTitle || "wireform-harness"}.html`;
}
