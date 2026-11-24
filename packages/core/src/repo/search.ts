import { z } from 'zod';
import type { DbAdapter } from '../db/adapter';

export function ftsPrefix(query: unknown) {
  const words = z.string().max(1024).parse(query).match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.slice(0, 24).map(word => `"${word}"*`).join(' AND ');
}

export async function searchRecords(db: DbAdapter, query: unknown, userId?: string) {
  const expression = ftsPrefix(query);
  if (!expression) return [];
  return db.select<{ entity_type: string; entity_id: string; title: string; module: string }>(`SELECT entity_type, entity_id, title, module FROM search_index s
    WHERE search_index MATCH ?
      AND (module != 'health' OR EXISTS (
        SELECT 1 FROM person p WHERE p.archived_at IS NULL AND (p.health_private_user_id IS NULL OR p.health_private_user_id = ?)
        AND (p.id = CASE s.entity_type
          WHEN 'task' THEN (SELECT target_id FROM task WHERE id = s.entity_id AND target_type = 'person')
          WHEN 'health_visit' THEN (SELECT person_id FROM health_visit WHERE id = s.entity_id)
          WHEN 'health_screening' THEN (SELECT person_id FROM health_screening WHERE id = s.entity_id)
          WHEN 'health_vaccination' THEN (SELECT person_id FROM health_vaccination WHERE id = s.entity_id)
          WHEN 'health_medication' THEN (SELECT person_id FROM health_medication WHERE id = s.entity_id)
          WHEN 'health_allergy' THEN (SELECT person_id FROM health_allergy WHERE id = s.entity_id)
          WHEN 'health_measurement' THEN (SELECT person_id FROM health_measurement WHERE id = s.entity_id)
        END)))
      AND (s.entity_type != 'document' OR NOT EXISTS (
        SELECT 1 FROM document_link l WHERE l.document_id = s.entity_id AND l.target_type IN
        ('person', 'task_occurrence', 'health_visit', 'health_screening', 'health_vaccination', 'health_medication')
      ))
    ORDER BY rank LIMIT 100`, [expression, userId ?? null]);
}
