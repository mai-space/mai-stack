import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('projects')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('created_at', 'text', (col) => col.notNull())
    .execute();

  await db.schema
    .createTable('tasks')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('project_id', 'text', (col) => col.notNull().references('projects.id'))
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('OPEN'))
    .addColumn('priority', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('assigned_agent', 'text')
    .addColumn('lease_expires_at', 'text')
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addColumn('updated_at', 'text', (col) => col.notNull())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('tasks').execute();
  await db.schema.dropTable('projects').execute();
}
