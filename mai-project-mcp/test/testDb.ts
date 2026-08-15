import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { Database as DB } from '../src/db/schema.js';
import { up as up001 } from '../src/db/migrations/001_initial.js';
import { up as up002 } from '../src/db/migrations/002_blockers.js';

export function createTestDb(): Kysely<DB> {
  const sqlite = new Database(':memory:');
  return new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
}

export async function migrateTestDb(db: Kysely<DB>): Promise<void> {
  await up001(db as any);
  await up002(db as any);
}

export async function insertProject(db: Kysely<DB>, id = 'proj-1'): Promise<string> {
  await db.insertInto('projects').values({ id, name: id, description: null, created_at: new Date().toISOString() }).execute();
  return id;
}

export async function insertTask(
  db: Kysely<DB>,
  overrides: Partial<{
    id: string;
    project_id: string;
    title: string;
    status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'BLOCKED';
    priority: number;
    parent_task_id: string | null;
    blocker_type: string | null;
    blocker_payload: string;
    assigned_agent: string | null;
  }> = {}
): Promise<string> {
  const id = overrides.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insertInto('tasks').values({
    id,
    project_id: overrides.project_id ?? 'proj-1',
    title: overrides.title ?? 'Task',
    description: null,
    status: overrides.status ?? 'OPEN',
    priority: overrides.priority ?? 0,
    assigned_agent: overrides.assigned_agent ?? null,
    lease_expires_at: null,
    parent_task_id: overrides.parent_task_id ?? null,
    blocker_type: overrides.blocker_type ?? null,
    blocker_payload: overrides.blocker_payload ?? '{}',
    blocker_resolved_at: null,
    created_at: now,
    updated_at: now,
  }).execute();
  return id;
}
