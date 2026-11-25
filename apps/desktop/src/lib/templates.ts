import type { TaskTemplate } from "@ppm/core";
import basis from "../../../../templates/da/basis.json";

/** Task template format (templates/da/README.md); the type lives in core. */
export type Template = TaskTemplate;

export const TEMPLATES = basis as Template[];
