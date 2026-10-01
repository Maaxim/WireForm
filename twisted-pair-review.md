# Twisted-pair review notes

## Areas requiring manual review

- Confirm the compact badge remains legible with long pair designators and at
  the minimum supported desktop viewport.
- Confirm inspector wording and S/Z direction terminology match the intended
  manufacturing conventions.
- Exercise large projects with many paired wires to assess inspector and
  validation ergonomics.
- Review whether converting an already-paired wire to another component kind or
  increasing its conductor count should keep the relationship as a visible
  validation error (current behavior) or ask to remove it immediately.

## Copy and relationship edge cases

Clipboard behavior is deliberately all-or-nothing: both members produce a new
independent relationship; one member never does. Internal links, termination
metadata, and each member's additional components continue through their
existing copy paths. Pair IDs use the same runtime ID strategy as other nested
project entities, while pair designators use deterministic first-gap allocation.

Selections containing both members plus unrelated components clone the pair.
Selections containing a malformed relationship cannot fabricate a partial pair.

## Topology-validation limitations

Routing consistency currently warns when one member is connected at both ends
while the other is not. It does not try to prove that two wires traverse the
same physical route because the present topology has no route-segment model and
guessing from signal names or endpoints could produce false errors. Different
parseable lengths and different normalized gauge strings are warnings only.

## Canvas limitations

The badge is intentionally local to each wire and does not draw a cross-canvas
bracket. This avoids implying electrical connectivity and remains usable when
members are far apart, but it gives less immediate visual grouping than a
layout-aware bracket could provide.

## Backward compatibility

Legacy projects receive an empty `twistedPairs` list during normalization. The
schema version remains unchanged because the field is additive. Pair metadata
is project-level and therefore absent from individual User Library templates.
Existing terminations, cable accessories, BOM aggregation, and HTML security
paths remain authoritative and were regression-tested.

## WireViz round-trip limitation

WireViz 0.4.1 has no supported representation for this WireForm relationship.
Export intentionally emits two ordinary wires and no custom YAML. Consequently,
exporting to WireViz YAML and reimporting loses pair designator, pitch,
direction, and notes. The `.wireform.json` file remains the authoritative source.

If a future supported WireViz version introduces an official pair construct,
map it at the existing document/import boundaries without changing the current
project relationship model.

## Future improvements

- Optional breakout/start/end lengths once the physical routing model can
  represent them accurately.
- A layout-aware bracket overlay that does not imply connectivity.
- An explicit member-replacement workflow with full eligibility checks.
- Generalized relationship types for triplets or star quad only when there is a
  concrete product requirement; the current implementation intentionally avoids
  premature `wireGroups` abstraction.
- Official WireViz mapping if and when the pinned version supports it.

## Production-use concerns

No twisted-pair-specific production blocker was found. The full test/build suite
passes, and Chrome manual verification covered persistence and exports. The
repository-wide vendor verification command still fails on an existing Pyodide
JavaScript checksum mismatch. The affected file is unchanged from `HEAD`, so it
was not caused by this work, but the manifest/file discrepancy should be
resolved before treating the vendor-integrity gate as green.

