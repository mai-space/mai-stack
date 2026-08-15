import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadAgentProfiles, getManagedProfiles,
  loadProjectConfigs, getEligibleProjects,
} from '../src/config.js';
import type { AgentProfile } from '../src/config.js';

const tmpDirs: string[] = [];
afterEach(() => { while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true }); });

function writeTmp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mai-runner-test-'));
  tmpDirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, content);
  return file;
}

describe('loadAgentProfiles', () => {
  it('parses both external and managed profiles, applying M6 defaults', () => {
    const file = writeTmp('agents.yml', `
agents:
  - id: cursor-claude
    type: cursor
    mode: external
    task_types: [code]
    max_concurrent_tasks: 2
  - id: managed-claude-php
    type: claude-cli
    mode: managed
    task_types: [code]
    max_parallel_worktrees: 2
    max_gate_retries: 3
    cli:
      command: claude
      args: ["-p"]
`);
    const profiles = loadAgentProfiles(file);
    expect(profiles).toHaveLength(2);
    expect(profiles[0].mode).toBe('external');
    expect(profiles[1].mode).toBe('managed');
    expect(profiles[1].cli?.timeout_minutes).toBe(30); // default applied
  });

  it('defaults mode to external when omitted', () => {
    const file = writeTmp('agents.yml', `
agents:
  - id: a
    type: cursor
    task_types: [code]
`);
    expect(loadAgentProfiles(file)[0].mode).toBe('external');
  });

  it('getManagedProfiles filters to mode: managed only', () => {
    const file = writeTmp('agents.yml', `
agents:
  - id: ext
    type: cursor
    mode: external
    task_types: [code]
  - id: managed-1
    type: anthropic-api
    mode: managed
    task_types: [code]
    api:
      base_url: https://api.anthropic.com
      api_key_env: ANTHROPIC_API_KEY
      model: claude-sonnet-5
`);
    loadAgentProfiles(file);
    const managed = getManagedProfiles();
    expect(managed.map(p => p.id)).toEqual(['managed-1']);
  });

  it('returns an empty array without throwing on a missing file', () => {
    expect(loadAgentProfiles('/nonexistent/agents.yml')).toEqual([]);
  });
});

describe('loadProjectConfigs / getEligibleProjects', () => {
  it('applies runtime/quality_gates/pr_strategy defaults when omitted', () => {
    const file = writeTmp('projects.yml', `
projects:
  - id: app-a
    workspace: /workspaces/app-a
`);
    const projects = loadProjectConfigs(file);
    expect(projects[0].runtime).toEqual({ type: 'none', max_parallel_worktrees: 1 });
    expect(projects[0].pr_strategy).toBe('push-branch-only');
    expect(projects[0].allowed_agents).toEqual([]);
  });

  it('project_affinity restricts a managed agent to exactly those projects, ignoring allowed_agents', () => {
    loadProjectConfigs(writeTmp('projects.yml', `
projects:
  - id: app-a
    workspace: /a
    allowed_agents: [someone-else]
  - id: app-b
    workspace: /b
`));
    const profile = { id: 'managed-1', project_affinity: ['app-a'] } as AgentProfile;
    expect(getEligibleProjects(profile).map(p => p.id)).toEqual(['app-a']);
  });

  it('without affinity, falls back to allowed_agents (or unrestricted if empty)', () => {
    loadProjectConfigs(writeTmp('projects.yml', `
projects:
  - id: app-a
    workspace: /a
    allowed_agents: [managed-1]
  - id: app-b
    workspace: /b
    allowed_agents: [someone-else]
  - id: app-c
    workspace: /c
`));
    const profile = { id: 'managed-1' } as AgentProfile;
    const eligible = getEligibleProjects(profile).map(p => p.id);
    expect(eligible).toContain('app-a'); // explicitly allowed
    expect(eligible).toContain('app-c'); // unrestricted (empty allowed_agents)
    expect(eligible).not.toContain('app-b'); // allowed_agents excludes this agent
  });
});
