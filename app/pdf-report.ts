import type {
  Column,
  Content,
  TableCell,
  TDocumentDefinitions,
} from "pdfmake/interfaces";
import {
  formatBomQuantity,
  sortBomRows,
  type BomApprovedAlternative,
  type BomRow,
} from "./bom.ts";
import { formatApprovedAlternatives } from "./approved-alternatives.ts";
import {
  formatReportDesignators,
  htmlReportFilenameForTitle,
  type HarnessReportModel,
  type ReportCable,
  type ReportCableAdditionalComponent,
  type ReportConductor,
  type ReportConnector,
  type ReportConnectorAdditionalComponent,
  type ReportHarnessImage,
  type ReportPin,
  type ReportTermination,
  type ReportTwistedPair,
} from "./html-report.ts";
import type { ReportConnectionMappingRow } from "./connection-mapping.ts";
import {
  PDF_COLORS,
  PDF_STYLES,
  PDF_TABLE_HORIZONTAL_PADDING,
  PDF_TABLE_LAYOUT,
  PDF_TABLE_LINE_WIDTH,
} from "./pdf-styles.ts";
import {
  getWireColorDisplay,
  parseWireColor,
} from "./wire-colors.ts";
import {
  calculatePdfColumnWidths,
  colorColumn,
  compactColumn,
  contentColumn,
  flexColumn,
  type ReportColumnLayout,
} from "./report-table-layout.ts";

interface PdfCellContext {
  width: number;
  noWrap: boolean;
}

interface PdfColumn<Row> {
  heading: string;
  value: (row: Row, index: number) => string | number;
  measureValue?: (row: Row, index: number) => string | number;
  cell?: (row: Row, index: number, context: PdfCellContext) => Content;
  optional?: boolean;
  numeric?: boolean;
  layout: ReportColumnLayout;
}

export interface PdfRenderOptions {
  includeDiagram?: boolean;
  includeImages?: boolean;
}

export interface PdfDownloadResult {
  warnings: string[];
}

const DETERMINISTIC_PDF_DATE = new Date("2000-01-01T00:00:00.000Z");
const PDF_RASTER_IMAGE = /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=\s]+$/;
const PDF_PAGE_MARGINS = [42, 54, 42, 44] as const;
const A4_PAGE_POINTS = { width: 595.28, height: 841.89 } as const;
const DIAGRAM_HEADING_SPACE = 40;
const PDF_TABLE_WIDTH =
  A4_PAGE_POINTS.width - PDF_PAGE_MARGINS[0] - PDF_PAGE_MARGINS[2];
export function getPdfTableContentWidth(columnCount: number) {
  return (
    PDF_TABLE_WIDTH -
    columnCount * PDF_TABLE_HORIZONTAL_PADDING * 2 -
    (columnCount + 1) * PDF_TABLE_LINE_WIDTH
  );
}

export interface PdfDiagramLayout {
  pageOrientation: "portrait" | "landscape";
  fit: [number, number];
  diagramWidth: number;
  diagramHeight: number;
  scale: number;
}

function clean(value: string | undefined) {
  return value?.trim() ?? "";
}

function svgLengthPoints(value: string | undefined) {
  const match = value?.trim().match(
    /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(px|pt|pc|in|cm|mm)?$/i,
  );
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const unit = match[2]?.toLowerCase() ?? "px";
  const factors: Record<string, number> = {
    px: 0.75,
    pt: 1,
    pc: 12,
    in: 72,
    cm: 72 / 2.54,
    mm: 72 / 25.4,
  };
  return amount * factors[unit];
}

export function getSvgDiagramDimensions(svg: string) {
  const openingTag = svg.match(/<svg\b[^>]*>/i)?.[0] ?? "";
  const viewBox = openingTag
    .match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    viewBox?.length === 4 &&
    viewBox.every(Number.isFinite) &&
    viewBox[2] > 0 &&
    viewBox[3] > 0
  ) {
    return { width: viewBox[2], height: viewBox[3] };
  }
  const width = svgLengthPoints(
    openingTag.match(/\bwidth\s*=\s*["']([^"']+)["']/i)?.[1],
  );
  const height = svgLengthPoints(
    openingTag.match(/\bheight\s*=\s*["']([^"']+)["']/i)?.[1],
  );
  return width && height ? { width, height } : undefined;
}

function diagramArea(orientation: "portrait" | "landscape") {
  const page =
    orientation === "portrait"
      ? A4_PAGE_POINTS
      : { width: A4_PAGE_POINTS.height, height: A4_PAGE_POINTS.width };
  return {
    width: page.width - PDF_PAGE_MARGINS[0] - PDF_PAGE_MARGINS[2],
    height:
      page.height -
      PDF_PAGE_MARGINS[1] -
      PDF_PAGE_MARGINS[3] -
      DIAGRAM_HEADING_SPACE,
  };
}

export function choosePdfDiagramLayout(svg: string): PdfDiagramLayout {
  const dimensions = getSvgDiagramDimensions(svg) ?? { width: 16, height: 9 };
  const portrait = diagramArea("portrait");
  const landscape = diagramArea("landscape");
  const portraitScale = Math.min(
    portrait.width / dimensions.width,
    portrait.height / dimensions.height,
  );
  const landscapeScale = Math.min(
    landscape.width / dimensions.width,
    landscape.height / dimensions.height,
  );
  const pageOrientation =
    landscapeScale > portraitScale ? "landscape" : "portrait";
  const fitArea = pageOrientation === "landscape" ? landscape : portrait;
  return {
    pageOrientation,
    fit: [fitArea.width, fitArea.height],
    diagramWidth: dimensions.width,
    diagramHeight: dimensions.height,
    scale: Math.max(portraitScale, landscapeScale),
  };
}

function text(value: string | number) {
  return value === "" ? "—" : String(value);
}

function table<Row>(
  rows: readonly Row[],
  columns: ReadonlyArray<PdfColumn<Row>>,
  emptyMessage: string,
): Content {
  if (!rows.length) return { text: emptyMessage, style: "empty", margin: [0, 2, 0, 8] };
  const visible = columns.filter(
    (column) =>
      !column.optional || rows.some((row, index) => column.value(row, index) !== ""),
  );
  const allocation = calculatePdfColumnWidths(
    visible.map((column) => ({
      heading: column.heading,
      values: rows.map((row, index) =>
        (column.measureValue ?? column.value)(row, index),
      ),
      layout: column.layout,
    })),
    getPdfTableContentWidth(visible.length),
  );
  const body: TableCell[][] = [
    visible.map((column, columnIndex) => ({
      text: column.heading,
      style: "tableHeader",
      alignment: column.numeric ? "right" : "left",
      ...(allocation.noWrap[columnIndex] ? { noWrap: true } : {}),
    }) as TableCell),
    ...rows.map((row, index) =>
      visible.map((column, columnIndex) => {
        const value = column.value(row, index);
        return (value !== "" && column.cell
          ? column.cell(row, index, {
              width: allocation.widths[columnIndex],
              noWrap: allocation.noWrap[columnIndex],
            })
          : {
              text: text(value),
              style: "tableCell",
              alignment: column.numeric ? "right" : "left",
              ...(allocation.noWrap[columnIndex] ? { noWrap: true } : {}),
              ...(value === "" ? { color: PDF_COLORS.muted } : {}),
            }) as TableCell;
      }),
    ),
  ];
  return {
    table: {
      headerRows: 1,
      keepWithHeaderRows: 1,
      widths: allocation.widths,
      body,
    },
    layout: PDF_TABLE_LAYOUT,
    margin: [0, 0, 0, 10],
  };
}

function heading(value: string, pageBreak?: "before" | "after") {
  return {
    text: value,
    style: "sectionHeading",
    headlineLevel: 1,
    ...(pageBreak ? { pageBreak } : {}),
  };
}

function subsection(value: string): Content {
  return {
    text: value,
    style: "subsectionHeading",
    headlineLevel: 2,
  };
}

function metadataTable(items: Array<[string, string | number]>): Content {
  const populated = items.filter(([, value]) => value !== "");
  return {
    table: {
      widths: [95, "*"],
      body: populated.map(([label, value]) => [
        { text: label.toUpperCase(), style: "metadataLabel" },
        { text: String(value), style: "metadataValue" },
      ]),
    },
    layout: "noBorders",
    margin: [0, 0, 0, 12],
  };
}

function alternativesTable(alternatives: readonly BomApprovedAlternative[]): Content[] {
  if (!alternatives.length) return [];
  return [
    subsection("Approved Alternatives"),
    table(
      alternatives,
      [
        {
          heading: "Manufacturer",
          value: (row) => row.manufacturer ?? "",
          optional: true,
          layout: contentColumn(),
        },
        {
          heading: "MPN",
          value: (row) => row.mpn ?? "",
          optional: true,
          layout: contentColumn(),
        },
        {
          heading: "Note",
          value: (row) => row.note ?? "",
          optional: true,
          layout: flexColumn(),
        },
      ],
      "",
    ),
  ];
}

export function pdfWireColorSwatch(code: string): Column {
  const parsed = parseWireColor(code);
  const primary = parsed.primary?.hex ?? "#70808c";
  const secondary = parsed.secondary?.hex;
  return {
    width: 28,
    canvas: [
      { type: "rect", x: 0, y: 1, w: 25, h: 9, color: primary },
      ...(secondary
        ? [{ type: "rect" as const, x: 0, y: 4, w: 25, h: 3, color: secondary }]
        : []),
      {
        type: "rect",
        x: 0,
        y: 1,
        w: 25,
        h: 9,
        lineColor: "#66777e",
        lineWidth: 0.6,
      },
    ],
  };
}

export function pdfWireColorCell(code: string, noWrap = false): Content {
  return {
    columns: [
      pdfWireColorSwatch(code),
      {
        width: "*",
        text: getWireColorDisplay(code),
        style: "tableCell",
        ...(noWrap ? { noWrap: true } : {}),
      },
    ],
    columnGap: 3,
  };
}

function pdfConnectionMappingConductorCell(
  row: ReportConnectionMappingRow,
): Content {
  if (!row.conductor.colorCode) {
    return { text: row.conductor.display, style: "tableCell" };
  }
  return {
    columns: [
      pdfWireColorSwatch(row.conductor.colorCode),
      {
        width: "*",
        text: row.conductor.display,
        style: "tableCell",
      },
    ],
    columnGap: 3,
  };
}

const PIN_COLUMNS: Array<PdfColumn<ReportPin>> = [
  { heading: "Pin", value: (row) => row.pin, layout: compactColumn() },
  {
    heading: "Label",
    value: (row) => row.label,
    optional: true,
    layout: contentColumn(),
  },
  {
    heading: "Wire / Conductor",
    value: (row) => row.wireConductor,
    optional: true,
    layout: flexColumn(),
  },
  {
    heading: "Color",
    value: (row) => row.color,
    measureValue: (row) => getWireColorDisplay(row.color),
    cell: (row, _index, context) => pdfWireColorCell(row.color, context.noWrap),
    optional: true,
    layout: colorColumn(),
  },
];

const CONNECTOR_COMPONENT_COLUMNS: Array<PdfColumn<ReportConnectorAdditionalComponent>> = [
  { heading: "Type", value: (row) => row.type, layout: contentColumn() },
  {
    heading: "Manufacturer",
    value: (row) => row.manufacturer,
    optional: true,
    layout: contentColumn(),
  },
  {
    heading: "MPN",
    value: (row) => row.mpn,
    optional: true,
    layout: contentColumn(),
  },
  {
    heading: "Description",
    value: (row) => row.description,
    optional: true,
    layout: flexColumn({ flexWeight: 2 }),
  },
  {
    heading: "Base",
    value: (row) => row.baseQuantity,
    numeric: true,
    layout: compactColumn(),
  },
  { heading: "Mode", value: (row) => row.quantityMode, layout: contentColumn() },
  {
    heading: "Calculated",
    value: (row) => row.calculatedQuantity,
    numeric: true,
    layout: compactColumn(),
  },
  { heading: "Unit", value: (row) => row.unit, layout: compactColumn() },
  {
    heading: "Notes",
    value: (row) => row.notes,
    optional: true,
    layout: flexColumn(),
  },
];

const CABLE_COMPONENT_COLUMNS: Array<PdfColumn<ReportCableAdditionalComponent>> = [
  { heading: "Type", value: (row) => row.type, layout: contentColumn() },
  {
    heading: "Manufacturer",
    value: (row) => row.manufacturer,
    optional: true,
    layout: contentColumn(),
  },
  {
    heading: "MPN",
    value: (row) => row.mpn,
    optional: true,
    layout: contentColumn(),
  },
  {
    heading: "Description",
    value: (row) => row.description,
    optional: true,
    layout: flexColumn({ flexWeight: 2 }),
  },
  {
    heading: "Qty",
    value: (row) => row.calculatedQuantity,
    numeric: true,
    layout: compactColumn(),
  },
  { heading: "Unit", value: (row) => row.unit, layout: compactColumn() },
  {
    heading: "Placement",
    value: (row) => row.placement,
    optional: true,
    layout: flexColumn(),
  },
];

function connectorContent(
  connector: ReportConnector,
  includeImages: boolean,
): Content[] {
  const photo =
    includeImages && connector.photo && PDF_RASTER_IMAGE.test(connector.photo.dataUrl)
      ? {
          stack: [
            {
              image: connector.photo.dataUrl,
              fit: [150, 105] as [number, number],
              alignment: "right" as const,
              margin: [8, 0, 0, 4] as [number, number, number, number],
            },
            ...(connector.photo.alt
              ? [
                  {
                    text: connector.photo.alt,
                    style: "smallText",
                    alignment: "right" as const,
                    margin: [8, 0, 0, 4] as [number, number, number, number],
                  },
                ]
              : []),
          ],
        }
      : undefined;
  const overview: Content = {
    columns: [
      {
        width: "*",
        stack: [
          metadataTable([
            ["Type", connector.kind],
            ["Description", connector.name],
            ["Manufacturer", connector.manufacturer],
            ["MPN", connector.mpn],
            ["Supplier", connector.supplier],
            ["Supplier PN", connector.supplierPn],
            ["Pin count", connector.pinCount],
          ]),
          ...(connector.notes
            ? [{
                text: connector.notes,
                style: "note",
                margin: [0, 0, 0, 8] as [number, number, number, number],
              }]
            : []),
        ],
      },
      ...(photo ? [{ width: 165, stack: photo.stack }] : []),
    ],
    columnGap: 10,
  };
  return [
    { stack: [subsection(connector.designator), overview], unbreakable: true },
    ...alternativesTable(connector.approvedAlternatives),
    subsection("Pinout"),
    table(connector.pins, PIN_COLUMNS, "No pins are defined."),
    ...(connector.shieldTerminations.length
      ? [
          subsection("Shield Terminations"),
          table(
            connector.shieldTerminations,
            [
              {
                heading: "Label",
                value: (row) => row.label,
                layout: contentColumn(),
              },
              {
                heading: "Connected to",
                value: (row) => row.connectedTo,
                layout: flexColumn(),
              },
            ],
            "",
          ),
        ]
      : []),
    ...(connector.additionalComponents.length
      ? [
          subsection("Additional Components"),
          table(
            connector.additionalComponents,
            CONNECTOR_COMPONENT_COLUMNS,
            "",
          ),
        ]
      : []),
  ];
}

const CABLE_COLUMNS: Array<PdfColumn<ReportCable>> = [
  {
    heading: "Designator",
    value: (row) => row.designator,
    layout: contentColumn(),
  },
  { heading: "Type", value: (row) => row.kind, layout: contentColumn() },
  {
    heading: "Manufacturer",
    value: (row) => row.manufacturer,
    optional: true,
    layout: contentColumn(),
  },
  {
    heading: "MPN",
    value: (row) => row.mpn,
    optional: true,
    layout: contentColumn(),
  },
  {
    heading: "Description",
    value: (row) => row.description,
    optional: true,
    layout: flexColumn({ flexWeight: 2 }),
  },
  {
    heading: "Length",
    value: (row) => row.length,
    optional: true,
    layout: compactColumn(),
  },
  {
    heading: "Cond.",
    value: (row) => row.conductorCount,
    numeric: true,
    layout: compactColumn(),
  },
  {
    heading: "Size",
    value: (row) => row.gauge,
    optional: true,
    layout: compactColumn(),
  },
  {
    heading: "Color",
    value: (row) => row.color,
    measureValue: (row) => getWireColorDisplay(row.color),
    cell: (row, _index, context) => pdfWireColorCell(row.color, context.noWrap),
    optional: true,
    layout: colorColumn(),
  },
  {
    heading: "Twisted pair",
    value: (row) => row.twistedPair,
    optional: true,
    layout: contentColumn(),
  },
  {
    heading: "Notes",
    value: (row) => row.notes,
    optional: true,
    layout: flexColumn(),
  },
];

const CONNECTION_MAPPING_COLUMNS: Array<
  PdfColumn<ReportConnectionMappingRow>
> = [
  {
    heading: "From",
    value: (row) => row.from.connectorDesignator,
    layout: contentColumn(),
  },
  { heading: "Pin", value: (row) => row.from.pinDisplay, layout: contentColumn() },
  {
    heading: "Wire / Conductor",
    value: (row) => row.conductor.display,
    cell: (row) => pdfConnectionMappingConductorCell(row),
    layout: flexColumn({ flexWeight: 2, visualWidth: 31 }),
  },
  {
    heading: "TP",
    value: (row) => row.twistedPair?.designator ?? "",
    layout: contentColumn(),
  },
  {
    heading: "To",
    value: (row) => row.to.connectorDesignator,
    layout: contentColumn(),
  },
  { heading: "Pin", value: (row) => row.to.pinDisplay, layout: contentColumn() },
];

const CONDUCTOR_COLUMNS: Array<PdfColumn<ReportConductor>> = [
  {
    heading: "Conductor",
    value: (row) => row.number,
    numeric: true,
    layout: compactColumn(),
  },
  {
    heading: "Label",
    value: (row) => row.label,
    optional: true,
    layout: contentColumn(),
  },
  {
    heading: "Color",
    value: (row) => row.color,
    measureValue: (row) => getWireColorDisplay(row.color),
    cell: (row, _index, context) => pdfWireColorCell(row.color, context.noWrap),
    optional: true,
    layout: colorColumn(),
  },
  {
    heading: "Size",
    value: (row) => row.gauge,
    optional: true,
    layout: compactColumn(),
  },
  { heading: "Length", value: (row) => row.length, layout: compactColumn() },
  {
    heading: "Twisted pair",
    value: (row) => row.twistedPair,
    optional: true,
    layout: contentColumn(),
  },
];

const COMPACT_CONNECTOR_COLUMNS: Array<PdfColumn<ReportConnector>> = [
  {
    heading: "Designator",
    value: (row) => row.designator,
    layout: contentColumn(),
  },
  { heading: "Type", value: (row) => row.kind, layout: contentColumn() },
  {
    heading: "Manufacturer",
    value: (row) => row.manufacturer,
    optional: true,
    layout: contentColumn(),
  },
  {
    heading: "MPN",
    value: (row) => row.mpn,
    optional: true,
    layout: contentColumn(),
  },
  {
    heading: "Description",
    value: (row) => row.name,
    optional: true,
    layout: flexColumn(),
  },
  {
    heading: "Pin label",
    value: (row) => row.pins[0]?.label ?? "",
    optional: true,
    layout: contentColumn(),
  },
];

function cableDetails(cable: ReportCable): Content[] {
  const showConductors = cable.kind === "bundle" && cable.conductors.length > 0;
  if (
    !showConductors &&
    !cable.approvedAlternatives.length &&
    !cable.additionalComponents.length
  ) return [];
  return [
    subsection(`${cable.designator} — ${cable.kind}`),
    ...(showConductors
      ? [
          subsection("Bundle Conductors"),
          table(cable.conductors, CONDUCTOR_COLUMNS, ""),
        ]
      : []),
    ...alternativesTable(cable.approvedAlternatives),
    ...(cable.additionalComponents.length
      ? [
          subsection(`${cable.designator} Additional Components`),
          table(cable.additionalComponents, CABLE_COMPONENT_COLUMNS, ""),
        ]
      : []),
  ];
}

const TWISTED_PAIR_COLUMNS: Array<PdfColumn<ReportTwistedPair>> = [
  { heading: "Pair", value: (row) => row.designator, layout: compactColumn() },
  { heading: "Member A", value: (row) => row.wireA, layout: contentColumn() },
  {
    heading: "Member A color",
    value: (row) => row.wireAColor,
    measureValue: (row) => getWireColorDisplay(row.wireAColor),
    cell: (row, _index, context) =>
      pdfWireColorCell(row.wireAColor, context.noWrap),
    optional: true,
    layout: colorColumn(),
  },
  { heading: "Member B", value: (row) => row.wireB, layout: contentColumn() },
  {
    heading: "Member B color",
    value: (row) => row.wireBColor,
    measureValue: (row) => getWireColorDisplay(row.wireBColor),
    cell: (row, _index, context) =>
      pdfWireColorCell(row.wireBColor, context.noWrap),
    optional: true,
    layout: colorColumn(),
  },
  {
    heading: "Pitch",
    value: (row) => row.pitch,
    optional: true,
    layout: compactColumn(),
  },
  {
    heading: "Direction",
    value: (row) => row.direction,
    layout: contentColumn(),
  },
  {
    heading: "Notes",
    value: (row) => row.notes,
    optional: true,
    layout: flexColumn(),
  },
];

const TERMINATION_COLUMNS: Array<PdfColumn<ReportTermination>> = [
  {
    heading: "Connector",
    value: (row) => row.connector,
    layout: contentColumn(),
  },
  { heading: "Pin", value: (row) => row.pin, layout: contentColumn() },
  {
    heading: "Label",
    value: (row) => row.pinLabel,
    optional: true,
    layout: contentColumn(),
  },
  { heading: "Wire", value: (row) => row.cable, layout: flexColumn() },
  { heading: "Cond.", value: (row) => row.conductor, layout: compactColumn() },
  {
    heading: "Signal",
    value: (row) => row.signal,
    optional: true,
    layout: contentColumn(),
  },
  {
    heading: "Contact mfr.",
    value: (row) => row.contactManufacturer,
    optional: true,
    layout: contentColumn(),
  },
  {
    heading: "Contact MPN",
    value: (row) => row.contactMpn,
    optional: true,
    layout: contentColumn(),
  },
  {
    heading: "Seal PN",
    value: (row) => row.sealPn,
    optional: true,
    layout: contentColumn(),
  },
  {
    heading: "Strip",
    value: (row) => row.stripLength,
    optional: true,
    layout: compactColumn(),
  },
  {
    heading: "Tooling",
    value: (row) => row.tooling,
    optional: true,
    layout: flexColumn(),
  },
  {
    heading: "Notes",
    value: (row) => row.notes,
    optional: true,
    layout: flexColumn(),
  },
];

const BOM_COLUMNS: Array<PdfColumn<BomRow>> = [
  {
    heading: "Item",
    value: (_row, index) => index + 1,
    numeric: true,
    layout: compactColumn(),
  },
  {
    heading: "Category",
    value: (row) => row.category,
    layout: contentColumn(),
  },
  {
    heading: "Manufacturer",
    value: (row) => row.manufacturer,
    optional: true,
    layout: contentColumn(),
  },
  {
    heading: "MPN",
    value: (row) => row.mpn,
    optional: true,
    layout: contentColumn(),
  },
  {
    heading: "Description",
    value: (row) => row.description,
    optional: true,
    layout: flexColumn({ flexWeight: 2 }),
  },
  {
    heading: "Qty",
    value: (row) => formatBomQuantity(row.quantity),
    numeric: true,
    layout: compactColumn(),
  },
  { heading: "Unit", value: (row) => row.unit, layout: compactColumn() },
  {
    heading: "Designators",
    value: (row) => formatReportDesignators(row.designators),
    optional: true,
    layout: flexColumn(),
  },
  {
    heading: "Approved alternatives",
    value: (row) => formatApprovedAlternatives(row.approvedAlternatives),
    optional: true,
    layout: flexColumn(),
  },
  {
    heading: "Notes",
    value: (row) => row.notes,
    optional: true,
    layout: flexColumn(),
  },
];

function cover(model: HarnessReportModel): Content[] {
  const title = clean(model.project.title) || "Untitled Harness";
  return [
    { text: "WIREFORM", style: "coverSubtitle", margin: [0, 70, 0, 16] },
    { text: title, style: "coverTitle", margin: [0, 0, 0, 8] },
    { text: "Wiring Harness Engineering Report", fontSize: 16, color: PDF_COLORS.muted, margin: [0, 0, 0, 18] },
    {
      canvas: [
        { type: "line", x1: 0, y1: 0, x2: 505, y2: 0, lineWidth: 2, lineColor: PDF_COLORS.accent },
      ],
      margin: [0, 0, 0, 24],
    },
    metadataTable([
      ["Project / Harness", title],
      ["Company", model.project.company],
      ["Revision", model.project.revision],
      ["WireForm schema", model.project.schemaVersion],
    ]),
    {
      text: "This report is generated documentation. The .wireform.json project remains the authoritative editable source.",
      style: "smallText",
      margin: [0, 30, 0, 0],
    },
  ];
}

function harnessImagesContent(
  images: readonly ReportHarnessImage[],
  includeImages: boolean,
): Content[] {
  if (!images.length) return [];
  return [
    heading("Additional Images", "before"),
    ...images.map((image, index) => ({
      stack: [
        ...(image.title
          ? [{ text: image.title, style: "subsectionHeading" }]
          : []),
        ...(includeImages && PDF_RASTER_IMAGE.test(image.dataUrl)
          ? [
              {
                image: image.dataUrl,
                // Leave enough vertical room for the section heading, image
                // title, caption, page header/footer, and group margins. An
                // oversized unbreakable portrait group can otherwise be
                // dropped by pdfmake instead of moved intact to the next page.
                fit: [440, 400] as [number, number],
                alignment: "center" as const,
                margin: [0, 4, 0, 8] as [number, number, number, number],
              },
            ]
          : [
              {
                text: `Harness image ${index + 1} could not be embedded.`,
                style: "empty",
                margin: [0, 4, 0, 8] as [number, number, number, number],
              },
            ]),
        ...(image.caption
          ? [
              {
                text: image.caption,
                style: "note",
                preserveLeadingSpaces: true,
              },
            ]
          : []),
      ],
      unbreakable: true,
      margin: [0, 0, 0, 18] as [number, number, number, number],
    })),
  ];
}

export function buildHarnessPdfDocument(
  model: HarnessReportModel,
  options: PdfRenderOptions = {},
): TDocumentDefinitions {
  const includeDiagram = options.includeDiagram !== false;
  const includeImages = options.includeImages !== false;
  const title = clean(model.project.title) || "Untitled Harness";
  const revision = clean(model.project.revision);
  const headerTitle = `${title} — Wiring Harness Report${revision ? ` — Rev ${revision}` : ""}`;
  const content: Content[] = [...cover(model)];
  const diagramLayout = choosePdfDiagramLayout(model.diagramSvg);

  content.push({
    ...heading("Harness Diagram", "before"),
    pageOrientation: diagramLayout.pageOrientation,
  });
  content.push(
    includeDiagram
      ? {
          svg: model.diagramSvg,
          fit: diagramLayout.fit,
          alignment: "center",
          margin: [0, 8, 0, 0],
        }
      : {
          text: "The harness diagram could not be embedded in this PDF.",
          style: "empty",
        },
  );

  content.push({
    ...heading("Connection Mapping", "before"),
    pageOrientation: "portrait",
  });
  content.push({
    text: "From/To indicates deterministic report ordering and does not imply electrical signal direction.",
    style: "smallText",
    margin: [0, 0, 0, 8],
  });
  content.push(
    table(
      model.connectionMapping,
      CONNECTION_MAPPING_COLUMNS,
      "No physical conductors are defined.",
    ),
  );

  content.push({
    ...heading("Connectors", "before"),
    pageOrientation: "landscape",
  });
  if (model.connectors.length) {
    for (const connector of model.connectors.filter((item) => !item.compact)) {
      content.push(...connectorContent(connector, includeImages));
    }
    const compactConnectors = model.connectors.filter((item) => item.compact);
    if (compactConnectors.length) {
      content.push(subsection("Simple One-Pin Connectors"));
      content.push(table(compactConnectors, COMPACT_CONNECTOR_COLUMNS, ""));
    }
  } else {
    content.push({ text: "No connectors are defined.", style: "empty" });
  }

  content.push(heading("Wires / Cables / Bundles", "before"));
  content.push(table(model.cables, CABLE_COLUMNS, "No cables or wires are defined."));
  for (const cable of model.cables) content.push(...cableDetails(cable));

  if (model.twistedPairs.length) {
    content.push(heading("Twisted Pairs", "before"));
    content.push(table(model.twistedPairs, TWISTED_PAIR_COLUMNS, ""));
  }

  if (model.terminations.length) {
    content.push(heading("Terminations", "before"));
    content.push(table(model.terminations, TERMINATION_COLUMNS, ""));
  }

  content.push(heading("Bill of Materials", "before"));
  content.push(
    table(sortBomRows(model.bomRows), BOM_COLUMNS, "No BOM items are defined."),
  );

  if (model.project.notes.trim()) {
    content.push({
      ...heading("Harness Notes", "before"),
      pageOrientation: "portrait",
    });
    content.push({
      text: model.project.notes,
      style: "note",
      preserveLeadingSpaces: true,
      margin: [0, 0, 0, 8],
    });
  }

  content.push(...harnessImagesContent(model.harnessImages, includeImages));

  return {
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: [...PDF_PAGE_MARGINS],
    compress: true,
    info: {
      title: `${title} — Wiring Harness Report`,
      author: model.project.company || "WireForm",
      subject: "Wiring harness engineering report",
      keywords: "WireForm, wiring harness, engineering report",
      creator: "WireForm",
      producer: "WireForm / pdfmake",
      creationDate: DETERMINISTIC_PDF_DATE,
      modDate: DETERMINISTIC_PDF_DATE,
    },
    header: {
      text: headerTitle,
      fontSize: 8,
      color: PDF_COLORS.muted,
      margin: [42, 22, 42, 0],
    },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: "WireForm", alignment: "left" },
        { text: `Page ${currentPage} / ${pageCount}`, alignment: "right" },
      ],
      fontSize: 8,
      color: PDF_COLORS.muted,
      margin: [42, 0, 42, 20],
    }),
    defaultStyle: {
      font: "Roboto",
      fontSize: 9,
      color: PDF_COLORS.ink,
    },
    styles: PDF_STYLES,
    content,
  };
}

export function pdfReportFilenameForTitle(title: string) {
  return htmlReportFilenameForTitle(title).replace(/\.html$/, ".pdf");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function loadPdfMake() {
  const [pdfModule, vfsModule] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
  ]);
  const pdfMake = pdfModule.default;
  const vfs = vfsModule.default;
  pdfMake.addVirtualFileSystem(vfs);
  return pdfMake;
}

export async function downloadHarnessPdf(
  model: HarnessReportModel,
  filename = pdfReportFilenameForTitle(model.project.title),
): Promise<PdfDownloadResult> {
  const pdfMake = await loadPdfMake();
  try {
    const blob = await pdfMake.createPdf(buildHarnessPdfDocument(model)).getBlob();
    downloadBlob(blob, filename);
    return { warnings: [] };
  } catch (error) {
    try {
      const fallback = buildHarnessPdfDocument(model, {
        includeDiagram: false,
        includeImages: false,
      });
      const blob = await pdfMake.createPdf(fallback).getBlob();
      downloadBlob(blob, filename);
      return {
        warnings: [
          "The diagram or an embedded image could not be rendered; the PDF was downloaded without embedded graphics.",
        ],
      };
    } catch {
      throw error;
    }
  }
}
