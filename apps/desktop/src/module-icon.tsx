import { LayoutDashboard, ListChecks, House, Wrench, Car, Wallet, Utensils, ShieldCheck,
  HeartPulse, FileText, Sparkles, Settings, type LucideIcon } from 'lucide-react';

const modules: Record<string, [LucideIcon, string]> = {
  Overblik: [LayoutDashboard, 'overview'], Opgaver: [ListChecks, 'tasks'],
  'Bolig og inventar': [House, 'home'], Arbejdsordrer: [Wrench, 'maintenance'],
  Bil: [Car, 'vehicle'], Økonomi: [Wallet, 'finance'], Madplan: [Utensils, 'food'],
  Forsikring: [ShieldCheck, 'insurance'], Helbred: [HeartPulse, 'health'],
  Dokumenter: [FileText, 'documents'], 'AI-indbakke': [Sparkles, 'ai'], Indstillinger: [Settings, 'settings'],
};

export function ModuleIcon({ name }: { name: string }) {
  const [Icon, token] = modules[name];
  return <span className={'module-icon icon-' + token} aria-hidden="true"><Icon size={18} /></span>;
}
export function ModuleTitle({ name }: { name: string }) {
  return <h1><ModuleIcon name={name} />{name}</h1>;
}
