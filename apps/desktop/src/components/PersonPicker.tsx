import { useQuery } from "@tanstack/react-query";
import { listEntities } from "@ppm/core";
import { useSession } from "../app/session";
import { initials } from "./visual";

/** Several persons as toggle buttons with round initials (recurring expenses, items, policies). */
export function PersonPicker({ value, onChange, label }: { value: string[]; onChange(ids: string[]): void; label: string }) {
  const { archive } = useSession();
  const persons = useQuery({ queryKey: ["person", "list"], queryFn: () => listEntities(archive.db, "person", { orderBy: "name" }) });
  if ((persons.data ?? []).length === 0) return <p className="small muted">Opret personer under Lister → Personer for at knytte dem til posten.</p>;
  return (
    <div className="person-picker">
      <div className="small">{label}</div>
      <div className="row" role="group" aria-label={label}>
        {(persons.data ?? []).map((p) => {
          const id = String(p.id);
          const on = value.includes(id);
          return (
            <button
              key={id}
              type="button"
              className="person-toggle"
              aria-pressed={on}
              disabled={archive.readOnly}
              onClick={() => onChange(on ? value.filter((x) => x !== id) : [...value, id])}
            >
              <span className={`avatar${on ? "" : " other"}`} aria-hidden="true">
                {initials(String(p.name))}
              </span>
              {String(p.name)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
