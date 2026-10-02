# Connector additional components review

## Areas needing manual review

- Confirm the connector inspector's accessory section remains comfortable on
  the smallest supported desktop width and with long manufacturer/MPN values.
- Review wording for Secondary Lock / TPA across product documentation; some
  manufacturers distinguish secondary locks, TPAs, and retainers more narrowly.
- Exercise library duplicate policies (`keep`, `replace`, and `skip`) with
  production libraries containing older connector templates.
- Review printed HTML with connectors containing many accessory rows.

## Contact/accessory double-count risks

The native BOM path is safe by construction: it consumes user accessories from
the connector and contacts/seals from topology links, never the combined
WireViz export. WireViz export deliberately combines both sources. An authored
accessory that is exactly identical to a generated termination part is summed
with the generated quantity in YAML, retaining its extra quantity rather than
silently discarding it.

The remaining human-data risk is intentional duplication: a user may enter a
contact as a generic connector accessory even though the same physical contact
is assigned to terminations. WireForm treats the manual entry as an intentional
extra/spare. The UI explanation and documentation make the distinction clear,
but purchasing review should still inspect contact-like manual accessories.

## WireViz import ambiguity

WireViz connector `additional_components` is aggregate BOM data and has no
reliable cavity mapping. The importer therefore cannot confidently decide that
an item named `Crimp contact` or `Wire seal` belongs on every, or any specific,
termination. Such entries are preserved as editable connector accessories and
the import report states that no per-pin assignments were inferred. This favors
lossless data retention over an unsafe conversion.

## User Library cloning concerns

Normalization and insertion preserve connector accessories. Insertion and
canvas paste deep-clone accessory data and regenerate internal accessory IDs.
The manual and automated checks confirmed independent edits. Future nested
fields added to `AdditionalComponent` should continue to use structured cloning
through `cloneAdditionalComponentsWithNewIds()` rather than a shallow copy.

## Quantity semantics

Fixed and `populated` satisfy the primary connector accessory workflow.
`pincount` and `unpopulated` are also exposed because they are existing standard
WireViz connector multipliers already accepted by WireForm. Populated quantity
counts distinct connected pin ports; it does not count arbitrary connection
objects or termination metadata on invalid links.

Zero quantity is valid in the editor and project but native BOM aggregation
omits non-positive procurement rows. Negative and non-finite quantities are
validation errors. Unknown multipliers are warned about, omitted from WireViz,
and yield an unavailable effective quantity.

## Future accessory presets

The generic model can support CPA, backshell, strain relief, connector seal,
boot, shield clamp, mounting clip, coding/keying insert, dust cap, retainer, and
generic hardware presets without schema changes. New presets should remain
initial values for the same editor rather than introducing dedicated fields.

Possible future improvements include reorder controls, a preset search menu,
and a visual warning when a manual accessory looks identical to a termination
contact while still preserving its spare quantity.

## Production-use concerns

- The feature itself passes lint, type checking, production build, and all 82
  automated tests, including the live WireViz/Graphviz runtime test.
- `npm run vendor:verify` currently fails because the tracked Pyodide JavaScript
  checksum differs from the tracked manifest. This predates and is outside the
  connector-accessory changes, but release engineering should reconcile the
  vendored artifact and manifest before treating all repository integrity
  checks as green.
- Very large embedded User Libraries and connector photos remain subject to the
  browser storage limits described by the existing application; connector
  accessories add only small JSON objects.
