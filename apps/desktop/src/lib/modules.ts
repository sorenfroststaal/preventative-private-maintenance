import {
  Car,
  FileText,
  HeartPulse,
  House,
  LayoutDashboard,
  ListChecks,
  ListTree,
  Settings,
  ShieldCheck,
  Sparkles,
  Utensils,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/** Menu entries with icon and colour token in the order of spec 04 "Navigation". */
export interface ModuleDef {
  id: ModuleId;
  to: string;
  label: string;
  Icon: LucideIcon;
  /** CSS custom property, e.g. "--c-food". */
  token: string;
}

export type ModuleId =
  | "overview"
  | "tasks"
  | "home"
  | "maintenance"
  | "vehicle"
  | "finance"
  | "food"
  | "insurance"
  | "health"
  | "documents"
  | "ai"
  | "lists"
  | "settings";

export const MODULES: ModuleDef[] = [
  { id: "overview", to: "/", label: "Overblik", Icon: LayoutDashboard, token: "--c-overview" },
  { id: "tasks", to: "/opgaver", label: "Opgaver", Icon: ListChecks, token: "--c-tasks" },
  { id: "home", to: "/bolig", label: "Bolig og inventar", Icon: House, token: "--c-home" },
  { id: "maintenance", to: "/arbejdsordrer", label: "Arbejdsordrer", Icon: Wrench, token: "--c-maintenance" },
  { id: "vehicle", to: "/bil", label: "Bil", Icon: Car, token: "--c-vehicle" },
  { id: "finance", to: "/okonomi", label: "Økonomi", Icon: Wallet, token: "--c-finance" },
  { id: "food", to: "/madplan", label: "Madplan", Icon: Utensils, token: "--c-food" },
  { id: "insurance", to: "/forsikring", label: "Forsikring", Icon: ShieldCheck, token: "--c-insurance" },
  { id: "health", to: "/helbred", label: "Helbred", Icon: HeartPulse, token: "--c-health" },
  { id: "documents", to: "/dokumenter", label: "Dokumenter", Icon: FileText, token: "--c-documents" },
  { id: "ai", to: "/ai", label: "AI-indbakke", Icon: Sparkles, token: "--c-ai" },
  { id: "lists", to: "/lister", label: "Lister", Icon: ListTree, token: "--c-lists" },
  { id: "settings", to: "/indstillinger", label: "Indstillinger", Icon: Settings, token: "--c-settings" },
];

export const moduleDef = (id: ModuleId): ModuleDef => MODULES.find((m) => m.id === id)!;

/** Core modules (search_index.module, task.module) → UI module. */
export function uiModuleOf(coreModule: string): ModuleId {
  switch (coreModule) {
    case "home":
    case "maintenance":
    case "vehicle":
    case "finance":
    case "food":
    case "insurance":
    case "health":
    case "documents":
      return coreModule;
    case "custom":
      return "tasks";
    default:
      return "settings";
  }
}
