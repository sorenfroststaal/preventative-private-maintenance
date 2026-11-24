import { createContext, useContext } from "react";
import { makeCtx, type Archive, type Ctx, type Env, type PublicUser } from "@ppm/core";
import type { AppInfo } from "../platform/tauri";

export interface Session {
  env: Env;
  info: AppInfo;
  archive: Archive;
  user: PublicUser;
  /** Write context for the current user (via = ui). */
  ctx(): Ctx;
  logout(): void;
  /** Closes the archive (e.g. before restore) and returns to the start screen. */
  closeArchive(): Promise<void>;
  /** Closes the archive, restores the backup into its folder and re-opens it. */
  restoreFrom(zipPath: string): Promise<void>;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside SessionContext");
  return s;
}

export function buildCtx(env: Env, archive: Archive, user: PublicUser): Ctx {
  return makeCtx(env, archive.db, user.id, "ui");
}

/** Friendly message for any error thrown by core. */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "Der skete en ukendt fejl.";
}
