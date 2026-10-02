import {
  createApprovedPartAlternativeId,
  type ApprovedPartAlternative,
  type ComponentKind,
  type HarnessComponent,
  type HarnessProject,
} from "./model.ts";

export const APPROVED_ALTERNATIVE_KINDS: readonly ComponentKind[] = [
  "connector",
  "wire",
  "cable",
  "bundle",
];

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function folded(value: unknown) {
  return clean(value).toLocaleLowerCase("en-US");
}

function partKey(part: Pick<ApprovedPartAlternative, "manufacturer" | "mpn">) {
  return JSON.stringify([folded(part.manufacturer), folded(part.mpn)]);
}

export function supportsApprovedAlternatives(kind: ComponentKind) {
  return APPROVED_ALTERNATIVE_KINDS.includes(kind);
}

export function createApprovedPartAlternative(): ApprovedPartAlternative {
  return { id: createApprovedPartAlternativeId() };
}

export function cloneApprovedAlternativesWithNewIds(
  alternatives: readonly ApprovedPartAlternative[] | undefined,
) {
  return alternatives?.map((alternative) => ({
    ...structuredClone(alternative),
    id: createApprovedPartAlternativeId(),
  }));
}

export function canonicalApprovedAlternativeSet(
  alternatives: readonly Pick<
    ApprovedPartAlternative,
    "manufacturer" | "mpn" | "note"
  >[] | undefined,
) {
  const keys = new Set(
    (alternatives ?? [])
      .filter(
        (alternative) =>
          clean(alternative.manufacturer) || clean(alternative.mpn),
      )
      .map((alternative) =>
        JSON.stringify([
          folded(alternative.manufacturer),
          folded(alternative.mpn),
          folded(alternative.note),
        ]),
      ),
  );
  return [...keys].sort();
}

export function formatApprovedAlternatives(
  alternatives: readonly Pick<
    ApprovedPartAlternative,
    "manufacturer" | "mpn" | "note"
  >[] | undefined,
) {
  return (alternatives ?? [])
    .map((alternative) => {
      const part = [clean(alternative.manufacturer), clean(alternative.mpn)]
        .filter(Boolean)
        .join(" ");
      const note = clean(alternative.note);
      if (part && note) return `${part} (${note})`;
      return part || (note ? `(${note})` : "");
    })
    .filter(Boolean)
    .join("; ");
}

export function validateApprovedAlternatives(project: HarnessProject) {
  const warnings: string[] = [];
  for (const component of project.components) {
    if (!supportsApprovedAlternatives(component.kind)) continue;
    const primaryKey = partKey(component);
    const seen = new Map<string, number>();
    for (const [index, alternative] of (
      component.approvedAlternatives ?? []
    ).entries()) {
      const label = `${component.designator || component.kind} approved alternative ${index + 1}`;
      const manufacturer = clean(alternative.manufacturer);
      const mpn = clean(alternative.mpn);
      if (!manufacturer && !mpn) {
        warnings.push(`${label} is empty; enter a manufacturer or MPN.`);
        continue;
      }
      const key = partKey(alternative);
      if (key === primaryKey && (manufacturer || mpn)) {
        warnings.push(`${label} is identical to the primary part.`);
      }
      const prior = seen.get(key);
      if (prior !== undefined) {
        warnings.push(
          `${label} duplicates approved alternative ${prior + 1} on ${component.designator || component.kind}.`,
        );
      } else {
        seen.set(key, index);
      }
    }
  }
  return { errors: [] as string[], warnings };
}

export function componentApprovedAlternatives(
  component: HarnessComponent,
): ApprovedPartAlternative[] {
  return supportsApprovedAlternatives(component.kind)
    ? (component.approvedAlternatives ?? []).filter(
        (alternative) =>
          clean(alternative.manufacturer) || clean(alternative.mpn),
      )
    : [];
}
