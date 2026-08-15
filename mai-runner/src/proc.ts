import { spawn } from 'node:child_process';

/** POSIX single-quote escaping — safe for the runner-generated paths/branch names used in shell commands here. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs a shell command (config-authored, not agent-authored) and captures output. */
export function execCapture(command: string, opts: { cwd: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } ): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: opts.cwd,
      shell: true,
      timeout: opts.timeoutMs,
      env: { ...process.env, ...opts.env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ exitCode: code ?? -1, stdout, stderr }));
    child.on('error', (err) => resolve({ exitCode: -1, stdout, stderr: stderr + String(err) }));
  });
}

export type OutputHandler = (stream: 'stdout' | 'stderr', text: string) => void;

/** Spawns an interactive-shaped process (a coding agent CLI) and streams output line-by-line. */
export function spawnStreaming(
  command: string,
  args: string[],
  opts: { cwd: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; onOutput: OutputHandler }
): Promise<{ exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs,
      env: { ...process.env, ...opts.env },
    });
    child.stdout?.on('data', (d) => opts.onOutput('stdout', d.toString()));
    child.stderr?.on('data', (d) => opts.onOutput('stderr', d.toString()));
    child.on('close', (code) => resolve({ exitCode: code ?? -1 }));
    child.on('error', (err) => {
      opts.onOutput('stderr', String(err));
      resolve({ exitCode: -1 });
    });
  });
}
