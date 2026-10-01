import { parseLengthMeters } from "./additional-components.ts";
import {
  createTwistedPairId,
  type HarnessComponent,
  type HarnessProject,
  type TwistedPair,
} from "./model.ts";

export interface TwistedPairValidationResult {
  errors: string[];
  warnings: string[];
}

function clean(value: string | undefined) {
  return value?.trim() ?? "";
}

function pairLabel(pair: TwistedPair) {
  return clean(pair.designator) || "Twisted pair";
}

export function isTwistedPairWire(
  component: HarnessComponent | undefined,
) {
  return component?.kind === "wire" && component.wireCount === 1;
}

export function findTwistedPairForWire(
  project: HarnessProject,
  wireId: string,
) {
  return project.twistedPairs.find((pair) => pair.members.includes(wireId));
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
  memberIds: readonly string[],
) {
  if (memberIds.length !== 2) return "Select exactly two single wires.";
  if (memberIds[0] === memberIds[1]) return "A wire cannot be paired with itself.";
  for (const id of memberIds) {
    const component = project.components.find((candidate) => candidate.id === id);
    if (!component) return "One selected wire no longer exists.";
    if (!isTwistedPairWire(component)) {
      return `${component.designator} must be a single-wire component.`;
    }
    const existing = findTwistedPairForWire(project, id);
    if (existing) {
      return `${component.designator} already belongs to ${pairLabel(existing)}.`;
    }
  }
  return undefined;
}

export function createTwistedPair(
  project: HarnessProject,
  memberIds: readonly string[],
): TwistedPair {
  const issue = twistedPairCreationIssue(project, memberIds);
  if (issue) throw new Error(issue);
  return {
    id: createTwistedPairId(),
    designator: allocateTwistedPairDesignator(project.twistedPairs),
    members: [memberIds[0], memberIds[1]],
    twistDirection: "unspecified",
  };
}

export function cloneTwistedPairsForPaste(
  pairs: readonly TwistedPair[],
  memberIds: ReadonlyMap<string, string>,
  existingPairs: readonly TwistedPair[],
) {
  const cloned: TwistedPair[] = [];
  const designators = [...existingPairs];
  for (const pair of pairs) {
    const members = pair.members.map((member) => memberIds.get(member));
    if (members.length !== 2 || members.some((member) => !member)) continue;
    const copy: TwistedPair = {
      ...structuredClone(pair),
      id: createTwistedPairId(),
      designator: allocateTwistedPairDesignator(designators),
      members: members as string[],
    };
    cloned.push(copy);
    designators.push(copy);
  }
  return cloned;
}

export function withoutTwistedPairsForMembers(
  pairs: readonly TwistedPair[],
  memberIds: ReadonlySet<string>,
) {
  return pairs.filter((pair) =>
    pair.members.every((member) => !memberIds.has(member)),
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

  for (const pair of project.twistedPairs) {
    const label = pairLabel(pair);
    const designatorKey = clean(pair.designator).toLowerCase();
    if (!designatorKey) errors.push("A twisted pair is missing its designator.");
    else designators.set(designatorKey, (designators.get(designatorKey) ?? 0) + 1);

    if (pair.members.length !== 2) {
      errors.push(`${label} must contain exactly two wires.`);
      continue;
    }
    if (pair.members[0] === pair.members[1]) {
      errors.push(`${label} contains the same wire twice.`);
      continue;
    }

    const members = pair.members.map((id) =>
      project.components.find((component) => component.id === id),
    );
    pair.members.forEach((id, index) => {
      const member = members[index];
      if (!member) {
        errors.push(`${label} references missing wire ${id || "(empty ID)"}.`);
        return;
      }
      if (!isTwistedPairWire(member)) {
        errors.push(`${label}: ${member.designator} is not a single-wire component.`);
      }
      const previous = membership.get(id);
      if (previous) {
        errors.push(`${label}: ${member.designator} is already a member of ${previous}.`);
      } else {
        membership.set(id, label);
      }
    });

    if (
      pair.twistPitchMm !== undefined &&
      (!Number.isFinite(pair.twistPitchMm) || pair.twistPitchMm <= 0)
    ) {
      errors.push(`${label} has an invalid twist pitch; use a value greater than 0 mm.`);
    }

    const [first, second] = members;
    if (
      !first ||
      !second ||
      !isTwistedPairWire(first) ||
      !isTwistedPairWire(second)
    ) continue;
    const firstLength = parseLengthMeters(first.length);
    const secondLength = parseLengthMeters(second.length);
    if (
      firstLength !== undefined &&
      secondLength !== undefined &&
      Math.abs(firstLength - secondLength) > 1e-9
    ) {
      warnings.push(
        `${label}: ${first.designator} and ${second.designator} have different lengths (${first.length} vs ${second.length}).`,
      );
    }
    if (clean(first.gauge).toLowerCase() !== clean(second.gauge).toLowerCase()) {
      warnings.push(
        `${label}: ${first.designator} and ${second.designator} have different gauges (${first.gauge || "unspecified"} vs ${second.gauge || "unspecified"}).`,
      );
    }
    const firstSides = connectedSides(project, first.id).size;
    const secondSides = connectedSides(project, second.id).size;
    if ((firstSides === 2 && secondSides < 2) || (secondSides === 2 && firstSides < 2)) {
      warnings.push(
        `${label}: one member is fully routed while the other has an open end.`,
      );
    }
  }

  for (const [designator, count] of designators) {
    if (count > 1) {
      errors.push(`Twisted-pair designator ${designator} is used more than once.`);
    }
  }
  return { errors, warnings };
}
