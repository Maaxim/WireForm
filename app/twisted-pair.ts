import { parseLengthMeters } from "./additional-components.ts";
import {
  createTwistedPairId,
  type HarnessComponent,
  type HarnessProject,
  type TwistedPair,
  type TwistedPairMember,
} from "./model.ts";

export interface TwistedPairValidationResult {
  errors: string[];
  warnings: string[];
}

export interface ResolvedTwistedPairMember {
  ref: TwistedPairMember;
  component: HarnessComponent;
  conductorIndex?: number;
  conductorNumber?: number;
  conductorLabel?: string;
  colorCode: string;
  displayName: string;
}

function clean(value: string | undefined) {
  return value?.trim() ?? "";
}

function pairLabel(pair: TwistedPair) {
  return clean(pair.designator) || "Twisted pair";
}

export function wireMember(wireId: string): TwistedPairMember {
  return { kind: "wire", wireId };
}

export function bundleConductorMember(
  bundleId: string,
  conductorId: string,
): TwistedPairMember {
  return { kind: "bundle-conductor", bundleId, conductorId };
}

function normalizedMember(member: TwistedPairMember | string): TwistedPairMember {
  return typeof member === "string" ? wireMember(member) : member;
}

export function twistedPairMemberKey(member: TwistedPairMember | string) {
  const ref = normalizedMember(member);
  return ref.kind === "wire"
    ? `wire:${ref.wireId}`
    : `bundle:${ref.bundleId}:${ref.conductorId}`;
}

export function twistedPairMemberComponentId(member: TwistedPairMember | string) {
  const ref = normalizedMember(member);
  return ref.kind === "wire" ? ref.wireId : ref.bundleId;
}

export function sameTwistedPairMember(
  left: TwistedPairMember | string,
  right: TwistedPairMember | string,
) {
  return twistedPairMemberKey(left) === twistedPairMemberKey(right);
}

export function isTwistedPairWire(
  component: HarnessComponent | undefined,
): component is HarnessComponent {
  return component?.kind === "wire" && component.wireCount === 1;
}

export function resolveTwistedPairMember(
  project: HarnessProject,
  member: TwistedPairMember | string,
): ResolvedTwistedPairMember | undefined {
  const ref = normalizedMember(member);
  if (ref.kind === "wire") {
    const component = project.components.find((item) => item.id === ref.wireId);
    if (!isTwistedPairWire(component)) return undefined;
    return {
      ref,
      component,
      colorCode: component.colors[0] ?? "",
      displayName: component.designator,
    };
  }
  const component = project.components.find((item) => item.id === ref.bundleId);
  if (!component || component.kind !== "bundle") return undefined;
  const conductorIndex = (component.conductorIds ?? []).indexOf(ref.conductorId);
  if (conductorIndex < 0 || conductorIndex >= component.wireCount) return undefined;
  const conductorNumber = conductorIndex + 1;
  const conductorLabel = clean(component.wireLabels[conductorIndex]);
  return {
    ref,
    component,
    conductorIndex,
    conductorNumber,
    conductorLabel,
    colorCode: component.colors[conductorIndex] ?? "",
    displayName: `${component.designator}:${conductorLabel || conductorNumber}`,
  };
}

export function getTwistedPairMemberDisplay(
  project: HarnessProject,
  member: TwistedPairMember | string,
) {
  return resolveTwistedPairMember(project, member)?.displayName ?? "Missing member";
}

export function findTwistedPairForMember(
  project: HarnessProject,
  member: TwistedPairMember | string,
) {
  const key = twistedPairMemberKey(member);
  return project.twistedPairs.find((pair) =>
    pair.members.some((candidate) => twistedPairMemberKey(candidate) === key),
  );
}

export function findTwistedPairForWire(project: HarnessProject, wireId: string) {
  return findTwistedPairForMember(project, wireMember(wireId));
}

export function findTwistedPairForBundleConductor(
  project: HarnessProject,
  bundleId: string,
  conductorId: string,
) {
  return findTwistedPairForMember(
    project,
    bundleConductorMember(bundleId, conductorId),
  );
}

export function allocateTwistedPairDesignator(
  pairs: readonly Pick<TwistedPair, "designator">[],
) {
  const used = new Set(pairs.map((pair) => clean(pair.designator).toLowerCase()));
  let index = 1;
  while (used.has(`tp${index}`)) index += 1;
  return `TP${index}`;
}

export function twistedPairCreationIssue(
  project: HarnessProject,
  members: readonly (TwistedPairMember | string)[],
) {
  if (members.length !== 2) return "Select exactly two eligible members.";
  const refs = members.map(normalizedMember);
  if (sameTwistedPairMember(refs[0], refs[1])) {
    return "A member cannot be paired with itself.";
  }
  if (refs[0].kind !== refs[1].kind) {
    return "Pair two standalone wires or two conductors in the same bundle.";
  }
  if (
    refs[0].kind === "bundle-conductor" &&
    refs[1].kind === "bundle-conductor" &&
    refs[0].bundleId !== refs[1].bundleId
  ) {
    return "Bundle conductor pairs must belong to the same bundle.";
  }
  for (const ref of refs) {
    const resolved = resolveTwistedPairMember(project, ref);
    if (!resolved) {
      if (ref.kind === "wire") {
        const component = project.components.find((item) => item.id === ref.wireId);
        return component
          ? `${component.designator} must be a single-wire component.`
          : "One selected wire no longer exists.";
      }
      return "One selected bundle conductor no longer exists or is ineligible.";
    }
    const existing = findTwistedPairForMember(project, ref);
    if (existing) {
      return `${resolved.displayName} already belongs to ${pairLabel(existing)}.`;
    }
  }
  return undefined;
}

export function createTwistedPair(
  project: HarnessProject,
  members: readonly (TwistedPairMember | string)[],
): TwistedPair {
  const issue = twistedPairCreationIssue(project, members);
  if (issue) throw new Error(issue);
  return {
    id: createTwistedPairId(),
    designator: allocateTwistedPairDesignator(project.twistedPairs),
    members: [normalizedMember(members[0]), normalizedMember(members[1])],
    twistDirection: "unspecified",
  };
}

export function cloneTwistedPairsForPaste(
  pairs: readonly TwistedPair[],
  componentIds: ReadonlyMap<string, string>,
  existingPairs: readonly TwistedPair[],
  conductorIds: ReadonlyMap<string, string> = new Map(),
) {
  const cloned: TwistedPair[] = [];
  const designators = [...existingPairs];
  for (const pair of pairs) {
    const members = pair.members.flatMap((member): TwistedPairMember[] => {
      const ref = normalizedMember(member);
      if (ref.kind === "wire") {
        const wireId = componentIds.get(ref.wireId);
        return wireId ? [wireMember(wireId)] : [];
      }
      const bundleId = componentIds.get(ref.bundleId);
      const conductorId = conductorIds.get(twistedPairMemberKey(ref));
      return bundleId && conductorId
        ? [bundleConductorMember(bundleId, conductorId)]
        : [];
    });
    if (members.length !== 2) continue;
    const copy: TwistedPair = {
      ...structuredClone(pair),
      id: createTwistedPairId(),
      designator: allocateTwistedPairDesignator(designators),
      members,
    };
    cloned.push(copy);
    designators.push(copy);
  }
  return cloned;
}

export function withoutTwistedPairsForMembers(
  pairs: readonly TwistedPair[],
  componentIds: ReadonlySet<string>,
) {
  return pairs.filter((pair) =>
    pair.members.every(
      (member) => !componentIds.has(twistedPairMemberComponentId(member)),
    ),
  );
}

export function withoutTwistedPairsForConductorIds(
  pairs: readonly TwistedPair[],
  conductorIds: ReadonlySet<string>,
  bundleId?: string,
) {
  return pairs.filter((pair) =>
    pair.members.every(
      (member) =>
        member.kind !== "bundle-conductor" ||
        (bundleId !== undefined && member.bundleId !== bundleId) ||
        !conductorIds.has(member.conductorId),
    ),
  );
}

function connectedSides(project: HarnessProject, wireId: string) {
  const sides = new Set<string>();
  for (const link of project.links) {
    for (const endpoint of [link.from, link.to]) {
      if (endpoint.nodeId === wireId && endpoint.portId === "wire:1") {
        sides.add(endpoint.side);
      }
    }
  }
  return sides;
}

export function validateTwistedPairs(
  project: HarnessProject,
): TwistedPairValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const membership = new Map<string, string>();
  const designators = new Map<string, number>();

  for (const bundle of project.components.filter(
    (component) => component.kind === "bundle",
  )) {
    const seen = new Set<string>();
    for (let index = 0; index < bundle.wireCount; index += 1) {
      const conductorId = clean(bundle.conductorIds?.[index]);
      if (!conductorId) {
        errors.push(
          `${bundle.designator}: conductor ${index + 1} is missing its stable identity.`,
        );
      } else if (seen.has(conductorId)) {
        errors.push(
          `${bundle.designator}: conductor identity ${conductorId} is duplicated.`,
        );
      } else seen.add(conductorId);
    }
  }

  for (const pair of project.twistedPairs) {
    const label = pairLabel(pair);
    const designatorKey = clean(pair.designator).toLowerCase();
    if (!designatorKey) errors.push("A twisted pair is missing its designator.");
    else designators.set(designatorKey, (designators.get(designatorKey) ?? 0) + 1);

    if (pair.members.length !== 2) {
      errors.push(`${label} must contain exactly two members.`);
      continue;
    }
    if (sameTwistedPairMember(pair.members[0], pair.members[1])) {
      errors.push(`${label} contains the same wire twice.`);
      continue;
    }
    const firstRef = normalizedMember(pair.members[0]);
    const secondRef = normalizedMember(pair.members[1]);
    if (firstRef.kind !== secondRef.kind) {
      errors.push(`${label} mixes standalone wires and bundle conductors.`);
    }
    if (
      firstRef.kind === "bundle-conductor" &&
      secondRef.kind === "bundle-conductor" &&
      firstRef.bundleId !== secondRef.bundleId
    ) {
      errors.push(`${label} uses conductors from different bundles.`);
    }

    const resolved = pair.members.map((member) =>
      resolveTwistedPairMember(project, member),
    );
    pair.members.forEach((member, index) => {
      const key = twistedPairMemberKey(member);
      const value = resolved[index];
      if (!value) {
        const ref = normalizedMember(member);
        if (ref.kind === "wire") {
          const component = project.components.find(
            (candidate) => candidate.id === ref.wireId,
          );
          errors.push(
            component
              ? `${label}: ${component.designator} is not a single-wire component.`
              : `${label} references missing wire ${ref.wireId || "(empty ID)"}.`,
          );
        } else {
          errors.push(`${label} references a missing or ineligible bundle conductor (${key}).`);
        }
        return;
      }
      const previous = membership.get(key);
      if (previous) {
        errors.push(`${label}: ${value.displayName} is already a member of ${previous}.`);
      } else membership.set(key, label);
    });

    if (
      pair.twistPitchMm !== undefined &&
      (!Number.isFinite(pair.twistPitchMm) || pair.twistPitchMm <= 0)
    ) {
      errors.push(`${label} has an invalid twist pitch; use a value greater than 0 mm.`);
    }

    const [first, second] = resolved;
    if (!first || !second || first.ref.kind !== "wire" || second.ref.kind !== "wire") {
      continue;
    }
    const firstLength = parseLengthMeters(first.component.length);
    const secondLength = parseLengthMeters(second.component.length);
    if (
      firstLength !== undefined &&
      secondLength !== undefined &&
      Math.abs(firstLength - secondLength) > 1e-9
    ) {
      warnings.push(`${label}: ${first.displayName} and ${second.displayName} have different lengths (${first.component.length} vs ${second.component.length}).`);
    }
    if (
      clean(first.component.gauge).toLowerCase() !==
      clean(second.component.gauge).toLowerCase()
    ) {
      warnings.push(`${label}: ${first.displayName} and ${second.displayName} have different gauges (${first.component.gauge || "unspecified"} vs ${second.component.gauge || "unspecified"}).`);
    }
    const firstSides = connectedSides(project, first.component.id).size;
    const secondSides = connectedSides(project, second.component.id).size;
    if ((firstSides === 2 && secondSides < 2) || (secondSides === 2 && firstSides < 2)) {
      warnings.push(`${label}: one member is fully routed while the other has an open end.`);
    }
  }

  for (const [designator, count] of designators) {
    if (count > 1) {
      errors.push(`Twisted-pair designator ${designator} is used more than once.`);
    }
  }
  return { errors, warnings };
}
