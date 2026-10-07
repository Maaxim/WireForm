import type {
  Column,
  Content,
  Size,
  TableCell,
  TDocumentDefinitions,
} from "pdfmake/interfaces";
import {
  formatBomQuantity,
  naturalCompare,
  sortBomRows,
  type BomApprovedAlternative,
  type BomRow,
} from "./bom.ts";
import { formatApprovedAlternatives } from "./approved-alternatives.ts";
import {
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
import { PDF_COLORS, PDF_STYLES, PDF_TABLE_LAYOUT } from "./pdf-styles.ts";
import {
  getWireColorDisplay,
  parseWireColor,
} from "./wire-colors.ts";

interface PdfColumn<Row> {
  heading: string;
  value: (row: Row, index: number) => string | number;
  cell?: (row: Row, index: number) => Content;
  width?: Size;
  optional?: boolean;
  numeric?: boolean;
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

function clean(value: string | undefined) {
  return value?.trim() ?? "";
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
  const body: TableCell[][] = [
    visible.map((column) => ({
      text: column.heading,
      style: "tableHeader",
      alignment: column.numeric ? "right" : "left",
    }) as TableCell),
    ...rows.map((row, index) =>
      visible.map((column) => {
        const value = column.value(row, index);
        return (value !== "" && column.cell
          ? column.cell(row, index)
          : {
              text: text(value),
              style: "tableCell",
              alignment: column.numeric ? "right" : "left",
              ...(value === "" ? { color: PDF_COLORS.muted } : {}),
            }) as TableCell;
      }),
    ),
  ];
  return {
    table: {
      headerRows: 1,
      keepWithHeaderRows: 1,
      widths: visible.map((column) => column.width ?? "*"),
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
        { heading: "Manufacturer", value: (row) => row.manufacturer ?? "", width: "*", optional: true },
        { heading: "MPN", value: (row) => row.mpn ?? "", width: "*", optional: true },
        { heading: "Note", value: (row) => row.note ?? "", width: "*", optional: true },
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

export function pdfWireColorCell(code: string): Content {
  return {
    columns: [
      pdfWireColorSwatch(code),
      {
        width: "*",
        text: getWireColorDisplay(code),
        style: "tableCell",
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
  { heading: "Pin", value: (row) => row.pin, width: 24 },
  { heading: "Label", value: (row) => row.label, optional: true },
  { heading: "Signal", value: (row) => row.signal, optional: true },
  { heading: "Wire", value: (row) => row.cable, optional: true },
  { heading: "Cond.", value: (row) => row.conductor, optional: true },
  {
    heading: "Color",
    value: (row) => row.color,
    cell: (row) => pdfWireColorCell(row.color),
    width: 105,
    optional: true,
  },
  { heading: "Size", value: (row) => row.gauge, width: 48, optional: true },
  { heading: "Contact mfr.", value: (row) => row.contactManufacturer, optional: true },
  { heading: "Contact MPN", value: (row) => row.contactMpn, optional: true },
  { heading: "Seal PN", value: (row) => row.sealPn, optional: true },
];

const CONNECTOR_COMPONENT_COLUMNS: Array<PdfColumn<ReportConnectorAdditionalComponent>> = [
  { heading: "Type", value: (row) => row.type },
  { heading: "Manufacturer", value: (row) => row.manufacturer, optional: true },
  { heading: "MPN", value: (row) => row.mpn, optional: true },
  { heading: "Description", value: (row) => row.description, optional: true },
  { heading: "Base", value: (row) => row.baseQuantity, width: 30, numeric: true },
  { heading: "Mode", value: (row) => row.quantityMode, width: 62 },
  { heading: "Calculated", value: (row) => row.calculatedQuantity, width: 45, numeric: true },
  { heading: "Unit", value: (row) => row.unit, width: 30 },
  { heading: "Notes", value: (row) => row.notes, optional: true },
];

const CABLE_COMPONENT_COLUMNS: Array<PdfColumn<ReportCableAdditionalComponent>> = [
  { heading: "Type", value: (row) => row.type },
  { heading: "Manufacturer", value: (row) => row.manufacturer, optional: true },
  { heading: "MPN", value: (row) => row.mpn, optional: true },
  { heading: "Description", value: (row) => row.description, optional: true },
  { heading: "Base", value: (row) => row.baseQuantity, width: 30, numeric: true },
  { heading: "Mode", value: (row) => row.quantityMode, width: 62 },
  { heading: "Calculated", value: (row) => row.calculatedQuantity, width: 45, numeric: true },
  { heading: "Unit", value: (row) => row.unit, width: 30 },
  { heading: "Placement", value: (row) => row.placement, optional: true },
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
    subsection("Pins / Terminations"),
    table(connector.pins, PIN_COLUMNS, "No pins are defined."),
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
  { heading: "Designator", value: (row) => row.designator, width: 48 },
  { heading: "Type", value: (row) => row.kind, width: 42 },
  { heading: "Manufacturer", value: (row) => row.manufacturer, optional: true },
  { heading: "MPN", value: (row) => row.mpn, optional: true },
  { heading: "Description", value: (row) => row.description, optional: true },
  { heading: "Length", value: (row) => row.length, width: 46, optional: true },
  { heading: "Cond.", value: (row) => row.conductorCount, width: 28, numeric: true },
  { heading: "Size", value: (row) => row.gauge, width: 46, optional: true },
  {
    heading: "Color",
    value: (row) => row.color,
    cell: (row) => pdfWireColorCell(row.color),
    width: 105,
    optional: true,
  },
  { heading: "Twisted pair", value: (row) => row.twistedPair, optional: true },
  { heading: "From", value: (row) => row.from, optional: true },
  { heading: "To", value: (row) => row.to, optional: true },
  { heading: "Notes", value: (row) => row.notes, optional: true },
];

const CONNECTION_MAPPING_COLUMNS: Array<
  PdfColumn<ReportConnectionMappingRow>
> = [
  { heading: "From", value: (row) => row.from.connectorDesignator, width: 48 },
  { heading: "Pin", value: (row) => row.from.pinDisplay, width: 55 },
  {
    heading: "Wire / Conductor",
    value: (row) => row.conductor.display,
    cell: (row) => pdfConnectionMappingConductorCell(row),
    width: "*",
  },
  {
    heading: "TP",
    value: (row) => row.twistedPair?.designator ?? "",
    width: 38,
  },
  { heading: "To", value: (row) => row.to.connectorDesignator, width: 55 },
  { heading: "Pin", value: (row) => row.to.pinDisplay, width: 90 },
];

const CONDUCTOR_COLUMNS: Array<PdfColumn<ReportConductor>> = [
  { heading: "Conductor", value: (row) => row.number, width: 50, numeric: true },
  { heading: "Label", value: (row) => row.label, optional: true },
  {
    heading: "Color",
    value: (row) => row.color,
    cell: (row) => pdfWireColorCell(row.color),
    width: 105,
    optional: true,
  },
  { heading: "Twisted pair", value: (row) => row.twistedPair, optional: true },
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
          subsection("Additional Components"),
          table(cable.additionalComponents, CABLE_COMPONENT_COLUMNS, ""),
        ]
      : []),
  ];
}

const TWISTED_PAIR_COLUMNS: Array<PdfColumn<ReportTwistedPair>> = [
  { heading: "Pair", value: (row) => row.designator, width: 48 },
  { heading: "Member A", value: (row) => row.wireA },
  {
    heading: "Member A color",
    value: (row) => row.wireAColor,
    cell: (row) => pdfWireColorCell(row.wireAColor),
    width: 105,
    optional: true,
  },
  { heading: "Member B", value: (row) => row.wireB },
  {
    heading: "Member B color",
    value: (row) => row.wireBColor,
    cell: (row) => pdfWireColorCell(row.wireBColor),
    width: 105,
    optional: true,
  },
  { heading: "Pitch", value: (row) => row.pitch, width: 55, optional: true },
  { heading: "Direction", value: (row) => row.direction, width: 62 },
  { heading: "Notes", value: (row) => row.notes, optional: true },
];

const TERMINATION_COLUMNS: Array<PdfColumn<ReportTermination>> = [
  { heading: "Connector", value: (row) => row.connector, width: 48 },
  { heading: "Pin", value: (row) => row.pin, width: 28 },
  { heading: "Label", value: (row) => row.pinLabel, optional: true },
  { heading: "Wire", value: (row) => row.cable, width: 44 },
  { heading: "Cond.", value: (row) => row.conductor, width: 44 },
  { heading: "Signal", value: (row) => row.signal, optional: true },
  { heading: "Contact mfr.", value: (row) => row.contactManufacturer, optional: true },
  { heading: "Contact MPN", value: (row) => row.contactMpn, optional: true },
  { heading: "Seal PN", value: (row) => row.sealPn, optional: true },
  { heading: "Strip", value: (row) => row.stripLength, width: 42, optional: true },
  { heading: "Tooling", value: (row) => row.tooling, optional: true },
  { heading: "Notes", value: (row) => row.notes, optional: true },
];

const BOM_COLUMNS: Array<PdfColumn<BomRow>> = [
  { heading: "Item", value: (_row, index) => index + 1, width: 24, numeric: true },
  { heading: "Category", value: (row) => row.category, width: 62 },
  { heading: "Manufacturer", value: (row) => row.manufacturer, optional: true },
  { heading: "MPN", value: (row) => row.mpn, optional: true },
  { heading: "Description", value: (row) => row.description, optional: true },
  { heading: "Qty", value: (row) => formatBomQuantity(row.quantity), width: 34, numeric: true },
  { heading: "Unit", value: (row) => row.unit, width: 32 },
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

  content.push({
    ...heading("Harness Diagram", "before"),
    pageOrientation: "landscape",
  });
  content.push(
    includeDiagram
      ? {
          svg: model.diagramSvg,
          fit: [720, 455],
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
    for (const connector of model.connectors) {
      content.push(...connectorContent(connector, includeImages));
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
    pageMargins: [42, 54, 42, 44],
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
