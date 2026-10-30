# WireForm → Onshape Cable/Wire Routing CSV Export — Implementation Handoff

**Prepared:** 2026-10-27  
**Target:** `maxim/new_features`
**Status:** Implemented and verified with Onshape, confirmed by the user on 2026-10-30.

**Roadmap:** Phase 1 completed and verified; Phases 2–5 cancelled; Phase 6 (importing Onshape-calculated wire lengths) remains a potential future feature.

This document records the completed exporter, its technical contract and verification history. Development-phase information stays in internal documentation and is not presented in the export UI.

## 1. Outcome

WireForm provides **Export → Onshape CSV** in the existing export toolbar.

Users should be able to obtain a deterministic CSV from their electrical connectivity model, upload that CSV into an Onshape document, and select it through Neil Cooke's Cable/Wire Routing **Wire data** feature to define conductors for 3D routing.

The export must:

- Run **entirely in the browser**, without Onshape login, server, API keys, or telemetry.
- Emit **one row for each real, eligible physical conductor**: standalone wire, bundle conductor, or multicore cable conductor.
- Preserve connector designators, authoritative physical pin IDs, gauge, and supported color values.
- Use stable wire identities and deterministic ordering.
- Make unsupported/invalid/omitted data visible and never silently invent electrical connectivity.
- Not modify projects, existing electrical model, reports, BOM, or WireViz export.

**Do not implement** Onshape API synchronization, 3D CAD files, reverse length import, full connector-library generation, or harness flattening in Phase 1.

## 2. External interoperability evidence and verification status

### 2.1 Verified from published Onshape guidance

Neil Cooke's official Onshape wiring Tech Tip (2025) describes a **from-to CSV** containing:

- Wire ID; from and to references/pins.
- Wire geometry such as diameter, area, gauge, insulation thickness.
- Minimum bend radius and color (RGB, hex, or named colors).
- A workflow in which the user uploads the CSV, configures Wire data and units/column mapping, and works with connector reference geometry and routing features.

Source: https://www.onshape.com/de/resource-center/tech-tips/tech-tip-how-to-use-custom-features-for-wiring-in-onshape

The original Onshape developer thread names the public FeatureScript document and shows the intended from-to workflow:

- FeatureScript: https://cad.onshape.com/documents/3599036701247d65f0106997
- Thread: https://forum.onshape.com/discussion/18756/custom-feature-cable-wire-routing
- CSV import video: https://onshape.wistia.com/medias/cwfkicq4gg

An independently published wiring tutorial explicitly lists these seven case-sensitive headers:

1. `Wire ID`
2. `From Ref`
3. `To Ref`
4. `From Pin`
5. `To Pin`
6. `Gauge`
7. `Color`

Source: https://sites.google.com/nicholsschool.org/emrknowledgebase/shared-resources/skills/mechanical/cadcam/wiring-cad

This is the historical basic-header example. The completed WireForm exporter uses the 13-column contract in §5, verified by the user with Onshape.

The Onshape FeatureScript documentation confirms that uploaded external CSV files must be Onshape document tabs to be referenced by FeatureScript:

https://cad.onshape.com/FsDoc/imports.html

The developer's July 2026 changelog announced two-color wires in release 1.217:

https://forum.onshape.com/discussion/18756/custom-feature-cable-wire-routing/p8

**Color syntax resolved (2026-10-28):** The user verified the 1.217 demonstration video at https://onshape.wistia.com/medias/drjqloy1cv and supplied its confirmed CSV syntax. Full English names are accepted, and two colors can be separated by `/`, `-`, `_`, or `+`. Examples demonstrated include `green/yellow`, `GN+yellow`, `VIWH`, `violet-WH`, `dark_red`, and `LT BL`. Dark/light modifiers and IEC 60757 / DIN/VDE aliases are supported. CSV import supports bi-color wires even though the manual wire-route selector currently offers a single color.

WireForm exports **lowercase full English names**, using `primary-color/secondary-color` for bi-colors. For example `BUWH` → `blue/white`, `WHBU` → `white/blue`, and WireForm `VTWH` → `violet/white`. This avoids assuming that Onshape aliases (such as `VI`) match WireForm/WireViz aliases (such as `VT`). The user verified the video syntax and subsequently confirmed successful operation of the implemented exporter with Onshape on 2026-10-30.

**Additional columns confirmed by the user (2026-10-28):** Cable/Wire Routing can import CSV containing additional columns and select only the columns it needs. The current exporter always produces the single 13-column schema in §5, including optional connector/contact MPNs and strip lengths. No routing-only profile, mode, selector, or separate manufacturing file is provided. This confirmation does not establish that Onshape consumes the contact/strip-length columns for routing.

### 2.2 Completed verification

The user confirmed that the completed native exporter works successfully with Onshape. This supersedes the earlier development-time compatibility notices and pending research gates.

- The 13-column CSV, physical endpoint mapping, stable identities and current color/gauge conversion are established feature behavior.
- Automated tests continue to validate mapping, ordering, escaping, metadata association and invalid-input handling.
- Verification attribution is the user's Onshape test; the agent's local checks cover code, generated CSV and build/test behavior.

No verification acknowledgement is required for ordinary valid exports. Warnings remain for actual excluded shield connections and invalid optional strip lengths; data-integrity errors still block download.

## 3. WireForm context: implemented features to preserve

Treat the local checkout as truth. Relevant existing functionality in the user's implementation includes:

- Standalone wires, multicore cables, bundles, and physical bundle conductors.
- General bundle length with optional per-conductor overrides (not export fields in Phase 1).
- Stable conductor references for twisted pairs (verify actual representation).
- Authoritative physical connector pin numbers plus optional pin display labels.
- Dedicated connector shield terminations *separate from numbered pins* and cable shield topology.
- Solid/bi-color wire color codes like `RD`, `BK`, `OGWH`, `GNYE`.
- Connection Mapping report with shared topology resolution and deterministic endpoints.
- Local BOM, HTML/PDF exports, User Libraries, WireViz compatibility.

**Critical:** Export rows must come from the actual electrical model, not parsed HTML/SVG, report text, Graphviz geometry, or screen labels. Reuse existing domain endpoint resolution. If that logic is embedded in report code, extract a pure shared resolver without coupling the exporter to the report renderer.

## 4. Data mapping contract

| WireForm source | CSV treatment | Notes |
|---|---|---|
| Standalone single wire | One row | Stable identity and two valid endpoints required. |
| Bundle conductor | One row per physical conductor | Never one row representing a whole bundle. |
| Multicore cable conductor | One row per physical conductor | Do not use cable OD as conductor OD. |
| Bundle or cable grouping | Keep stable association within row identity | Dedicated grouping CSV field only if verified to exist. |
| Connector designator | `From Ref` / `To Ref` | Must correspond to an Onshape Wire ref. |
| Physical connector pin | `From Pin` / `To Pin` | Do not substitute WireForm pin display label. |
| Wire size / gauge | `Gauge` | Convert only according to verified target parser. |
| Wire/conductor color | `Color` | Use verified Onshape color mapping; never drop the stripe silently. |
| Wire/conductor label or signal | Not an extra column in Phase 1 | Retain internally only for error context. |
| Bundle conductor length override | Not exported | Routing length and manufacturing cut length are different. |
| Twisted-pair ID/pitch/direction | Outside the CSV contract | Export member wires normally, without a feature-gap notice. |
| Cable shield | No shield rows | Warn about connected shield terminations excluded from the CSV. Floating shield metadata needs no warning. |
| Dedicated connector shield endpoint | Outside numbered-pin routing rows | Preserve the genuine non-pin endpoint error; never use fake pin `0`, `-1`, or `SHIELD`. |
| Connector primary MPNs | `From Part No` / `To Part No` | Resolve by endpoint connector ID; preserve formatting. |
| Per-end contact MPNs | `From Contact PN` / `To Contact PN` | Only `contact.mpn` from the exact conductor-end topology link. |
| Per-end strip lengths | `From Strip Length (mm)` / `To Strip Length (mm)` | Convert each endpoint separately to numeric millimeters; no suffix. |
| Seals, alternatives, accessories | Not exported | Never substituted for primary connector/contact MPNs. |

### Physical pin mapping

Always use the stable *actual* physical pin identifier, not the user-editable display label. The existing Onshape 3D connector pin references must match exported values. If an Onshape library intentionally numbers pins differently, resolve that through a separately reviewed mapping, **not silent substitution**.

### Endpoint ordering

For non-directional conductors, reuse the same deterministic endpoint ordering as Connection Mapping, so one project exports the same `From` and `To` assignments each time. This is not an assertion of signal direction. Each resolved endpoint carries its own conductor-end termination metadata **before sorting**; connector MPNs are looked up by that endpoint's connector ID. Reversing normalized order therefore moves the connector/contact MPNs and strip length with their physical pin.

### Identity / stable Wire ID

Requirements:

- Unique across every exported conductor in the file.
- Stable across repeated exports, reordering conductors, and changing UI layout.
- Based on the existing persistent conductor identity wherever possible.
- Readable when practical, but **never use a transient array index as identity**.
- Detect collisions and reject affected export; do not silently add random suffixes.

Illustrative labels (`W1-01`, `W1-02`) are **not sufficient** if `01/02` refer to unstable array positions. Prefer an existing stable member ID with a deterministic, safe encoding. Record any trade-off (e.g. bundle designator renaming changes visible external ID). Do not add persistent ID fields without inspecting existing identity infrastructure. If no adequate stable identity exists, document the blocker and implement the smallest safe approach; do not claim stability falsely.

### Gauge / wire geometry

Use the established source-AWG conversion to bare AWG designations. Reject unsupported gauge systems rather than guess. **Do not infer insulated outer diameter from AWG alone.** Diameter, area, insulation and bend-radius columns are outside the established CSV contract; their former roadmap phases are cancelled.

### Color

Implement `toOnshapeWireColor(...)` as a pure tested mapping, using the current parsed WireForm color value. Keep primary/secondary order, including `OGWH` versus `WHOG` where the existing source distinguishes them.

- Supported solid color → exact verified target representation.
- Supported bi-color → exact verified target representation.
- Unrecognized or malformed source encoding → **explicit blocking error for that row**; **never downgrade `OGWH` to `OG`**.
- Do not fill unknown color with a guessed default.

The user confirmed the two-color video syntax and successful Onshape operation. Use the existing authoritative WireForm parser to resolve both colors and export lowercase English names separated by `/`, preserving their order.

## 5. Comprehensive Onshape CSV schema

The exporter always emits exactly these 13 headers, in this order:

```csv
Wire ID,From Ref,From Pin,To Ref,To Pin,Gauge,Color,From Part No,To Part No,From Contact PN,To Contact PN,From Strip Length (mm),To Strip Length (mm)
```

Illustrative data using the verified CSV contract:

```csv
Wire ID,From Ref,From Pin,To Ref,To Pin,Gauge,Color,From Part No,To Part No,From Contact PN,To Contact PN,From Strip Length (mm),To Strip Length (mm)
W1-01,J1,1,J2,1,14,red,09 32 040 3001,10142708-040021LF,09 33 000 6102,10158070-121LF,7.5,5.7
W1-02,J1,2,J2,2,14,blue/white,09 32 040 3001,10142708-040021LF,09 33 000 6102,10158070-121LF,7.5,5.7
```

Illustrative Wire IDs above are shortened for readability; actual existing persistent Wire ID formatting is unchanged. The original implementation placed `To Ref` before `From Pin`; the explicit 13-column sequence and examples in the current user specification take precedence, placing each connector ref directly beside its pin. Field names and values remain unchanged.

The six added fields are optional. Connector part numbers use only the connector's primary `mpn`; contact part numbers use only the exact physical conductor-end link's `termination.contact.mpn`. Manufacturer, description, approved alternatives, generic `pn`, seal MPNs, BOM aggregation, and generic additional components are not substitutes. Part-number formatting, including spaces and hyphens, is preserved.

Strip lengths come from that endpoint's `termination.stripLength`. Supported existing units are converted to millimeters with exact decimal arithmetic; no unit symbol or locale decimal comma is emitted, and meaningful precision is not rounded away. Missing metadata produces empty cells, never `0`, `undefined`, `null`, or a placeholder. Invalid optional strip lengths produce an omission warning and an empty cell; valid routing rows remain exportable.

Onshape can select the columns it needs and ignore others, as confirmed by the user. Contact/strip fields are available manufacturing metadata; their use by the routing feature is not claimed. There is one comprehensive export and no mode or profile selection.

**CSV serialization requirements:**

- Comma delimiter; RFC-4180-style quoting (`"` doubled inside quoted fields), including commas, quotes, and newlines.
- UTF-8; use stable CRLF records for broad CSV compatibility, unless the verified target fixture says otherwise.
- A single header row and exactly 13 fields per data row, including empty optional fields. One centralized column definition controls headers, serialization and routing preview order.
- No locale-dependent decimal commas; numeric values expressed in documented units.
- Stable row order: natural order of wire/bundle designators with stable conductor identity tie-breakers.
- Stable filename derived from existing project metadata (sanitize filesystem-unsafe characters).
- No generated timestamps, random IDs, unannounced rows, nonstandard comment lines, or project mutation.
- Identical project + export configuration yields **byte-identical content**.

## 6. Validation and omission policy

Use a typed result:

```ts
interface OnshapeExportIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  memberId?: string;
  designator?: string;
}

interface OnshapeExportResult {
  rows: OnshapeWireRow[];
  issues: OnshapeExportIssue[];
  totals: {
    candidateConductors: number;
    exportedConductors: number;
    excludedConductors: number;
    omittedShields: number;
  };
}
```

Adapt to actual repository conventions; these are conceptual, not mandatory API names.

| Condition | Required handling |
|---|---|
| Complete 2-endpoint wire with valid refs, gauge/color | Export exactly once. |
| Same physical conductor encountered twice | Deduplicate by stable physical identity or error; never double-export. |
| Repeated output Wire ID for different conductors | Error. |
| Connector missing / broken endpoint | Error with exact member reference. |
| Pin missing / invalid physical pin | Error. |
| One-ended / open wire | Exclude; report explicit warning or error, clearly counted. |
| More than two endpoints / multidrop | Do not invent pairwise connections; exclude/error unless supported mapping verified. |
| Missing gauge | Follow verified target requirements; warn/error, never invent AWG. |
| Invalid color mapping | Error for impacted row; no silent substitution. |
| Missing connector/contact MPN or strip length | Empty optional field; does not block a valid routing row. |
| Invalid strip length | Empty optional field with an explicit warning; does not block a valid routing row. |
| Cable shield connected | Preserve the exclusion and show a factual omission warning. |
| Cable shield floating | No external connection is lost; no warning is needed. |
| Dedicated connector shield endpoint | Not a normal pin; omit affected unsupported edge with clear warning. |
| Twisted pair | Keep member rows; no notice for metadata outside the established CSV contract. |
| Unsupported physical-length metadata | Do not include silently as routing length. |

Default UX: **disable export when any fatal errors exist**. Warnings for deliberate known omissions (e.g. shields) should be visible, with an explicit acknowledgement if exporting a partial model. Clearly show candidate count, exported count, excluded count, and shield omission count. Never label an incomplete file "all wires exported".

Do not silently export partially invalid rows. If the current UI has a strong validation convention, reuse it instead of inventing a new one.

## 7. Implementation architecture

Follow the current TypeScript/React/state conventions; names and paths below are conceptual:

```text
Project electrical model
         |
         v
Shared physical-member and endpoint resolver
         |
         v
buildOnshapeWireRows(project)
         |
         v
validateOnshapeExport(...)
         |
         v
toOnshapeWireColor(...) / gauge conversion
         |
         v
serializeOnshapeCsv(...)
         |
         v
Existing browser file-download utility
```

Preferred independent modules/responsibilities:

- `onshapeExportTypes`: normalized row, issue, statistics and target types.
- `onshapeMapping`: pure topology → rows; no React and no browser dependencies.
- `onshapeColor`: explicit color-code conversion.
- `onshapeValidation`: eligibility and comprehensive diagnostics.
- `onshapeCsv`: pure serializer with deterministic output.
- UI integration: export action/modal/dialog using existing report/export/validation UX.

**Do not import HTML/PDF report renderers** to get Connection Mapping; extract or reuse the domain-level resolver instead.

Do not introduce a new app backend, Python, spreadsheet framework, or cloud dependency.

## 8. Export UI

The native entry is **Export → Onshape CSV**. The compact dialog retains conductor counts, CSV preview and real validation results, without development status, verification notices or roadmap text.

The confirmation/preview UI should show at least:

```text
Export to Onshape
Target: Neil Cooke Cable/Wire Routing CSV

Standalone wires:        4
Bundle conductors:      12
Cable conductors:       16
--------------------------
Candidate conductors:   32
Exported conductors:    31
Excluded conductors:     1
Shield connections:      2 omitted

Issues:
[!] W7: conductor 2 has no valid To pin
[!] W3 shield omitted (unsupported)

[Cancel]            [Export CSV]
```

Counts above are illustrative. Issue lists should identify actual designators and conductor identities. Reuse existing design language, warnings and download utility. Do not require account login or show a fictitious "uploaded to Onshape" state.

## 9. Test plan and fixtures

### Pure unit tests

1. Standalone wire → exactly one row, correct physical endpoints.
2. 4-conductor bundle → four rows; stable identities independent of array order.
3. 8-conductor multicore cable → eight rows; no whole-cable duplicate.
4. Pin labels distinct from physical pin IDs → export physical pin IDs.
5. Deterministic endpoint orientation matches Connection Mapping.
6. Different conductors cannot produce duplicate Wire IDs.
7. No project/schema mutation from export.
8. Missing connector, missing pin, dangling conductor, multidrop → visible issues.
9. Shield-only topology does not produce fake numbered pins.
10. Standalone and bundle-conductor twisted pairs export physical members once each; no made-up TP columns.
11. Color mapping verifies common solids and `OGWH`, `GNWH`, `BUWH`, `BNWH`, `GNYE` against current target syntax; unsupported cases fail clearly.
12. Gauge formatting matches the inspected parser; missing gauge does not gain a fabricated value.
13. Quotes, commas, line breaks, Unicode and non-ASCII designators escape correctly.
14. Same input produces byte-identical CSV.
15. Natural sorting (`W2` before `W10`) and stable tie-breaking.
16. Project JSON, BOM, WireViz YAML, reports unchanged.

### Representative fixture

Use a fixture equivalent to:

```text
W1: physical 8-conductor CAT5e cable
J1 pin 1..8 -> J2 pin 1..8
Color examples: OGWH, OG, GNWH, BU, BUWH, GN, BNWH, BN
Gauge: 24 AWG (if that is the real source specification)
Optional shield: present and connected, but omitted with warning
```

**Expected:** exactly eight conductor rows, with their actual physical pins and colors `orange/white`, `orange`, `green/white`, `blue`, `blue/white`, `green`, `brown/white`, `brown`. Connected shield terminations are omitted with a factual warning. The user confirmed successful exporter operation with Onshape.

Use a second fixture with a bundle containing per-wire length overrides to prove those overrides do not leak into Phase 1 CSV or disturb row identities.

### User-facing tests

- Export dialog opens and accurately counts physical members.
- Fatal issue prevents download; warning/omission handling is explicit.
- No upload/cloud authentication required.
- Download produces `.csv` and valid contents.
- Existing export actions still work.

### Repeatable Onshape smoke-test procedure

1. Import the generated CSV as a tab in an Onshape document.
2. Select it via the Cable/Wire Routing `Wire data` custom feature.
3. Verify it parses **without manual editing** and lists expected unique wire IDs.
4. Check that `J1/J2` physical pin references match 3D connector definition.
5. Verify gauge and every solid/striped color representation.
6. Create at least one 3D route, then revise and re-import the same CSV while retaining identities.
7. Record target FeatureScript version and results in section 14.

The user confirmed successful Onshape verification on 2026-10-30. The procedure remains useful for future regression checks; only record individual steps or target versions when evidence is available.

## 10. Coding and delivery rules

- Inspect `package.json`, relevant TS types, project serializers and actual export menu/components before coding.
- Prefer pure functions with deterministic outputs and focused fixtures.
- Keep UI state minimal; do not persist transient Onshape export settings in project JSON unless required and justified.
- Run repository-defined tests, lint/type checking if present, and production build.
- Update user-facing export instructions, including Onshape import steps and limitations.
- Do not commit automatically unless the usual Codex workflow/user instructions permit it.
- Respect existing GPL/source notices and follow repository contribution conventions.

## 11. Explicit non-goals

Do not add these to the Phase 1 CSV without verified support:

- Manufacturing wire cut length or conductor-level default/override length.
- Seals, tooling, notes and termination accessory details beyond the explicitly requested per-end contact MPNs and strip lengths.
- Twisted-pair properties, pitch and direction.
- Shield / connector-shell pseudo-pins.
- Cable bundle/jacket cross-section grouping metadata.
- Connector 3D geometry, clips, routing guides or 3D routes.
- Onshape REST API calls, authentication or background sync.
- Modifications to WireViz YAML, BOM, HTML/PDF reports or electrical topology.

## 12. Revised internal roadmap (2026-10-30)

- **Phase 1: COMPLETED AND VERIFIED** by the user with Onshape. Maintain the current single comprehensive exporter as an ordinary native feature.
- **Phases 2–5: CANCELLED.** Former geometry, grouping, shield-extension and other export-roadmap ideas are no longer planned.
- **Phase 6: Potential future development.** Import Onshape-calculated 3D routing lengths for review/comparison with WireForm-approved lengths. No implementation, controls or coming-soon UI are included now.
- The internal roadmap is not displayed in the export workflow. No profiles, compatibility modes or separate files are introduced.

## 13. Completion checklist

- [x] Current checkout audited (topology resolver, member identity, pin semantics, color model, export UI).
- [x] Target CSV parser/fixture inspected where publicly accessible; remaining uncertainty clearly documented.
- [x] Shared topology resolver reused; no SVG/report parser dependency.
- [x] Standalone, bundle-conductor, multicore-conductor mapping correct.
- [x] Wire IDs collision-detected and stable under conductor reorder.
- [x] Gauge and solid/bi-color mappings are pure and tested; color names and slash syntax follow the user-verified 1.217 video and preserve color order.
- [x] Shields/TP/unsupported fields handled transparently.
- [x] Preview, validation, downloadable CSV integrated into the existing export toolbar.
- [x] Deterministic CSV and escaping tests pass.
- [x] Existing project data, reports, BOM and WireViz unaffected.
- [x] Tests/typecheck/build run and results recorded below.
- [x] Onshape live import status explicitly stated, not assumed.
- [x] Section 14 updated with findings and remaining limitations.

## 14. Codex implementation notes / verification log — fill in while implementing

| Item | Status / evidence |
|---|---|
| Current WireForm checkout commit / branch | `5373fc4` on `maxim/new_features`; implementation performed without reverting the existing dirty report auto-fit worktree changes. |
| Existing topology resolver reused | `resolvePhysicalConnections(...)` from `app/connection-topology.ts`, including the same deterministic endpoint normalization used by Connection Mapping. No SVG, diagram-label or report parsing is used. |
| Stable conductor ID scheme | Each Wire ID is derived only from persistent component ID + persistent conductor ID using an unambiguous safe encoding. Array indexes are not identities. Duplicate generated IDs are fatal and all colliding rows are excluded. |
| FeatureScript document and pinned version inspected | Public document URL was requested on 2026-10-28, but returned only the Onshape sign-in application shell (`clientPackageVersion 1.222.1792700711272`). The anonymous API request returned HTTP 401, so the current FeatureScript source/parser and its pinned feature version could not be inspected. The public development thread reports release 1.221 on 2026-10-06 and two-color support in 1.217.0, but does not publish the CSV value grammar. |
| CSV headers and optional fields | User confirmed successful exporter operation with Onshape on 2026-10-30 and additional-column selection. The single export always emits the 13-column schema in §5, including primary connector MPNs, exact per-end contact MPNs and strip lengths in mm. |
| Exact AWG/gauge encoding | The established conversion accepts explicit AWG forms (`24 AWG`, `AWG 24`, `24`, and `1/0` through `4/0`) and emits the bare designation in `Gauge`; metric/unknown values remain fatal. No diameter/area is inferred, and no compatibility disclaimer is emitted. |
| Exact solid-color encoding | **Syntax resolved:** official guidance and the user's 1.217 video verification confirm full English names. Supported WireForm codes are resolved by `parseWireColor(...)` and exported in lowercase (for example `RD` → `red`, `VT` → `violet`). No Onshape abbreviation assumptions or project-data changes are needed. |
| Exact striped/two-color encoding | **RESOLVED** by the user's 1.217 video verification and subsequent Onshape verification. Export convention: `primary-color/secondary-color` using lowercase full English names, for example `GNYE` → `green/yellow`, `BUWH` → `blue/white`, `WHBU` → `white/blue`. Both colors come from the authoritative WireForm parser; unsupported/missing source codes remain fatal. |
| Unit rules for optional physical geometry | Outside the current CSV contract; Phases 2–5 are cancelled. |
| Local unit tests | Initial exporter suite passed (263 repository tests). Color update adds explicit solid and ordered bi-color mappings, unsupported-code errors, identical conversion for standalone/bundle/multicore conductors, no mutation, exact escaped final CSV, and the complete eight-row striped CAT5e fixture. Updated results are recorded below. |
| Typecheck/build | `npm run typecheck` passed; `npm run lint` passed; `npm run build` passed; `npm test` passed (results recorded 2026-10-28). |
| Real Onshape CSV import verification | **COMPLETED AND VERIFIED**, as confirmed by the user on 2026-10-30. This is user-provided verification, separate from the agent's automated test runs. |
| Exclusions / warnings | Connected shield terminations are excluded with a factual warning; floating shields and TP metadata need no feature-gap notices. Open/unresolved/multidrop/non-pin endpoints, missing stable IDs, invalid/missing gauge/color and duplicate Wire IDs remain fatal. Wire cut lengths, conductor overrides, seals/tooling/notes, BOM fields, routing geometry and 3D data remain outside the CSV contract. Missing optional manufacturing values remain empty; invalid strip values warn. |
| UI integration | The native export toolbar entry sits beside BOM/HTML/PDF exports. The compact dialog provides preview, counts, genuine errors and omission warnings. Development/verification state is not displayed. |

### Commands and results (2026-10-28)

- `node --experimental-strip-types --test tests/onshape-export.test.mjs` — passed (21 tests/subtests, 0 failures).
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed.
- `npm test` — passed (263 tests, 0 failures).
- Public Onshape document GET — sign-in application shell only; anonymous API GET — HTTP 401.

### Color compatibility update (2026-10-28)

- Evidence: the user verified the FeatureScript 1.217 video and supplied the accepted syntax/examples recorded in §2.1. The agent has not independently performed an Onshape import.
- Implementation: `convertColorForOnshape(...)` uses `parseWireColor(...)` and the existing palette names, lowercases each resolved name, and joins primary/secondary names with `/`. No independent code splitting, alias translation, secondary-color loss, or schema/model mutation occurs.
- The same converter remains in the shared export-row path for standalone wires, bundle conductors, and multicore cable conductors. Unsupported codes retain the existing fatal error policy.
- Verification results: `node --experimental-strip-types --test tests/onshape-export.test.mjs` passed (25 tests/subtests); `npm run lint` and `npm run typecheck` passed; `npm test` passed (267 tests, 0 failures), including the production build. These supersede the initial implementation counts above.
- Subsequent verification: the user confirmed successful exporter operation with Onshape on 2026-10-30. The established CSV mappings and omissions remain documented above.

### Per-end manufacturing metadata extension (2026-10-28)

- Branch: `maxim/new_features`; extends the existing native exporter from commit `601dfd6`.
- One comprehensive 13-column file replaces the previous seven-column file. `ONSHAPE_CSV_COLUMNS` is the single source for headers, serialization and compact routing-preview order. No alternate export modes or additional dialogs were introduced.
- `ResolvedConnectionEndpoint.termination` carries its source conductor-end link metadata before the existing deterministic normalization. Connector primary MPNs resolve by connector ID, while contact MPN and strip length resolve from that exact endpoint. No per-pin lookup that could borrow another conductor's metadata is used.
- The new `parseLengthMillimeters(...)` reuses the existing unit definitions/parser and performs exact decimal scaling without losing meaningful precision. Existing `parseLengthMeters(...)` retains its original rounding and behavior for BOM/length consumers.
- Missing optional values remain empty and do not block export. Invalid strip lengths are omitted with a warning, preserving valid routing rows. Numbered pins, Wire IDs, color conversion, shields and TP handling are unchanged.
- Header-order decision: the user's explicit 13-column sequence takes priority over the previous implementation's `To Ref`/`From Pin` ordering. No field values are remapped positionally.
- Verification: focused Onshape exporter, Connection Mapping and hover suites passed (52 tests/subtests). `npm run lint` and `npm run typecheck` passed. `npm test` passed (276 tests, 0 failures), including the production build. Regression coverage includes reversed endpoints with different connector/contact MPNs and strips; all conductor types; distinct cavity contacts; no metadata inference; millimeter conversions/precision; 13-field counts and order; optional blanks; Unicode/quote/comma/newline escaping; byte-identical exports and no project mutation. The production build retains its existing large-chunk advisory.
- Subsequent verification: the user confirmed successful exporter operation with Onshape on 2026-10-30. The four contact/strip columns remain available manufacturing metadata, without a claim that routing consumes them.

### Completed-feature UI cleanup (2026-10-30)

- Verification evidence: the user confirmed Phase 1 is completed and verified with Onshape. Phases 2–5 are cancelled; Phase 6 is an internal future possibility only, as recorded in §12.
- Removed unconditional compatibility notices, runtime verification flags, phase wording and unnecessary metadata-gap notices from the export issue source and dialog. A valid export has no development warning or acknowledgement requirement.
- Connected shield exclusions still produce concise factual warnings. Floating shield metadata and omitted TP metadata do not remove ordinary conductor connectivity and generate no notices. `totals.omittedShields` still counts shield definitions; the row and CSV generation are unchanged.
- Genuine topology/reference/pin/identity/gauge/color errors, duplicate-ID detection, empty-project errors and invalid-strip warnings retain their behavior. Existing download gating and omission acknowledgement remain for actual warnings.
- Recorded a representative pre-cleanup CSV SHA-256 digest from commit `2b30d20`; regression tests assert the generated UTF-8/CRLF bytes are unchanged, including part numbers, contacts, strips and ordered bi-colors.
- Verification results: focused Onshape exporter/UI regression suite passed (37 tests/subtests), including the pre-cleanup CSV byte fingerprint; `npm run lint` and `npm run typecheck` passed; `npm test` passed (279 tests, 0 failures), including the production build. No browser-driven or new Onshape import test was performed during this presentation-only cleanup.

## 15. External references (ordered by direct relevance)

1. Public FeatureScript document — https://cad.onshape.com/documents/3599036701247d65f0106997
2. Neil Cooke development thread — https://forum.onshape.com/discussion/18756/custom-feature-cable-wire-routing
3. Original import demo — https://onshape.wistia.com/medias/cwfkicq4gg
4. Official 2025 technical workflow/CSV overview — https://www.onshape.com/de/resource-center/tech-tips/tech-tip-how-to-use-custom-features-for-wiring-in-onshape
5. Explicit legacy/basic seven-column header example (third party) — https://sites.google.com/nicholsschool.org/emrknowledgebase/shared-resources/skills/mechanical/cadcam/wiring-cad
6. Official FeatureScript uploaded data / CSV handling — https://cad.onshape.com/FsDoc/imports.html
7. July 2026 two-color FeatureScript announcement — https://forum.onshape.com/discussion/18756/custom-feature-cable-wire-routing/p8
8. Dated real-world CSV update/scoping example (1 Oct 2026) — https://pib-rocks.atlassian.net/wiki/spaces/kb/pages/1143701513/pib%2BAdvanced%2BV5%2BWiring%2BFeatureScript%2Band%2Bscoped%2BCSV%2Bworkflow

---

**Core principle:** WireForm owns electrical connectivity and manufacturing data; Onshape owns mechanical routing geometry. The CSV is a deliberately limited and validated one-way interoperability artifact, not an alternative project format.
