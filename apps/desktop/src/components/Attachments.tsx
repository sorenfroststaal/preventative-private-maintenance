import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Receipt, X } from "lucide-react";
import { documentRelPath, documentsFor, importDocument, linkDocument, type Row } from "@ppm/core";
import { errorText, useSession, type Session } from "../app/session";
import { pickFiles } from "../platform/tauri";
import { useToast } from "../layout/Shell";
import { Modal } from "./ui";
import { DocumentPreview } from "./DocumentPreview";
import { IconButton, TextIconButton } from "./visual";

type DocTarget = Parameters<typeof linkDocument>[1]["target_type"];
export interface PendingFile {
  path: string;
  role: "photo" | "receipt";
}

const IMAGE_EXT = ["jpg", "jpeg", "png", "heic"];
const RECEIPT_EXT = ["pdf", "jpg", "jpeg", "png", "heic", "eml", "msg"];

/**
 * Photos and receipt chosen while creating a record. They are imported and linked by
 * attachPending() once the record exists (spec 04: fotos og kvittering på genstande).
 */
export function PendingAttachments({ value, onChange, receipt = true }: { value: PendingFile[]; onChange(v: PendingFile[]): void; receipt?: boolean }) {
  const session = useSession();
  const add = async (role: PendingFile["role"]) => {
    const files = await pickFiles(role === "photo" ? "Vælg fotos" : "Vælg kvittering", {
      filterName: role === "photo" ? "Billeder" : "Kvittering",
      extensions: role === "photo" ? IMAGE_EXT : RECEIPT_EXT,
      multiple: role === "photo",
    });
    onChange([...value, ...files.filter((p) => !value.some((v) => v.path === p)).map((path) => ({ path, role }))]);
  };
  return (
    <fieldset>
      <legend>Fotos og kvittering</legend>
      <div className="row">
        <TextIconButton icon={Camera} onClick={() => void add("photo")} disabled={session.archive.readOnly}>
          Tilføj fotos…
        </TextIconButton>
        {receipt && (
          <TextIconButton icon={Receipt} onClick={() => void add("receipt")} disabled={session.archive.readOnly}>
            Tilføj kvittering…
          </TextIconButton>
        )}
      </div>
      {value.length > 0 ? (
        <ul className="plain">
          {value.map((f) => (
            <li key={f.path} className="line">
              <span>{session.env.fs.basename(f.path)}</span>
              <span className="muted small">{f.role === "photo" ? "Foto" : "Kvittering"}</span>
              <IconButton icon={X} label={`Fjern ${session.env.fs.basename(f.path)}`} onClick={() => onChange(value.filter((v) => v.path !== f.path))} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">Filerne kopieres ind i arkivet, når du opretter. Du kan også tilføje dem senere under Bilag.</p>
      )}
    </fieldset>
  );
}

/** Imports the chosen files and links them to the new record. Returns the number linked. */
export async function attachPending(session: Session, targetType: DocTarget, targetId: string, files: PendingFile[]): Promise<{ linked: number; errors: string[] }> {
  let linked = 0;
  const errors: string[] = [];
  for (const f of files) {
    try {
      const r = await importDocument(session.env, session.archive, session.ctx(), f.path, { source: "drop" });
      await linkDocument(session.ctx(), { document_id: String(r.document.id), target_type: targetType, target_id: targetId, role: f.role });
      linked++;
    } catch (e) {
      errors.push(`${session.env.fs.basename(f.path)}: ${errorText(e)}`);
    }
  }
  return { linked, errors };
}

function Thumb({ doc, onOpen }: { doc: Row; onOpen(): void }) {
  const { env, archive } = useSession();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    env.fs
      .readFile(archive.path(documentRelPath(String(doc.sha256), String(doc.ext))))
      .then((bytes) => {
        if (cancelled) return;
        revoke = URL.createObjectURL(new Blob([bytes.slice()], { type: String(doc.mime) }));
        setUrl(revoke);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [archive, doc.ext, doc.mime, doc.sha256, env]);
  const title = String(doc.title ?? doc.filename);
  return (
    <button className="photo-thumb" onClick={onOpen} aria-label={`Vis foto: ${title}`} title={title}>
      {url ? <img src={url} alt="" /> : <span aria-hidden="true" />}
    </button>
  );
}

/** Photo strip at the top of a detail view, with a button to add more photos. */
export function PhotoStrip({ targetType, targetId }: { targetType: DocTarget; targetId: string }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState<Row | null>(null);
  const docs = useQuery({ queryKey: ["documents", "for", targetType, targetId], queryFn: () => documentsFor(session.archive.db, targetType, targetId) });
  const photos = (docs.data ?? []).filter((d) => String(d.role).startsWith("photo") && ["jpg", "jpeg", "png"].includes(String(d.ext)));
  const add = async () => {
    const files = await pickFiles("Vælg fotos", { filterName: "Billeder", extensions: IMAGE_EXT, multiple: true });
    if (!files.length) return;
    const r = await attachPending(session, targetType, targetId, files.map((path) => ({ path, role: "photo" })));
    for (const e of r.errors) toast(e, "error");
    if (r.linked) toast(`${r.linked} ${r.linked === 1 ? "foto er" : "fotos er"} tilføjet`);
    await qc.invalidateQueries({ queryKey: ["documents"] });
  };
  return (
    <div className="photo-strip" aria-label="Fotos">
      {photos.map((d) => (
        <Thumb key={`${String(d.id)}:${String(d.role)}`} doc={d} onOpen={() => setOpen(d)} />
      ))}
      <TextIconButton icon={Camera} onClick={() => void add()} disabled={session.archive.readOnly}>
        {photos.length ? "Flere fotos…" : "Tilføj fotos…"}
      </TextIconButton>
      {open && (
        <Modal title={String(open.title ?? open.filename)} onClose={() => setOpen(null)} wide>
          <DocumentPreview doc={open} />
        </Modal>
      )}
    </div>
  );
}
