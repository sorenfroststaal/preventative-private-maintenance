import { EmptyState, PageHeader } from "../components/visual";
import type { ModuleId } from "../lib/modules";

export function Placeholder({ title, module, phase = 2 }: { title: string; module: ModuleId; phase?: number }) {
  return (
    <section>
      <PageHeader module={module} title={title} />
      <EmptyState module={module} text={`Modulet bygges i fase ${phase} (se docs/spec/07-faser-og-accept.md).`} />
    </section>
  );
}
