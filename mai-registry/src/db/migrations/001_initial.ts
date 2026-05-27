import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('projects')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey().notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('slug', 'text', (col) => col.notNull().unique())
    .addColumn('workspace_path', 'text', (col) => col.notNull())
    .addColumn('agents_md_path', 'text')
    .addColumn('system_prompt_override', 'text')
    .addColumn('allowed_agent_ids', 'text', (col) => col.notNull().defaultTo('[]'))
    .addColumn('embedding_model', 'text', (col) => col.notNull().defaultTo('ollama:nomic-embed-text'))
    .addColumn('reindex_threshold_minutes', 'integer', (col) => col.notNull().defaultTo(15))
    .addColumn('last_indexed_at', 'text')
    .addColumn('index_health', 'text', (col) => col.notNull().defaultTo('unknown'))
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addColumn('updated_at', 'text', (col) => col.notNull())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('projects').execute();
}
