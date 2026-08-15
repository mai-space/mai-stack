import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb, migrateTestDb } from './testDb.js';
import { seedFromYaml } from '../src/seed/fromYaml.js';

const tmpDirs: string[] = [];

function writeYaml(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mai-registry-test-'));
  tmpDirs.push(dir);
  const file = join(dir, 'projects.yml');
  writeFileSync(file, content);
  return file;
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('seedFromYaml', () => {
  it('does nothing when the config file is missing', async () => {
    const db = createTestDb();
    await migrateTestDb(db);
    await seedFromYaml(db, '/nonexistent/path/projects.yml');
    expect(await db.selectFrom('projects').selectAll().execute()).toHaveLength(0);
  });

  it('inserts projects from yaml with registry defaults applied', async () => {
    const file = writeYaml(`
projects:
  - id: app-a
    name: "App A"
    workspace: /workspaces/app-a
    allowed_agents: [cursor-claude]
`);
    const db = createTestDb();
    await migrateTestDb(db);
    await seedFromYaml(db, file);

    const rows = await db.selectFrom('projects').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].workspace_path).toBe('/workspaces/app-a');
    expect(rows[0].embedding_model).toBe('ollama:nomic-embed-text');
    expect(rows[0].reindex_threshold_minutes).toBe(15);
    expect(JSON.parse(rows[0].allowed_agent_ids)).toEqual(['cursor-claude']);
  });

  it('upserts on conflict, updating fields but preserving runtime state (last_indexed_at, index_health)', async () => {
    const file = writeYaml(`
projects:
  - id: app-a
    name: "App A"
    workspace: /workspaces/app-a
`);
    const db = createTestDb();
    await migrateTestDb(db);
    await seedFromYaml(db, file);

    // simulate the indexer having run since the last seed
    await db.updateTable('projects')
      .set({ last_indexed_at: '2026-01-01T00:00:00.000Z', index_health: 'healthy' })
      .where('id', '=', 'app-a')
      .execute();

    writeFileSync(file, `
projects:
  - id: app-a
    name: "App A Renamed"
    workspace: /workspaces/app-a
`);
    await seedFromYaml(db, file);

    const row = await db.selectFrom('projects').selectAll().where('id', '=', 'app-a').executeTakeFirstOrThrow();
    expect(row.name).toBe('App A Renamed');
    expect(row.last_indexed_at).toBe('2026-01-01T00:00:00.000Z');
    expect(row.index_health).toBe('healthy');
  });

  it('is a no-op when the yaml has no projects key', async () => {
    const file = writeYaml('other_key: 1\n');
    const db = createTestDb();
    await migrateTestDb(db);
    await seedFromYaml(db, file);
    expect(await db.selectFrom('projects').selectAll().execute()).toHaveLength(0);
  });
});
