import type { StyleDictionary, TableLayout } from "pdfmake/interfaces";

export const PDF_COLORS = {
  ink: "#17212B",
  muted: "#62717D",
  accent: "#1F6F78",
  accentLight: "#DDEBED",
  border: "#C8D2D8",
  row: "#F6F8F9",
  note: "#F1F6F7",
} as const;

export const PDF_STYLES: StyleDictionary = {
  coverTitle: {
    fontSize: 28,
    bold: true,
    color: PDF_COLORS.ink,
    lineHeight: 1.05,
  },
  coverSubtitle: {
    fontSize: 14,
    color: PDF_COLORS.accent,
    bold: true,
  },
  sectionHeading: {
    fontSize: 17,
    bold: true,
    color: PDF_COLORS.ink,
    margin: [0, 0, 0, 10],
  },
  subsectionHeading: {
    fontSize: 12,
    bold: true,
    color: PDF_COLORS.accent,
    margin: [0, 8, 0, 6],
  },
  metadataLabel: {
    fontSize: 8,
    bold: true,
    color: PDF_COLORS.muted,
  },
  metadataValue: {
    fontSize: 10,
    color: PDF_COLORS.ink,
  },
  tableHeader: {
    fontSize: 7.5,
    bold: true,
    color: PDF_COLORS.ink,
  },
  tableCell: {
    fontSize: 7.5,
    color: PDF_COLORS.ink,
    lineHeight: 1.08,
  },
  smallText: {
    fontSize: 8,
    color: PDF_COLORS.muted,
  },
  note: {
    fontSize: 9,
    color: PDF_COLORS.ink,
    lineHeight: 1.25,
  },
  empty: {
    fontSize: 9,
    italics: true,
    color: PDF_COLORS.muted,
  },
};

export const PDF_TABLE_LAYOUT: TableLayout = {
  hLineColor: () => PDF_COLORS.border,
  vLineColor: () => PDF_COLORS.border,
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  paddingLeft: () => 4,
  paddingRight: () => 4,
  paddingTop: () => 3,
  paddingBottom: () => 3,
  fillColor: (rowIndex) =>
    rowIndex === 0
      ? PDF_COLORS.accentLight
      : rowIndex % 2 === 0
        ? PDF_COLORS.row
        : null,
};
