import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { Database as DB } from '../src/db/schema.js';
import { up } from '../src/db/migrations/001_initial.js';

export function createTestDb(): Kysely<DB> {
  const sqlite = new Database(':memory:');
  return new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
}

export async function migrateTestDb(db: Kysely<DB>): Promise<void> {
  await up(db as any);
}

export function createFakeRedis() {
  const published: Array<{ channel: string; message: string }> = [];
  return {
    published,
    async publish(channel: string, message: string): Promise<void> {
      published.push({ channel, message });
    },
  };
}
