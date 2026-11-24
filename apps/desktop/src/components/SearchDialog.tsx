import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { search, type SearchHit } from "@ppm/core";
import { useSession } from "../app/session";
import { Modal } from "./ui";

const MODULE_LABEL: Record<string, string> = {
  home: "Bolig og inventar",
  maintenance: "Vedligehold",
  vehicle: "Bil",
  finance: "Økonomi",
  insurance: "Forsikring",
  health: "Helbred",
  documents: "Dokumenter",
  core: "Kontakter",
};

function route(hit: SearchHit): string {
  switch (hit.type) {
    case "item":
      return `/bolig?id=${hit.id}`;
    case "work_order":
      return `/arbejdsordrer?id=${hit.id}`;
    case "task":
      return `/opgaver?task=${hit.id}`;
    case "vehicle":
      return `/bil?id=${hit.id}`;
    case "policy":
      return `/forsikring?id=${hit.id}`;
    case "document":
      return `/dokumenter?id=${hit.id}`;
    case "bank_transaction":
      return `/okonomi`;
    default:
      return hit.module === "health" ? "/helbred" : "/indstillinger";
  }
}

/** Global search (Ctrl+K) over search_index, grouped by module (spec 04). */
export function SearchDialog({ onClose }: { onClose(): void }) {
  const { archive } = useSession();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 150);
    return () => clearTimeout(t);
  }, [q]);
  const hits = useQuery({ queryKey: ["search", debounced], queryFn: () => search(archive.db, debounced, { limit: 50 }), enabled: debounced.trim().length > 0 });
  const groups = new Map<string, SearchHit[]>();
  for (const h of hits.data ?? []) groups.set(h.module, [...(groups.get(h.module) ?? []), h]);
  const go = (h: SearchHit) => {
    navigate(route(h));
    onClose();
  };
  return (
    <Modal title="Søg" onClose={onClose} wide>
      <input
        type="search"
        aria-label="Søg i hele arkivet"
        placeholder="Søg i genstande, opgaver, dokumenter, posteringer…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && hits.data?.[0]) go(hits.data[0]);
        }}
      />
      {debounced && hits.data?.length === 0 && <p className="muted">Ingen resultater.</p>}
      {[...groups.entries()].map(([module, list]) => (
        <div key={module}>
          <h3>{MODULE_LABEL[module] ?? module}</h3>
          <ul className="plain">
            {list.map((h) => (
              <li key={`${h.type}:${h.id}`}>
                <button className="search-hit" onClick={() => go(h)}>
                  <strong>{h.title || "(uden titel)"}</strong>
                  {h.snippet && <span className="small muted"> {h.snippet}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Modal>
  );
}
