import { CABLE_KINDS, type HarnessComponent } from "./model.ts";
import type { ResolvedPhysicalConductor } from "./connection-topology.ts";

export const INSULATION_THICKNESS_HELP = "Radial insulation thickness around each conductor, excluding any outer cable jacket or bundle covering.";

/** Reuse the caller's resolved parent, checking the stable physical member ID. */
export function getConductorInsulationThickness(
  parent: HarnessComponent | undefined,
  conductor: Pick<ResolvedPhysicalConductor, "componentId" | "conductorId">,
): number | undefined {
  if (!parent || parent.id !== conductor.componentId || !CABLE_KINDS.includes(parent.kind) || !conductor.conductorId) return undefined;
  const index = parent.conductorIds.indexOf(conductor.conductorId);
  if (index < 0 || index >= parent.wireCount) return undefined;
  return parent.insulationThicknessMm;
}
