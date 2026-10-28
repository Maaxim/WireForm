export type ReportColumnSizing = "compact" | "content" | "flex";

export interface ReportColumnLayout {
  sizing: ReportColumnSizing;
  minWidth?: number;
  maxWidth?: number;
  noWrap?: boolean;
  preferNoWrap?: boolean;
  flexWeight?: number;
  visualWidth?: number;
}

export interface PdfColumnMeasurement {
  heading: string;
  values: ReadonlyArray<string | number>;
  layout: ReportColumnLayout;
}

export interface PdfColumnAllocation {
  widths: number[];
  preferredWidths: number[];
  noWrap: boolean[];
}

const DEFAULT_LIMITS: Record<
  ReportColumnSizing,
  { minWidth: number; maxWidth: number }
> = {
  compact: { minWidth: 24, maxWidth: 72 },
  content: { minWidth: 34, maxWidth: 150 },
  flex: { minWidth: 62, maxWidth: Number.POSITIVE_INFINITY },
};

const textWidthCache = new Map<string, number>();

export function compactColumn(
  overrides: Omit<ReportColumnLayout, "sizing"> = {},
): ReportColumnLayout {
  return { sizing: "compact", noWrap: true, ...overrides };
}

export function contentColumn(
  overrides: Omit<ReportColumnLayout, "sizing"> = {},
): ReportColumnLayout {
  return { sizing: "content", preferNoWrap: true, ...overrides };
}

export function flexColumn(
  overrides: Omit<ReportColumnLayout, "sizing"> = {},
): ReportColumnLayout {
  return { sizing: "flex", flexWeight: 1, ...overrides };
}

export function colorColumn(
  overrides: Omit<ReportColumnLayout, "sizing"> = {},
): ReportColumnLayout {
  return contentColumn({
    minWidth: 92,
    maxWidth: 180,
    noWrap: false,
    preferNoWrap: true,
    visualWidth: 31,
    ...overrides,
  });
}

export function reportColumnClassNames(layout: ReportColumnLayout | undefined) {
  if (!layout) return [];
  return [
    `report-col-${layout.sizing}`,
    layout.noWrap ? "report-nowrap" : "",
    !layout.noWrap && layout.preferNoWrap ? "report-prefer-nowrap" : "",
  ].filter(Boolean);
}

export function estimatePdfTextWidth(value: string | number, fontSize = 7.5) {
  const text = String(value);
  const key = `${fontSize}\0${text}`;
  const cached = textWidthCache.get(key);
  if (cached !== undefined) return cached;

  const widestLine = text.split(/\r?\n/).reduce((widest, line) => {
    let units = 0;
    for (const character of line) {
      if (/\s/.test(character)) units += 0.28;
      else if (/[ilI1|.,:;'`]/.test(character)) units += 0.27;
      else if (/[MW@%&#]/.test(character)) units += 0.85;
      else if (/[A-Z0-9]/.test(character)) units += 0.58;
      else units += 0.5;
    }
    return Math.max(widest, units * fontSize);
  }, 0);
  textWidthCache.set(key, widestLine);
  return widestLine;
}

function limits(layout: ReportColumnLayout) {
  const defaults = DEFAULT_LIMITS[layout.sizing];
  return {
    min: layout.minWidth ?? defaults.minWidth,
    max: layout.maxWidth ?? defaults.maxWidth,
  };
}

function shrink(
  widths: number[],
  columns: readonly PdfColumnMeasurement[],
  sizing: ReportColumnSizing,
  deficit: number,
) {
  let remaining = deficit;
  let candidates = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column, index }) => {
      const minimum = limits(column.layout).min;
      return column.layout.sizing === sizing && widths[index] > minimum;
    });
  while (remaining > 0.01 && candidates.length) {
    const share = remaining / candidates.length;
    let reduced = 0;
    for (const { column, index } of candidates) {
      const minimum = limits(column.layout).min;
      const amount = Math.min(share, widths[index] - minimum);
      widths[index] -= amount;
      reduced += amount;
    }
    remaining -= reduced;
    if (reduced < 0.01) break;
    candidates = candidates.filter(
      ({ column, index }) => widths[index] > limits(column.layout).min + 0.01,
    );
  }
  return remaining;
}

export function calculatePdfColumnWidths(
  columns: readonly PdfColumnMeasurement[],
  availableWidth: number,
  options: { fontSize?: number; cellPadding?: number } = {},
): PdfColumnAllocation {
  if (!columns.length) return { widths: [], preferredWidths: [], noWrap: [] };
  const fontSize = options.fontSize ?? 7.5;
  const cellPadding = options.cellPadding ?? 10;
  const preferredWidths = columns.map((column) => {
    const measured = Math.max(
      estimatePdfTextWidth(column.heading, fontSize),
      ...column.values.map((value) => estimatePdfTextWidth(value, fontSize)),
    );
    const { min, max } = limits(column.layout);
    return Math.max(
      min,
      Math.min(max, measured + cellPadding + (column.layout.visualWidth ?? 0)),
    );
  });
  const widths = [...preferredWidths];
  const preferredTotal = widths.reduce((sum, width) => sum + width, 0);

  if (preferredTotal < availableWidth) {
    const recipients = columns
      .map((column, index) => ({ column, index }))
      .filter(({ column }) => column.layout.sizing === "flex");
    const fallbacks = recipients.length
      ? recipients
      : columns
          .map((column, index) => ({ column, index }))
          .filter(({ column }) => column.layout.sizing === "content");
    let targets = fallbacks.length
      ? fallbacks
      : [{ column: columns[0], index: 0 }];
    let extra = availableWidth - preferredTotal;
    while (extra > 0.01 && targets.length) {
      const totalWeight = targets.reduce(
        (sum, { column }) => sum + (column.layout.flexWeight ?? 1),
        0,
      );
      let distributed = 0;
      for (const { column, index } of targets) {
        const share = extra * ((column.layout.flexWeight ?? 1) / totalWeight);
        const capacity = limits(column.layout).max - widths[index];
        const amount = Math.min(share, capacity);
        widths[index] += amount;
        distributed += amount;
      }
      extra -= distributed;
      if (distributed < 0.01) break;
      targets = targets.filter(
        ({ column, index }) => widths[index] < limits(column.layout).max - 0.01,
      );
    }
  } else if (preferredTotal > availableWidth) {
    let deficit = preferredTotal - availableWidth;
    deficit = shrink(widths, columns, "flex", deficit);
    deficit = shrink(widths, columns, "content", deficit);
    deficit = shrink(widths, columns, "compact", deficit);
    if (deficit > 0.01) {
      const emergencyFloor = 12;
      let candidates = widths
        .map((width, index) => ({ width, index }))
        .filter(({ width }) => width > emergencyFloor);
      while (deficit > 0.01 && candidates.length) {
        const share = deficit / candidates.length;
        let reduced = 0;
        for (const { index } of candidates) {
          const amount = Math.min(share, widths[index] - emergencyFloor);
          widths[index] -= amount;
          reduced += amount;
        }
        deficit -= reduced;
        if (reduced < 0.01) break;
        candidates = candidates.filter(
          ({ index }) => widths[index] > emergencyFloor + 0.01,
        );
      }
    }
  }

  const rounded = widths.map((width) => Math.round(width * 100) / 100);
  const total = rounded.reduce((sum, width) => sum + width, 0);
  const difference = Math.round((availableWidth - total) * 100) / 100;
  if (difference < 0 || Math.abs(difference) <= 0.02) {
    const adjustmentIndex = Math.max(
      columns.findIndex((column) => column.layout.sizing === "flex"),
      0,
    );
    rounded[adjustmentIndex] = Math.max(1, rounded[adjustmentIndex] + difference);
  }

  return {
    widths: rounded,
    preferredWidths,
    noWrap: columns.map(
      (column, index) =>
        Boolean(column.layout.noWrap) ||
        (Boolean(column.layout.preferNoWrap) &&
          rounded[index] >= preferredWidths[index] - 0.01),
    ),
  };
}
