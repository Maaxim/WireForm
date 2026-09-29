# Termination/contact review notes

## Areas for manual review

- Exercise the connector inspector at the supported desktop widths, especially
  long manufacturer part numbers in the compact pin rows.
- Confirm keyboard focus and native nested `<details>` behavior for contact and
  optional-seal editors in Chrome, Edge, Firefox, and Safari.
- Run the documented browser workflow: edit a contact, inspect YAML/preview,
  reload autosave, undo/redo, copy/paste a connected subassembly, delete the
  link, and reconnect it.
- Review BOM policy for the case where an imported manual additional component
  exactly matches an assigned per-pin contact. The implementation adds their
  quantities into one deterministic BOM row.

## Backward compatibility

- Schema-1 and schema-2 projects load and migrate to schema 3 automatically.
- Links without a `termination` property retain their previous behavior and
  generate no new `additional_components`.
- Unknown or malformed nested termination fields are ignored rather than
  preventing a project from loading.
- Connector photos, project metadata, autosave, and component libraries remain
  on their existing persistence paths.
- A newer schema-3 project will still be rejected by older WireForm releases;
  users should retain a backup before opening it in an older deployment.

## Edge cases covered

- Different contact PNs at opposite ends of the same conductor.
- Shared and mixed contact PNs on a connector.
- Optional seals aggregated independently of contacts.
- Imported backshells or other unrelated connector components preserved beside
  generated contacts.
- Manual items using `qty_multiplier` kept separate from exact assigned-contact
  quantities.
- Invalid topology carrying termination metadata warned and excluded from
  aggregation.
- Pin/wire count reduction and shield removal cascading link/termination removal.
- Copy/paste and history snapshots not sharing mutable nested contact objects.

## Known limitations and production considerations

- WireViz cannot preserve the exact pin assignment; only grouped connector BOM
  quantities survive YAML export. The `.wireform.json` project remains the
  authoritative editable artifact.
- The importer intentionally makes no assignment inference, including for a
  single `qty_multiplier: populated` contact. It preserves the connector-level
  entry and reports the ambiguity.
- Strip-length validation accepts positive values using `mm`, `cm`, `m`, `in`,
  `inch`, `inches`, or `"`. More elaborate tolerances remain free-form but will
  produce a warning.
- Imported additional-component fields outside the WireViz 0.4.1 data class are
  reported as unsupported and are not preserved.
- `npm run vendor:verify` currently fails because the checked-in Pyodide
  JavaScript hash differs from `vendor/manifest.json`; this should be resolved
  before relying on the vendor-integrity gate for production releases.
- The locked dependency tree currently has two high-severity npm advisories and
  one moderate advisory. They were not auto-updated because dependency and
  vendored-runtime upgrades require their own compatibility review.

## Recommended follow-up

1. Resolve the Pyodide manifest checksum mismatch from a trusted vendoring
   source and rerun the vendor verification gate.
2. Review and update the affected transitive npm dependencies, then rerun the
   full build/runtime suite.
3. Add browser-level interaction tests for autosave recovery, undo/redo, and the
   expandable termination editor.
4. Consider a future reusable contact catalog or connector-template defaults,
   while keeping actual selected hardware on `TopologyLink`.
5. If users need to author non-contact connector accessories in WireForm, add a
   dedicated connector-level additional-components editor rather than mixing
   those accessories into per-link termination data.
