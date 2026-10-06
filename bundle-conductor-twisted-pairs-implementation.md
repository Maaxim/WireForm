# Bundle-conductor twisted pairs — implementation

## Summary

WireForm twisted pairs can now relate either two independent single-wire components or two conductors in the same bundle. Bundle conductors remain part of their bundle and keep their own label, color, topology ports, BOM contribution, and report identity.

## Files changed

- `app/model.ts` — schema v4, stable conductor IDs, typed twisted-pair member references, legacy migration.
- `app/twisted-pair.ts` — shared member resolution, creation, validation, cloning, deletion cleanup, and display helpers.
- `app/HarnessStudio.tsx` — bundle-conductor pair creation/editing, canvas badge, history-safe cleanup, copy/paste, and library integration.
- `app/library.ts` — bundle-local pair template persistence and independent ID regeneration.
- `app/html-report.ts` / `app/pdf-report.ts` — shared bundle conductor rows and unified twisted-pair member reporting.
- `app/globals.css` — compact bundle conductor editor styling.
- `tests/twisted-pair.test.mjs`, `tests/html-report.test.mjs`, `tests/project-data.test.mjs` — regression coverage.
- `README.md` — user workflow and compatibility documentation.

## Data model and migration

`TwistedPair.members` now uses a discriminated member reference:

```ts
{ kind: "wire", wireId: string }
{ kind: "bundle-conductor", bundleId: string, conductorId: string }
```

Cable-like components now have positional `conductorIds`. They are stable across normal edits and save/load. Projects from schemas 1–3 receive deterministic IDs derived from component ID and conductor position. Legacy twisted-pair string members are migrated to `wire` references. The project schema is version 4.

No separate pair model was introduced. Standalone and bundle pairs use the existing project-level `twistedPairs` collection.

## UI workflow

The existing two-selected-wire action still creates standalone pairs. A selected Bundle now shows a conductor table with physical ordinal, editable label, editable WireViz color code, and current pair membership. Select two eligible rows and choose **Create twisted pair**. Each local pair exposes designator, pitch, direction, notes, and removal controls. The bundle canvas card shows a compact pair-count badge.

All edits use the existing project update/history path. Removing a pair never removes conductors. Reducing bundle wire count removes relationships that reference removed conductor IDs. Changing a component kind removes relationships that would become invalid.

## Copy, duplication, and User Libraries

Copying a complete bundle regenerates its component ID, all conductor IDs, and all local pair IDs, then remaps pair members to the new conductors. No relationship is created when the required owning component/member set is absent.

Bundle User Library templates store pairs whose two members belong to that bundle. Insertion regenerates component, conductor, and pair IDs and allocates a project-unique pair designator. Other component templates remain unchanged.

## Validation

Validation covers exact two-member cardinality, same-member reuse, mixed standalone/bundle membership, cross-bundle conductor pairs, missing or ineligible members, repeated membership, malformed pitch, duplicate pair designators, and malformed/duplicate conductor IDs. Existing standalone length, gauge, and routing warnings remain unchanged.

## Reports, BOM, and WireViz

The shared report model resolves both member variants. HTML and PDF show bundle conductor number, label, color, and pair/counterpart, and the unified Twisted Pairs section uses the same natural ordering for standalone and bundle pairs.

Pair membership does not add or regroup BOM rows. WireViz export remains standard: bundle/cable definitions and numeric connections are unchanged, no custom twisted-pair key is emitted, and WireViz import does not infer relationships.

## Tests and commands

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed (existing large-chunk advisory only).
- `npm test` — passed, 151/151 tests.
- Formatter — no formatter script is defined in `package.json`; ESLint and TypeScript checks were used.

Focused tests cover standalone compatibility, bundle creation and invalid combinations, stable persistence and v3 migration, cloning/no-half-pair behavior, conductor deletion, library insertion, HTML shared model output, natural pair handling, unchanged BOM, and unchanged WireViz output.

## Manual verification

A production build was served locally and loaded in Chrome headless at 1600×1000; the editor, canvas, inspector, and WireViz runtime startup rendered without an application error. The representative bundle workflow was also exercised through the same model/UI update paths in automated tests: two pairs in one bundle, metadata edits, save/load, copy, conductor removal, library insertion, HTML/PDF model generation, BOM comparison, and WireViz exclusion.

## Known limitations

- Version 1 allows two standalone wires or two conductors in one bundle. Mixed wire/bundle and cross-bundle pairs are rejected.
- WireViz has no targeted standard field for this WireForm relationship, so YAML round-trip intentionally loses pair metadata.
- The canvas uses a bundle-level pair-count badge; detailed conductor pairing is shown in the inspector and reports rather than as intertwined wire geometry.
