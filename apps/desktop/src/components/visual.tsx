import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import {
  CircleCheck,
  CircleHelp,
  Clock,
  FileText,
  Image as ImageIcon,
  Lock,
  Mail,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { moduleDef, type ModuleId } from "../lib/modules";

/** Sets the module colour (--mc) used by icon backgrounds and card borders. */
export const moduleStyle = (id: ModuleId): CSSProperties => ({ ["--mc" as string]: `var(${moduleDef(id).token})` });

/** Decorative module icon on the module's colour (aria-hidden: always shown next to text). */
export function ModuleIcon({ id, large }: { id: ModuleId; large?: boolean }) {
  const { Icon } = moduleDef(id);
  return (
    <span className={`module-icon${large ? " lg" : ""}`} style={moduleStyle(id)} aria-hidden="true">
      <Icon size={large ? 20 : 16} strokeWidth={2.2} />
    </span>
  );
}

/** Title part of a page header (module icon + h1), for pages that lay out their own header. */
export function PageTitle({ module, title }: { module: ModuleId; title?: string }) {
  return (
    <div className="title">
      <ModuleIcon id={module} large />
      <h1>{title ?? moduleDef(module).label}</h1>
    </div>
  );
}

/** Page header with the module's icon (spec 04: icons in page headers). */
export function PageHeader({ module, title, children }: { module: ModuleId; title?: string; children?: ReactNode }) {
  return (
    <div className="page-header">
      <div className="title">
        <ModuleIcon id={module} large />
        <h1>{title ?? moduleDef(module).label}</h1>
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export type BadgeKind = "overdue" | "today" | "done" | "missing" | "private" | "allergy";
const BADGE_ICON: Record<BadgeKind, LucideIcon> = {
  overdue: TriangleAlert,
  today: Clock,
  done: CircleCheck,
  missing: CircleHelp,
  private: Lock,
  allergy: TriangleAlert,
};

/** Status badge: icon plus text, never colour alone (WCAG 1.4.1). */
export function StatusBadge({ kind, children, title }: { kind: BadgeKind; children: ReactNode; title?: string }) {
  const Icon = BADGE_ICON[kind];
  return (
    <span className={`status-badge ${kind}`} title={title}>
      <Icon size={13} aria-hidden="true" className="icon" />
      {children}
    </span>
  );
}

/** Button with only an icon: aria-label and tooltip are required by the type. */
export function IconButton({
  icon: Icon,
  label,
  size = 16,
  className,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title" | "children"> & { icon: LucideIcon; label: string; size?: number }) {
  return (
    <button type="button" {...rest} className={`icon-button ${className ?? ""}`.trim()} aria-label={label} title={label}>
      <Icon size={size} aria-hidden="true" />
    </button>
  );
}

/** Button with an icon in front of its text. */
export function TextIconButton({
  icon: Icon,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon }) {
  return (
    <button type="button" {...rest} className={`with-icon ${className ?? ""}`.trim()}>
      <Icon size={16} aria-hidden="true" />
      {children}
    </button>
  );
}

/** Empty list: large muted module icon, one sentence and the primary action (spec 04 "Tomme tilstande"). */
export function EmptyState({
  module,
  text,
  action,
  onAction,
  disabled,
  children,
}: {
  module: ModuleId;
  text: string;
  action?: string;
  onAction?(): void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const { Icon } = moduleDef(module);
  return (
    <div className="empty-state" style={moduleStyle(module)}>
      <Icon size={48} aria-hidden="true" className="empty-icon" />
      <p>{text}</p>
      {action && onAction && (
        <button className="primary" onClick={onAction} disabled={disabled}>
          {action}
        </button>
      )}
      {children}
    </div>
  );
}

/** Key-figure card on the dashboard: icon, number and text; a link to its section (spec 04 "Overblik"). */
export function KpiCard({ module, icon: Icon, n, label, target }: { module: ModuleId; icon: LucideIcon; n: number; label: string; target: string }) {
  return (
    <a
      className="kpi"
      href={`#${target}`}
      style={moduleStyle(module)}
      aria-label={`${label}: ${n}`}
      onClick={(e) => {
        // The router uses the URL hash, so scroll and move focus ourselves.
        e.preventDefault();
        const el = document.getElementById(target);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
        el?.focus({ preventScroll: true });
      }}
    >
      <span className="module-icon lg" style={moduleStyle(module)} aria-hidden="true">
        <Icon size={20} />
      </span>
      <span aria-hidden="true">
        <span className="kpi-n">{n}</span>
        <br />
        <span className="kpi-label">{label}</span>
      </span>
    </a>
  );
}

/** File type icon for documents (spec 04): file-text for PDF, image for pictures, mail for mail. */
export function FileTypeIcon({ ext, size = 16 }: { ext: string; size?: number }) {
  const e = ext.toLowerCase();
  const Icon = ["jpg", "jpeg", "png", "heic"].includes(e) ? ImageIcon : ["eml", "msg"].includes(e) ? Mail : FileText;
  return <Icon size={size} aria-hidden="true" className="icon" />;
}

/** "Anna Marie Jensen" → "AJ"; one word → the first two letters. */
export function initials(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (w.length === 0) return "?";
  if (w.length === 1) return w[0]!.slice(0, 2).toUpperCase();
  return (w[0]![0]! + w[w.length - 1]![0]!).toUpperCase();
}

/** Round initials badge for a person; the full name is the accessible name and tooltip. */
export function Avatar({ name, icon: Icon }: { name: string; icon?: LucideIcon }) {
  return (
    <span className={`avatar${Icon ? " other" : ""}`} title={name} role="img" aria-label={name}>
      {Icon ? <Icon size={14} aria-hidden="true" /> : initials(name)}
    </span>
  );
}

/** Priority 1-5 as filled dots, with the label in text next to it. */
export function PriorityDots({ value, label }: { value: number; label: string }) {
  return (
    <span className="priority" title={`Prioritet ${value} af 5: ${label}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`dot${n <= value ? " on" : ""}`} aria-hidden="true" />
      ))}
      <span className="small">&nbsp;{label}</span>
    </span>
  );
}
