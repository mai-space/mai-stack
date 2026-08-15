import type { ProjectConfig } from './config.js';
import type { Worktree } from './worktree.js';
import { execCapture, type ExecResult } from './proc.js';
import { ddevExec } from './ddev.js';
import { appendJournal } from './journalClient.js';

export interface GateOutcome {
  gate: string;
  pass: boolean;
  output: string;
}

async function runCommand(project: ProjectConfig, worktree: Worktree, command: string): Promise<ExecResult> {
  if (project.runtime.type === 'ddev') return ddevExec(worktree, command);
  return execCapture(command, { cwd: worktree.path, timeoutMs: 10 * 60_000 });
}

function summarize(r: ExecResult): string {
  return (r.stdout + r.stderr).slice(0, 4000);
}

export async function runQualityGates(project: ProjectConfig, worktree: Worktree, taskId: string): Promise<GateOutcome[]> {
  const outcomes: GateOutcome[] = [];
  const gates = project.quality_gates;

  if (gates.phpstan?.enabled && gates.phpstan.command) {
    const r = await runCommand(project, worktree, gates.phpstan.command);
    const outcome: GateOutcome = { gate: 'phpstan', pass: r.exitCode === 0, output: summarize(r) };
    outcomes.push(outcome);
    await appendJournal(taskId, 'gate_result', outcome, { projectId: project.id });
  }

  if (gates.rector?.enabled && gates.rector.command) {
    const mode = gates.rector.mode ?? 'dry-run';
    const r = await runCommand(project, worktree, gates.rector.command);
    let pass = r.exitCode === 0;
    if (mode === 'apply' && r.exitCode !== 0) {
      // dry-run reported pending changes — apply them, then phpstan/e2e re-validate this attempt
      const applyCmd = gates.rector.command.replace(/\s+--dry-run\b/, '');
      const applied = await runCommand(project, worktree, applyCmd);
      pass = applied.exitCode === 0;
    }
    const outcome: GateOutcome = { gate: 'rector', pass, output: summarize(r) };
    outcomes.push(outcome);
    await appendJournal(taskId, 'gate_result', outcome, { projectId: project.id });
  }

  if (gates.e2e?.enabled && gates.e2e.command) {
    const r = await runCommand(project, worktree, gates.e2e.command);
    const outcome: GateOutcome = { gate: gates.e2e.tool ?? 'e2e', pass: r.exitCode === 0, output: summarize(r) };
    outcomes.push(outcome);
    await appendJournal(taskId, 'gate_result', outcome, { projectId: project.id });
  }

  return outcomes;
}
