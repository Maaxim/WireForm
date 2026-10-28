import assert from "node:assert/strict";
import test from "node:test";

const layout = await import("../app/report-table-layout.ts");

test("semantic column helpers expose consistent HTML and PDF policy", () => {
  assert.deepEqual(layout.reportColumnClassNames(layout.compactColumn()), [
    "report-col-compact",
    "report-nowrap",
  ]);
  assert.deepEqual(layout.reportColumnClassNames(layout.contentColumn()), [
    "report-col-content",
    "report-prefer-nowrap",
  ]);
  assert.deepEqual(layout.reportColumnClassNames(layout.flexColumn()), [
    "report-col-flex",
  ]);

  const color = layout.colorColumn();
  assert.equal(color.sizing, "content");
  assert.equal(color.noWrap, false);
  assert.equal(color.preferNoWrap, true);
  assert.ok(color.visualWidth > 0);
  assert.ok(color.minWidth < color.maxWidth);
});

test("PDF auto-fit keeps compact values compact and gives remaining width to flex", () => {
  const allocation = layout.calculatePdfColumnWidths(
    [
      {
        heading: "Qty",
        values: [1, 12],
        layout: layout.compactColumn(),
      },
      {
        heading: "MPN",
        values: ["ABC-123"],
        layout: layout.contentColumn(),
      },
      {
        heading: "Description",
        values: ["Bundle wire"],
        layout: layout.flexColumn(),
      },
    ],
    400,
  );

  assert.equal(allocation.widths.reduce((sum, width) => sum + width, 0), 400);
  assert.ok(allocation.widths[0] < allocation.widths[1]);
  assert.ok(allocation.widths[1] < allocation.widths[2]);
  assert.equal(allocation.noWrap[0], true);
  assert.equal(allocation.noWrap[1], true);
});

test("PDF auto-fit shrinks flex columns before content columns", () => {
  const columns = [
    {
      heading: "Pin",
      values: ["12"],
      layout: layout.compactColumn({ minWidth: 30, maxWidth: 30 }),
    },
    {
      heading: "MPN",
      values: ["MANUFACTURER-PART-NUMBER"],
      layout: layout.contentColumn({ minWidth: 60, maxWidth: 130 }),
    },
    {
      heading: "Description",
      values: ["A deliberately long description for the harness assembly"],
      layout: layout.flexColumn({ minWidth: 60, maxWidth: 220 }),
    },
  ];
  const roomy = layout.calculatePdfColumnWidths(columns, 380);
  const constrained = layout.calculatePdfColumnWidths(columns, 280);

  assert.equal(constrained.widths[0], roomy.widths[0]);
  assert.equal(constrained.widths[1], roomy.widths[1]);
  assert.ok(constrained.widths[2] < roomy.widths[2]);
  assert.equal(constrained.widths.reduce((sum, width) => sum + width, 0), 280);
});

test("PDF color width includes the swatch and preserves common bi-color text", () => {
  const plain = layout.calculatePdfColumnWidths(
    [
      {
        heading: "Color",
        values: ["Green / Yellow (GNYE)"],
        layout: layout.contentColumn({ noWrap: true, preferNoWrap: false }),
      },
      {
        heading: "Description",
        values: ["Bundle wire"],
        layout: layout.flexColumn(),
      },
    ],
    400,
  );
  const withSwatch = layout.calculatePdfColumnWidths(
    [
      {
        heading: "Color",
        values: ["Green / Yellow (GNYE)", "Orange / White (OGWH)"],
        layout: layout.colorColumn(),
      },
      {
        heading: "Description",
        values: ["Bundle wire"],
        layout: layout.flexColumn(),
      },
    ],
    400,
  );

  assert.ok(withSwatch.preferredWidths[0] > plain.preferredWidths[0]);
  assert.equal(withSwatch.noWrap[0], true);
  assert.equal(withSwatch.widths.reduce((sum, width) => sum + width, 0), 400);
});

test("PDF auto-fit respects min, max, flex weight, and constrained wrapping", () => {
  const columns = [
    {
      heading: "Type",
      values: ["Connector"],
      layout: layout.contentColumn({ minWidth: 50, maxWidth: 70 }),
    },
    {
      heading: "Description",
      values: ["Description"],
      layout: layout.flexColumn({ flexWeight: 2, minWidth: 40 }),
    },
    {
      heading: "Notes",
      values: ["Notes"],
      layout: layout.flexColumn({ flexWeight: 1, minWidth: 40 }),
    },
  ];
  const roomy = layout.calculatePdfColumnWidths(columns, 430);
  assert.ok(roomy.widths[0] >= 50 && roomy.widths[0] <= 70);
  assert.ok(roomy.widths[1] > roomy.widths[2]);

  const constrained = layout.calculatePdfColumnWidths(columns, 180);
  assert.equal(constrained.widths.reduce((sum, width) => sum + width, 0), 180);
  assert.equal(constrained.noWrap[1], false);
});
