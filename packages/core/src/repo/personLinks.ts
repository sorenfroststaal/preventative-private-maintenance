/** Persons attached to recurring expenses and items (migration 0010, several per record). */
import type { DbAdapter } from "../db/adapter";
import { createEntity, deleteLink, type Ctx } from "./entities";

export type PersonLinkTarget = "recurring_expense" | "item";

export interface LinkedPerson {
  id: string;
  name: string;
}

/** Persons per record of a type, sorted by name. */
export async function personLinks(db: DbAdapter, targetType: PersonLinkTarget): Promise<Map<string, LinkedPerson[]>> {
  const rows = await db.select<{ target_id: string; id: string; name: string }>(
    `SELECT l.target_id, p.id, p.name FROM person_link l JOIN person p ON p.id = l.person_id
      WHERE l.target_type = ? AND p.archived_at IS NULL ORDER BY p.name`,
    [targetType],
  );
  const out = new Map<string, LinkedPerson[]>();
  for (const r of rows) out.set(r.target_id, [...(out.get(r.target_id) ?? []), { id: r.id, name: r.name }]);
  return out;
}

/** Sets exactly these persons on a record (adds and removes links, with audit). */
export async function setPersonLinks(ctx: Ctx, targetType: PersonLinkTarget, targetId: string, personIds: string[]): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const c = { ...ctx, db: tx };
    const now = new Set(
      (await tx.select<{ person_id: string }>("SELECT person_id FROM person_link WHERE target_type = ? AND target_id = ?", [targetType, targetId])).map((r) => r.person_id),
    );
    const want = new Set(personIds);
    for (const id of want) if (!now.has(id)) await createEntity(c, "person_link", { person_id: id, target_type: targetType, target_id: targetId });
    for (const id of now) if (!want.has(id)) await deleteLink(c, "person_link", { person_id: id, target_type: targetType, target_id: targetId });
  });
}
