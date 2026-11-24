export function Placeholder({ title, phase = 2 }: { title: string; phase?: number }) {
  return (
    <section>
      <h1>{title}</h1>
      <p className="muted">Modulet bygges i fase {phase} (se docs/spec/07-faser-og-accept.md).</p>
    </section>
  );
}
