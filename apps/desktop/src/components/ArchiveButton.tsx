import { useMutation, useQueryClient } from "@tanstack/react-query";
import { archiveEntity, type EntityType } from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { useToast } from "../layout/Shell";

/** Archives (never deletes) a primary entity (spec README "Sletning"). */
export function ArchiveButton({ type, id, label, onDone }: { type: EntityType; id: string; label: string; onDone?(): void }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => archiveEntity(session.ctx(), type, id),
    onSuccess: async () => {
      await qc.invalidateQueries();
      toast(`${label} er arkiveret`);
      onDone?.();
    },
    onError: (e) => toast(errorText(e), "error"),
  });
  return (
    <button
      className="link"
      disabled={session.archive.readOnly || m.isPending}
      onClick={() => window.confirm(`Arkivér ${label.toLowerCase()}? Data bevares og kan findes i eksporten.`) && m.mutate()}
    >
      Arkivér
    </button>
  );
}
