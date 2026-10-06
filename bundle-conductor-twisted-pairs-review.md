# Bundle-conductor twisted pairs — review notes

## Areas for manual review

- Verify the compact bundle conductor table at narrow inspector widths and with 64 conductors.
- Exercise keyboard-only checkbox, label, color, pair metadata, and removal workflows.
- Confirm the pair-count badge remains readable on bundle cards with long names.
- Inspect long bundle conductor tables and long pair notes in both HTML print preview and multipage PDF output.

## Persistence and migration

Schema v4 adds stable `conductorIds` and typed pair member references. Legacy standalone pair members are migrated from strings. Deterministic IDs for legacy conductors are position-derived; after the migrated project is saved, those IDs are explicitly persisted. Review unusual hand-edited projects containing duplicate or empty IDs—the normalizer repairs local duplicates and validation protects live malformed state.

## Deletion and reordering

Reducing conductor count removes pairs that reference the removed tail conductors. There is currently no conductor reorder operation, so no separate reorder behavior is exposed. If reorder is added later, it must move the conductor ID together with label/color data rather than regenerate IDs.

## Copy and User Library concerns

Copy/paste and library insertion regenerate relationship IDs and conductor IDs. Bundle-local pairs are preserved only when the complete bundle template is saved; individual conductors are not library objects and cannot carry half a relationship. Existing duplicate-template policy remains based on primary component identity, so users choosing “skip” may intentionally keep an older version of a template without newer pair metadata.

## WireViz and BOM compatibility

Twisted-pair metadata remains WireForm-only. WireViz export contains no non-standard pair keys and import does not infer pairs. This makes WireForm → WireViz → WireForm intentionally lossy. Pair membership has no BOM row or quantity effect; a future purchasable twisted-pair product would need a separate explicit component model, not an extension of this relationship.

## Report considerations

Both renderers consume the same normalized report model. Bundle conductor tables can become long, especially in PDF. Current PDF tables repeat headers and paginate naturally; unusually verbose labels/notes deserve visual review. Missing members render as such rather than crashing export.

## Future improvements

- Dedicated conductor row drag/reorder that preserves IDs.
- A clearer multi-row selection affordance for touch devices.
- Optional canvas bracket detail for individual pair identities at high zoom.
- Import/export through a future official WireViz twisted-pair syntax if one is standardized.

## Production-use concerns

No blocking automated regression remains. The main production consideration is intentional WireViz round-trip loss of WireForm-only relationship data; `.wireform.json` must remain the authoritative editable source.
