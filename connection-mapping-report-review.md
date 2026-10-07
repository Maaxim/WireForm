# Connection Mapping Report — Review Notes

## Areas needing manual review

- Compare the mapping against a production harness containing representative connectors, splices/junctions, cables, bundles, standalone wires, partial pin labels, and open ends.
- Confirm the compact conductor wording matches shop-floor terminology (`cond.` versus a longer localized form).
- Review PDF wrapping with the longest real connector designators, pin labels, signal names, and cable designators used by the organization.
- Confirm the portrait table remains readable on the intended paper sizes and printers.
- Exercise a genuinely large project in the browser to assess report-model construction and PDF generation time, although the builder is a straightforward conductor/link scan and the automated 48-row PDF succeeds.

## Topology assumptions

The builder treats every `wire:1..wireCount` port on wire/cable/bundle components as a physical conductor. A topology link touching that port contributes the opposite endpoint. Only connector-family components with valid `pin:n` ports are considered resolved endpoints.

This matches the current project model, where electrical topology is represented as links between stable component IDs and port IDs. If future topology permits explicit in-line non-connector nodes, branched conductor segments, or nested cable structures, endpoint normalization should be revisited rather than inferred from report strings.

## Multidrop and splice limitations

More than two resolved endpoints are deliberately represented as one conductor row with a `MULTI-DROP` destination and a deterministic endpoint list. The implementation does not create every possible endpoint pair because that would imply independent physical runs that may not exist.

Splices and junctions are members of the current connector family and therefore appear as endpoint components when linked through pins. The overview does not recursively trace through a splice into several downstream physical conductors. That would require explicit topology semantics and is outside this report-only feature.

## Endpoint direction ambiguity

Current links do not carry an electrical source/destination direction. The builder normalizes endpoints using natural connector/pin ordering, and both reports explicitly say that From/To is deterministic report ordering rather than signal direction.

If explicit signal direction is added later, it should be supplied as authoritative topology metadata and consumed by the shared builder. It should not be inferred from link insertion order, component position, signal names, or SVG direction.

## Natural sorting edge cases

The implementation reuses the existing BOM natural comparator. This correctly handles common values such as `J2`/`J10` and numeric pins. Projects using unusual mixed punctuation, locale-specific digits, or designators that differ only by case should be reviewed for the desired organizational order.

OPEN and UNRESOLVED states sort after connected endpoints by explicit status ordering. This makes completed mappings scan first while keeping incomplete conductors visible and deterministic.

## Bundle-conductor identity concerns

Bundle twisted-pair membership uses the stable conductor ID, while visible mapping identity uses physical conductor number plus the current label and color. This is correct for current projects, but any future conductor reordering feature must keep its stable-ID semantics aligned with topology, termination, and twisted-pair references.

Cable conductors are listed like bundle conductors, but twisted-pair lookup is intentionally limited to the member types currently supported by the project model: standalone single wires and conductors inside bundles.

## Very large harness and PDF pagination concerns

The PDF table repeats its header and allows ordinary rows to flow between pages. A 48-row mapping generated a valid PDF in automated verification. Extremely long single-cell content—especially a large multidrop endpoint list—can make one row unusually tall. Production data with hundreds of conductors should be inspected for comfortable density and generation time before release workflows rely on it.

The HTML table is full width and horizontally scrollable on narrow screens; printed output uses the existing compact report styles.

## OPEN and malformed topology behavior

Unused conductors are retained as `OPEN -> conductor -> OPEN`; this is intentional because a report reviewer should see all modeled physical conductors. One-ended conductors show OPEN at the missing end. Invalid opposite ports become UNRESOLVED rather than being guessed or omitted.

The existing validation system remains the authoritative place for root-cause issues. The report does not add a competing validator.

## Shared-model and regression risk

HTML and PDF consume `HarnessReportModel.connectionMapping` directly, preventing renderer drift. The mapping builder is independent of BOM and WireViz serialization and is read-only. Review should ensure future report refactors continue to build this field once rather than traversing raw topology separately in either renderer.

The detailed connector, cable, twisted-pair, termination, BOM, notes, and image sections remain unchanged. The only intentional report-order change is insertion of Connection Mapping immediately after the diagram.

## Future CSV export possibility

A dedicated connection-mapping CSV could be useful for assembly or test documentation, but it was intentionally not added. If implemented later, it should consume the same `ReportConnectionMappingRow[]` and existing CSV escaping rather than rebuilding topology.

## Production-use concerns

- Treat the physical pin as authoritative; the label in parentheses is presentation metadata.
- Treat From/To as non-directional unless the project model later supplies explicit direction.
- Investigate every UNRESOLVED value through the editor validation UI before releasing manufacturing documentation.
- Confirm whether unused conductors should remain intentionally open or represent incomplete design work.
- Establish a review convention for multidrop summaries, since this overview is not a full branch topology diagram.
- Keep `.wireform.json` as the editable source; the mapping is a derived snapshot in each exported report.
