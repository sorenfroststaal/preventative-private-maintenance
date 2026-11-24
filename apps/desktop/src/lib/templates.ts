import type { Recurrence } from "@ppm/core";
import basis from "../../../../templates/da/basis.json";

/** Task template format (templates/da/README.md). */
export interface Template {
  id: string;
  version: number;
  title: string;
  description: string;
  module: string;
  applies_to: "property" | "building_part" | "item" | "vehicle" | "person";
  recurrence: Recurrence | null;
  basis: "suggestion" | "recommendation" | "requirement";
  source: unknown;
}

export const TEMPLATES = basis as Template[];
