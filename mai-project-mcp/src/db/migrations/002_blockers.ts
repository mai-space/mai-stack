import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // SQLite ALTER TABLE ADD COLUMN — safe since migration 001 has no CHECK constraint on status
  await db.schema.alterTable('tasks').addColumn('parent_task_id', 'text').execute();
  await db.schema.alterTable('tasks').addColumn('blocker_type', 'text').execute();
  await db.schema.alterTable('tasks').addColumn('blocker_payload', 'text', (col) => col.notNull().defaultTo('{}')).execute();
  await db.schema.alterTable('tasks').addColumn('blocker_resolved_at', 'text').execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  // SQLite cannot DROP COLUMN in older versions; rebuild would be needed
}
