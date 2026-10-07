import { naturalCompare } from "./bom.ts";
import type {
  HarnessProject,
  TwistedPair,
  TwistedPairMember,
} from "./model.ts";
import {
  getTwistedPairMemberDisplay,
  resolveTwistedPairMember,
} from "./twisted-pair.ts";

export interface DiagramPoint {
  x: number;
  y: number;
}

export interface DiagramBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ResolvedDiagramMemberGeometry {
  bounds: DiagramBounds;
  point: DiagramPoint;
  entryPoint: DiagramPoint;
  source: "node" | "conductor" | "bundle";
}

export interface TwistedPairAnnotationGeometry {
  pair: TwistedPair;
  markers: Array<{
    memberIndex: number;
    member: TwistedPairMember;
    point: DiagramPoint;
    bounds: DiagramBounds;
    source: ResolvedDiagramMemberGeometry["source"];
  }>;
}

interface SvgGroup {
  attributes: string;
  content: string;
  id: string;
  className: string;
  title: string;
}

const NUMBER_PATTERN = /-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi;
const ENTRY_LABEL_OFFSET = 20;
export const HARNESS_DIAGRAM_HORIZONTAL_RANK_SEPARATION = 6;

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function decodeXml(value: string) {
  return value
    .replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi, (_match, hex, decimal) =>
      String.fromCodePoint(Number.parseInt(hex ?? decimal, hex ? 16 : 10)),
    )
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function attributeValue(attributes: string, name: string) {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "i",
  ).exec(attributes);
  return decodeXml(match?.[1] ?? match?.[2] ?? "");
}

function svgGroups(svg: string) {
  return [
    ...svg.matchAll(/<g\b([^>]*)>((?:(?!<g\b)[\s\S])*?)<\/g>/gi),
  ].map(
    (match): SvgGroup => ({
      attributes: match[1],
      content: match[2],
      id: attributeValue(match[1], "id"),
      className: attributeValue(match[1], "class"),
      title: decodeXml(/<title>([\s\S]*?)<\/title>/i.exec(match[2])?.[1] ?? ""),
    }),
  );
}

function pointsFromNumbers(numbers: number[]) {
  const points: DiagramPoint[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    points.push({ x: numbers[index], y: numbers[index + 1] });
  }
  return points;
}

function numbers(value: string) {
  return [...value.matchAll(NUMBER_PATTERN)].map((match) => Number(match[0]));
}

function elementPoints(content: string) {
  const points: DiagramPoint[] = [];
  for (const match of content.matchAll(/<(path|polygon|polyline|line|rect|ellipse|circle)\b([^>]*)\/?\s*>/gi)) {
    const name = match[1].toLowerCase();
    const attributes = match[2];
    if (name === "path") {
      points.push(...pointsFromNumbers(numbers(attributeValue(attributes, "d"))));
    } else if (name === "polygon" || name === "polyline") {
      points.push(...pointsFromNumbers(numbers(attributeValue(attributes, "points"))));
    } else if (name === "line") {
      points.push(
        { x: Number(attributeValue(attributes, "x1")), y: Number(attributeValue(attributes, "y1")) },
        { x: Number(attributeValue(attributes, "x2")), y: Number(attributeValue(attributes, "y2")) },
      );
    } else if (name === "rect") {
      const x = Number(attributeValue(attributes, "x"));
      const y = Number(attributeValue(attributes, "y"));
      const width = Number(attributeValue(attributes, "width"));
      const height = Number(attributeValue(attributes, "height"));
      points.push({ x, y }, { x: x + width, y: y + height });
    } else {
      const cx = Number(attributeValue(attributes, "cx"));
      const cy = Number(attributeValue(attributes, "cy"));
      const rx = Number(attributeValue(attributes, name === "circle" ? "r" : "rx"));
      const ry = Number(attributeValue(attributes, name === "circle" ? "r" : "ry"));
      points.push({ x: cx - rx, y: cy - ry }, { x: cx + rx, y: cy + ry });
    }
  }
  return points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function boundsForPoints(points: readonly DiagramPoint[]): DiagramBounds | undefined {
  if (!points.length) return undefined;
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function center(bounds: DiagramBounds): DiagramPoint {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

function cubicPoint(
  start: DiagramPoint,
  controlA: DiagramPoint,
  controlB: DiagramPoint,
  end: DiagramPoint,
  amount: number,
) {
  const inverse = 1 - amount;
  return {
    x:
      inverse ** 3 * start.x +
      3 * inverse ** 2 * amount * controlA.x +
      3 * inverse * amount ** 2 * controlB.x +
      amount ** 3 * end.x,
    y:
      inverse ** 3 * start.y +
      3 * inverse ** 2 * amount * controlA.y +
      3 * inverse * amount ** 2 * controlB.y +
      amount ** 3 * end.y,
  };
}

function sampledPath(content: string) {
  const paths = [
    ...content.matchAll(/<path\b([^>]*)\/?\s*>/gi),
  ];
  if (!paths.length) return [];
  // WireViz represents striped conductors as parallel outline/color paths. The
  // middle path is the conductor centerline and is the most stable anchor.
  const attributes = paths[Math.floor(paths.length / 2)][1];
  const data = attributeValue(attributes, "d");
  const values = numbers(data);
  if (values.length < 4) return [];
  const start = { x: values[0], y: values[1] };
  if (!/[Cc]/.test(data) || values.length < 8) {
    return pointsFromNumbers(values);
  }
  const sampled = [start];
  let current = start;
  for (let index = 2; index + 5 < values.length; index += 6) {
    const controlA = { x: values[index], y: values[index + 1] };
    const controlB = { x: values[index + 2], y: values[index + 3] };
    const end = { x: values[index + 4], y: values[index + 5] };
    for (let step = 1; step <= 24; step += 1) {
      sampled.push(cubicPoint(current, controlA, controlB, end, step / 24));
    }
    current = end;
  }
  return sampled;
}

function distance(left: DiagramPoint, right: DiagramPoint) {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function distanceToBounds(point: DiagramPoint, bounds: DiagramBounds) {
  const dx = Math.max(bounds.minX - point.x, 0, point.x - bounds.maxX);
  const dy = Math.max(bounds.minY - point.y, 0, point.y - bounds.maxY);
  return Math.hypot(dx, dy);
}

function pointAlongPath(
  points: readonly DiagramPoint[],
  offset: number,
  fromStart: boolean,
) {
  if (!points.length) return undefined;
  const ordered = fromStart ? points : [...points].reverse();
  let remaining = offset;
  for (let index = 1; index < ordered.length; index += 1) {
    const segmentLength = distance(ordered[index - 1], ordered[index]);
    if (segmentLength >= remaining && segmentLength > 0) {
      const amount = remaining / segmentLength;
      return {
        x:
          ordered[index - 1].x +
          (ordered[index].x - ordered[index - 1].x) * amount,
        y:
          ordered[index - 1].y +
          (ordered[index].y - ordered[index - 1].y) * amount,
      };
    }
    remaining -= segmentLength;
  }
  return ordered.at(-1);
}

function entryPointOnPath(
  content: string,
  componentBounds: DiagramBounds,
) {
  const points = sampledPath(content);
  if (points.length < 2) return undefined;
  const startDistance = distanceToBounds(points[0], componentBounds);
  const endDistance = distanceToBounds(points.at(-1)!, componentBounds);
  const totalLength = points
    .slice(1)
    .reduce((sum, point, index) => sum + distance(points[index], point), 0);
  return pointAlongPath(
    points,
    Math.min(ENTRY_LABEL_OFFSET, totalLength / 2),
    startDistance <= endDistance,
  );
}

export function encodeDiagramKey(value: string) {
  return Array.from(value)
    .map((character) => character.codePointAt(0)!.toString(16))
    .join("_");
}

/**
 * WireViz uses a left-to-right graph with ranksep=2. In that orientation,
 * ranksep controls the horizontal gap between component ranks while nodesep
 * controls vertical spacing within a rank. Keep the latter untouched.
 */
export function applyHarnessDiagramLayout(dot: string) {
  return dot.replace(
    /(^\s*graph\s*\[[^\]\r\n]*\branksep\s*=\s*)(?:"[^"]*"|[^\s\]]+)/m,
    `$1${HARNESS_DIAGRAM_HORIZONTAL_RANK_SEPARATION}`,
  );
}

function decodeDotIdentifier(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  return trimmed;
}

/** Adds stable semantic edge IDs without changing WireViz-visible geometry. */
export function addWireFormDiagramIdsToDot(dot: string) {
  const occurrences = new Map<string, number>();
  return dot
    .split("\n")
    .map((line) => {
      if (line.includes("[") || (!line.includes(" -- ") && !line.includes(" -> "))) {
        return line;
      }
      const operator = line.includes(" -- ") ? " -- " : " -> ";
      const [left, right, ...rest] = line.trim().split(operator);
      if (!left || !right || rest.length) return line;
      const endpoint = [left, right]
        .map((value) => /^(.*):w([1-9][0-9]*):[ew]$/.exec(value.trim()))
        .find(Boolean);
      if (!endpoint) return line;
      const designator = decodeDotIdentifier(endpoint[1]);
      const conductor = Number(endpoint[2]);
      const memberKey = `${encodeDiagramKey(designator)}-${conductor}`;
      const occurrence = (occurrences.get(memberKey) ?? 0) + 1;
      occurrences.set(memberKey, occurrence);
      return `${line} [id="wireform-member-${memberKey}-${occurrence}"]`;
    })
    .join("\n");
}

/** Applies WireForm's shared layout and identity metadata before Graphviz. */
export function prepareHarnessDiagramDot(dot: string) {
  return addWireFormDiagramIdsToDot(applyHarnessDiagramLayout(dot));
}

function nodeGeometry(groups: readonly SvgGroup[], designator: string) {
  const group = groups.find(
    (candidate) =>
      candidate.className.split(/\s+/).includes("node") &&
      candidate.title === designator,
  );
  if (!group) return undefined;
  const bounds = boundsForPoints(elementPoints(group.content));
  return bounds ? { bounds, point: center(bounds) } : undefined;
}

function conductorGeometry(
  groups: readonly SvgGroup[],
  designator: string,
  conductorNumber: number,
  componentBounds: DiagramBounds,
) {
  const prefix = `wireform-member-${encodeDiagramKey(designator)}-${conductorNumber}-`;
  const matchingGroups = groups
    .filter(
      (candidate) =>
        candidate.className.split(/\s+/).includes("edge") &&
        candidate.id.startsWith(prefix),
    )
    .sort((left, right) => naturalCompare(left.id, right.id));
  if (!matchingGroups.length) return undefined;
  const bounds = boundsForPoints(
    matchingGroups.flatMap((group) => elementPoints(group.content)),
  );
  if (!bounds) return undefined;
  const entryPoint = matchingGroups
    .map((group) => entryPointOnPath(group.content, componentBounds))
    .find(Boolean);
  if (!entryPoint) return undefined;
  return {
    bounds,
    point: entryPoint,
    entryPoint,
  };
}

function fallbackEntryPoint(
  geometry: { bounds: DiagramBounds; point: DiagramPoint },
  conductorIndex?: number,
  conductorCount = 1,
) {
  const row = conductorIndex ?? 0;
  return {
    x: geometry.bounds.minX + ENTRY_LABEL_OFFSET,
    y:
      geometry.bounds.minY +
      ((row + 1) / (Math.max(1, conductorCount) + 1)) *
        (geometry.bounds.maxY - geometry.bounds.minY),
  };
}

export function resolveDiagramMemberGeometry(
  member: TwistedPairMember,
  svg: string,
  project: HarnessProject,
): ResolvedDiagramMemberGeometry | undefined {
  const groups = svgGroups(svg);
  const resolved = resolveTwistedPairMember(project, member);
  if (!resolved) return undefined;
  const node = nodeGeometry(groups, resolved.component.designator);
  if (member.kind === "wire") {
    const wireGeometry = node
      ? conductorGeometry(groups, resolved.component.designator, 1, node.bounds)
      : undefined;
    if (wireGeometry) return { ...wireGeometry, source: "conductor" };
    if (!node) return undefined;
    return {
      ...node,
      entryPoint: fallbackEntryPoint(node),
      source: "node",
    };
  }
  const geometry = node
    ? conductorGeometry(
        groups,
        resolved.component.designator,
        resolved.conductorNumber!,
        node.bounds,
      )
    : undefined;
  if (geometry) return { ...geometry, source: "conductor" };
  if (!node) return undefined;
  return {
    ...node,
    entryPoint: fallbackEntryPoint(
      node,
      resolved.conductorIndex,
      resolved.component.wireCount,
    ),
    source: "bundle",
  };
}

function labelBounds(point: DiagramPoint, text: string): DiagramBounds {
  const width = Math.max(22, text.length * 5 + 8);
  return {
    minX: point.x - width / 2,
    minY: point.y - 7,
    maxX: point.x + width / 2,
    maxY: point.y + 7,
  };
}

export function getTwistedPairAnnotationGeometry(
  pair: TwistedPair,
  svg: string,
  project: HarnessProject,
): TwistedPairAnnotationGeometry | undefined {
  if (pair.members.length !== 2) return undefined;
  const markers = pair.members.flatMap((member, memberIndex) => {
    const geometry = resolveDiagramMemberGeometry(member, svg, project);
    if (!geometry) return [];
    return [
      {
        memberIndex,
        member,
        point: geometry.entryPoint,
        bounds: labelBounds(geometry.entryPoint, pair.designator || "TP"),
        source: geometry.source,
      },
    ];
  });
  if (markers.length !== 2) return undefined;
  return {
    pair,
    markers,
  };
}

function markerTitle(pair: TwistedPair, project: HarnessProject) {
  const details = [
    pair.designator || "Twisted pair",
    `Members: ${pair.members
      .map((member) => getTwistedPairMemberDisplay(project, member))
      .join(" + ")}`,
  ];
  if (pair.twistPitchMm !== undefined) details.push(`Pitch: ${pair.twistPitchMm} mm`);
  if (pair.twistDirection !== "unspecified") details.push(`Direction: ${pair.twistDirection}`);
  return details.join(" · ");
}

function renderMarker(geometry: TwistedPairAnnotationGeometry, project: HarnessProject) {
  const { pair } = geometry;
  const title = escapeXml(markerTitle(pair, project));
  const text = escapeXml(pair.designator || "TP");
  const badges = geometry.markers.map(({ memberIndex, bounds: box, point }) =>
    `<g id="wireform-tp-${encodeDiagramKey(pair.id)}-member-${memberIndex + 1}" class="wireform-twisted-pair-marker" data-pair-id="${escapeXml(pair.id)}">
<title>${title}</title>
<rect x="${box.minX}" y="${box.minY}" width="${box.maxX - box.minX}" height="${box.maxY - box.minY}" rx="2" ry="2" fill="#ffffff" stroke="#4f5f66" stroke-width="0.8" />
<text x="${point.x}" y="${point.y}" fill="#26353b" font-family="Arial, sans-serif" font-size="8" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${text}</text>
</g>`,
  );
  return `<g id="wireform-tp-${encodeDiagramKey(pair.id)}" class="wireform-twisted-pair-annotation" data-pair-id="${escapeXml(pair.id)}">${badges.join("")}</g>`;
}

/** Adds deterministic vector markers and leaves all original wire paths unchanged. */
export function addTwistedPairAnnotations(svg: string, project: HarnessProject) {
  if (!project.twistedPairs.length || !svg.includes("<svg")) return svg;
  const sortedPairs = [...project.twistedPairs].sort(
    (left, right) =>
      naturalCompare(left.designator, right.designator) ||
      left.id.localeCompare(right.id),
  );
  const markers: string[] = [];
  for (const pair of sortedPairs) {
    try {
      const geometry = getTwistedPairAnnotationGeometry(pair, svg, project);
      if (!geometry) continue;
      markers.push(renderMarker(geometry, project));
    } catch {
      // A malformed or unmappable pair must not suppress the diagram or other markers.
    }
  }
  if (!markers.length) return svg;
  const annotations = `<g id="wireform-twisted-pair-annotations">${markers.join("")}</g>`;
  const graphEnd = svg.lastIndexOf("</g>");
  const svgEnd = svg.lastIndexOf("</svg>");
  const insertion = graphEnd > 0 && graphEnd < svgEnd ? graphEnd : svgEnd;
  return insertion < 0
    ? svg
    : `${svg.slice(0, insertion)}${annotations}${svg.slice(insertion)}`;
}
