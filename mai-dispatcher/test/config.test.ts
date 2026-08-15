import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAgentProfiles, getAgentProfiles } from '../src/config.js';

const tmpDirs: string[] = [];
afterEach(() => { while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true }); });

function writeYaml(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mai-dispatcher-test-'));
  tmpDirs.push(dir);
  const file = join(dir, 'agents.yml');
  writeFileSync(file, content);
  return file;
}

describe('loadAgentProfiles', () => {
  it('parses a valid agents.yml and applies field defaults', () => {
    const file = writeYaml(`
agents:
  - id: cursor-claude
    type: cursor
    model_provider: anthropic
    model: claude-sonnet-5
    task_types: [code, refactor]
    max_concurrent_tasks: 2
    budget:
      daily_usd: 5
      per_task_usd: 0.5
    rate_limit:
      requests_per_minute: 10
`);
    const profiles = loadAgentProfiles(file);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe('cursor-claude');
    expect(profiles[0].budget?.daily_usd).toBe(5);
    expect(getAgentProfiles()).toBe(profiles); // same array the module caches
  });

  it('returns an empty array (without throwing) when the file does not exist', () => {
    const profiles = loadAgentProfiles('/nonexistent/agents.yml');
    expect(profiles).toEqual([]);
  });

  it('returns an empty array (without throwing) when the yaml fails schema validation', () => {
    const file = writeYaml(`
agents:
  - id: bad-agent
    # missing required fields: type, model_provider, model, task_types, max_concurrent_tasks
`);
    const profiles = loadAgentProfiles(file);
    expect(profiles).toEqual([]);
  });

  it('parses multiple agent profiles', () => {
    const file = writeYaml(`
agents:
  - id: a
    type: cursor
    model_provider: anthropic
    model: claude-sonnet-5
    task_types: [code]
    max_concurrent_tasks: 1
  - id: b
    type: opencode
    model_provider: openai
    model: gpt-4o-mini
    task_types: [docs]
    max_concurrent_tasks: 3
`);
    const profiles = loadAgentProfiles(file);
    expect(profiles.map(p => p.id)).toEqual(['a', 'b']);
  });
});
