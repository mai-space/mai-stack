import Database from 'better-sqlite3';
import { Kysely, SqliteDialect, FileMigrationProvider, Migrator } from 'kysely';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { Database as DB } from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _db: Kysely<DB> | null = null;

export function getDb(dbPath: string): Kysely<DB> {
  if (!_db) {
    const sqlite = new Database(dbPath);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    _db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
  }
  return _db;
}

export async function runMigrations(db: Kysely<DB>): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, 'migrations'),
    }),
  });
  const { error, results } = await migrator.migrateToLatest();
  results?.forEach((r) => {
    if (r.status === 'Success') console.log(`Migration applied: ${r.migrationName}`);
    if (r.status === 'Error') console.error(`Migration failed: ${r.migrationName}`);
  });
  if (error) throw error;
}
