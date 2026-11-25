import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, CircleCheck, Pencil, X } from "lucide-react";
import {
  approveGroup,
  ConflictError,
  describeDraft,
  editDraft,
  formatIngredient,
  listDraftGroups,
  rejectGroup,
  type Conflict,
  type DraftGroup,
  type DraftRow,
  type IngredientInput,
} from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { useToast } from "../layout/Shell";
import { Modal } from "../components/ui";
import { EmptyState, IconButton, PageHeader, StatusBadge, TextIconButton } from "../components/visual";
import { formatDateTime } from "../lib/format";

const STATUS_LABEL: Record<string, string> = {
  pending: "Venter",
  approved: "Godkendt",
  rejected: "Afvist",
  failed: "Fejlede",
  partial: "Delvist godkendt",
};

/** AI inbox (spec 06 "Kladdegrupper og godkendelse"): draft groups from the MCP server. */
export function AiInbox() {
  const session = useSession();
  const [showAll, setShowAll] = useState(false);
  const q = useQuery({ queryKey: ["ai_draft", "groups", showAll], queryFn: () => listDraftGroups(session.archive.db, { status: showAll ? "all" : "pending" }) });
  const groups = q.data ?? [];
  return (
    <section>
      <PageHeader module="ai">
        <label className="inline">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Vis også afgjorte forslag
        </label>
      </PageHeader>
      <p className="small muted">
        AI kan kun foreslå ændringer. Et forslag er en gruppe af operationer, som du godkender samlet eller enkeltvis. Godkendte ændringer logges med "via AI-kladde".
      </p>
      {q.data && groups.length === 0 && (
        <EmptyState module="ai" text="Her lander forslag fra AI, fx en ny genstand med kvittering eller ugens madplan. Opsæt AI under Indstillinger → AI-adgang." />
      )}
      {groups.map((g) => (
        <GroupCard key={g.group} group={g} />
      ))}
    </section>
  );
}

function GroupCard({ group }: { group: DraftGroup }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const pending = group.drafts.filter((d) => d.status === "pending");
  const [selected, setSelected] = useState<string[]>(pending.map((d) => d.id));
  const [open, setOpen] = useState<string[]>([]);
  const [editing, setEditing] = useState<DraftRow | null>(null);
  const [conflicts, setConflicts] = useState<{ conflicts: Conflict[]; only?: string[] } | null>(null);
  const ro = session.archive.readOnly;
  const refresh = () => qc.invalidateQueries();

  const approve = useMutation({
    mutationFn: (v: { only?: string[]; confirm?: boolean }) =>
      approveGroup(session.env, session.archive, session.ctx(), group.group, { only: v.only, confirmConflicts: v.confirm }),
    onSuccess: async (r) => {
      setConflicts(null);
      toast(`${r.approved} ${r.approved === 1 ? "ændring er" : "ændringer er"} godkendt`);
      await refresh();
    },
    onError: async (e, v) => {
      if (e instanceof ConflictError) setConflicts({ conflicts: e.conflicts, only: v.only });
      else {
        toast(errorText(e), "error");
        await refresh();
      }
    },
  });
  const reject = useMutation({
    mutationFn: () => rejectGroup(session.env, session.archive, session.ctx(), group.group),
    onSuccess: async (n) => {
      toast(`${n} ${n === 1 ? "forslag er" : "forslag er"} afvist`);
      await refresh();
    },
    onError: (e) => toast(errorText(e), "error"),
  });

  const badgeKind = group.status === "pending" ? "today" : group.status === "approved" ? "done" : group.status === "failed" ? "overdue" : "missing";
  return (
    <div className="panel module" style={{ ["--mc" as string]: "var(--c-ai)" }} aria-label={`Forslag: ${group.rationale}`} role="region">
      <div className="header-row">
        <div>
          <h2 style={{ marginBottom: 0 }}>{group.rationale}</h2>
          <span className="small muted">
            {formatDateTime(group.created_at)} · {group.drafts.length} {group.drafts.length === 1 ? "operation" : "operationer"}
          </span>
        </div>
        <StatusBadge kind={badgeKind}>{STATUS_LABEL[group.status] ?? group.status}</StatusBadge>
      </div>
      <ul className="plain">
        {group.drafts.map((d) => {
          const isOpen = open.includes(d.id);
          return (
            <li key={d.id} className="draft-op">
              <div className="row" style={{ alignItems: "center" }}>
                {d.status === "pending" ? (
                  <input
                    type="checkbox"
                    aria-label={`Vælg operation ${d.payload.index}: ${describeDraft(d)}`}
                    checked={selected.includes(d.id)}
                    onChange={(e) => setSelected(e.target.checked ? [...selected, d.id] : selected.filter((x) => x !== d.id))}
                  />
                ) : (
                  <StatusBadge kind={d.status === "approved" ? "done" : d.status === "failed" ? "overdue" : "missing"}>{STATUS_LABEL[d.status]}</StatusBadge>
                )}
                <IconButton
                  icon={isOpen ? ChevronDown : ChevronRight}
                  label={`${isOpen ? "Skjul" : "Vis"} detaljer for operation ${d.payload.index}`}
                  onClick={() => setOpen(isOpen ? open.filter((x) => x !== d.id) : [...open, d.id])}
                />
                <span>
                  {d.payload.index}. {describeDraft(d)}
                </span>
                {d.status === "pending" && (d.action === "create" || d.action === "update") && (
                  <IconButton icon={Pencil} label={`Redigér operation ${d.payload.index}`} onClick={() => setEditing(d)} disabled={ro} />
                )}
              </div>
              {d.payload.duplicate_of && d.status === "pending" && (
                <StatusBadge kind="missing" title="Godkender du, oprettes en post mere med samme navn.">
                  Findes allerede (ref {d.payload.duplicate_of.replace(/-/g, "").slice(0, 8)})
                </StatusBadge>
              )}
              {d.error && <p className="error small">{d.error}</p>}
              {isOpen && (
                <div className="draft-details">
                  <pre className="mailtext">{JSON.stringify(d.payload.data, null, 2)}</pre>
                  {d.payload.ingredients && (
                    <>
                      <div className="small">Ingredienser</div>
                      <ul className="small">
                        {(d.payload.ingredients as IngredientInput[]).map((i, n) => (
                          <li key={n}>{formatIngredient(i)}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {pending.length > 0 && (
        <div className="row" style={{ marginTop: "0.6rem" }}>
          <TextIconButton icon={CircleCheck} className="primary" onClick={() => approve.mutate({})} disabled={ro || approve.isPending}>
            Godkend alle
          </TextIconButton>
          <button onClick={() => approve.mutate({ only: selected })} disabled={ro || approve.isPending || selected.length === 0 || selected.length === pending.length}>
            Godkend valgte ({selected.length})
          </button>
          <TextIconButton icon={X} onClick={() => window.confirm("Afvis alle ventende operationer i forslaget?") && reject.mutate()} disabled={ro || reject.isPending}>
            Afvis alle
          </TextIconButton>
        </div>
      )}
      {editing && <EditDraft draft={editing} onClose={() => setEditing(null)} />}
      {conflicts && (
        <Modal title="Posten er ændret siden forslaget" onClose={() => setConflicts(null)}>
          <p>
            {conflicts.conflicts.length === 1 ? "En post" : `${conflicts.conflicts.length} poster`}, som forslaget ændrer, er blevet ændret i appen, efter AI lavede forslaget. Godkender du, overskrives de nyere værdier.
          </p>
          <ul>
            {conflicts.conflicts.map((c) => (
              <li key={c.draft_id}>
                Operation {c.index} ({c.type}), ændret {formatDateTime(c.updated_at)}
              </li>
            ))}
          </ul>
          <div className="row">
            <button className="primary" onClick={() => approve.mutate({ only: conflicts.only, confirm: true })}>
              Godkend alligevel
            </button>
            <button onClick={() => setConflicts(null)}>Annullér</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** "Redigér": edit the data as JSON; validated with the same schema as the forms. */
function EditDraft({ draft, onClose }: { draft: DraftRow; onClose(): void }) {
  const session = useSession();
  const qc = useQueryClient();
  const [text, setText] = useState(JSON.stringify(draft.payload.data, null, 2));
  const [error, setError] = useState<string | null>(null);
  async function save() {
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      await editDraft(session.ctx(), draft.id, data);
      await qc.invalidateQueries({ queryKey: ["ai_draft"] });
      onClose();
    } catch (e) {
      setError(e instanceof SyntaxError ? "Ugyldig JSON." : errorText(e));
    }
  }
  return (
    <Modal title={`Redigér operation ${draft.payload.index}`} onClose={onClose} wide>
      <p className="small muted">{describeDraft(draft)}. Felterne valideres som i formularerne, når du gemmer.</p>
      <label>
        Data (JSON)
        <textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button className="primary" onClick={save}>
          Gem
        </button>
        <button onClick={onClose}>Annullér</button>
      </div>
    </Modal>
  );
}
