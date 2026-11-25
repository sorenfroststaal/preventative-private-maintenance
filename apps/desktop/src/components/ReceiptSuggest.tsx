import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { applyReceiptSuggestion, dismissReceiptSuggestion, itemReceiptStatus, type ItemReceiptSuggestion } from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { useToast } from "../layout/Shell";
import { Modal } from "./ui";
import { formatDate, formatMoney } from "../lib/format";

const LABELS = { purchase_price_minor: "Købspris", purchase_date: "Købsdato", vendor_name: "Forhandler" } as const;

function show(key: keyof typeof LABELS, v: unknown): string {
  if (v === null || v === undefined || v === "") return "–";
  if (key === "purchase_price_minor") return formatMoney(Number(v));
  if (key === "purchase_date") return formatDate(String(v));
  return String(v);
}

/**
 * Phase 4.4: when a linked receipt or invoice has text (OCR or PDF) that can fill empty fields on the
 * item, a banner offers it. Nothing is changed until the user confirms.
 */
export function ReceiptSuggestionBanner({ itemId }: { itemId: string }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["documents", "receipt-suggestion", itemId],
    queryFn: () => itemReceiptStatus(session.archive.db, itemId),
    // While a receipt photo is waiting for OCR, check again now and then.
    refetchInterval: (query) => (query.state.data?.waiting_for_ocr ? 4000 : false),
  });
  const dismiss = useMutation({
    mutationFn: (s: ItemReceiptSuggestion) => dismissReceiptSuggestion(session.ctx(), itemId, s.document_id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents", "receipt-suggestion", itemId] }),
    onError: (e) => toast(errorText(e), "error"),
  });
  const s = q.data?.suggestion;
  if (!s) return q.data?.waiting_for_ocr ? <p className="small muted">Kvitteringen læses (tekstgenkendelse)…</p> : null;
  return (
    <div className="panel" role="region" aria-label="Forslag fra kvittering">
      <p className="small">
        Kvitteringen foreslår{" "}
        {s.fields
          .filter((f) => f.current === null || f.current === "")
          .map((f) => `${LABELS[f.key].toLowerCase()} ${show(f.key, f.suggested)}`)
          .join(", ")}
        .
      </p>
      <div className="row">
        <button className="primary" onClick={() => setOpen(true)} disabled={session.archive.readOnly}>
          Gennemse og udfyld…
        </button>
        <button onClick={() => dismiss.mutate(s)} disabled={session.archive.readOnly || dismiss.isPending}>
          Afvis
        </button>
      </div>
      {open && <ReceiptSuggestDialog itemId={itemId} suggestion={s} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function ReceiptSuggestDialog({ itemId, suggestion, onClose }: { itemId: string; suggestion: ItemReceiptSuggestion; onClose(): void }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [chosen, setChosen] = useState<string[]>(suggestion.fields.filter((f) => f.current === null || f.current === "").map((f) => f.key));
  const apply = useMutation({
    mutationFn: () =>
      applyReceiptSuggestion(
        session.ctx(),
        itemId,
        Object.fromEntries(suggestion.fields.filter((f) => chosen.includes(f.key)).map((f) => [f.key, f.suggested])),
      ),
    onSuccess: async () => {
      toast("Genstanden er udfyldt fra kvitteringen");
      await qc.invalidateQueries();
      onClose();
    },
    onError: (e) => toast(errorText(e), "error"),
  });
  return (
    <Modal title="Udfyld fra kvittering" onClose={onClose}>
      <p className="small muted">Forslagene er læst ud af kvitteringens tekst. Kontrollér dem, og vælg, hvad der skal udfyldes.</p>
      <table className="list">
        <thead>
          <tr>
            <th>Udfyld</th>
            <th>Felt</th>
            <th>Nu</th>
            <th>Forslag</th>
          </tr>
        </thead>
        <tbody>
          {suggestion.fields.map((f) => (
            <tr key={f.key}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Udfyld ${LABELS[f.key].toLowerCase()}`}
                  checked={chosen.includes(f.key)}
                  onChange={(e) => setChosen(e.target.checked ? [...chosen, f.key] : chosen.filter((k) => k !== f.key))}
                />
              </td>
              <td>{LABELS[f.key]}</td>
              <td className="muted">{show(f.key, f.current)}</td>
              <td>
                <strong>{show(f.key, f.suggested)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <button className="primary" onClick={() => apply.mutate()} disabled={chosen.length === 0 || apply.isPending}>
          Udfyld valgte
        </button>
        <button onClick={onClose}>Annullér</button>
      </div>
    </Modal>
  );
}
