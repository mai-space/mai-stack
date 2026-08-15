import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/proc.js', () => ({ execCapture: vi.fn() }));
vi.mock('../src/ddev.js', () => ({ ddevExec: vi.fn() }));
vi.mock('../src/journalClient.js', () => ({ appendJournal: vi.fn() }));

import { execCapture } from '../src/proc.js';
import { ddevExec } from '../src/ddev.js';
import { appendJournal } from '../src/journalClient.js';
import { runQualityGates } from '../src/gates.js';
import { ProjectConfigSchema } from '../src/config.js';
import type { Worktree } from '../src/worktree.js';

const worktree: Worktree = { path: '/tmp/wt', branch: 'agent/t1', taskId: 't1' };

function project(overrides: Record<string, unknown> = {}) {
  return ProjectConfigSchema.parse({
    id: 'app-a',
    workspace: '/workspaces/app-a',
    ...overrides,
  });
}

function ok(stdout = ''): { exitCode: number; stdout: string; stderr: string } {
  return { exitCode: 0, stdout, stderr: '' };
}

function fail(stdout = ''): { exitCode: number; stdout: string; stderr: string } {
  return { exitCode: 1, stdout, stderr: 'error output' };
}

beforeEach(() => {
  vi.mocked(execCapture).mockReset();
  vi.mocked(ddevExec).mockReset();
  vi.mocked(appendJournal).mockReset();
});

describe('runQualityGates', () => {
  it('runs nothing and returns [] when no gates are configured', async () => {
    const results = await runQualityGates(project(), worktree, 't1');
    expect(results).toEqual([]);
    expect(execCapture).not.toHaveBeenCalled();
    expect(ddevExec).not.toHaveBeenCalled();
  });

  it('runs commands via execCapture (not ddev) for a node-runtime project', async () => {
    vi.mocked(execCapture).mockResolvedValue(ok());
    const p = project({ runtime: { type: 'node' }, quality_gates: { e2e: { enabled: true, tool: 'cypress', command: 'npx cypress run' } } });

    const results = await runQualityGates(p, worktree, 't1');
    expect(results).toEqual([{ gate: 'cypress', pass: true, output: '' }]);
    expect(execCapture).toHaveBeenCalledWith('npx cypress run', { cwd: worktree.path, timeoutMs: 10 * 60_000 });
    expect(ddevExec).not.toHaveBeenCalled();
  });

  it('runs commands via ddevExec (not execCapture) for a ddev-runtime project', async () => {
    vi.mocked(ddevExec).mockResolvedValue(ok());
    const p = project({ runtime: { type: 'ddev' }, quality_gates: { phpstan: { enabled: true, command: 'phpstan analyse' } } });

    const results = await runQualityGates(p, worktree, 't1');
    expect(results).toEqual([{ gate: 'phpstan', pass: true, output: '' }]);
    expect(ddevExec).toHaveBeenCalledWith(worktree, 'phpstan analyse');
    expect(execCapture).not.toHaveBeenCalled();
  });

  it('a failing phpstan gate is reported as pass: false and journaled', async () => {
    vi.mocked(ddevExec).mockResolvedValue(fail('3 errors found'));
    const p = project({ runtime: { type: 'ddev' }, quality_gates: { phpstan: { enabled: true, command: 'phpstan analyse' } } });

    const results = await runQualityGates(p, worktree, 't1');
    expect(results[0].pass).toBe(false);
    expect(results[0].output).toContain('3 errors found');
    expect(appendJournal).toHaveBeenCalledWith('t1', 'gate_result', results[0], { projectId: 'app-a' });
  });

  it('rector in dry-run mode reports failure without attempting to apply', async () => {
    vi.mocked(ddevExec).mockResolvedValue(fail('would change 2 files'));
    const p = project({ runtime: { type: 'ddev' }, quality_gates: { rector: { enabled: true, mode: 'dry-run', command: 'rector process --dry-run' } } });

    const results = await runQualityGates(p, worktree, 't1');
    expect(results[0].pass).toBe(false);
    expect(ddevExec).toHaveBeenCalledTimes(1); // no apply attempt in dry-run mode
  });

  it('rector in apply mode re-runs without --dry-run when the dry-run reports pending changes', async () => {
    vi.mocked(ddevExec)
      .mockResolvedValueOnce(fail('would change 2 files')) // dry-run: changes pending
      .mockResolvedValueOnce(ok()); // apply: succeeds
    const p = project({ runtime: { type: 'ddev' }, quality_gates: { rector: { enabled: true, mode: 'apply', command: 'rector process --dry-run' } } });

    const results = await runQualityGates(p, worktree, 't1');
    expect(results[0].pass).toBe(true);
    expect(ddevExec).toHaveBeenCalledTimes(2);
    expect(ddevExec).toHaveBeenNthCalledWith(2, worktree, 'rector process'); // --dry-run stripped
  });

  it('rector in apply mode reports failure if the apply run itself fails', async () => {
    vi.mocked(ddevExec)
      .mockResolvedValueOnce(fail('would change 2 files'))
      .mockResolvedValueOnce(fail('syntax error introduced'));
    const p = project({ runtime: { type: 'ddev' }, quality_gates: { rector: { enabled: true, mode: 'apply', command: 'rector process --dry-run' } } });

    const results = await runQualityGates(p, worktree, 't1');
    expect(results[0].pass).toBe(false);
  });

  it('runs phpstan, rector, and e2e in order and aggregates all results', async () => {
    vi.mocked(ddevExec)
      .mockResolvedValueOnce(ok()) // phpstan
      .mockResolvedValueOnce(ok()) // rector dry-run, clean
      .mockResolvedValueOnce(ok()); // e2e
    const p = project({
      runtime: { type: 'ddev' },
      quality_gates: {
        phpstan: { enabled: true, command: 'phpstan analyse' },
        rector: { enabled: true, mode: 'dry-run', command: 'rector process --dry-run' },
        e2e: { enabled: true, tool: 'playwright', command: 'npx playwright test' },
      },
    });

    const results = await runQualityGates(p, worktree, 't1');
    expect(results.map(r => r.gate)).toEqual(['phpstan', 'rector', 'playwright']);
    expect(results.every(r => r.pass)).toBe(true);
  });
});
