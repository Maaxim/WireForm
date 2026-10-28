# WireForm → Onshape Cable/Wire Routing CSV Export — Implementation Handoff

**Prepared:** 2026-10-27  
**Target:** WireForm current checkout (including local, not-yet-pushed modifications)  
**Status:** Implementation specification; no changes to the user's local repository have been made by the author of this handoff.  
**Phase:** 1 — local, one-way, conductor-level CSV export.

> **Codex: Read this entire file, inspect the current checkout, and implement Phase 1.** The checkout is the authority for internal code structure. Do not assume its implementation matches the public WireForm repository. The Onshape CSV contract MUST be validated against the current installed/published Cable/Wire Routing FeatureScript or a known-working current example before declaring real Onshape compatibility.

## 1. Outcome

Add **Export → Onshape Cable/Wire Routing CSV** (wording may follow the current export menu) to WireForm.

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

**Important:** This header set is a *documented legacy/basic example*, not proof that it covers every required/optional field in the latest FeatureScript. Header **spelling is evidenced; the precise current parser and allowed values still need inspection**.

The Onshape FeatureScript documentation confirms that uploaded external CSV files must be Onshape document tabs to be referenced by FeatureScript:

https://cad.onshape.com/FsDoc/imports.html

The developer's July 2026 changelog announced two-color wires in release 1.217:

https://forum.onshape.com/discussion/18756/custom-feature-cable-wire-routing/p8

**Color syntax resolved (2026-10-28):** The user verified the 1.217 demonstration video at https://onshape.wistia.com/medias/drjqloy1cv and supplied its confirmed CSV syntax. Full English names are accepted, and two colors can be separated by `/`, `-`, `_`, or `+`. Examples demonstrated include `green/yellow`, `GN+yellow`, `VIWH`, `violet-WH`, `dark_red`, and `LT BL`. Dark/light modifiers and IEC 60757 / DIN/VDE aliases are supported. CSV import supports bi-color wires even though the manual wire-route selector currently offers a single color.

WireForm exports **lowercase full English names**, using `primary-color/secondary-color` for bi-colors. For example `BUWH` → `blue/white`, `WHBU` → `white/blue`, and WireForm `VTWH` → `violet/white`. This avoids assuming that Onshape aliases (such as `VI`) match WireForm/WireViz aliases (such as `VT`). This evidence is the user's video verification; an actual import of WireForm-generated CSV has **not** been performed.

### 2.2 NOT verified — do not guess

The author of this handoff could not directly inspect the current FeatureScript source/parser through the public web view or execute an authenticated Onshape import. The following remain **unverified**:

- Whether the current installed feature uses the legacy seven-column header set as-is, including exact ordering, defaults, and case handling.
- The accepted representations for `Gauge` (e.g. `24`, `24 AWG`, `0.5 mm²`) and missing values.
- Acceptance of every extended WireForm palette name by the installed target version; the full-name/slash syntax itself is resolved above. Direct compatibility of WireForm abbreviations is not assumed or required.
- Which of `Diameter`, `Area`, `Insulation`, and bend-radius fields are optional and their **exact headings/units**.
- Whether a CSV can express explicit multicore cable grouping, shield endpoints, or twisted-pair metadata in the target feature version.
- Whether a tested Onshape instance accepts an automatically generated WireForm CSV without modification.

**Mandatory research gate:** Inspect the current public FeatureScript document's `Wire data` parser and example CSV if accessible. Record the precise FeatureScript version, accepted headings, units, color encoding, and evidence in section 14 below. Alternatively obtain an actually imported, known-working current fixture. Do not infer accepted syntax from marketing descriptions or older tutorials alone. If inaccessible, implement the conservatively evidenced basic profile and state clearly that live compatibility remains **unverified**. Do not claim a successful Onshape import without performing it.

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
| Twisted-pair ID/pitch/direction | Not exported | Export member wires normally; issue informational limitation when relevant. |
| Cable shield | Excluded initially | Explicit omission warning per affected shield. |
| Dedicated connector shield endpoint | Excluded initially unless explicitly verified in Onshape | Never replace with fake pin `0`, `-1`, or `SHIELD`. |
| Contacts, seals, strip lengths, alternatives, accessories | Not exported | Remain WireForm-native. |

### Physical pin mapping

Always use the stable *actual* physical pin identifier, not the user-editable display label. The existing Onshape 3D connector pin references must match exported values. If an Onshape library intentionally numbers pins differently, resolve that through a separately reviewed mapping, **not silent substitution**.

### Endpoint ordering

For non-directional conductors, reuse the same deterministic endpoint ordering as Connection Mapping, so one project exports the same `From` and `To` assignments each time. This is not an assertion of signal direction.

### Identity / stable Wire ID

Requirements:

- Unique across every exported conductor in the file.
- Stable across repeated exports, reordering conductors, and changing UI layout.
- Based on the existing persistent conductor identity wherever possible.
- Readable when practical, but **never use a transient array index as identity**.
- Detect collisions and reject affected export; do not silently add random suffixes.

Illustrative labels (`W1-01`, `W1-02`) are **not sufficient** if `01/02` refer to unstable array positions. Prefer an existing stable member ID with a deterministic, safe encoding. Record any trade-off (e.g. bundle designator renaming changes visible external ID). Do not add persistent ID fields without inspecting existing identity infrastructure. If no adequate stable identity exists, document the blocker and implement the smallest safe approach; do not claim stability falsely.

### Gauge / wire geometry

Use source AWG if present; format according to verified Onshape syntax. Reject or warn for unsupported gauge systems rather than guess. **Do not infer insulated outer diameter from AWG alone.** Optional `Diameter`/`Insulation`/`Area`/bend-radius export belongs to Phase 2 unless parser and underlying authoritative data are both verified.

### Color

Implement `toOnshapeWireColor(...)` as a pure tested mapping, using the current parsed WireForm color value. Keep primary/secondary order, including `OGWH` versus `WHOG` where the existing source distinguishes them.

- Supported solid color → exact verified target representation.
- Supported bi-color → exact verified target representation.
- Unrecognized / unverified encoding → **explicit blocking error for that row** or a clearly marked unsupported condition; **never downgrade `OGWH` to `OG`**.
- Do not fill unknown color with a guessed default.

The 1.217 video verification supplied by the user resolves the two-color syntax gate. Use the existing authoritative WireForm parser to resolve both colors and export lowercase English names separated by `/`, preserving their order. The local CAT5e conversion test may now pass; end-to-end Onshape import remains a separate verification step.

## 5. Phase 1 CSV profile

The *candidate minimal header profile* evidenced by the independent tutorial is:

```csv
Wire ID,From Ref,To Ref,From Pin,To Pin,Gauge,Color
```

Illustrative data (NOT verified as successfully imported by current Onshape):

```csv
Wire ID,From Ref,To Ref,From Pin,To Pin,Gauge,Color
W1-01,J1,J2,1,1,24,red
W1-02,J1,J2,2,2,24,blue/white
```

Codex must first check whether the current installed/published FeatureScript expects additional or different headings or values. Replace this candidate profile with the verified schema if required and document why.

**CSV serialization requirements:**

- Comma delimiter; RFC-4180-style quoting (`"` doubled inside quoted fields), including commas, quotes, and newlines.
- UTF-8; use stable CRLF records for broad CSV compatibility, unless the verified target fixture says otherwise.
- A single header row and consistent column counts.
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
| Invalid/unverified color mapping | Error for impacted row; no silent substitution. |
| Cable shield defined or connected | Omit and warn; show count. |
| Dedicated connector shield endpoint | Not a normal pin; omit affected unsupported edge with clear warning. |
| Twisted pair | Keep member rows; show informational note that TP metadata was not exported. |
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

- `onshapeExportTypes`: normalized row, issue, statistics and profile types.
- `onshapeMapping`: pure topology → rows; no React and no browser dependencies.
- `onshapeColor`: explicit color-code conversion.
- `onshapeValidation`: eligibility and comprehensive diagnostics.
- `onshapeCsv`: pure serializer with deterministic output.
- UI integration: export action/modal/dialog using existing report/export/validation UX.

**Do not import HTML/PDF report renderers** to get Connection Mapping; extract or reuse the domain-level resolver instead.

Do not introduce a new app backend, Python, spreadsheet framework, or cloud dependency.

## 8. Export UI

Add a native entry, preferably **Export → Onshape Cable/Wire Routing CSV**.

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

**Expected:** exactly eight conductor rows, with their actual physical pins and colors `orange/white`, `orange`, `green/white`, `blue`, `blue/white`, `green`, `brown/white`, `brown`. The shield is omitted with a warning. Color syntax is resolved; a successful live Onshape import is still required for end-to-end compatibility.

Use a second fixture with a bundle containing per-wire length overrides to prove those overrides do not leak into Phase 1 CSV or disturb row identities.

### User-facing tests

- Export dialog opens and accurately counts physical members.
- Fatal issue prevents download; warning/omission handling is explicit.
- No upload/cloud authentication required.
- Download produces `.csv` and valid contents.
- Existing export actions still work.

### Acceptance / live smoke test

1. Import the generated CSV as a tab in an Onshape document.
2. Select it via the Cable/Wire Routing `Wire data` custom feature.
3. Verify it parses **without manual editing** and lists expected unique wire IDs.
4. Check that `J1/J2` physical pin references match 3D connector definition.
5. Verify gauge and every solid/striped color representation.
6. Create at least one 3D route, then revise and re-import the same CSV while retaining identities.
7. Record target FeatureScript version and results in section 14.

If no Onshape account/session or current FeatureScript source is accessible to Codex, do **not** claim steps 1–7 were completed. Mark live import **NOT VERIFIED** and state what was tested locally.

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
- Connector contact, seal, strip-length or termination accessory details.
- Twisted-pair properties, pitch and direction.
- Shield / connector-shell pseudo-pins.
- Cable bundle/jacket cross-section grouping metadata.
- Connector 3D geometry, clips, routing guides or 3D routes.
- Onshape REST API calls, authentication or background sync.
- Modifications to WireViz YAML, BOM, HTML/PDF reports or electrical topology.

## 12. Candidate Phase 2 work (not part of current implementation)

- Optional verified geometry columns: insulated wire OD, area, insulation thickness, minimum bend radius.
- Explicit, tested multi-conductor cable grouping if Onshape parser supports it.
- Mapping dedicated shield terminations to real Onshape connector shell attachment geometry.
- Configurable Onshape connector pin naming/alias mapping.
- Importing Onshape 3D routed lengths for comparison with WireForm-approved cut lengths (never silent overwrite).
- Per-export target FeatureScript profile/version selection **only if actually needed**.

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
| CSV headers and optional fields confirmed from parser | Parser source **NOT VERIFIED**. Phase 1 implements the evidenced legacy/basic headers exactly: `Wire ID,From Ref,To Ref,From Pin,To Pin,Gauge,Color`. Optional geometry fields are not emitted. |
| Exact AWG/gauge encoding | Current parser **NOT VERIFIED**. The implementation conservatively accepts only explicit AWG forms (`24 AWG`, `AWG 24`, `24`, and `1/0` through `4/0`) and emits the bare designation in `Gauge`; metric/unknown values are fatal. Every export carries an acknowledgement-required compatibility warning that this encoding was not live-import verified. No diameter/area is inferred. |
| Exact solid-color encoding | **Syntax resolved:** official guidance and the user's 1.217 video verification confirm full English names. Supported WireForm codes are resolved by `parseWireColor(...)` and exported in lowercase (for example `RD` → `red`, `VT` → `violet`). No Onshape abbreviation assumptions or project-data changes are needed. |
| Exact striped/two-color encoding | **RESOLVED** by the user's 1.217 video verification. Export convention: `primary-color/secondary-color` using lowercase full English names, for example `GNYE` → `green/yellow`, `BUWH` → `blue/white`, `WHBU` → `white/blue`. Both colors come from the authoritative WireForm parser; unsupported/missing source codes remain fatal. The previous `UNVERIFIED_BICOLOR_ENCODING` blocker is removed. Actual Onshape import is still **NOT VERIFIED**. |
| Unit rules for optional physical geometry | Not emitted; Phase 2 as planned. |
| Local unit tests | Initial exporter suite passed (263 repository tests). Color update adds explicit solid and ordered bi-color mappings, unsupported-code errors, identical conversion for standalone/bundle/multicore conductors, no mutation, exact escaped final CSV, and the complete eight-row striped CAT5e fixture. Updated results are recorded below. |
| Typecheck/build | `npm run typecheck` passed; `npm run lint` passed; `npm run build` passed; `npm test` passed (results recorded 2026-10-28). |
| Real Onshape CSV import test | **NOT VERIFIED** — no authenticated Onshape document/session or current FeatureScript source was available. The UI states this and requires warning acknowledgement before download. |
| Known exclusions / warnings | Shields are counted and warned but never become fake conductor rows. TP membership is informational and does not create columns. Open/unresolved/multidrop/non-pin endpoints, missing stable IDs, invalid/missing gauge/color and duplicate Wire IDs are fatal. Supported bi-colors now export normally. Lengths, conductor overrides, terminations, BOM fields, geometry and 3D data are intentionally absent. Gauge/current-profile and live-import verification remain pending. |
| Any deviations from this plan | The current checkout has an export toolbar rather than a dropdown, so the native entry was added beside the existing BOM/HTML/PDF exports. The user's 1.217 video verification resolves the color research gate; no further color-syntax research is required for this implementation. Current-parser/gauge and live-import limitations remain documented. |

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
- Remaining limitations: actual CSV import/routing in Onshape is **NOT VERIFIED**; current Gauge grammar and full current-parser/header behavior remain unverified. Shields and TP metadata retain the Phase 1 omission policy.

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
