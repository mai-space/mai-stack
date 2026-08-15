import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('journal_entries')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('task_id', 'text', (col) => col.notNull())
    .addColumn('project_id', 'text')
    .addColumn('agent_id', 'text')
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('payload', 'text', (col) => col.notNull().defaultTo('{}'))
    .addColumn('created_at', 'text', (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex('journal_entries_task_id_idx')
    .ifNotExists()
    .on('journal_entries')
    .column('task_id')
    .execute();

  await db.schema
    .createIndex('journal_entries_project_id_idx')
    .ifNotExists()
    .on('journal_entries')
    .column('project_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('journal_entries').execute();
}
