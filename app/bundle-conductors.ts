import { parseLengthMeters } from "./length.ts";
import type { HarnessComponent, HarnessProject } from "./model.ts";

function clean(value: string | undefined) {
  return value?.trim() ?? "";
}

export function getBundleConductorLengthOverride(
  bundle: HarnessComponent,
  conductorId: string,
) {
  if (bundle.kind !== "bundle") return undefined;
  return bundle.conductorLengthOverrides?.[conductorId];
}

export function getEffectiveBundleConductorLength(
  bundle: HarnessComponent,
  conductorId: string,
) {
  return (
    getBundleConductorLengthOverride(bundle, conductorId) ?? bundle.length
  );
}

export function withBundleConductorLengthOverride(
  bundle: HarnessComponent,
  conductorId: string,
  value: string | undefined,
) {
  const overrides = { ...(bundle.conductorLengthOverrides ?? {}) };
  const normalized = clean(value);
  if (normalized) overrides[conductorId] = normalized;
  else delete overrides[conductorId];
  return Object.keys(overrides).length ? overrides : undefined;
}

export function remapBundleConductorLengthOverrides(
  overrides: Readonly<Record<string, string>> | undefined,
  conductorIds: ReadonlyMap<string, string>,
) {
  if (!overrides) return undefined;
  const remapped: Record<string, string> = {};
  for (const [oldId, value] of Object.entries(overrides)) {
    const newId = conductorIds.get(oldId);
    if (newId && clean(value)) remapped[newId] = clean(value);
  }
  return Object.keys(remapped).length ? remapped : undefined;
}

export function validateBundleConductorLengths(project: HarnessProject) {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const bundle of project.components.filter(
    (component) => component.kind === "bundle",
  )) {
    const defaultLength = clean(bundle.length);
    if (defaultLength && parseLengthMeters(defaultLength) === undefined) {
      errors.push(
        `${bundle.designator}: default length must be a positive length with a supported unit.`,
      );
    }
    for (let index = 0; index < bundle.wireCount; index += 1) {
      const conductorId = bundle.conductorIds[index];
      if (!conductorId) continue;
      const override = getBundleConductorLengthOverride(bundle, conductorId);
      if (override !== undefined && parseLengthMeters(override) === undefined) {
        errors.push(
          `${bundle.designator}: conductor ${index + 1} length override must be a positive length with a supported unit.`,
        );
        continue;
      }
      if (!clean(getEffectiveBundleConductorLength(bundle, conductorId))) {
        warnings.push(
          `${bundle.designator}: conductor ${index + 1} has no effective length.`,
        );
      }
    }
  }
  return { errors, warnings };
}
