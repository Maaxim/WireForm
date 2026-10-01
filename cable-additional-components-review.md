# Cable/Wire Additional Components Review

## Areas needing manual review

- Confirm the compact inspector remains comfortable on the minimum supported
  desktop width with several expanded accessory rows.
- Review terminology for WireViz's `terminations` multiplier. WireViz 0.4.1
  counts cable connection records; users may intuitively expect physical wire
  ends instead.
- Confirm from/to orientation matches manufacturing conventions for cables
  placed or reconnected in unusual visual arrangements.
- Review HTML accessory tables with very long supplier descriptions and large
  accessory counts in browser print preview.

## WireViz round-trip limitations

Standard part, quantity, unit, color, and multiplier fields round-trip.
WireForm-only IDs and placement data are deliberately omitted from YAML and
cannot be restored by importing YAML alone. Project JSON remains the
authoritative editable source.

Unknown imported multipliers are preserved in WireForm project data for user
repair, shown as warnings, and omitted on export to keep output compatible with
WireViz 0.4.1.

## Placement semantics concerns

- `from` and `to` use the cable port's existing left/right endpoint orientation,
  not designator ordering or current canvas coordinates.
- A disconnected named end is warned about and shown generically in the report.
- Selected conductors accept either one-based conductor ordinals or exact
  conductor label text. Duplicate selections are retained but do not affect
  purchasing quantities.
- Placement differences intentionally do not split native BOM purchasing rows.

## Quantity-calculation edge cases

- WireViz `terminations` equals `Cable.connections`. For a fully connected
  12-conductor cable this is 12, even though there are 24 physical ends.
- Partially connected conductors count once when they produce a WireViz cable
  connection record. The UI reports the modeled partial count rather than
  inventing missing ends.
- `length` and `total_length` require a supported positive unit-bearing cable
  length. An unresolved calculation is shown as unavailable and skipped as an
  accessory BOM contribution while validation and existing cable-length notes
  remain visible.
- A zero calculated quantity is retained in project/YAML data but is omitted
  by the existing BOM aggregator, matching its handling of non-purchased rows.

## Multiconductor cable concerns

Base cable procurement remains counted once by modeled cable length. Accessory
`total_length` explicitly multiplies by wire count because that is the selected
WireViz rule. Loose `bundle` base length behavior is unchanged from the
existing BOM implementation.

## Legacy-project considerations

No schema bump was introduced because the field is optional and normalization
is additive. Legacy projects load with no accessory list. Existing connector
additional components gain internal IDs in memory but serialize to the same
standard WireViz fields; internal IDs never leak into YAML.

## User-library concerns

Template serialization retains full placement metadata. Each insertion creates
new accessory IDs and deep-cloned placement arrays. Library duplicate matching
still uses the parent component signature, not individual accessory content;
users should choose the existing keep/replace/skip policy deliberately when
two templates share a parent part identity but differ in accessories.

## Security and robustness

Accessory text follows the existing HTML report escaping path. Placement fields
never enter SVG generation, and only standard whitelisted component fields are
sent to WireViz. Malformed quantities or placement values cannot crash the BOM
or report paths.

## Future improvements

- Add a small explicit “both physical ends” preset/rule explanation beside the
  WireViz `terminations` mode.
- Add reordering for accessory rows when assembly sequence matters.
- Offer selectable conductor chips instead of comma-separated identifiers for
  very large cables.
- Add an optional report-only assembly sequence or installation zone without
  affecting BOM identity.
- Resolve the repository's pre-existing Pyodide vendor-manifest checksum drift.

## Production-use concerns

The implemented feature passes type checking, linting, the 54-test suite,
production build, real WireViz runtime validation, and Edge workflow checks.
The main semantic risk is user interpretation of WireViz `terminations`; it is
documented and intentionally follows WireViz 0.4.1 exactly. The unrelated
vendor checksum verification failure should be resolved before treating the
vendored dependency manifest as a reliable release gate.
