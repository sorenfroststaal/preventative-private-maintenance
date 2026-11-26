import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { documentRelPath, thumbnailsFor, type ThumbDoc } from "@ppm/core";
import type { LucideIcon } from "lucide-react";
import { useSession } from "../app/session";

/** Small thumbnails, made once per image and kept for the session (by content hash). */
const cache = new Map<string, Promise<string | null>>();
const SIZE = 96; // CSS 48 px at 2x

async function makeThumb(bytes: Uint8Array, mime: string): Promise<string | null> {
  const blob = new Blob([bytes.slice()], { type: mime });
  if (typeof createImageBitmap === "undefined" || typeof document === "undefined") return null;
  const bmp = await createImageBitmap(blob);
  const scale = Math.max(SIZE / bmp.width, SIZE / bmp.height);
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // Cover: fill the square and crop the overflow evenly.
  ctx.drawImage(bmp, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
  bmp.close?.();
  return canvas.toDataURL("image/jpeg", 0.82);
}

/** Thumbnails for every record of a type, for list rows. */
export function useThumbnails(targetType: string) {
  const { archive } = useSession();
  return useQuery({ queryKey: ["documents", "thumbs", targetType], queryFn: () => thumbnailsFor(archive.db, targetType) }).data;
}

/**
 * The image at the left of a row. Loads only when the row is visible; without an image it shows the
 * module icon (decorative), so rows line up.
 */
export function RowThumb({ doc, icon: Icon }: { doc: ThumbDoc | undefined | null; icon?: LucideIcon }) {
  const { env, archive } = useSession();
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!doc || !visible) return;
    let cancelled = false;
    if (!cache.has(doc.sha256)) {
      cache.set(
        doc.sha256,
        env.fs
          .readFile(archive.path(documentRelPath(doc.sha256, doc.ext)))
          .then((b) => makeThumb(b, doc.mime))
          .catch(() => null),
      );
    }
    void cache.get(doc.sha256)!.then((u) => !cancelled && setUrl(u));
    return () => {
      cancelled = true;
    };
  }, [doc, visible, env, archive]);
  return (
    <span ref={ref} className={`row-thumb${url ? " has-img" : ""}`} aria-hidden="true">
      {url ? <img src={url} alt="" /> : Icon ? <Icon size={18} /> : null}
    </span>
  );
}
